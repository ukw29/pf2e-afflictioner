/**
 * Condition Hooks - Prevent manual removal of affliction-managed conditions
 */

import { MODULE_ID } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { ConditionStackingService } from '../services/ConditionStackingService.js';

/**
 * Prevent deletion of conditions that are managed by afflictions
 */
export function onPreDeleteItem(item, options, userId) {
  // Only check conditions
  if (item.type !== 'condition') return true;

  // Check if this condition is managed by an affliction
  const isAfflictionManaged = item.getFlag(MODULE_ID, 'fromAffliction');

  if (isAfflictionManaged) {
    // Prevent deletion unless it's from our cleanup code
    if (!options?.bypassAfflictionLock) {
      ui.notifications.warn(`${item.name} is managed by an affliction and cannot be manually removed. Manage the affliction to remove this condition.`);
      return false; // Prevent deletion
    }
  }

  return true; // Allow deletion
}

/**
 * Prevent updates to conditions that are managed by afflictions
 * Also handle GM badge changes on affliction effects to sync stage
 */
export async function onPreUpdateItem(item, changes, options, userId) {
  // Check if this is an affliction effect with badge change
  if (item.type === 'effect') {
    const isAfflictionEffect = item.getFlag(MODULE_ID, 'isAfflictionEffect');
    const afflictionId = item.getFlag(MODULE_ID, 'afflictionId');
    const badgeChange = changes.system?.badge?.value;

    if (isAfflictionEffect && afflictionId && badgeChange !== undefined) {
      // Allow GM to change badge and sync to affliction
      const user = game.users.get(userId);
      const isGM = user?.isGM;

      if (isGM && !options?.bypassAfflictionSync) {
        const token = canvas.tokens.get(item.parent.token?.id) || canvas.tokens.placeables.find(t => t.actor?.id === item.parent.id);
        if (token) {
          const affliction = AfflictionStore.getAffliction(token, afflictionId);
          if (affliction && affliction.currentStage !== badgeChange) {
            // Validate and clamp the new stage
            const maxStage = affliction.stages?.length || 4;
            const newStage = Math.max(0, Math.min(badgeChange, maxStage));

            // Use setTimeout to avoid blocking the hook
            setTimeout(async () => {
              try {
                // Stage 0 = cured, remove the affliction
                if (newStage === 0) {
                  const oldStageData = affliction.stages[affliction.currentStage - 1];
                  const actor = token.actor;

                  // Remove condition instances from stacking service
                  await ConditionStackingService.removeConditionInstancesForAffliction(actor, affliction.id);
                  await ConditionStackingService.recalculateConditions(actor);

                  // Remove affliction and stage effects
                  await AfflictionStore.removeAffliction(token, affliction.id);
                  await AfflictionService.removeStageEffects(token, affliction, oldStageData, null);

                  // Remove visual indicator
                  const { VisualService } = await import('../services/VisualService.js');
                  await VisualService.removeAfflictionIndicator(token);

                  ui.notifications.info(`${token.name} has recovered from ${affliction.name}`);
                  return;
                }

                // Get old and new stage data
                const oldStageData = affliction.stages[affliction.currentStage - 1];
                const newStageData = affliction.stages[newStage - 1];

                // Update affliction stage
                await AfflictionStore.updateAffliction(token, affliction.id, {
                  currentStage: newStage
                });

                // Re-fetch updated affliction
                const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

                // Remove old stage effects and apply new ones
                await AfflictionService.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);

                if (newStageData) {
                  await AfflictionService.applyStageEffects(token, updatedAffliction, newStageData);
                }

                ui.notifications.info(`Updated ${affliction.name} to stage ${newStage}`);
              } catch (error) {
                console.error('PF2e Afflictioner | Error syncing affliction stage:', error);
                ui.notifications.error(`Failed to update ${affliction.name} stage: ${error.message}`);
              }
            }, 0);

            return false; // Prevent direct badge update
          }
        }
      }
    }
  }

  // Only check conditions
  if (item.type !== 'condition') return true;

  // Check if this condition is managed by an affliction
  const isAfflictionManaged = item.getFlag(MODULE_ID, 'fromAffliction');

  if (isAfflictionManaged) {
    // Check if they're trying to update the value (decreasing levels)
    const isValueChange = changes.system?.value?.value !== undefined;

    // Allow GMs to manually adjust condition levels
    const user = game.users.get(userId);
    const isGM = user?.isGM;

    // Prevent updates unless it's from our cleanup code or the user is a GM
    if (isValueChange && !options?.bypassAfflictionLock && !isGM) {
      ui.notifications.warn(`${item.name} is managed by an affliction and cannot be manually modified. Manage the affliction to change this condition.`);
      return false; // Prevent update
    }
  }

  return true; // Allow update
}
