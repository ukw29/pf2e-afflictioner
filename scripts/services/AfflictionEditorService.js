/**
 * Affliction Editor Service - Handles edit logic, validation, and data merging
 */

import * as AfflictionDefinitionStore from '../stores/AfflictionDefinitionStore.js';
import { AfflictionParser } from './AfflictionParser.js';
import { PF2E_CONDITIONS } from '../constants.js';

export class AfflictionEditorService {
  /**
   * Check if an affliction has an edited version
   * @param {Object} afflictionData - The affliction data
   * @returns {boolean} - True if edited version exists
   */
  static hasEditedVersion(afflictionData) {
    const key = AfflictionDefinitionStore.generateDefinitionKey(afflictionData);
    return AfflictionDefinitionStore.getEditedDefinition(key) !== null;
  }

  /**
   * Apply edited definition to affliction data
   * Merges edited values into the base affliction
   * @param {Object} afflictionData - The base affliction data
   * @param {Object} editedDef - The edited definition
   * @returns {Object} - The merged affliction data
   */
  static applyEditedDefinition(afflictionData, editedDef) {
    if (!afflictionData || !editedDef) {
      console.warn('AfflictionEditorService: Invalid data for merging');
      return afflictionData;
    }

    // Create a merged copy
    const merged = { ...afflictionData };

    // Override with edited values
    if (editedDef.dc !== undefined) merged.dc = editedDef.dc;
    if (editedDef.saveType !== undefined) merged.saveType = editedDef.saveType;
    if (editedDef.onset !== undefined) merged.onset = editedDef.onset;
    if (editedDef.stages !== undefined) merged.stages = editedDef.stages;

    return merged;
  }

  /**
   * Validate edited affliction data
   * @param {Object} editedData - The data to validate
   * @returns {{valid: boolean, errors: Array<string>}} - Validation result
   */
  static validateEditedData(editedData) {
    const errors = [];

    // Validate DC
    if (editedData.dc !== undefined) {
      if (!Number.isInteger(editedData.dc) || editedData.dc < 1 || editedData.dc > 50) {
        errors.push('DC must be an integer between 1 and 50');
      }
    }

    // Validate save type
    if (editedData.saveType !== undefined) {
      const validSaveTypes = ['fortitude', 'reflex', 'will'];
      if (!validSaveTypes.includes(editedData.saveType.toLowerCase())) {
        errors.push('Save type must be Fortitude, Reflex, or Will');
      }
    }

    // Validate onset
    if (editedData.onset) {
      if (!Number.isInteger(editedData.onset.value) || editedData.onset.value < 0) {
        errors.push('Onset value must be a non-negative integer');
      }

      const validUnits = ['round', 'minute', 'hour', 'day', 'week'];
      if (!validUnits.includes(editedData.onset.unit)) {
        errors.push('Onset unit must be round, minute, hour, day, or week');
      }
    }

    // Validate stages
    if (editedData.stages && Array.isArray(editedData.stages)) {
      for (const stage of editedData.stages) {
        // Validate duration
        if (stage.duration) {
          if (!Number.isInteger(stage.duration.value) || stage.duration.value <= 0) {
            errors.push(`Stage ${stage.number}: Duration value must be a positive integer`);
          }

          const validUnits = ['round', 'minute', 'hour', 'day', 'week'];
          if (!validUnits.includes(stage.duration.unit)) {
            errors.push(`Stage ${stage.number}: Duration unit must be round, minute, hour, day, or week`);
          }
        }

        // Validate damage
        if (stage.damage && Array.isArray(stage.damage)) {
          for (const dmg of stage.damage) {
            try {
              if (dmg.formula && !Roll.validate(dmg.formula)) {
                errors.push(`Stage ${stage.number}: Invalid damage formula "${dmg.formula}"`);
              }
            } catch (e) {
              errors.push(`Stage ${stage.number}: Invalid damage formula "${dmg.formula}"`);
            }
          }
        }

        // Validate conditions
        if (stage.conditions && Array.isArray(stage.conditions)) {
          for (const cond of stage.conditions) {
            const normalizedName = cond.name?.toLowerCase().replace(/\s+/g, '-');
            if (!PF2E_CONDITIONS.includes(normalizedName)) {
              errors.push(`Stage ${stage.number}: Unknown condition "${cond.name}"`);
            }

            if (cond.value !== null && cond.value !== undefined) {
              if (!Number.isInteger(cond.value) || cond.value < 0 || cond.value > 4) {
                errors.push(`Stage ${stage.number}: Condition value must be 0-4 or null`);
              }
            }
          }
        }

        // Validate weakness
        if (stage.weakness && Array.isArray(stage.weakness)) {
          for (const weak of stage.weakness) {
            if (!Number.isInteger(weak.value) || weak.value <= 0) {
              errors.push(`Stage ${stage.number}: Weakness value must be a positive integer`);
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Prepare affliction data for editing
   * If UUID is provided, loads from source
   * @param {Object|string} afflictionOrUuid - Affliction data or item UUID
   * @returns {Promise<Object|null>} - The affliction data ready for editing
   */
  static async prepareForEditing(afflictionOrUuid) {
    try {
      // If it's a UUID, load the item and parse it
      if (typeof afflictionOrUuid === 'string') {
        const item = await fromUuid(afflictionOrUuid);
        if (!item) {
          ui.notifications.error('Could not load affliction source item');
          return null;
        }

        const afflictionData = AfflictionParser.parseFromItem(item);
        return afflictionData;
      }

      // If sourceItemUuid exists, reload from source for fresh data
      if (afflictionOrUuid.sourceItemUuid) {
        const item = await fromUuid(afflictionOrUuid.sourceItemUuid);
        if (item) {
          return AfflictionParser.parseFromItem(item);
        }
      }

      // Otherwise, use the provided data
      return afflictionOrUuid;
    } catch (error) {
      console.error('AfflictionEditorService: Error preparing for editing', error);
      ui.notifications.error('Failed to prepare affliction for editing');
      return null;
    }
  }

  /**
   * Create an edit-ready structure from affliction data
   * Ensures all necessary fields are present for the editor
   * @param {Object} afflictionData - The affliction data
   * @returns {Object} - Edit-ready structure
   */
  static prepareEditStructure(afflictionData) {
    return {
      name: afflictionData.name || 'Unknown Affliction',
      type: afflictionData.type || 'affliction',
      dc: afflictionData.dc || 15,
      saveType: afflictionData.saveType || 'fortitude',
      onset: afflictionData.onset || null,
      maxDuration: afflictionData.maxDuration || null,
      stages: afflictionData.stages || [],
      sourceItemUuid: afflictionData.sourceItemUuid || null
    };
  }
}
