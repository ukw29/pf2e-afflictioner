import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { TreatmentService } from '../services/TreatmentService.js';
import { CounteractService } from '../services/CounteractService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import { shouldSkipAffliction } from '../utils.js';
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

    if (!game.user.isGM) {
      ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.GM_ONLY_MANAGER'));
      this.close();
      return;
    }

    this.filterTokenId = options.filterTokenId || null;
    AfflictionManager.currentInstance = this;
    this._setupAutoRefresh();
  }

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

  _onRender(context, options) {
    super._onRender?.(context, options);

    const element = this.element;
    if (!element) return;

    if (this._dropHandlersInitialized) return;
    this._dropHandlersInitialized = true;

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

    const element = this.element;
    if (element) {
      element.classList.remove('drag-over');
      element.style.outline = '';
    }

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.INVALID_DRAG_DATA'));
      return;
    }

    const tokenSection = event.target.closest('.token-section');
    let targetTokenId = null;

    if (tokenSection) {
      const firstAffliction = tokenSection.querySelector('[data-token-id]');
      if (firstAffliction) {
        targetTokenId = firstAffliction.dataset.tokenId;
      }
    }

    if (data.type === 'Affliction' && data.afflictionData) {
      await this._applyDraggedAffliction(data.afflictionData, data.itemUuid, targetTokenId);
      return;
    }

    if (data.type === 'Item') {
      await this._applyDraggedItem(data.uuid, targetTokenId);
      return;
    }
  }

  async _applyDraggedAffliction(afflictionData, _itemUuid, targetTokenId = null) {
    let token = null;

    if (targetTokenId) {
      token = canvas.tokens.get(targetTokenId);
    } else if (this.filterTokenId) {
      token = canvas.tokens.get(this.filterTokenId);
    } else {
      token = canvas.tokens.controlled[0];
    }

    if (!token) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.SELECT_TOKEN_OR_DROP'));
      return;
    }

    const { AfflictionService } = await import('../services/AfflictionService.js');
    await AfflictionService.promptInitialSave(token, afflictionData);

    this.render({ force: true });
  }

  async _applyDraggedItem(itemUuid, targetTokenId = null) {
    let token = null;

    if (targetTokenId) {
      token = canvas.tokens.get(targetTokenId);
    } else if (this.filterTokenId) {
      token = canvas.tokens.get(this.filterTokenId);
    } else {
      token = canvas.tokens.controlled[0];
    }

    if (!token) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.SELECT_TOKEN_OR_DROP'));
      return;
    }

    const item = await fromUuid(itemUuid);
    if (!item) {
      ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.COULD_NOT_LOAD_ITEM'));
      return;
    }

    const traits = item.system?.traits?.value || [];
    if (!traits.includes('poison') && !traits.includes('disease')) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.ITEM_MUST_HAVE_TRAIT'));
      return;
    }

    const afflictionData = AfflictionParser.parseFromItem(item);
    if (shouldSkipAffliction(afflictionData)) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_SKIPPED'));
      return;
    }

    if (!afflictionData) {
      ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.COULD_NOT_PARSE'));
      return;
    }

    await this._applyDraggedAffliction(afflictionData, itemUuid);
  }

  async close(options = {}) {
    if (this._combatHook) {
      Hooks.off('updateCombat', this._combatHook);
    }
    if (this._tokenUpdateHook) {
      Hooks.off('updateToken', this._tokenUpdateHook);
    }
    if (this._worldTimeHook) {
      Hooks.off('updateWorldTime', this._worldTimeHook);
    }

    this._dropHandlersInitialized = false;

    AfflictionManager.currentInstance = null;
    return super.close(options);
  }

  async _prepareContext(_options) {
    const tokensWithAfflictions = [];

    const tokensToCheck = this.filterTokenId
      ? [canvas.tokens.get(this.filterTokenId)].filter(t => t)
      : canvas.tokens.placeables;

    const combat = game.combat;

    for (const token of tokensToCheck) {
      const afflictions = AfflictionStore.getAfflictions(token);

      for (const [id, affliction] of Object.entries(afflictions)) {
        if (!combat && !affliction.inOnset) {
          const needsMigration = !affliction.nextSaveTimestamp || affliction.nextSaveTimestamp > 1000000000000;

          if (needsMigration) {
            const currentStage = affliction.stages?.[affliction.currentStage - 1];
            if (currentStage?.duration) {
              const durationSeconds = AfflictionParser.durationToSeconds(currentStage.duration);
              const nextSaveTimestamp = game.time.worldTime + durationSeconds;

              await AfflictionStore.updateAffliction(token, id, {
                nextSaveTimestamp: nextSaveTimestamp
              });
            }
          }
        }
      }

      const updatedAfflictions = AfflictionStore.getAfflictions(token);
      if (Object.keys(updatedAfflictions).length > 0) {
        tokensWithAfflictions.push({
          token: token,
          tokenId: token.id,
          name: token.name,
          img: token.document.texture.src,
          afflictions: Object.values(updatedAfflictions).map(aff => {
            const stageIndex = aff.currentStage - 1;
            const currentStage = (stageIndex >= 0 && aff.stages) ? aff.stages[stageIndex] : undefined;
            const hasDamage = currentStage && currentStage.damage && currentStage.damage.length > 0;

            return {
              ...aff,
              stageDisplay: aff.currentStage === -1
                ? game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.INITIAL_SAVE')
                : aff.inOnset
                  ? game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.ONSET')
                  : `${game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.STAGE')} ${aff.currentStage}`,
              nextSaveDisplay: this.formatNextSave(aff),
              treatmentDisplay: this.formatTreatment(aff),
              hasWarning: currentStage?.requiresManualHandling || false,
              hasDamage: hasDamage,
              stageTooltip: this.formatStageTooltip(aff),
              isVirulent: aff.isVirulent || false,
              hasMultipleExposure: aff.multipleExposure?.enabled || false,
              multipleExposureIncrease: aff.multipleExposure?.stageIncrease || 0,
              canProgressStage: aff.currentStage < (aff.stages?.length ?? 0),
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

    if (affliction.inOnset && affliction.onsetRemaining) {
      return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.ONSET_PREFIX', { duration: AfflictionParser.formatDuration(affliction.onsetRemaining) });
    }

    const stage = affliction.stages?.[affliction.currentStage - 1];
    const durationUnit = stage?.duration?.unit?.toLowerCase();

    if (combat && affliction.nextSaveRound) {
      const remaining = affliction.nextSaveRound - combat.round;

      if (remaining <= 0) {
        return game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.NOW');
      }

      if (durationUnit === 'round') {
        return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.IN_ROUNDS', {
          rounds: remaining
        });
      } else {
        const remainingSeconds = remaining * 6;
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.ceil((remainingSeconds % 3600) / 60);

        if (hours > 0) {
          return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.TIME_HOURS_MIN', { hours, minutes });
        }
        return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.TIME_MIN', { minutes });
      }
    }

    if (!combat) {
      if (affliction.nextSaveTimestamp) {
        const remainingSeconds = Math.max(0, affliction.nextSaveTimestamp - game.time.worldTime);

        if (remainingSeconds <= 0) return game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.SAVE_DUE');

        return `${AfflictionParser.formatDuration(remainingSeconds)} until save`;
      }

      if (stage?.duration) {
        const durationSeconds = this.constructor.durationToSeconds(stage.duration);
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.ceil((durationSeconds % 3600) / 60);

        if (hours > 0) {
          return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.TIME_APPROX_HOURS_MIN', { hours, minutes });
        }
        return game.i18n.format('PF2E_AFFLICTIONER.MANAGER.TIME_APPROX_MIN', { minutes });
      }
    }

    return game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.NOT_AVAILABLE');
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

  static cleanTooltipText(text) {
    if (!text) return '';

    let cleaned = text.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1');
    cleaned = cleaned.replace(/@UUID\[[^\]]+\]/g, '');
    cleaned = cleaned.replace(/@Damage\[([^[]+)\[([^\]]+)\]\]/g, '$1 ($2 damage)');
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
        .map(c => {
          if (c.name === 'persistent damage' || c.name === 'persistent-damage') {
            return `${c.persistentFormula || '1d6'} ${c.persistentType || 'untyped'} persistent damage`;
          }
          return c.value ? `${c.name} ${c.value}` : c.name;
        })
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
    const token = canvas.tokens.controlled[0] ||
      (this.filterTokenId ? canvas.tokens.get(this.filterTokenId) : null);

    if (!token) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.SELECT_TOKEN_FIRST'));
      return;
    }

    const { AddAfflictionDialog } = await import('./AddAfflictionDialog.js');
    new AddAfflictionDialog(token).render(true);
  }

  static async removeAffliction(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (!token) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
      return;
    }

    const affliction = AfflictionStore.getAffliction(token, afflictionId);

    const oldStageData = affliction?.currentStage > 0
      ? affliction.stages[affliction.currentStage - 1]
      : null;

    await AfflictionStore.removeAffliction(token, afflictionId);

    if (affliction) {
      await AfflictionService.removeStageEffects(token, affliction, oldStageData, null);
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    const remainingAfflictions = AfflictionStore.getAfflictions(token);
    if (Object.keys(remainingAfflictions).length === 0) {
      const { VisualService } = await import('../services/VisualService.js');
      await VisualService.removeAfflictionIndicator(token);
    }

    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.MANAGER.REMOVED_AFFLICTION', { tokenName: token.name }));
    this.render({ force: true });
  }

  static async editAffliction(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (!token) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
      return;
    }

    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND'));
      return;
    }

    const { AfflictionEditorDialog } = await import('./AfflictionEditorDialog.js');
    new AfflictionEditorDialog(affliction).render(true);
  }

  static async clearAllAfflictions(_event, _button) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.CLEAR_ALL_CONFIRM_TITLE'),
      content: `<p>${game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.CLEAR_ALL_CONFIRM_CONTENT')}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    const tokensToCheck = this.filterTokenId
      ? [canvas.tokens.get(this.filterTokenId)].filter(t => t)
      : canvas.tokens.placeables;

    let clearedCount = 0;
    const clearedTokens = [];

    for (const token of tokensToCheck) {
      const afflictions = AfflictionStore.getAfflictions(token);
      const afflictionIds = Object.keys(afflictions);

      if (afflictionIds.length === 0) continue;

      for (const afflictionId of afflictionIds) {
        const affliction = afflictions[afflictionId];
        const oldStageData = affliction?.currentStage > 0
          ? affliction.stages[affliction.currentStage - 1]
          : null;

        await AfflictionStore.removeAffliction(token, afflictionId);
        await AfflictionService.removeStageEffects(token, affliction, oldStageData, null);
        clearedCount++;
      }

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
      ui.notifications.info(game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.NO_AFFLICTIONS_TO_CLEAR'));
    }

    this.render({ force: true });
  }

  static async progressStage(_event, button) {
    const afflictionId = button.dataset.afflictionId;
    const tokenId = button.dataset.tokenId;
    const token = canvas.tokens.get(tokenId);

    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);

      if (affliction.currentStage >= affliction.stages.length) {
        ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MAX_STAGE', {
          tokenName: token.name,
          afflictionName: affliction.name
        }));
        return;
      }

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

      if (affliction.currentStage <= 1) {
        ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.MANAGER.AT_STAGE_ONE', { tokenName: token.name, afflictionName: affliction.name }));
        return;
      }

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
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
      return;
    }

    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND'));
      return;
    }

    await CounteractService.promptCounteract(token, affliction);
  }
}
