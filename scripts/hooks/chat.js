import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import * as WeaponCoatingStore from '../stores/WeaponCoatingStore.js';
import { DEGREE_OF_SUCCESS, MODULE_ID } from '../constants.js';
import { FeatsService } from '../services/FeatsService.js';

export async function onCreateChatMessage(message, options, userId) {
  if (!game.user.isGM) return;

  if (!game.settings.get('pf2e-afflictioner', 'autoDetectAfflictions')) return;

  const flags = message.flags?.pf2e;
  if (!flags?.context?.type) return;

  if (flags.context.type === 'attack-roll') {
    await handleAttackRoll(message, flags);
    return;
  }

  if (flags.context.type !== 'saving-throw') return;

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
      const durationCopy = { ...firstStage.duration };
      const durationSeconds = await AfflictionParser.resolveStageDuration(durationCopy, `${afflictionData.name} Stage 1`);
      const durationRounds = Math.ceil(durationSeconds / 6);
      affliction.nextSaveRound = combat.round + durationRounds;
      if (durationCopy.value > 0) {
        affliction.currentStageResolvedDuration = { value: durationCopy.value, unit: durationCopy.unit };
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

async function handleAttackRoll(_message, flags) {
  const originUuid = flags.origin?.uuid;
  if (!originUuid) return;

  let weapon;
  try {
    weapon = await fromUuid(originUuid);
  } catch {
    return;
  }
  if (!weapon) return;

  const actor = weapon.parent;
  if (!actor) return;

  const coating = WeaponCoatingStore.getCoating(actor, weapon.id);
  if (!coating) return;

  const outcome = flags.context?.outcome;
  if (!outcome) return;

  const weaponName = weapon.name;
  const actorName = actor.name;
  const poisonName = coating.poisonName;

  const gmWhisper = game.users.filter(u => u.isGM).map(u => u.id);

  if (outcome === DEGREE_OF_SUCCESS.SUCCESS || outcome === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) {
    const damageType = weapon.system?.damage?.damageType;
    const hasPiercingOrSlashing = damageType === 'piercing' || damageType === 'slashing';

    if (hasPiercingOrSlashing) {
      // Blowgun Poisoner: if the attacker critted with a blowgun and has the feat, degrade target's initial save
      const weaponTraits = weapon.system?.traits?.value ?? [];
      const isBlowgunStrike = weaponTraits.includes('blowgun') || weapon.system?.slug === 'blowgun';
      const buttonAfflictionData = (
        outcome === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS &&
        isBlowgunStrike &&
        FeatsService.hasBlowgunPoisoner(actor)
      )
        ? { ...coating.afflictionData, blowgunPoisonerCrit: true }
        : coating.afflictionData;

      const i = game.i18n;
      const K = 'PF2E_AFFLICTIONER.WEAPON_COATING';

      // Extract target from PF2e message flags (reliable regardless of who processes the hook)
      const targets = [];
      const pf2eTarget = flags.context?.target;
      if (pf2eTarget?.token) {
        try {
          const tokenDoc = await fromUuid(pf2eTarget.token);
          if (tokenDoc) {
            const canvasToken = canvas.tokens.get(tokenDoc.id);
            if (canvasToken) targets.push(canvasToken);
          }
        } catch { /* ignore */ }
      }
      // Fallback to current user's targets
      if (!targets.length) {
        targets.push(...game.user.targets);
      }

      if (targets.length) {
        for (const target of targets) {
          await ChatMessage.create({
            content: `
              <div class="pf2e-afflictioner-save-request">
                <h3><i class="fas fa-flask"></i> ${i.format(`${K}.HIT_TITLE`, { poisonName })}</h3>
                <p><strong>${actorName}</strong> hit <strong>${target.name}</strong> with <strong>${weaponName}</strong>.</p>
                <button class="pf2e-afflictioner-apply-weapon-poison"
                        data-target-token-id="${target.id}"
                        data-actor-id="${actor.id}"
                        data-weapon-id="${weapon.id}"
                        data-affliction-data="${encodeURIComponent(JSON.stringify(buttonAfflictionData))}">
                  <i class="fas fa-biohazard"></i> ${i.format(`${K}.HIT_APPLY_BTN`, { targetName: target.name })}
                </button>
              </div>`,
            whisper: gmWhisper
          });
        }
      } else {
        await ChatMessage.create({
          content: `
            <div class="pf2e-afflictioner-save-request">
              <h3><i class="fas fa-flask"></i> ${i.format(`${K}.HIT_TITLE`, { poisonName })}</h3>
              <p>${i.format(`${K}.HIT_NO_TARGET`, { actorName, weaponName })}</p>
              <p><em>${i.localize(`${K}.HIT_NO_TARGET_HINT`)}</em></p>
            </div>`,
          whisper: gmWhisper
        });
      }
    } else {
      await WeaponCoatingStore.removeCoating(actor, weapon.id);
      const i = game.i18n;
      const K = 'PF2E_AFFLICTIONER.WEAPON_COATING';
      await ChatMessage.create({
        content: `<div class="pf2e-afflictioner-save-request"><p>${i.format(`${K}.HIT_WRONG_DAMAGE`, { weaponName, poisonName })}</p></div>`,
        whisper: gmWhisper
      });
    }
  } else if (outcome === DEGREE_OF_SUCCESS.FAILURE) {
    const i = game.i18n;
    const K = 'PF2E_AFFLICTIONER.WEAPON_COATING';
    await ChatMessage.create({
      content: `<div class="pf2e-afflictioner-save-request"><p>${i.format(`${K}.MISS`, { actorName, weaponName, poisonName })}</p></div>`,
      whisper: gmWhisper
    });
  } else if (outcome === DEGREE_OF_SUCCESS.CRITICAL_FAILURE) {
    await WeaponCoatingStore.removeCoating(actor, weapon.id);
    const i = game.i18n;
    const K = 'PF2E_AFFLICTIONER.WEAPON_COATING';
    await ChatMessage.create({
      content: `<div class="pf2e-afflictioner-save-request"><p>${i.format(`${K}.CRIT_MISS`, { actorName, weaponName, poisonName })}</p></div>`,
      whisper: gmWhisper
    });
  }
}
