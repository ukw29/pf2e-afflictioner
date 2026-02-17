/**
 * Affliction Timer Service - Handles duration tracking and timing logic
 */

import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionParser } from './AfflictionParser.js';
import { AfflictionChatService } from './AfflictionChatService.js';

export class AfflictionTimerService {
  /**
   * Update onset timers for all afflicted tokens
   */
  static async updateOnsetTimers(token, combat, AfflictionService) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [id, affliction] of Object.entries(afflictions)) {
      if (affliction.inOnset && affliction.onsetRemaining > 0) {
        const newRemaining = affliction.onsetRemaining - 6; // 6 seconds per round

        if (newRemaining <= 0) {
          // Onset complete - advance to stage based on initial save result
          const targetStage = Math.min(affliction.stageAdvancement || 1, affliction.stages.length);
          const stageData = affliction.stages[targetStage - 1];

          if (!stageData) {
            console.error(`PF2e Afflictioner | Stage ${targetStage} not found for ${affliction.name}`);
            return;
          }

          const durationSeconds = AfflictionParser.durationToSeconds(stageData.duration);
          const durationRounds = Math.ceil(durationSeconds / 6);
          const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0,
            durationElapsed: 0,
            nextSaveRound: combat.round + durationRounds,
            nextSaveInitiative: tokenCombatant?.initiative
          });

          // Get updated affliction after stage change
          const updatedAffliction = AfflictionStore.getAffliction(token, id);
          await AfflictionService.applyStageEffects(token, updatedAffliction, stageData);

          // If stage has damage, post damage to chat
          if (stageData.damage && stageData.damage.length > 0) {
            await AfflictionService.promptDamage(token, updatedAffliction);
          }
        } else {
          await AfflictionStore.updateAffliction(token, id, {
            onsetRemaining: newRemaining
          });
        }
      }
    }
  }

  /**
   * Check durations and expire afflictions if needed
   */
  static async checkDurations(token, _combat) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [_id, affliction] of Object.entries(afflictions)) {
      if (!affliction.maxDuration) continue; // indefinite

      // Skip max duration counting during onset (per PF2e rules)
      if (affliction.inOnset) continue;

      // Increment elapsed time (6 seconds per round)
      const newMaxDurationElapsed = (affliction.maxDurationElapsed || 0) + 6;
      await AfflictionStore.updateAffliction(token, affliction.id, {
        maxDurationElapsed: newMaxDurationElapsed
      });

      // Check if max duration exceeded
      const maxDurationSeconds = AfflictionParser.durationToSeconds(affliction.maxDuration);

      if (newMaxDurationElapsed >= maxDurationSeconds && !affliction.maxDurationExpired) {
        // Mark as expired and post chat message
        await AfflictionStore.updateAffliction(token, affliction.id, {
          maxDurationExpired: true
        });

        await AfflictionChatService.postMaxDurationExpired(token, affliction);

        ui.notifications.warn(`${affliction.name} on ${token.name} has reached maximum duration. Check chat for removal button.`);
      }
    }
  }

  /**
   * Check maximum duration expiration for world time (non-combat)
   */
  static async checkWorldTimeMaxDuration(token, affliction, deltaSeconds) {
    if (!affliction.maxDuration) return false; // indefinite

    // Skip max duration counting during onset (per PF2e rules)
    if (affliction.inOnset) return false;

    // Increment elapsed time
    const newMaxDurationElapsed = (affliction.maxDurationElapsed || 0) + deltaSeconds;
    await AfflictionStore.updateAffliction(token, affliction.id, {
      maxDurationElapsed: newMaxDurationElapsed
    });

    // Check if max duration exceeded
    const maxDurationSeconds = AfflictionParser.durationToSeconds(affliction.maxDuration);

    if (newMaxDurationElapsed >= maxDurationSeconds && !affliction.maxDurationExpired) {
      // Mark as expired and post chat message
      await AfflictionStore.updateAffliction(token, affliction.id, {
        maxDurationExpired: true
      });

      await AfflictionChatService.postMaxDurationExpired(token, affliction);

      ui.notifications.warn(`${affliction.name} on ${token.name} has reached maximum duration. Check chat for removal button.`);

      return false; // Affliction not yet removed (GM must click button)
    }

    return false;
  }

  /**
   * Check if affliction needs save based on world time elapsed
   */
  static async checkWorldTimeSave(token, affliction, deltaSeconds, AfflictionService) {
    // Skip if still in onset period
    if (affliction.inOnset) {
      return;
    }

    // Skip if no current stage
    if (!affliction.currentStage || affliction.currentStage === 0) return;

    const stage = affliction.stages[affliction.currentStage - 1];
    if (!stage || !stage.duration) return;

    // Convert stage duration to seconds
    const stageDurationSeconds = AfflictionParser.durationToSeconds(stage.duration);

    // Track elapsed time
    const newElapsed = (affliction.durationElapsed || 0) + deltaSeconds;

    // Check if save is due
    if (newElapsed >= stageDurationSeconds) {
      // Reset elapsed time
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: 0
      });

      // Always prompt save in chat during world time updates
      await AfflictionService.promptSave(token, affliction);
    } else {
      // Update elapsed time
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: newElapsed
      });
    }
  }

  /**
   * Check if token has scheduled saves this turn
   */
  static async checkForScheduledSaves(token, combat, AfflictionService) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [_id, affliction] of Object.entries(afflictions)) {
      // Skip if still in onset period
      if (affliction.inOnset) continue;

      // Check if save is due or overdue
      const isOverdue = combat.round > affliction.nextSaveRound;
      const isDueNow = combat.round === affliction.nextSaveRound &&
        affliction.nextSaveInitiative === combat.combatant.initiative;

      if (isOverdue || isDueNow) {
        await AfflictionService.promptSave(token, affliction);
      }
    }
  }

  /**
   * Build expiration data for condition instance tracking
   */
  static buildExpirationData(_affliction, stage, token) {
    const combat = game.combat;

    if (!stage.duration) {
      return { type: "permanent" };
    }

    if (combat) {
      const durationSeconds = AfflictionParser.durationToSeconds(stage.duration);
      const durationRounds = Math.ceil(durationSeconds / 6);
      const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);

      return {
        type: "combat",
        round: combat.round + durationRounds,
        initiative: tokenCombatant?.initiative,
        timestamp: null
      };
    } else {
      const durationSeconds = AfflictionParser.durationToSeconds(stage.duration);
      return {
        type: "worldTime",
        round: null,
        initiative: null,
        timestamp: game.time.worldTime + durationSeconds
      };
    }
  }
}
