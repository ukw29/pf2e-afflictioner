/**
 * Affliction Manager - ApplicationV2-based UI for managing afflictions
 */

import { MODULE_ID } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { TreatmentService } from '../services/TreatmentService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';

export class AfflictionManager extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static currentInstance = null;

  static DEFAULT_OPTIONS = {
    id: 'pf2e-afflictioner-manager',
    classes: ['pf2e-afflictioner', 'affliction-manager'],
    tag: 'div',
    window: {
      title: 'PF2E_AFFLICTIONER.MANAGER.TITLE',
      icon: 'fas fa-biohazard',
      resizable: true
    },
    position: {
      width: 600,
      height: 'auto'
    },
    actions: {
      addAffliction: AfflictionManager.addAffliction,
      removeAffliction: AfflictionManager.removeAffliction,
      progressStage: AfflictionManager.progressStage,
      regressStage: AfflictionManager.regressStage,
      rollSave: AfflictionManager.rollSave,
      treatAffliction: AfflictionManager.treatAffliction
    }
  };

  static PARTS = {
    form: {
      template: 'modules/pf2e-afflictioner/templates/affliction-manager.hbs'
    }
  };

  constructor(options = {}) {
    super(options);

    // GM-only access
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can access the Affliction Manager');
      this.close();
      return;
    }

    // Optional token filter
    this.filterTokenId = options.filterTokenId || null;

    // Set as current instance
    AfflictionManager.currentInstance = this;

    // Setup auto-refresh
    this._setupAutoRefresh();
  }

  /**
   * Setup auto-refresh on combat updates
   */
  _setupAutoRefresh() {
    this._combatHook = Hooks.on('updateCombat', () => {
      this.render({ force: true });
    });

    this._tokenUpdateHook = Hooks.on('updateToken', () => {
      this.render({ force: true });
    });
  }

  async close(options = {}) {
    // Cleanup hooks
    if (this._combatHook) {
      Hooks.off('updateCombat', this._combatHook);
    }
    if (this._tokenUpdateHook) {
      Hooks.off('updateToken', this._tokenUpdateHook);
    }

    AfflictionManager.currentInstance = null;
    return super.close(options);
  }

  async _prepareContext(options) {
    // Get all tokens with afflictions
    const tokensWithAfflictions = [];

    // Determine which tokens to show
    const tokensToCheck = this.filterTokenId
      ? [canvas.tokens.get(this.filterTokenId)].filter(t => t)
      : canvas.tokens.placeables;

    for (const token of tokensToCheck) {
      const afflictions = AfflictionStore.getAfflictions(token);
      if (Object.keys(afflictions).length > 0) {
        tokensWithAfflictions.push({
          token: token,
          tokenId: token.id,
          name: token.name,
          img: token.document.texture.src,
          afflictions: Object.values(afflictions).map(aff => ({
            ...aff,
            stageDisplay: aff.inOnset ? game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.ONSET') : `${game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.STAGE')} ${aff.currentStage}`,
            nextSaveDisplay: this.formatNextSave(aff),
            treatmentDisplay: this.formatTreatment(aff),
            hasWarning: aff.stages[aff.currentStage - 1]?.requiresManualHandling || false,
            stageTooltip: this.formatStageTooltip(aff)
          }))
        });
      }
    }

    return {
      tokens: tokensWithAfflictions,
      hasAfflictions: tokensWithAfflictions.length > 0
    };
  }

  formatNextSave(affliction) {
    const combat = game.combat;

    // In combat with scheduled save
    if (combat && affliction.nextSaveRound) {
      const remaining = affliction.nextSaveRound - combat.round;
      if (remaining <= 0) {
        return game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.NOW');
      }
      return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.IN_ROUNDS', {
        rounds: remaining
      });
    }

    // Out of combat - show time-based info
    if (!combat) {
      if (affliction.inOnset && affliction.onsetRemaining) {
        const minutes = Math.ceil(affliction.onsetRemaining / 60);
        return `Onset: ${minutes}m`;
      }

      // Show elapsed time for current stage
      const stage = affliction.stages?.[affliction.currentStage - 1];
      if (stage?.duration) {
        const elapsed = affliction.durationElapsed || 0;
        const total = this.constructor.durationToSeconds(stage.duration);
        const remaining = total - elapsed;
        const minutes = Math.ceil(remaining / 60);
        return `${minutes}m until save`;
      }
    }

    return 'N/A';
  }

  static durationToSeconds(duration) {
    if (!duration) return 0;
    return AfflictionParser.durationToSeconds(duration);
  }

  formatTreatment(affliction) {
    if (affliction.treatedThisStage) {
      const bonus = affliction.treatmentBonus;
      return `${game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.TREATMENT')}: ${bonus > 0 ? '+' : ''}${bonus}`;
    }
    return game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.NOT_TREATED');
  }

  formatStageTooltip(affliction) {
    if (affliction.inOnset) {
      if (affliction.onset) {
        return `Onset: ${affliction.onset.value} ${affliction.onset.unit}(s) - No effects yet`;
      }
      return 'Onset period - No effects yet';
    }

    if (affliction.currentStage === 0) {
      return 'Not yet afflicted';
    }

    const stage = affliction.stages[affliction.currentStage - 1];
    if (!stage) {
      return 'Stage information unavailable';
    }

    // Build tooltip text
    let tooltip = `Stage ${affliction.currentStage}:\n`;

    if (stage.effects) {
      tooltip += `${stage.effects}\n`;
    }

    if (stage.damage && stage.damage.length > 0) {
      tooltip += `Damage: ${stage.damage.join(', ')}\n`;
    }

    if (stage.conditions && stage.conditions.length > 0) {
      const conditionText = stage.conditions
        .map(c => c.value ? `${c.name} ${c.value}` : c.name)
        .join(', ');
      tooltip += `Conditions: ${conditionText}\n`;
    }

    if (stage.duration) {
      tooltip += `Duration: ${stage.duration.value} ${stage.duration.unit}(s)`;
    }

    if (stage.requiresManualHandling) {
      tooltip += `\n⚠️ Requires manual handling`;
    }

    return tooltip.trim();
  }

  static async addAffliction(event, button) {
    // Get selected token or first token with afflictions
    const token = canvas.tokens.controlled[0] ||
                  (this.filterTokenId ? canvas.tokens.get(this.filterTokenId) : null);

    if (!token) {
      ui.notifications.warn('Please select a token first');
      return;
    }

    // Import and show dialog
    const { AddAfflictionDialog } = await import('./AddAfflictionDialog.js');
    new AddAfflictionDialog(token).render(true);
  }

  static async removeAffliction(event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (!token) {
      ui.notifications.warn('Token not found');
      return;
    }

    await AfflictionStore.removeAffliction(token, afflictionId);

    // Wait for document to sync
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check if token has any remaining afflictions
    const remainingAfflictions = AfflictionStore.getAfflictions(token);
    if (Object.keys(remainingAfflictions).length === 0) {
      // No more afflictions - remove visual indicator
      const { VisualService } = await import('../services/VisualService.js');
      await VisualService.removeAfflictionIndicator(token);
    }

    ui.notifications.info(`Removed affliction from ${token.name}`);
    this.render({ force: true });
  }

  static async progressStage(event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      // Force regular failure (+1 stage): save 10, DC 15
      await AfflictionService.handleStageSave(token, affliction, 10, 15, true);
      this.render({ force: true });
    }
  }

  static async regressStage(event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      // Force regular success (-1 stage): save 15, DC 10
      await AfflictionService.handleStageSave(token, affliction, 15, 10, true);
      this.render({ force: true });
    }
  }

  static async rollSave(event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      await AfflictionService.promptSave(token, affliction);
    }
  }

  static async treatAffliction(event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      await TreatmentService.promptTreatment(token, affliction);
    }
  }
}
