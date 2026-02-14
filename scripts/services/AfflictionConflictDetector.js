/**
 * Affliction Conflict Detector - Detects and categorizes conflicts between imported and existing afflictions
 */
export class AfflictionConflictDetector {

  /**
   * Analyze import data against current data
   * @param {Object} incomingEdits - The edits being imported
   * @param {Object} currentEdits - The currently stored edits
   * @returns {Object} - { conflicts: [], autoImport: [], summary: {} }
   */
  static analyzeImport(incomingEdits, currentEdits) {
    const conflicts = [];
    const autoImport = [];

    for (const [key, incomingDef] of Object.entries(incomingEdits)) {
      const currentDef = currentEdits[key];

      if (!currentDef) {
        // No conflict - doesn't exist locally
        autoImport.push({ key, definition: incomingDef });
      } else {
        // Potential conflict - analyze differences
        const conflictData = this.detectConflict(key, currentDef, incomingDef);
        if (conflictData.hasConflict) {
          conflicts.push(conflictData);
        } else {
          // Definitions are identical
          autoImport.push({ key, definition: incomingDef, isIdentical: true });
        }
      }
    }

    return {
      conflicts,
      autoImport,
      summary: {
        totalIncoming: Object.keys(incomingEdits).length,
        conflictCount: conflicts.length,
        autoImportCount: autoImport.length
      }
    };
  }

  /**
   * Detect conflicts between two affliction definitions
   */
  static detectConflict(key, currentDef, incomingDef) {
    const differences = {
      basic: [],      // dc, saveType, onset changes
      stages: [],     // stage-level differences
      metadata: []    // editedAt, editedBy
    };

    // Check basic properties
    if (currentDef.dc !== incomingDef.dc) {
      differences.basic.push({
        field: 'dc',
        current: currentDef.dc,
        incoming: incomingDef.dc
      });
    }

    if (currentDef.saveType !== incomingDef.saveType) {
      differences.basic.push({
        field: 'saveType',
        current: currentDef.saveType,
        incoming: incomingDef.saveType
      });
    }

    // Check onset (handle null/undefined)
    const onsetDiffers = !this.isOnsetEqual(currentDef.onset, incomingDef.onset);
    if (onsetDiffers) {
      differences.basic.push({
        field: 'onset',
        current: currentDef.onset,
        incoming: incomingDef.onset
      });
    }

    // Check stages
    const stageDiffs = this.detectStageDifferences(
      currentDef.stages || [],
      incomingDef.stages || []
    );
    differences.stages = stageDiffs;

    // Metadata differences (informational only)
    if (currentDef.editedAt !== incomingDef.editedAt) {
      differences.metadata.push({
        field: 'editedAt',
        current: currentDef.editedAt,
        incoming: incomingDef.editedAt
      });
    }

    const hasConflict =
      differences.basic.length > 0 ||
      differences.stages.length > 0;

    return {
      key,
      name: currentDef.name || incomingDef.name,
      type: currentDef.type || incomingDef.type,
      hasConflict,
      differences,
      currentDef,
      incomingDef
    };
  }

  /**
   * Detect stage-level differences
   */
  static detectStageDifferences(currentStages, incomingStages) {
    const stageDiffs = [];
    const maxStages = Math.max(currentStages.length, incomingStages.length);

    for (let i = 0; i < maxStages; i++) {
      const currentStage = currentStages[i];
      const incomingStage = incomingStages[i];

      if (!currentStage && incomingStage) {
        // Incoming has additional stage
        stageDiffs.push({
          stageNumber: i + 1,
          type: 'added',
          incoming: incomingStage
        });
      } else if (currentStage && !incomingStage) {
        // Current has additional stage (incoming removed it)
        stageDiffs.push({
          stageNumber: i + 1,
          type: 'removed',
          current: currentStage
        });
      } else if (currentStage && incomingStage) {
        // Both exist - check for modifications
        if (!this.isStageEqual(currentStage, incomingStage)) {
          stageDiffs.push({
            stageNumber: i + 1,
            type: 'modified',
            current: currentStage,
            incoming: incomingStage,
            fieldDiffs: this.getStageFieldDifferences(currentStage, incomingStage)
          });
        }
      }
    }

    return stageDiffs;
  }

