/**
 * World Time Hook - Handle out-of-combat affliction progression
 */

import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

/**
 * Handle world time changes - check afflictions need saves
 */
export async function onWorldTimeUpdate(worldTime, delta) {
  // Only GM processes time updates
  if (!game.user.isGM) return;

  // Skip very small time changes (< 1 second) to avoid noise
  if (delta < 1) return;

  // Check tokens on current canvas (we can only interact with rendered tokens)
  if (!canvas?.tokens) {
    return;
  }

  for (const token of canvas.tokens.placeables) {
    const afflictions = AfflictionStore.getAfflictions(token);
    if (Object.keys(afflictions).length === 0) continue;

    for (const [id, affliction] of Object.entries(afflictions)) {
      // Skip if in active combat (combat-based tracking takes precedence)
      if (game.combat && game.combat.started) {
        continue;
      }

      // Update onset timers
      if (affliction.inOnset && affliction.onsetRemaining > 0) {
        const newRemaining = affliction.onsetRemaining - delta;

        if (newRemaining <= 0) {
          // Onset complete - advance to stage based on initial save result
          // stageAdvancement: 1 for failure, 2 for critical failure
          const targetStage = Math.min(affliction.stageAdvancement || 1, affliction.stages.length);
          const stageData = affliction.stages[targetStage - 1];

          if (!stageData) {
            console.error(`PF2e Afflictioner | Stage ${targetStage} not found for ${affliction.name}`);
            continue;
          }

          // Calculate next save time for world time tracking
          const stageDurationSeconds = await AfflictionParser.resolveStageDuration(stageData.duration, `${affliction.name} Stage ${targetStage}`);
          const resolvedDuration = stageData.duration?.value > 0
            ? { value: stageData.duration.value, unit: stageData.duration.unit }
            : undefined;

          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0,
            durationElapsed: 0,  // Reset duration tracking for new stage
            nextSaveTimestamp: game.time.worldTime + stageDurationSeconds,
            ...(resolvedDuration && { currentStageResolvedDuration: resolvedDuration })
          });

          // Re-fetch affliction with updated currentStage
          const updatedAffliction = AfflictionStore.getAffliction(token, id);
          await AfflictionService.applyStageEffects(token, updatedAffliction, stageData);

          // If stage has damage, post damage to chat
          if (stageData.damage && stageData.damage.length > 0) {
            await AfflictionService.promptDamage(token, updatedAffliction);
          }

          ui.notifications.info(`${token.name} - ${affliction.name} onset complete, now at stage ${targetStage}`);
        } else {
          await AfflictionStore.updateAffliction(token, id, {
            onsetRemaining: newRemaining
          });
        }
      } else {
        // Check if maximum duration expired
        const wasRemoved = await AfflictionService.checkWorldTimeMaxDuration(token, affliction, delta);
        if (wasRemoved) continue; // Skip further checks if affliction was removed

        // Check if save is due based on elapsed time
        await AfflictionService.checkWorldTimeSave(token, affliction, delta);

        // Note: Damage prompts are NOT posted during world time updates
        // Damage is only prompted when entering a new stage (via save result)
      }
    }

    // NOTE: Condition cleanup is now handled by GrantItem automatically
    // When affliction effects are removed, PF2e removes granted conditions
  }
}
