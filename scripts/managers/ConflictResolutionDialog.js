/**
 * Conflict Resolution Dialog - Git-like merge UI for affliction imports
 */
import * as AfflictionDefinitionStore from '../stores/AfflictionDefinitionStore.js';
import { AfflictionEditorService } from '../services/AfflictionEditorService.js';
import { MODULE_ID } from '../constants.js';

export class ConflictResolutionDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-afflictioner-conflict-resolution',
    classes: ['pf2e-afflictioner', 'conflict-resolution'],
    tag: 'div',
    window: {
      title: 'PF2E_AFFLICTIONER.CONFLICT.TITLE',
      icon: 'fas fa-code-branch',
      resizable: true
    },
    position: {
      width: 900,
      height: 700
    },
    actions: {
      selectConflict: ConflictResolutionDialog.selectConflict,
      resolveConflict: ConflictResolutionDialog.resolveConflict,
      toggleFieldSelection: ConflictResolutionDialog.toggleFieldSelection,
      selectAllFields: ConflictResolutionDialog.selectAllFields,
      bulkResolve: ConflictResolutionDialog.bulkResolve,
      finishImport: ConflictResolutionDialog.finishImport,
      cancelImport: ConflictResolutionDialog.cancelImport
    }
  };

  static PARTS = {
    form: {
      template: 'modules/pf2e-afflictioner/templates/conflict-resolution.hbs'
    }
  };

  constructor(analysisResult, options = {}) {
    super(options);

    this.conflicts = analysisResult.conflicts;
    this.autoImport = analysisResult.autoImport;
    this.summary = analysisResult.summary;

    // Track resolutions: { key: { strategy, resolved, fieldSelections, mergedData } }
    this.resolutions = {};

    // Current conflict being viewed
    this.currentConflictIndex = 0;

    // Initialize resolutions as unresolved
    this.conflicts.forEach(conflict => {
      this.resolutions[conflict.key] = {
        strategy: null,
        resolved: false,
        fieldSelections: {}, // { stageIndex: { fieldName: 'current'|'incoming' } }
        mergedData: null
      };
    });
  }

  async _prepareContext(options) {
    const currentConflict = this.conflicts[this.currentConflictIndex];
    const resolvedCount = Object.values(this.resolutions).filter(r => r.resolved).length;
    const progress = {
      current: this.currentConflictIndex + 1,
      total: this.conflicts.length,
      resolved: resolvedCount,
      percentage: this.conflicts.length > 0 ? Math.round((resolvedCount / this.conflicts.length) * 100) : 0
    };

    return {
      summary: this.summary,
      progress,
      conflicts: this.conflicts.map((c, idx) => ({
        ...c,
        index: idx,
        isCurrent: idx === this.currentConflictIndex,
        resolution: this.resolutions[c.key]
      })),
      currentConflict: currentConflict ? this.prepareConflictView(currentConflict) : null,
      hasConflicts: this.conflicts.length > 0,
      allResolved: Object.values(this.resolutions).every(r => r.resolved),
      autoImportCount: this.autoImport.length
    };
  }

  prepareConflictView(conflict) {
    const resolution = this.resolutions[conflict.key];

    return {
      ...conflict,
      resolution,
      // Prepare side-by-side comparison data
      comparison: {
        basic: this.prepareBasicComparison(conflict),
        stages: this.prepareStageComparison(conflict)
      }
    };
  }

  prepareBasicComparison(conflict) {
    const { currentDef, incomingDef, differences } = conflict;

    return {
      dc: {
        current: currentDef.dc,
        incoming: incomingDef.dc,
        differs: differences.basic.some(d => d.field === 'dc')
      },
      saveType: {
        current: currentDef.saveType,
        incoming: incomingDef.saveType,
        differs: differences.basic.some(d => d.field === 'saveType')
      },
      onset: {
        current: currentDef.onset,
        incoming: incomingDef.onset,
        differs: differences.basic.some(d => d.field === 'onset')
      }
    };
  }

  prepareStageComparison(conflict) {
    const { currentDef, incomingDef, differences } = conflict;
    const resolution = this.resolutions[conflict.key];
    const maxStages = Math.max(
      currentDef.stages?.length || 0,
      incomingDef.stages?.length || 0
    );

    const stages = [];
    for (let i = 0; i < maxStages; i++) {
      const stageDiff = differences.stages.find(s => s.stageNumber === i + 1);
      const currentStage = currentDef.stages?.[i];
      const incomingStage = incomingDef.stages?.[i];

      // Get field selections for this stage
      const fieldSelections = resolution.fieldSelections[i] || {};

      // Prepare field differences as a map for easier template access
      const fieldDiffsMap = {};
      (stageDiff?.fieldDiffs || []).forEach(diff => {
        fieldDiffsMap[diff.field] = true;
      });

      stages.push({
        number: i + 1,
        stageIndex: i, // For data attributes
        current: currentStage,
        incoming: incomingStage,
        diffType: stageDiff?.type || 'identical',
        fieldDiffs: stageDiff?.fieldDiffs || [],
        fieldDiffsMap, // Easy lookup: {duration: true, damage: true, ...}
        fieldSelections, // Field-level selections for merge strategy
        // Check if all fields have been selected for this stage
        allFieldsSelected: this.areAllFieldsSelected(currentStage, incomingStage, fieldSelections, fieldDiffsMap)
      });
    }

    return stages;
  }

  /**
   * Check if all necessary fields have been selected for a stage in merge mode
   */
  areAllFieldsSelected(currentStage, incomingStage, fieldSelections, fieldDiffsMap) {
    if (!currentStage && !incomingStage) return true;

    // If there are no field differences, the stage is identical - no selection needed
    if (!fieldDiffsMap || Object.keys(fieldDiffsMap).length === 0) return true;

    // Only check fields that actually differ
    const differingFields = Object.keys(fieldDiffsMap);

    return differingFields.every(field => fieldSelections[field] !== undefined);
  }

  // Action handlers
  static async selectConflict(event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.currentConflictIndex = index;
    await dialog.render({ force: true });
  }

  static async resolveConflict(event, button) {
    const dialog = this;
    const strategy = button.dataset.strategy; // 'keep', 'accept', 'merge'
    const currentConflict = dialog.conflicts[dialog.currentConflictIndex];

    if (strategy === 'merge') {
      // Switch to custom merge view
      dialog.resolutions[currentConflict.key] = {
        strategy: 'merge',
        resolved: false, // Not resolved until all fields selected
        fieldSelections: {},
        mergedData: null
      };
    } else {
      // Simple resolution
      const mergedData = strategy === 'keep'
        ? foundry.utils.deepClone(currentConflict.currentDef)
        : foundry.utils.deepClone(currentConflict.incomingDef);

      dialog.resolutions[currentConflict.key] = {
        strategy,
        mergedData,
        resolved: true,
        fieldSelections: {}
      };

      // Auto-advance to next conflict
      if (dialog.currentConflictIndex < dialog.conflicts.length - 1) {
        dialog.currentConflictIndex++;
      }
    }

    await dialog.render({ force: true });
  }

  static async toggleFieldSelection(event, button) {
    const dialog = this;
    const currentConflict = dialog.conflicts[dialog.currentConflictIndex];
    const stageIndex = parseInt(button.dataset.stageIndex);
    const field = button.dataset.field; // 'duration', 'damage', 'conditions', etc.
    const version = button.dataset.version; // 'current' or 'incoming'

    const resolution = dialog.resolutions[currentConflict.key];
    if (!resolution.fieldSelections[stageIndex]) {
      resolution.fieldSelections[stageIndex] = {};
    }

    resolution.fieldSelections[stageIndex][field] = version;

    // Check if ALL stages have all fields selected
    const maxStages = Math.max(
      currentConflict.currentDef.stages?.length || 0,
      currentConflict.incomingDef.stages?.length || 0
    );

    const allStagesComplete = Array.from({ length: maxStages }).every((_, i) => {
      const cs = currentConflict.currentDef.stages?.[i];
      const is = currentConflict.incomingDef.stages?.[i];
      const fs = resolution.fieldSelections[i] || {};

      // Get fieldDiffsMap for this stage
      const stageDiff = currentConflict.differences.stages.find(s => s.stageNumber === i + 1);
      const fieldDiffsMap = {};
      (stageDiff?.fieldDiffs || []).forEach(diff => {
        fieldDiffsMap[diff.field] = true;
      });

      return dialog.areAllFieldsSelected(cs, is, fs, fieldDiffsMap);
    });

    if (allStagesComplete) {
      // Build merged data and mark as resolved
      resolution.mergedData = dialog.buildMergedData(currentConflict, resolution);
      resolution.resolved = true;
    } else {
      resolution.resolved = false;
    }

    await dialog.render({ force: true });
  }

  static async selectAllFields(event, button) {
    const dialog = this;
    const currentConflict = dialog.conflicts[dialog.currentConflictIndex];
    const stageIndex = parseInt(button.dataset.stageIndex);
    const version = button.dataset.version; // 'current' or 'incoming'

    const resolution = dialog.resolutions[currentConflict.key];
    if (!resolution.fieldSelections[stageIndex]) {
      resolution.fieldSelections[stageIndex] = {};
    }

    // Get fields that differ for this stage
    const stageDiff = currentConflict.differences.stages.find(s => s.stageNumber === stageIndex + 1);
    const differingFields = (stageDiff?.fieldDiffs || []).map(diff => diff.field);

    // Only set selections for fields that actually differ
    differingFields.forEach(field => {
      resolution.fieldSelections[stageIndex][field] = version;
    });

    // Check if all stages are now complete
    const maxStages = Math.max(
      currentConflict.currentDef.stages?.length || 0,
      currentConflict.incomingDef.stages?.length || 0
    );

    const allStagesComplete = Array.from({ length: maxStages }).every((_, i) => {
      const cs = currentConflict.currentDef.stages?.[i];
      const is = currentConflict.incomingDef.stages?.[i];
      const fs = resolution.fieldSelections[i] || {};

      // Get fieldDiffsMap for this stage
      const sDiff = currentConflict.differences.stages.find(s => s.stageNumber === i + 1);
      const fieldDiffsMap = {};
      (sDiff?.fieldDiffs || []).forEach(diff => {
        fieldDiffsMap[diff.field] = true;
      });

      return dialog.areAllFieldsSelected(cs, is, fs, fieldDiffsMap);
    });

    if (allStagesComplete) {
      resolution.mergedData = dialog.buildMergedData(currentConflict, resolution);
      resolution.resolved = true;
    }

    await dialog.render({ force: true });
  }

  static async bulkResolve(event, button) {
    const dialog = this;
    const strategy = button.dataset.strategy; // 'keep' or 'accept'

    // Apply strategy to all unresolved conflicts
    for (const conflict of dialog.conflicts) {
      if (!dialog.resolutions[conflict.key].resolved) {
        const mergedData = strategy === 'keep'
          ? foundry.utils.deepClone(conflict.currentDef)
          : foundry.utils.deepClone(conflict.incomingDef);

        dialog.resolutions[conflict.key] = {
          strategy,
          mergedData,
          resolved: true,
          fieldSelections: {}
        };
      }
    }

    await dialog.render({ force: true });
  }

  /**
   * Build merged affliction data from field selections
   */
  buildMergedData(conflict, resolution) {
    const { currentDef, incomingDef } = conflict;
    const { fieldSelections } = resolution;

    // Start with incoming as base (for metadata, name, type, etc.)
    const merged = foundry.utils.deepClone(incomingDef);

    // Build stages array based on field selections
    merged.stages = [];
    const maxStages = Math.max(
      currentDef.stages?.length || 0,
      incomingDef.stages?.length || 0
    );

    for (let i = 0; i < maxStages; i++) {
      const currentStage = currentDef.stages?.[i];
      const incomingStage = incomingDef.stages?.[i];
      const selections = fieldSelections[i] || {};

      // If stage doesn't exist in either version, skip
      if (!currentStage && !incomingStage) continue;

      // Build merged stage by field
      const mergedStage = {
        number: i + 1,
        duration: this.selectField(selections, 'duration', currentStage, incomingStage),
        effects: this.selectField(selections, 'effects', currentStage, incomingStage),
        damage: this.selectField(selections, 'damage', currentStage, incomingStage) || [],
        conditions: this.selectField(selections, 'conditions', currentStage, incomingStage) || [],
        weakness: this.selectField(selections, 'weakness', currentStage, incomingStage) || [],
        autoEffects: this.selectField(selections, 'autoEffects', currentStage, incomingStage) || [],
        rawText: this.selectField(selections, 'rawText', currentStage, incomingStage) || '',
        requiresManualHandling: false
      };

      merged.stages.push(mergedStage);
    }

    return merged;
  }

  /**
   * Select a field value based on user selection
   */
  selectField(selections, fieldName, currentStage, incomingStage) {
    const selection = selections[fieldName];

    if (selection === 'current') {
      return currentStage?.[fieldName] !== undefined
        ? foundry.utils.deepClone(currentStage[fieldName])
        : (incomingStage?.[fieldName] !== undefined ? foundry.utils.deepClone(incomingStage[fieldName]) : undefined);
    } else if (selection === 'incoming') {
      return incomingStage?.[fieldName] !== undefined
        ? foundry.utils.deepClone(incomingStage[fieldName])
        : (currentStage?.[fieldName] !== undefined ? foundry.utils.deepClone(currentStage[fieldName]) : undefined);
    }

    // Default fallback: prefer incoming
    return incomingStage?.[fieldName] !== undefined
      ? foundry.utils.deepClone(incomingStage[fieldName])
      : (currentStage?.[fieldName] !== undefined ? foundry.utils.deepClone(currentStage[fieldName]) : undefined);
  }

  static async finishImport(event, button) {
    const dialog = this;

    // Check all conflicts resolved
    if (!Object.values(dialog.resolutions).every(r => r.resolved)) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.CONFLICT.CONFLICTS_REMAINING'));
      return;
    }

    // Build final import data
    const finalEdits = {};

    // Add resolved conflicts
    for (const [key, resolution] of Object.entries(dialog.resolutions)) {
      // Validate merged data
      const validation = AfflictionEditorService.validateEditedData(resolution.mergedData);
      if (!validation.valid) {
        ui.notifications.error(`Validation failed for ${resolution.mergedData.name}: ${validation.errors.join(', ')}`);
        return;
      }

      // Update metadata
      resolution.mergedData.editedAt = Date.now();
      resolution.mergedData.editedBy = game.user.id;

      finalEdits[key] = resolution.mergedData;
    }

    // Add auto-import items
    for (const item of dialog.autoImport) {
      // Update metadata
      const definition = foundry.utils.deepClone(item.definition);
      definition.editedAt = Date.now();
      definition.editedBy = game.user.id;
      finalEdits[item.key] = definition;
    }

    // Save to settings
    try {
      await game.settings.set(MODULE_ID, 'editedAfflictions', finalEdits);

      const totalImported = Object.keys(finalEdits).length;
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.CONFLICT.IMPORT_SUCCESSFUL', { count: totalImported }));

      await dialog.close();

      // Refresh any open managers
      Object.values(ui.windows).forEach(app => {
        if (app.constructor.name === 'EditedAfflictionsManager') {
          app.render({ force: true });
        }
      });
    } catch (error) {
      console.error('ConflictResolutionDialog: Import failed', error);
      ui.notifications.error('Failed to import afflictions');
    }
  }

  static async cancelImport(event, button) {
    const dialog = this;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: game.i18n.localize('PF2E_AFFLICTIONER.CONFLICT.CANCEL_IMPORT'),
      content: '<p>Cancel import? All conflict resolutions will be lost.</p>',
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (confirmed) {
      await dialog.close();
    }
  }
}