  /**
   * Get field-level differences within a stage
   */
  static getStageFieldDifferences(currentStage, incomingStage) {
    const diffs = [];

    // Check duration
    if (!this.isDurationEqual(currentStage.duration, incomingStage.duration)) {
      diffs.push({ field: 'duration', current: currentStage.duration, incoming: incomingStage.duration });
    }

    // Check effects text
    if (currentStage.effects !== incomingStage.effects) {
      diffs.push({ field: 'effects', current: currentStage.effects, incoming: incomingStage.effects });
    }

    // Check damage arrays
    if (!this.isDamageArrayEqual(currentStage.damage, incomingStage.damage)) {
      diffs.push({ field: 'damage', current: currentStage.damage, incoming: incomingStage.damage });
    }

    // Check conditions arrays
    if (!this.isConditionArrayEqual(currentStage.conditions, incomingStage.conditions)) {
      diffs.push({ field: 'conditions', current: currentStage.conditions, incoming: incomingStage.conditions });
    }

    // Check weakness arrays
    if (!this.isWeaknessArrayEqual(currentStage.weakness, incomingStage.weakness)) {
      diffs.push({ field: 'weakness', current: currentStage.weakness, incoming: incomingStage.weakness });
    }

    // Check autoEffects arrays
    if (!this.isAutoEffectsArrayEqual(currentStage.autoEffects, incomingStage.autoEffects)) {
      diffs.push({ field: 'autoEffects', current: currentStage.autoEffects, incoming: incomingStage.autoEffects });
    }

    return diffs;
  }

  // Equality comparison helpers
  static isOnsetEqual(onset1, onset2) {
    if (!onset1 && !onset2) return true;
    if (!onset1 || !onset2) return false;
    return onset1.value === onset2.value && onset1.unit === onset2.unit;
  }

  static isDurationEqual(dur1, dur2) {
    if (!dur1 && !dur2) return true;
    if (!dur1 || !dur2) return false;
    return dur1.value === dur2.value && dur1.unit === dur2.unit;
  }

  static isStageEqual(stage1, stage2) {
    return this.getStageFieldDifferences(stage1, stage2).length === 0;
  }

  static isDamageArrayEqual(arr1, arr2) {
    // Normalize: treat undefined/null same as empty array
    const a1 = arr1 || [];
    const a2 = arr2 || [];

    if (a1.length !== a2.length) return false;
    if (a1.length === 0) return true; // Both empty

    // Sort and compare
    const sorted1 = [...a1].sort((a, b) => `${a.formula}${a.type}`.localeCompare(`${b.formula}${b.type}`));
    const sorted2 = [...a2].sort((a, b) => `${a.formula}${a.type}`.localeCompare(`${b.formula}${b.type}`));

    return sorted1.every((d1, i) => {
      const d2 = sorted2[i];
      return d1.formula === d2.formula && d1.type === d2.type;
    });
  }

  static isConditionArrayEqual(arr1, arr2) {
    // Normalize: treat undefined/null same as empty array
    const a1 = arr1 || [];
    const a2 = arr2 || [];

    if (a1.length !== a2.length) return false;
    if (a1.length === 0) return true; // Both empty

    const sorted1 = [...a1].sort((a, b) => a.name.localeCompare(b.name));
    const sorted2 = [...a2].sort((a, b) => a.name.localeCompare(b.name));

    return sorted1.every((c1, i) => {
      const c2 = sorted2[i];
      return c1.name === c2.name && c1.value === c2.value;
    });
  }

  static isWeaknessArrayEqual(arr1, arr2) {
    // Normalize: treat undefined/null same as empty array
    const a1 = arr1 || [];
    const a2 = arr2 || [];

    if (a1.length !== a2.length) return false;
    if (a1.length === 0) return true; // Both empty

    const sorted1 = [...a1].sort((a, b) => a.type.localeCompare(b.type));
    const sorted2 = [...a2].sort((a, b) => a.type.localeCompare(b.type));

    return sorted1.every((w1, i) => {
      const w2 = sorted2[i];
      return w1.type === w2.type && w1.value === w2.value;
    });
  }

  static isAutoEffectsArrayEqual(arr1, arr2) {
    // Normalize: treat undefined/null same as empty array
    const a1 = arr1 || [];
    const a2 = arr2 || [];

    if (a1.length !== a2.length) return false;
    if (a1.length === 0) return true; // Both empty

    const sorted1 = [...a1].sort((a, b) => a.uuid.localeCompare(b.uuid));
    const sorted2 = [...a2].sort((a, b) => a.uuid.localeCompare(b.uuid));

    return sorted1.every((e1, i) => {
      const e2 = sorted2[i];
      return e1.uuid === e2.uuid;
    });
  }
}
