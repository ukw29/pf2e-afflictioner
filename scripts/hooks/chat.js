import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { DEGREE_OF_SUCCESS } from '../constants.js';

export async function onCreateChatMessage(message, options, userId) {
  if (!game.user.isGM) return;

  if (!game.settings.get('pf2e-afflictioner', 'autoDetectAfflictions')) return;

  const flags = message.flags?.pf2e;
  if (!flags?.context?.type || flags.context.type !== 'saving-throw') return;

  const origin = flags.origin;
  if (!origin?.uuid) return;

  let item;
  try {
    item = await fromUuid(origin.uuid);
  } catch {
    return;
  }

  if (!item) return;

  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease') && !traits.includes('curse')) return;

  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  // Use the DC from the saving throw context — it includes elite/weak adjustments
  const contextDC = flags.context?.dc?.value;
  if (contextDC) afflictionData.dc = contextDC;

  const actorUuid = flags.actor?.uuid;
  if (!actorUuid) return;

  let actor;
  try {
    actor = await fromUuid(actorUuid);
  } catch {
    return;
  }

  if (!actor) return;

  const token = canvas.tokens.placeables.find(t => t.actor?.uuid === actor.uuid);
  if (!token) {
    return;
  }

  const degreeOfSuccess = flags.context?.outcome;
  if (!degreeOfSuccess) return;

  if (degreeOfSuccess === DEGREE_OF_SUCCESS.SUCCESS || degreeOfSuccess === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) {
    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RESISTED', {
      tokenName: token.name,
      afflictionName: afflictionData.name
    }));
    return;
  }

  const afflictionId = foundry.utils.randomID();
  const combat = game.combat;

  const affliction = {
    id: afflictionId,
    ...afflictionData,
    currentStage: 0,
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

  if (afflictionData.onset) {
    if (combat) {
      const onsetRounds = Math.ceil(affliction.onsetRemaining / 6);
      affliction.nextSaveRound = combat.round + onsetRounds;
    }
  } else {
    const firstStage = afflictionData.stages[0];
    affliction.currentStage = 1;
    affliction.inOnset = false;
    if (combat && firstStage?.duration) {
      const durationSeconds = await AfflictionParser.resolveStageDuration(firstStage.duration, `${afflictionData.name} Stage 1`);
      const durationRounds = Math.ceil(durationSeconds / 6);
      affliction.nextSaveRound = combat.round + durationRounds;
      if (firstStage.duration?.value > 0) {
        affliction.currentStageResolvedDuration = { value: firstStage.duration.value, unit: firstStage.duration.unit };
      }
    }

    await AfflictionService.applyStageEffects(token, affliction, firstStage);
  }

  await AfflictionStore.addAffliction(token, affliction);

  const { VisualService } = await import('../services/VisualService.js');
  await VisualService.addAfflictionIndicator(token);

  ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.AFFLICTED', {
    tokenName: token.name,
    afflictionName: afflictionData.name
  }));
}
