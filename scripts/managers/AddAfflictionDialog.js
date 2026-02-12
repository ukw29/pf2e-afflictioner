/**
 * Add Affliction Dialog - Manual entry or item selection
 */

import { MODULE_ID } from '../constants.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { VisualService } from '../services/VisualService.js';

export class AddAfflictionDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-afflictioner-add-dialog',
    classes: ['pf2e-afflictioner', 'add-affliction-dialog'],
    tag: 'form',
    window: {
      title: 'PF2E_AFFLICTIONER.DIALOG.ADD_AFFLICTION_TITLE',
      icon: 'fas fa-plus',
      resizable: false
    },
    position: {
      width: 500,
      height: 'auto'
    },
    actions: {
      addFromItem: AddAfflictionDialog.addFromItem,
      addManual: AddAfflictionDialog.addManual
    },
    form: {
      handler: AddAfflictionDialog.formHandler,
      closeOnSubmit: false
    }
  };

  static PARTS = {
    form: {
      template: 'modules/pf2e-afflictioner/templates/add-affliction-dialog.hbs'
    }
  };

  constructor(token, options = {}) {
    super(options);
    this.token = token;
    this.selectedItem = null;
  }

  async _prepareContext(options) {
    // Get all items with poison/disease traits from actor
    const afflictionItems = [];
    if (this.token?.actor) {
      for (const item of this.token.actor.items) {
        const traits = item.system?.traits?.value || [];
        if (traits.includes('poison') || traits.includes('disease')) {
          afflictionItems.push({
            id: item.id,
            uuid: item.uuid,
            name: item.name,
            type: traits.includes('poison') ? 'poison' : 'disease',
            img: item.img
          });
        }
      }
    }

    // Also get compendium items
    const compendiumItems = await this.getCompendiumAfflictions();

    return {
      token: {
        name: this.token.name,
        img: this.token.document.texture.src
      },
      actorItems: afflictionItems,
      compendiumItems: compendiumItems,
      hasItems: afflictionItems.length > 0 || compendiumItems.length > 0
    };
  }

  async getCompendiumAfflictions() {
    const afflictions = [];

    try {
      // Search PF2e compendiums for afflictions
      const packs = game.packs.filter(p =>
        p.metadata.type === 'Item' &&
        p.metadata.system === 'pf2e'
      );

      for (const pack of packs) {
        const index = await pack.getIndex();
        for (const entry of index) {
          if (entry.type === 'affliction') {
            afflictions.push({
              uuid: entry.uuid,
              name: entry.name,
              type: 'affliction',
              img: entry.img,
              pack: pack.metadata.label
            });
          }
        }
      }
    } catch (error) {
      console.error('Error loading compendium afflictions:', error);
    }

    return afflictions.slice(0, 20); // Limit to 20 for performance
  }

  static async addFromItem(event, button) {
    const itemUuid = button.dataset.itemUuid;

    try {
      // Load item
      const item = await fromUuid(itemUuid);
      if (!item) {
        ui.notifications.error('Could not load item');
        return;
      }

      // Parse affliction
      const afflictionData = AfflictionParser.parseFromItem(item);
      if (!afflictionData) {
        ui.notifications.error('Could not parse affliction from item');
        return;
      }

      // Add to token
      const afflictionId = foundry.utils.randomID();
      const combat = game.combat;

      const affliction = {
        id: afflictionId,
        ...afflictionData,
        currentStage: afflictionData.onset ? 0 : 1, // Start at stage 1 if no onset
        inOnset: !!afflictionData.onset,
        onsetRemaining: AfflictionParser.durationToSeconds(afflictionData.onset),
        nextSaveRound: combat ? combat.round : null,
        nextSaveInitiative: null,
        stageStartRound: combat ? combat.round : null,
        durationElapsed: 0,
        treatmentBonus: 0,
        treatedThisStage: false,
        addedTimestamp: Date.now(),
        addedInCombat: !!combat,
        combatId: combat?.id
      };

      // Apply initial effects
      const { AfflictionService } = await import('../services/AfflictionService.js');

      if (afflictionData.onset) {
        // Onset: Create effect with badge 0
        const effectUuid = await AfflictionService.createOrUpdateAfflictionEffect(
          this.token.actor,
          affliction,
          { effects: '', rawText: `Onset: ${afflictionData.onset.value} ${afflictionData.onset.unit}(s)` }
        );
        if (effectUuid) {
          affliction.appliedEffectUuid = effectUuid;
        }
      } else if (afflictionData.stages && afflictionData.stages.length > 0) {
        // No onset: Start at stage 1
        const firstStage = afflictionData.stages[0];
        if (combat && firstStage.duration) {
          affliction.nextSaveRound = combat.round + firstStage.duration.value;
        }

        // Apply initial stage effects
        await AfflictionService.applyStageEffects(this.token, affliction, firstStage);
      }

      await AfflictionStore.addAffliction(this.token, affliction);
      await VisualService.addAfflictionIndicator(this.token);

      ui.notifications.info(`Added ${afflictionData.name} to ${this.token.name}`);

      // Close dialog
      this.close();
    } catch (error) {
      console.error('Error adding affliction:', error);
      ui.notifications.error('Error adding affliction');
    }
  }

  static async addManual(event, button) {
    // Show manual entry form
    ui.notifications.info('Manual entry - Coming soon');
    // TODO: Implement manual entry form
  }

  static async formHandler(event, form, formData) {
    // Handle form submission if needed
  }

  // Enable drag and drop
  _onRender(context, options) {
    super._onRender(context, options);

    const element = this.element;
    if (!element) return;

    // Make dialog a drop target
    element.addEventListener('drop', this._onDrop.bind(this));
    element.addEventListener('dragover', this._onDragOver.bind(this));
  }

  _onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  async _onDrop(event) {
    event.preventDefault();

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }

    // Check if it's an item
    if (data.type !== 'Item') return;

    // Load item
    const item = await fromUuid(data.uuid);
    if (!item) return;

    // Check if it has poison/disease trait
    const traits = item.system?.traits?.value || [];
    if (!traits.includes('poison') && !traits.includes('disease')) {
      ui.notifications.warn('Item must have poison or disease trait');
      return;
    }

    // Parse and add affliction
    const afflictionData = AfflictionParser.parseFromItem(item);
    if (!afflictionData) {
      ui.notifications.error('Could not parse affliction from item');
      return;
    }

    // Add to token
    const afflictionId = foundry.utils.randomID();
    const combat = game.combat;

    const affliction = {
      id: afflictionId,
      ...afflictionData,
      currentStage: afflictionData.onset ? 0 : 1, // Start at stage 1 if no onset
      inOnset: !!afflictionData.onset,
      onsetRemaining: AfflictionParser.durationToSeconds(afflictionData.onset),
      nextSaveRound: combat ? combat.round : null,
      nextSaveInitiative: null,
      stageStartRound: combat ? combat.round : null,
      durationElapsed: 0,
      treatmentBonus: 0,
      treatedThisStage: false,
      addedTimestamp: Date.now(),
      addedInCombat: !!combat,
      combatId: combat?.id
    };

    // If no onset, set next save based on first stage duration
    if (!afflictionData.onset && afflictionData.stages && afflictionData.stages.length > 0) {
      const firstStage = afflictionData.stages[0];
      if (combat && firstStage.duration) {
        affliction.nextSaveRound = combat.round + firstStage.duration.value;
      }

      // Apply initial stage effects
      const { AfflictionService } = await import('../services/AfflictionService.js');
      await AfflictionService.applyStageEffects(this.token, affliction, firstStage);
    }

    await AfflictionStore.addAffliction(this.token, affliction);
    await VisualService.addAfflictionIndicator(this.token);

    ui.notifications.info(`Added ${afflictionData.name} to ${this.token.name}`);

    this.close();
  }
}
