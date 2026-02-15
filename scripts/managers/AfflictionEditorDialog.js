/**
 * Affliction Editor Dialog - Main UI for editing affliction definitions
 */

import * as AfflictionDefinitionStore from '../stores/AfflictionDefinitionStore.js';
import { AfflictionEditorService } from '../services/AfflictionEditorService.js';
import { StageEditorDialog } from './StageEditorDialog.js';

export class AfflictionEditorDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-afflictioner-editor',
    classes: ['pf2e-afflictioner', 'affliction-editor'],
    tag: 'form',
    window: {
      title: 'PF2E_AFFLICTIONER.EDITOR.TITLE',
      icon: 'fas fa-edit',
      resizable: true
    },
    position: {
      width: 700,
      height: 600
    },
    actions: {
      editStage: AfflictionEditorDialog.editStage,
      addStage: AfflictionEditorDialog.addStage,
      removeStage: AfflictionEditorDialog.removeStage,
      toggleOnset: AfflictionEditorDialog.toggleOnset,
      saveChanges: AfflictionEditorDialog.saveChanges,
      cancelEdit: AfflictionEditorDialog.cancelEdit,
      resetToDefault: AfflictionEditorDialog.resetToDefault
    }
  };

  static PARTS = {
    form: {
      template: 'modules/pf2e-afflictioner/templates/affliction-editor.hbs'
    }
  };

  constructor(afflictionData, options = {}) {
    super(options);

    // GM-only access
    if (!game.user.isGM) {
      ui.notifications.error('Only GMs can edit affliction definitions');
      this.close();
      return;
    }

    // Store original and working copy
    this.originalData = foundry.utils.deepClone(afflictionData);
    this.editedData = AfflictionEditorService.prepareEditStructure(afflictionData);
  }

  async _prepareContext(_options) {
    // Enrich stage effects text with clickable links
    const affliction = foundry.utils.deepClone(this.editedData);

    if (affliction.stages) {
      for (const stage of affliction.stages) {
        if (stage.effects) {
          stage.enrichedEffects = await TextEditor.enrichHTML(stage.effects, { async: true });
        }
      }
    }

    return {
      affliction
    };
  }

  static async editStage(_event, button) {
    const dialog = this;
    const stageNumber = parseInt(button.dataset.stageNumber);
    const stage = dialog.editedData.stages.find(s => s.number === stageNumber);

    if (!stage) {
      ui.notifications.error(`Stage ${stageNumber} not found`);
      return;
    }

    // Open stage editor dialog
    const stageEditor = new StageEditorDialog(stage, {
      onSave: async (updatedStage) => {
        // Update the stage in our data
        const index = dialog.editedData.stages.findIndex(s => s.number === stageNumber);
        if (index !== -1) {
          dialog.editedData.stages[index] = updatedStage;
          await dialog.render({ force: true });
        }
      }
    });

    stageEditor.render(true);
  }

  static async addStage(_event, _button) {
    const dialog = this;

    // Create new stage with next stage number
    const nextStageNumber = dialog.editedData.stages.length + 1;
    const newStage = {
      number: nextStageNumber,
      effects: '',
      rawText: '',
      duration: { value: 1, unit: 'day', isDice: false },
      damage: [],
      conditions: [],
      weakness: [],
      requiresManualHandling: false
    };

    dialog.editedData.stages.push(newStage);
    ui.notifications.info(`Added Stage ${nextStageNumber}`);
    await dialog.render({ force: true });
  }

  static async removeStage(_event, button) {
    const dialog = this;
    const stageNumber = parseInt(button.dataset.stageNumber);

    if (dialog.editedData.stages.length <= 1) {
      ui.notifications.warn('Cannot remove the last stage. Afflictions must have at least one stage.');
      return;
    }

    // Confirm removal
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize('PF2E_AFFLICTIONER.EDITOR.REMOVE_STAGE'),
      content: `<p>${game.i18n.format('PF2E_AFFLICTIONER.EDITOR.CONFIRM_REMOVE_STAGE', { number: stageNumber })}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    // Remove the stage
    const index = dialog.editedData.stages.findIndex(s => s.number === stageNumber);
    if (index !== -1) {
      dialog.editedData.stages.splice(index, 1);

      // Renumber remaining stages
      dialog.editedData.stages.forEach((stage, idx) => {
        stage.number = idx + 1;
      });

      ui.notifications.info(`Removed Stage ${stageNumber}`);
      await dialog.render({ force: true });
    }
  }

  static async toggleOnset(_event, _button) {
    const dialog = this;

    if (dialog.editedData.onset && dialog.editedData.onset.value > 0) {
      // Remove onset
      dialog.editedData.onset = null;
      ui.notifications.info('Onset removed');
    } else {
      // Add default onset
      dialog.editedData.onset = {
        value: 1,
        unit: 'round'
      };
      ui.notifications.info('Onset added');
    }

    await dialog.render({ force: true });
  }

  static async saveChanges(_event, _button) {
    const dialog = this;
    const formData = new FormDataExtended(dialog.element).object;

    // Update DC
    if (formData.dc !== undefined) {
      dialog.editedData.dc = Math.max(1, Math.min(50, parseInt(formData.dc) || 15));
    }

    // Update save type
    if (formData.saveType) {
      dialog.editedData.saveType = formData.saveType.toLowerCase();
    }

    // Update onset
    if (formData.onset) {
      const onsetValue = parseInt(formData.onset.value);
      if (onsetValue > 0) {
        dialog.editedData.onset = {
          value: onsetValue,
          unit: formData.onset.unit || 'round'
        };
      } else {
        dialog.editedData.onset = null;
      }
    }

    // Validate the edited data
    const validation = AfflictionEditorService.validateEditedData(dialog.editedData);
    if (!validation.valid) {
      ui.notifications.error('Validation failed: ' + validation.errors.join(', '));
      console.error('AfflictionEditorDialog: Validation errors', validation.errors);
      return;
    }

    // Generate key and save
    const key = AfflictionDefinitionStore.generateDefinitionKey(dialog.originalData);
    if (!key) {
      ui.notifications.error('Could not generate definition key');
      return;
    }

    try {
      await AfflictionDefinitionStore.saveEditedDefinition(key, dialog.editedData);
      ui.notifications.info(game.i18n.localize('PF2E_AFFLICTIONER.EDITOR.CHANGES_SAVED'));
      await dialog.close();
    } catch (error) {
      console.error('AfflictionEditorDialog: Error saving', error);
      ui.notifications.error('Failed to save changes');
    }
  }

  static async cancelEdit(_event, _button) {
    const dialog = this;
    await dialog.close();
  }

  static async resetToDefault(_event, _button) {
    const dialog = this;

    // Confirm reset
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize('PF2E_AFFLICTIONER.EDITOR.RESET_TO_DEFAULT'),
      content: `<p>${game.i18n.localize('PF2E_AFFLICTIONER.EDITOR.CONFIRM_RESET')}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    // Generate key and remove edit
    const key = AfflictionDefinitionStore.generateDefinitionKey(dialog.originalData);
    if (!key) {
      ui.notifications.error('Could not generate definition key');
      return;
    }

    try {
      await AfflictionDefinitionStore.removeEditedDefinition(key);
      ui.notifications.info('Affliction reset to default');
      await dialog.close();
    } catch (error) {
      console.error('AfflictionEditorDialog: Error resetting', error);
      ui.notifications.error('Failed to reset affliction');
    }
  }
}
