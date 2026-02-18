/**
 * Chat Message Hook - Detects saving throws against afflictions
 */

import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

/**
 * Handle chat message creation - detect saving throws against afflictions
 */
export async function onCreateChatMessage(message, options, userId) {
  // Only GM processes auto-application
  if (!game.user.isGM) return;

  // Check if auto-detection is enabled
  if (!game.settings.get('pf2e-afflictioner', 'autoDetectAfflictions')) return;

  // Check if this is a saving throw
  const flags = message.flags?.pf2e;
  if (!flags?.context?.type || flags.context.type !== 'saving-throw') return;

  // Get the origin item (what triggered the save)
  const origin = flags.origin;
  if (!origin?.uuid) return;

  let item;
  try {
    item = await fromUuid(origin.uuid);
  } catch {
    return;
  }

  if (!item) return;

  // Check if origin item has affliction (poison/disease/curse trait)
  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease') && !traits.includes('curse')) return;

  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  // Get the actor who rolled the save (the target of the affliction)
  const actorUuid = flags.actor?.uuid;
  if (!actorUuid) return;

  let actor;
  try {
    actor = await fromUuid(actorUuid);
  } catch {
    return;
  }

  if (!actor) return;

  // Find the token for this actor on the current scene
  const token = canvas.tokens.placeables.find(t => t.actor?.uuid === actor.uuid);
  if (!token) {
    return;
  }

  // Get the save result from the message
  const degreeOfSuccess = flags.context?.outcome;
  if (!degreeOfSuccess) return;

  // Auto-apply based on save result
  // Success or Critical Success = resisted
  if (degreeOfSuccess === 'success' || degreeOfSuccess === 'criticalSuccess') {
    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RESISTED', {
      tokenName: token.name,
      afflictionName: afflictionData.name
    }));
    return;
  }

  // Failure or Critical Failure = afflicted
  // Create affliction
  const afflictionId = foundry.utils.randomID();
  const combat = game.combat;

  const affliction = {
    id: afflictionId,
    ...afflictionData,
    currentStage: 0, // onset stage
    inOnset: !!afflictionData.onset,
    onsetRemaining: AfflictionParser.durationToSeconds(afflictionData.onset),
    nextSaveRound: combat ? combat.round : null,
    nextSaveInitiative: combat ? combat.combatant?.initiative : null,
    applicationInitiative: combat?.combatant?.initiative ?? null,
    stageStartRound: combat ? combat.round : null,
    durationElapsed: 0,
    nextSaveTimestamp: !combat ? game.time.worldTime + AfflictionParser.durationToSeconds(afflictionData.onset || afflictionData.stages?.[0]?.duration) : null,
    treatmentBonus: 0,
    treatedThisStage: false,
    addedTimestamp: Date.now(),
    addedInCombat: !!combat,
    combatId: combat?.id
  };

  // Calculate next save timing
  if (afflictionData.onset) {
    // Save happens after onset expires
    if (combat) {
      const onsetRounds = Math.ceil(affliction.onsetRemaining / 6);
      affliction.nextSaveRound = combat.round + onsetRounds;
    }
  } else {
    // No onset - go straight to stage 1
    const firstStage = afflictionData.stages[0];
    affliction.currentStage = 1;
    affliction.inOnset = false;
    if (combat && firstStage?.duration) {
      // Convert duration to rounds (6 seconds per round)
      const durationSeconds = await AfflictionParser.resolveStageDuration(firstStage.duration, `${afflictionData.name} Stage 1`);
      const durationRounds = Math.ceil(durationSeconds / 6);
      affliction.nextSaveRound = combat.round + durationRounds;
      if (firstStage.duration?.value > 0) {
        affliction.currentStageResolvedDuration = { value: firstStage.duration.value, unit: firstStage.duration.unit };
      }
    }

    // Apply stage 1 effects
    await AfflictionService.applyStageEffects(token, affliction, firstStage);
  }

  await AfflictionStore.addAffliction(token, affliction);

  // Add visual indicator
  const { VisualService } = await import('../services/VisualService.js');
  await VisualService.addAfflictionIndicator(token);

  ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.AFFLICTED', {
    tokenName: token.name,
    afflictionName: afflictionData.name
  }));
}
