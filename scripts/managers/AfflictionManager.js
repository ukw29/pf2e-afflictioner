/**
 * Affliction Manager - ApplicationV2-based UI for managing afflictions
 */

import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { TreatmentService } from '../services/TreatmentService.js';
import { CounteractService } from '../services/CounteractService.js';
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
      clearAllAfflictions: AfflictionManager.clearAllAfflictions,
      editAffliction: AfflictionManager.editAffliction,
      progressStage: AfflictionManager.progressStage,
      regressStage: AfflictionManager.regressStage,
      rollSave: AfflictionManager.rollSave,
      rollDamage: AfflictionManager.rollDamage,
      treatAffliction: AfflictionManager.treatAffliction,
      counteractAffliction: AfflictionManager.counteractAffliction
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
   * Setup auto-refresh on combat updates and world time changes
   */
  _setupAutoRefresh() {
    this._combatHook = Hooks.on('updateCombat', () => {
      this.render({ force: true });
    });

    this._tokenUpdateHook = Hooks.on('updateToken', () => {
      this.render({ force: true });
    });

    this._worldTimeHook = Hooks.on('updateWorldTime', (_worldTime, _delta) => {
      this.render({ force: true });
    });
  }

  /**
   * Setup drag-and-drop handlers after render
   */
  _onRender(context, options) {
    super._onRender?.(context, options);

    const element = this.element;
    if (!element) return;

    // Check if already initialized (prevent duplicate listeners)
    if (this._dropHandlersInitialized) return;
    this._dropHandlersInitialized = true;

    // Make the window a drop target
    element.addEventListener('drop', this._onDrop.bind(this));
    element.addEventListener('dragover', this._onDragOver.bind(this));
    element.addEventListener('dragenter', this._onDragEnter.bind(this));
    element.addEventListener('dragleave', this._onDragLeave.bind(this));
  }

  _onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  _onDragEnter(event) {
    event.preventDefault();
    const element = this.element;
    if (element) {
      element.classList.add('drag-over');
      element.style.outline = '2px dashed #4CAF50';
    }
  }

  _onDragLeave(event) {
    // Only remove highlight if leaving the window entirely
    if (event.target === this.element) {
      const element = this.element;
      if (element) {
        element.classList.remove('drag-over');
        element.style.outline = '';
      }
    }
  }

  async _onDrop(event) {
    event.preventDefault();

    // Remove drop highlight
    const element = this.element;
    if (element) {
      element.classList.remove('drag-over');
      element.style.outline = '';
    }

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      ui.notifications.warn('Invalid drag data');
      return;
    }

    // Find which token section was dropped on
    const tokenSection = event.target.closest('.token-section');
    let targetTokenId = null;

    if (tokenSection) {
      // Get the first affliction in this section to find the token ID
      const firstAffliction = tokenSection.querySelector('[data-token-id]');
      if (firstAffliction) {
        targetTokenId = firstAffliction.dataset.tokenId;
      }
    }

    // Handle affliction drag from chat message
    if (data.type === 'Affliction' && data.afflictionData) {
      await this._applyDraggedAffliction(data.afflictionData, data.itemUuid, targetTokenId);
      return;
    }

    // Handle item drag (existing functionality)
    if (data.type === 'Item') {
      await this._applyDraggedItem(data.uuid, targetTokenId);
      return;
    }
  }

  async _applyDraggedAffliction(afflictionData, _itemUuid, targetTokenId = null) {
    // Priority: dropped on token section > filter token > selected token
    let token = null;

    if (targetTokenId) {
      // Dropped on a specific token section
      token = canvas.tokens.get(targetTokenId);
    } else if (this.filterTokenId) {
      // Manager is filtered to specific token
      token = canvas.tokens.get(this.filterTokenId);
    } else {
      // Fall back to selected token
      token = canvas.tokens.controlled[0];
    }

    if (!token) {
      ui.notifications.warn('Please select a token or drop on a token section');
      return;
    }

    // Prompt for initial save - this will handle the full affliction flow
    const { AfflictionService } = await import('../services/AfflictionService.js');
    await AfflictionService.promptInitialSave(token, afflictionData);

    // Refresh the manager
    this.render({ force: true });
  }

  async _applyDraggedItem(itemUuid, targetTokenId = null) {
    // Priority: dropped on token section > filter token > selected token
    let token = null;

    if (targetTokenId) {
      // Dropped on a specific token section
      token = canvas.tokens.get(targetTokenId);
    } else if (this.filterTokenId) {
      // Manager is filtered to specific token
      token = canvas.tokens.get(this.filterTokenId);
    } else {
      // Fall back to selected token
      token = canvas.tokens.controlled[0];
    }

    if (!token) {
      ui.notifications.warn('Please select a token or drop on a token section');
      return;
    }

    // Load item
    const item = await fromUuid(itemUuid);
    if (!item) {
      ui.notifications.error('Could not load item');
      return;
    }

    // Check if it has poison/disease trait
    const traits = item.system?.traits?.value || [];
    if (!traits.includes('poison') && !traits.includes('disease')) {
      ui.notifications.warn('Item must have poison or disease trait');
      return;
    }

    // Parse and apply affliction
    const afflictionData = AfflictionParser.parseFromItem(item);
    if (!afflictionData) {
      ui.notifications.error('Could not parse affliction from item');
      return;
    }

    await this._applyDraggedAffliction(afflictionData, itemUuid);
  }

  async close(options = {}) {
    // Cleanup hooks
    if (this._combatHook) {
      Hooks.off('updateCombat', this._combatHook);
    }
    if (this._tokenUpdateHook) {
      Hooks.off('updateToken', this._tokenUpdateHook);
    }
    if (this._worldTimeHook) {
      Hooks.off('updateWorldTime', this._worldTimeHook);
    }

    // Reset drop handler flag
    this._dropHandlersInitialized = false;

    AfflictionManager.currentInstance = null;
    return super.close(options);
  }

  async _prepareContext(_options) {
    // Get all tokens with afflictions
    const tokensWithAfflictions = [];

    // Determine which tokens to show
    const tokensToCheck = this.filterTokenId
      ? [canvas.tokens.get(this.filterTokenId)].filter(t => t)
      : canvas.tokens.placeables;

    const combat = game.combat;

    // NOTE: Condition cleanup is now handled by GrantItem automatically
    // When affliction effects are removed, PF2e removes granted conditions

    for (const token of tokensToCheck) {
      const afflictions = AfflictionStore.getAfflictions(token);

      // Migrate legacy afflictions to add missing timestamp fields
      // Also handle afflictions that were added in combat but combat has ended
      for (const [id, affliction] of Object.entries(afflictions)) {
        if (!combat && !affliction.inOnset) {
          // Check if timestamp is missing or in old format (milliseconds instead of seconds)
          const needsMigration = !affliction.nextSaveTimestamp || affliction.nextSaveTimestamp > 1000000000000;

          if (needsMigration) {
            // Calculate when next save should be in game world time
            const currentStage = affliction.stages?.[affliction.currentStage - 1];
            if (currentStage?.duration) {
              const durationSeconds = AfflictionParser.durationToSeconds(currentStage.duration);
              // Use current world time + full duration (we don't track exactly when it was added)
              const nextSaveTimestamp = game.time.worldTime + durationSeconds;

              // Update the affliction with the timestamp
              await AfflictionStore.updateAffliction(token, id, {
                nextSaveTimestamp: nextSaveTimestamp
              });
            }
          }
        }
      }

      // Re-fetch afflictions after migration
      const updatedAfflictions = AfflictionStore.getAfflictions(token);
      if (Object.keys(updatedAfflictions).length > 0) {
        tokensWithAfflictions.push({
          token: token,
          tokenId: token.id,
          name: token.name,
          img: token.document.texture.src,
          afflictions: Object.values(updatedAfflictions).map(aff => {
            const currentStage = aff.stages[aff.currentStage - 1];
            const hasDamage = currentStage && currentStage.damage && currentStage.damage.length > 0;

            return {
              ...aff,
              stageDisplay: aff.currentStage === -1
                ? 'Initial Save'
                : aff.inOnset
                  ? game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.ONSET')
                  : `${game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.STAGE')} ${aff.currentStage}`,
              nextSaveDisplay: this.formatNextSave(aff),
              treatmentDisplay: this.formatTreatment(aff),
              hasWarning: aff.stages[aff.currentStage - 1]?.requiresManualHandling || false,
              hasDamage: hasDamage,
              stageTooltip: this.formatStageTooltip(aff),
              isVirulent: aff.isVirulent || false,
              hasMultipleExposure: aff.multipleExposure?.enabled || false,
              multipleExposureIncrease: aff.multipleExposure?.stageIncrease || 0,
              canProgressStage: aff.currentStage < aff.stages.length,
              canRegressStage: aff.currentStage > 1
            };
          })
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

    // Check if we're in onset
    if (affliction.inOnset && affliction.onsetRemaining) {
      return `Onset: ${AfflictionParser.formatDuration(affliction.onsetRemaining)}`;
    }

    // Get current stage to determine display format
    const stage = affliction.stages?.[affliction.currentStage - 1];
    const durationUnit = stage?.duration?.unit?.toLowerCase();

    // In combat with scheduled save
    if (combat && affliction.nextSaveRound) {
      const remaining = affliction.nextSaveRound - combat.round;

      if (remaining <= 0) {
        return game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.NOW');
      }

      // Show based on original duration unit
      if (durationUnit === 'round') {
        // Duration was in rounds → Show rounds
        return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.IN_ROUNDS', {
          rounds: remaining
        });
      } else {
        // Duration was in time units → Show time
        const remainingSeconds = remaining * 6; // Convert rounds to seconds
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.ceil((remainingSeconds % 3600) / 60);

        if (hours > 0) {
          return `${hours}h ${minutes}m until save`;
        }
        return `${minutes}m until save`;
      }
    }

    // Out of combat - show time-based info
    if (!combat) {
      // Use timestamp if available (timestamp is in game world time seconds)
      if (affliction.nextSaveTimestamp) {
        const remainingSeconds = Math.max(0, affliction.nextSaveTimestamp - game.time.worldTime);

        if (remainingSeconds <= 0) return 'Save due!';

        return `${AfflictionParser.formatDuration(remainingSeconds)} until save`;
      }

      // Fall back to showing full duration (for very old afflictions without proper tracking)
      if (stage?.duration) {
        const durationSeconds = this.constructor.durationToSeconds(stage.duration);
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.ceil((durationSeconds % 3600) / 60);

        if (hours > 0) {
          return `~${hours}h ${minutes}m until save`;
        }
        return `~${minutes}m until save`;
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

  /**
   * Clean up text by removing @UUID wrappers and @Damage notation
   */
  static cleanTooltipText(text) {
    if (!text) return '';

    // Extract display text from @UUID[path]{DisplayText} -> DisplayText
    let cleaned = text.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1');

    // Remove standalone @UUID[path] (no display text)
    cleaned = cleaned.replace(/@UUID\[[^\]]+\]/g, '');

    // Clean up @Damage[formula[type]] -> formula (type)
    cleaned = cleaned.replace(/@Damage\[([^[]+)\[([^\]]+)\]\]/g, '$1 ($2 damage)');

    // Clean up @Damage[formula] -> formula
    cleaned = cleaned.replace(/@Damage\[([^\]]+)\]/g, '$1');

    return cleaned.trim();
  }

  formatStageTooltip(affliction) {
    if (affliction.currentStage === -1) {
      return `Awaiting initial Fortitude save (DC ${affliction.dc}) to determine if afflicted`;
    }

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
      const cleanEffects = this.constructor.cleanTooltipText(stage.effects);
      tooltip += `${cleanEffects}\n`;
    }

    if (stage.damage && stage.damage.length > 0) {
      const damageText = stage.damage.map(d => {
        if (typeof d === 'string') return d;
        return `${d.formula} ${d.type}`;
      }).join(', ');
      tooltip += `Damage: ${damageText}\n`;
    }

    if (stage.conditions && stage.conditions.length > 0) {
      const conditionText = stage.conditions
        .map(c => c.value ? `${c.name} ${c.value}` : c.name)
        .join(', ');
      tooltip += `Conditions: ${conditionText}\n`;
    }

    if (stage.weakness && stage.weakness.length > 0) {
      const weaknessText = stage.weakness
        .map(w => `Weakness to ${w.type} ${w.value}`)
        .join(', ');
      tooltip += `${weaknessText}\n`;
    }

    if (stage.duration) {
      tooltip += `Duration: ${stage.duration.value} ${stage.duration.unit}(s)`;
    }

    if (stage.requiresManualHandling) {
      tooltip += `\n⚠️ Requires manual handling`;
    }

    return tooltip.trim();
  }

  static async addAffliction(_event, _button) {
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

  static async removeAffliction(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (!token) {
      ui.notifications.warn('Token not found');
      return;
    }

    // Get affliction data before removing it (needed for cleanup)
    const affliction = AfflictionStore.getAffliction(token, afflictionId);

    // Get old stage data for cleanup (handle onset stage 0)
    const oldStageData = affliction?.currentStage > 0
      ? affliction.stages[affliction.currentStage - 1]
      : null;

    // Remove affliction data from store
    await AfflictionStore.removeAffliction(token, afflictionId);

    // Clean up all effects and conditions
    if (affliction) {
      await AfflictionService.removeStageEffects(token, affliction, oldStageData, null);
    }

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

  static async editAffliction(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (!token) {
      ui.notifications.warn('Token not found');
      return;
    }

    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) {
      ui.notifications.warn('Affliction not found');
      return;
    }

    // Import and show editor dialog
    const { AfflictionEditorDialog } = await import('./AfflictionEditorDialog.js');
    new AfflictionEditorDialog(affliction).render(true);
  }

  static async clearAllAfflictions(_event, _button) {
    // Confirm before clearing
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.CLEAR_ALL_CONFIRM_TITLE'),
      content: `<p>${game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.CLEAR_ALL_CONFIRM_CONTENT')}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    // Get all tokens to clear
    const tokensToCheck = this.filterTokenId
      ? [canvas.tokens.get(this.filterTokenId)].filter(t => t)
      : canvas.tokens.placeables;

    let clearedCount = 0;
    const clearedTokens = [];

    for (const token of tokensToCheck) {
      const afflictions = AfflictionStore.getAfflictions(token);
      const afflictionIds = Object.keys(afflictions);

      if (afflictionIds.length === 0) continue;

      // Remove each affliction
      for (const afflictionId of afflictionIds) {
        const affliction = afflictions[afflictionId];
        // Get old stage data for cleanup (handle onset stage 0)
        const oldStageData = affliction?.currentStage > 0
          ? affliction.stages[affliction.currentStage - 1]
          : null;

        await AfflictionStore.removeAffliction(token, afflictionId);
        await AfflictionService.removeStageEffects(token, affliction, oldStageData, null);
        clearedCount++;
      }

      // Remove visual indicator
      const { VisualService } = await import('../services/VisualService.js');
      await VisualService.removeAfflictionIndicator(token);

      clearedTokens.push(token.name);
    }

    if (clearedCount > 0) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.MANAGER.CLEARED_ALL', {
        count: clearedCount,
        tokens: clearedTokens.join(', ')
      }));
    } else {
      ui.notifications.info('No afflictions to clear');
    }

    this.render({ force: true });
  }

  static async progressStage(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);

      // Check if already at max stage
      if (affliction.currentStage >= affliction.stages.length) {
        ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MAX_STAGE', {
          tokenName: token.name,
          afflictionName: affliction.name
        }));
        return;
      }

      // Force regular failure (+1 stage): save 10, DC 15
      await AfflictionService.handleStageSave(token, affliction, 10, 15, true);
      this.render({ force: true });
    }
  }

  static async regressStage(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);

      // Check if already at min stage (stage 1)
      if (affliction.currentStage <= 1) {
        ui.notifications.info(`${token.name} is already at stage 1 of ${affliction.name}. Use "Remove Affliction" to cure.`);
        return;
      }

      // Force regular success (-1 stage): save 15, DC 10
      await AfflictionService.handleStageSave(token, affliction, 15, 10, true);
      this.render({ force: true });
    }
  }

  static async rollSave(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      await AfflictionService.promptSave(token, affliction);
    }
  }

  static async rollDamage(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      await AfflictionService.promptDamage(token, affliction);
    }
  }

  static async treatAffliction(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      await TreatmentService.promptTreatment(token, affliction);
    }
  }

  static async counteractAffliction(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (!token) {
      ui.notifications.warn('Token not found');
      return;
    }

    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) {
      ui.notifications.warn('Affliction not found');
      return;
    }

    await CounteractService.promptCounteract(token, affliction);
  }
}
