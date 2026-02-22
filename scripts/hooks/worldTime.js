import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export async function onWorldTimeUpdate(worldTime, delta) {
  if (!game.user.isGM) return;

  if (delta < 1) return;

  if (!canvas?.tokens) {
    return;
  }

  for (const token of canvas.tokens.placeables) {
    const afflictions = AfflictionStore.getAfflictions(token);
    if (Object.keys(afflictions).length === 0) continue;

    for (const [id, affliction] of Object.entries(afflictions)) {
      if (game.combat && game.combat.started) {
        continue;
      }

      if (affliction.inOnset && affliction.onsetRemaining > 0) {
        const newRemaining = affliction.onsetRemaining - delta;

        if (newRemaining <= 0) {
          const targetStage = Math.min(affliction.stageAdvancement || 1, affliction.stages.length);
          const stageData = affliction.stages[targetStage - 1];

          if (!stageData) {
            console.error(`PF2e Afflictioner | Stage ${targetStage} not found for ${affliction.name}`);
            continue;
          }

          const durationCopy = stageData.duration ? { ...stageData.duration } : null;
          const stageDurationSeconds = await AfflictionParser.resolveStageDuration(durationCopy, `${affliction.name} Stage ${targetStage}`);
          const resolvedDuration = durationCopy?.value > 0
            ? { value: durationCopy.value, unit: durationCopy.unit }
            : undefined;

          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0,
            durationElapsed: 0,
            nextSaveTimestamp: game.time.worldTime + stageDurationSeconds,
            ...(resolvedDuration && { currentStageResolvedDuration: resolvedDuration })
          });

          const updatedAffliction = AfflictionStore.getAffliction(token, id);
          await AfflictionService.applyStageEffects(token, updatedAffliction, stageData);

          if (stageData.damage && stageData.damage.length > 0) {
            await AfflictionService.promptDamage(token, updatedAffliction);
          }

          ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.MANAGER.ONSET_COMPLETE', {
            tokenName: token.name,
            afflictionName: affliction.name,
            stage: targetStage
          }));
        } else {
          await AfflictionStore.updateAffliction(token, id, {
            onsetRemaining: newRemaining
          });
        }
      } else {
        const wasRemoved = await AfflictionService.checkWorldTimeMaxDuration(token, affliction, delta);
        if (wasRemoved) continue;

        await AfflictionService.checkWorldTimeSave(token, affliction, delta);
      }
    }
  }
}
