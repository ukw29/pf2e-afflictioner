/**
 * Condition Stacking Service - Handle PF2e condition stacking rules
 *
 * PF2e Rules:
 * - Same condition, same value: Keep longer duration
 * - Same condition, different values: Apply highest value, track all durations
 * - When highest expires: Downgrade to next highest active value
 */

import { MODULE_ID } from '../constants.js';

export class ConditionStackingService {
  /**
   * Add condition instance from affliction stage
   */
  static async addConditionInstance(actor, tokenId, afflictionId, conditionSlug, value, expirationData) {
    const instances = await this._getConditionInstances(actor, conditionSlug);

    // Check if same affliction already applied this condition
    const existingIndex = instances.findIndex(
      inst => inst.sourceAfflictionId === afflictionId && inst.sourceTokenId === tokenId
    );

    // Create new instance
    const newInstance = {
      id: foundry.utils.randomID(),
      value: value || null,
      sourceAfflictionId: afflictionId,
      sourceTokenId: tokenId,
      expiresAt: expirationData,
      addedAt: Date.now()
    };

    // If same affliction already has instance, check if we should update or keep longer duration
    if (existingIndex !== -1) {
      const existing = instances[existingIndex];

      // Same value: keep longer duration
      if (existing.value === newInstance.value) {
        const existingExpiry = this._getExpiryTime(existing.expiresAt);
        const newExpiry = this._getExpiryTime(newInstance.expiresAt);

        if (newExpiry > existingExpiry) {
          instances[existingIndex] = newInstance;
        }
        // else keep existing (it's longer)
      } else {
        // Different value: replace the instance (will be sorted by value anyway)
        instances[existingIndex] = newInstance;
      }
    } else {
      // New instance from this affliction
      instances.push(newInstance);
    }

    // Save updated instances
    await this._setConditionInstances(actor, conditionSlug, instances);
  }

