import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionParser } from './AfflictionParser.js';
import { AfflictionChatService } from './AfflictionChatService.js';

export class AfflictionTimerService {
  static async updateOnsetTimers(token, combat, AfflictionService) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [id, affliction] of Object.entries(afflictions)) {
      if (affliction.inOnset && affliction.onsetRemaining > 0) {
        const newRemaining = affliction.onsetRemaining - 6;

        if (newRemaining <= 0) {
          const targetStage = Math.min(affliction.stageAdvancement || 1, affliction.stages.length);
          const stageData = affliction.stages[targetStage - 1];

          if (!stageData) {
            console.error(`PF2e Afflictioner | Stage ${targetStage} not found for ${affliction.name}`);
            return;
          }

          const durationSeconds = await AfflictionParser.resolveStageDuration(stageData.duration, `${affliction.name} Stage ${targetStage}`);
          const durationRounds = Math.ceil(durationSeconds / 6);
          const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
          const resolvedDuration = stageData.duration?.value > 0
            ? { value: stageData.duration.value, unit: stageData.duration.unit }
            : undefined;
          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0,
            durationElapsed: 0,
            nextSaveRound: combat.round + durationRounds,
            ...(resolvedDuration && { currentStageResolvedDuration: resolvedDuration }),
            nextSaveInitiative: tokenCombatant?.initiative
          });

          const updatedAffliction = AfflictionStore.getAffliction(token, id);
          await AfflictionService.applyStageEffects(token, updatedAffliction, stageData);

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

  static async checkDurations(token, _combat) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [_id, affliction] of Object.entries(afflictions)) {
      if (!affliction.maxDuration) continue;

      if (affliction.inOnset) continue;

      const newMaxDurationElapsed = (affliction.maxDurationElapsed || 0) + 6;
      await AfflictionStore.updateAffliction(token, affliction.id, {
        maxDurationElapsed: newMaxDurationElapsed
      });

      const maxDurationSeconds = AfflictionParser.durationToSeconds(affliction.maxDuration);

      if (newMaxDurationElapsed >= maxDurationSeconds && !affliction.maxDurationExpired) {
        await AfflictionStore.updateAffliction(token, affliction.id, {
          maxDurationExpired: true
        });

        await AfflictionChatService.postMaxDurationExpired(token, affliction);

        ui.notifications.warn(`${affliction.name} on ${token.name} has reached maximum duration. Check chat for removal button.`);
      }
    }
  }

  static async checkWorldTimeMaxDuration(token, affliction, deltaSeconds) {
    if (!affliction.maxDuration) return false;

    if (affliction.inOnset) return false;

    const newMaxDurationElapsed = (affliction.maxDurationElapsed || 0) + deltaSeconds;
    await AfflictionStore.updateAffliction(token, affliction.id, {
      maxDurationElapsed: newMaxDurationElapsed
    });

    const maxDurationSeconds = AfflictionParser.durationToSeconds(affliction.maxDuration);

    if (newMaxDurationElapsed >= maxDurationSeconds && !affliction.maxDurationExpired) {
      await AfflictionStore.updateAffliction(token, affliction.id, {
        maxDurationExpired: true
      });

      await AfflictionChatService.postMaxDurationExpired(token, affliction);

      ui.notifications.warn(`${affliction.name} on ${token.name} has reached maximum duration. Check chat for removal button.`);

      return false;
    }

    return false;
  }

  static async checkWorldTimeSave(token, affliction, deltaSeconds, AfflictionService) {
    if (affliction.inOnset) {
      return;
    }

    if (!affliction.currentStage || affliction.currentStage === 0) return;

    const stage = affliction.stages[affliction.currentStage - 1];
    if (!stage || !stage.duration) return;

    const stageDurationSeconds = AfflictionParser.durationToSeconds(stage.duration);

    const newElapsed = (affliction.durationElapsed || 0) + deltaSeconds;

    if (newElapsed >= stageDurationSeconds) {
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: 0
      });

      await AfflictionService.promptSave(token, affliction);
    } else {
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: newElapsed
      });
    }
  }

  static async checkForScheduledSaves(token, combat, AfflictionService) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [_id, affliction] of Object.entries(afflictions)) {
      if (affliction.inOnset) continue;

      const isOverdue = combat.round > affliction.nextSaveRound;
      const isDueNow = combat.round === affliction.nextSaveRound &&
        affliction.nextSaveInitiative === combat.combatant.initiative;

      if (isOverdue || isDueNow) {
        await AfflictionService.promptSave(token, affliction);
      }
    }
  }

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