  /**
   * Remove all condition instances for an affliction
   */
  static async removeConditionInstancesForAffliction(actor, afflictionId) {
    const allInstances = await this._getAllConditionInstances(actor);
    let changed = false;

    // Remove instances from this affliction across all condition types
    for (const [slug, instances] of Object.entries(allInstances)) {
      const filtered = instances.filter(inst => inst.sourceAfflictionId !== afflictionId);
      if (filtered.length !== instances.length) {
        // If no instances left, remove condition from actor before updating tracking
        if (filtered.length === 0) {
          await this._removeCondition(actor, slug);
        }

        await this._setConditionInstances(actor, slug, filtered);
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Recalculate and apply highest condition values to PF2e system
   */
  static async recalculateConditions(actor) {
    const allInstances = await this._getAllConditionInstances(actor);
    const combat = game.combat;
    const currentRound = combat?.round;
    const currentInitiative = combat?.combatant?.initiative;
    const currentTimestamp = game.time.worldTime;

    for (const [slug, instances] of Object.entries(allInstances)) {
      // Filter to active instances
      const active = instances.filter(inst =>
        !this._isExpired(inst.expiresAt, currentRound, currentInitiative, currentTimestamp)
      );

      if (active.length === 0) {
        // No active instances - remove condition
        await this._removeCondition(actor, slug);
        await this._setConditionInstances(actor, slug, []);
        continue;
      }

      // Find highest value among active instances
      const highest = this._calculateHighestValue(active);

      // Apply to PF2e condition system
      await this._applyConditionValue(actor, slug, highest.value);
    }
  }

  /**
   * Clean up expired instances and recalculate
   */
  static async cleanupExpiredInstances(actor, currentRound, currentInitiative, currentTimestamp) {
    const allInstances = await this._getAllConditionInstances(actor);
    let changed = false;

    for (const [slug, instances] of Object.entries(allInstances)) {
      const active = instances.filter(inst =>
        !this._isExpired(inst.expiresAt, currentRound, currentInitiative, currentTimestamp)
      );

      if (active.length !== instances.length) {
        await this._setConditionInstances(actor, slug, active);
        changed = true;
      }
    }

    if (changed) {
      await this.recalculateConditions(actor);
    }
  }

  /**
   * Get current effective value for a condition
   */
  static async getEffectiveConditionValue(actor, conditionSlug) {
    const instances = await this._getConditionInstances(actor, conditionSlug);
    if (instances.length === 0) return null;

    const combat = game.combat;
    const active = instances.filter(inst =>
      !this._isExpired(inst.expiresAt, combat?.round, combat?.combatant?.initiative, game.time.worldTime)
    );

    if (active.length === 0) return null;

    const highest = this._calculateHighestValue(active);
    return highest.value;
  }

  // ========== INTERNAL HELPERS ==========

  /**
   * Get condition instances array for a specific condition slug
   */
  static async _getConditionInstances(actor, conditionSlug) {
    const allInstances = await this._getAllConditionInstances(actor);
    return allInstances[conditionSlug] || [];
  }

  /**
   * Get all condition instances
   */
  static async _getAllConditionInstances(actor) {
    return actor.getFlag(MODULE_ID, 'conditionInstances') || {};
  }

  /**
   * Set condition instances for a specific slug
   */
  static async _setConditionInstances(actor, conditionSlug, instances) {
    const allInstances = await this._getAllConditionInstances(actor);

    if (instances.length === 0) {
      delete allInstances[conditionSlug];
    } else {
      allInstances[conditionSlug] = instances;
    }

    await actor.setFlag(MODULE_ID, 'conditionInstances', allInstances);
  }

  /**
   * Calculate highest active value from instances
   */
  static _calculateHighestValue(instances) {
    if (instances.length === 0) return null;

    // Sort by value (descending), then by expiry (descending), then by addedAt (ascending for tie-break)
    const sorted = instances.sort((a, b) => {
      // First by value (higher is better)
      if ((a.value || 0) !== (b.value || 0)) {
        return (b.value || 0) - (a.value || 0);
      }

      // Then by expiry (longer is better)
      const aExpiry = this._getExpiryTime(a.expiresAt);
      const bExpiry = this._getExpiryTime(b.expiresAt);
      if (aExpiry !== bExpiry) {
        return bExpiry - aExpiry;
      }

      // Finally by addedAt (earlier wins for determinism)
      return a.addedAt - b.addedAt;
    });

    return sorted[0];
  }

  /**
   * Check if instance is expired
   */
  static _isExpired(expiresAt, currentRound, currentInitiative, currentTimestamp) {
    if (!expiresAt) return false;

    if (expiresAt.type === 'permanent') return false;

    if (expiresAt.type === 'combat' && currentRound !== null) {
      if (currentRound > expiresAt.round) return true;
      if (currentRound === expiresAt.round && currentInitiative !== null && expiresAt.initiative !== null) {
        return currentInitiative >= expiresAt.initiative;
      }
      return false;
    }

    if (expiresAt.type === 'worldTime' && currentTimestamp !== null) {
      return currentTimestamp >= expiresAt.timestamp;
    }

    return false;
  }

  /**
   * Get expiry time as comparable number (for sorting)
   */
  static _getExpiryTime(expiresAt) {
    if (!expiresAt) return Infinity;
    if (expiresAt.type === 'permanent') return Infinity;
    if (expiresAt.type === 'combat') return expiresAt.round || 0;
    if (expiresAt.type === 'worldTime') return expiresAt.timestamp || 0;
    return 0;
  }

  /**
   * Apply condition value to PF2e condition system
   */
  static async _applyConditionValue(actor, conditionSlug, value) {
    try {
      // Get existing condition
      const existingCondition = actor.itemTypes.condition?.find(c => c.slug === conditionSlug);

      if (existingCondition) {
        // Update value if different
        const currentValue = existingCondition.system?.value?.value;
        if (value && currentValue !== value) {
          await existingCondition.update({ 'system.value.value': value });
        } else if (!value && currentValue) {
          // Remove value (condition without value)
          await existingCondition.update({ 'system.value.value': null });
        }
      } else {
        // Add new condition
        if (value) {
          await actor.increaseCondition(conditionSlug, { value: value });
        } else {
          await actor.increaseCondition(conditionSlug);
        }
      }
    } catch (error) {
      console.error(`PF2e Afflictioner | Error applying condition ${conditionSlug}:`, error);
    }
  }

  /**
   * Remove condition from PF2e system
   */
  static async _removeCondition(actor, conditionSlug) {
    try {
      await actor.decreaseCondition(conditionSlug, { forceRemove: true });
    } catch (error) {
      // Condition might not exist, that's fine
      console.debug(`PF2e Afflictioner | Condition ${conditionSlug} not found for removal`);
    }
  }
}
