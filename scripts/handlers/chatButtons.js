import { registerSaveButtonHandlers, injectConfirmationButton } from './saveButtons.js';
import { registerAfflictionButtonHandlers } from './afflictionButtons.js';
import { registerTreatmentButtonHandlers, addTreatmentAfflictionSelection } from './treatmentButtons.js';
import { registerCounteractButtonHandlers, addCounteractAfflictionSelection, injectCounteractConfirmButton } from './counteractButtons.js';

export function onRenderChatMessage(message, html) {
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  injectConfirmationButton(message, root);
  injectCounteractConfirmButton(message, root);

  registerSaveButtonHandlers(root);
  registerAfflictionButtonHandlers(root, message);
  registerTreatmentButtonHandlers(root);
  registerCounteractButtonHandlers(root);

  addTreatmentAfflictionSelection(message, root);
  addCounteractAfflictionSelection(message, root);

  registerMaxDurationRemovalHandler(root);
  registerDeathConfirmationHandler(root);
  registerApplyWeaponPoisonHandler(root);

  injectCoatWeaponButton(message, root);
}

function registerApplyWeaponPoisonHandler(root) {
  const btn = root.querySelector('.pf2e-afflictioner-apply-weapon-poison');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const targetTokenId = btn.dataset.targetTokenId;
    const actorId = btn.dataset.actorId;
    const weaponId = btn.dataset.weaponId;
    const afflictionData = JSON.parse(decodeURIComponent(btn.dataset.afflictionData));

    const target = canvas.tokens.get(targetTokenId);
    if (!target) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.WEAPON_COATING.TARGET_NOT_FOUND'));
      return;
    }

    if (actorId && weaponId) {
      const actor = game.actors.get(actorId);
      if (actor) {
        const { removeCoating } = await import('../stores/WeaponCoatingStore.js');
        await removeCoating(actor, weaponId);
        const { AfflictionManager } = await import('../managers/AfflictionManager.js');
        if (AfflictionManager.currentInstance) AfflictionManager.currentInstance.render({ force: true });
      }
    }

    const { AfflictionService } = await import('../services/AfflictionService.js');
    await AfflictionService.promptInitialSave(target, afflictionData);

    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.WEAPON_COATING.SAVE_PROMPTED')}`;
  });
}

async function injectCoatWeaponButton(message, root) {
  if (!game.user.isGM) return;

  const itemUuid = message.flags?.pf2e?.origin?.uuid;
  if (!itemUuid) return;

  let item;
  try {
    item = await fromUuid(itemUuid);
  } catch {
    return;
  }
  if (!item) return;

  const traits = item.system?.traits?.value || [];
  if (!traits.includes('injury')) return;

  const footer = root.querySelector('.card-footer, .chat-card footer, .item-card footer');
  const container = footer || root.querySelector('.chat-card, .item-card') || root;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pf2e-afflictioner-coat-weapon-btn';
  btn.innerHTML = `<i class="fas fa-flask"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.WEAPON_COATING.COAT_WEAPON_BTN')}`;
  btn.dataset.itemUuid = itemUuid;


  const speakerActorId = message.speaker?.actor;
  const speakerTokenId = message.speaker?.token;

  btn.addEventListener('click', async () => {
    const targetTokenIds = [...game.user.targets].map(t => t.id);
    const { WeaponCoatingService } = await import('../services/WeaponCoatingService.js');
    const coated = await WeaponCoatingService.openCoatDialog(itemUuid, speakerActorId, speakerTokenId, targetTokenIds);
    if (coated) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.WEAPON_COATING.COAT_WEAPON_DONE')}`;
    }
  });

  container.appendChild(btn);
}

function registerMaxDurationRemovalHandler(root) {
  const removeBtn = root.querySelector('.pf2e-afflictioner-remove-expired-btn');
  if (!removeBtn) return;

  removeBtn.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const tokenId = button.dataset.tokenId;
    const afflictionId = button.dataset.afflictionId;

    const token = canvas.tokens.get(tokenId);
    if (!token) {
      ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
      return;
    }

    const AfflictionStore = await import('../stores/AfflictionStore.js');
    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) {
      ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND'));
      return;
    }

    const resolved = affliction.currentStageResolvedDuration;
    if (resolved?.value > 0 && affliction.appliedEffectUuid) {
      try {
        const effect = await fromUuid(affliction.appliedEffectUuid);
        if (effect) {
          const unitMap = { round: 'rounds', minute: 'minutes', hour: 'hours', day: 'days', week: 'weeks' };
          await effect.update({
            'system.duration': {
              value: resolved.value,
              unit: unitMap[resolved.unit] || resolved.unit,
              expiry: resolved.unit === 'round' ? 'turn-start' : null,
              sustained: false
            }
          });
        }
      } catch (e) {
        console.error('PF2e Afflictioner | Failed to update effect duration on max duration expiry:', e);
      }
    }

    await AfflictionStore.removeAffliction(token, afflictionId);

    const { VisualService } = await import('../services/VisualService.js');
    await VisualService.removeAfflictionIndicator(token);

    if (resolved?.value > 0) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.MANAGER.REMOVED_FROM_TRACKING_EXPIRES', {
        afflictionName: affliction.name,
        value: resolved.value,
        unit: resolved.unit
      }));
    } else {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.MANAGER.REMOVED_FROM_TRACKING_PERSISTS', {
        afflictionName: affliction.name,
        tokenName: token.name
      }));
    }

    button.disabled = true;
    button.textContent = `✓ ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.AFFLICTION_REMOVED')}`;
  });
}

function registerDeathConfirmationHandler(root) {
  const killBtn = root.querySelector('.pf2e-afflictioner-confirm-kill-btn');
  if (!killBtn) return;

  killBtn.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const tokenId = button.dataset.tokenId;
    const afflictionId = button.dataset.afflictionId;

    const token = canvas.tokens.get(tokenId);
    if (!token) {
      ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
      return;
    }

    const actor = token.actor;
    if (!actor) {
      ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.ACTOR_NOT_FOUND'));
      return;
    }

    const AfflictionStore = await import('../stores/AfflictionStore.js');
    const affliction = AfflictionStore.getAffliction(token, afflictionId);

    await actor.update({ 'system.attributes.hp.value': 0 });
    await actor.increaseCondition('dying');
    const dying = actor.getCondition('dying');
    if (dying) {
      const dyingMax = actor.system.attributes?.dying?.max ?? 4;
      await dying.update({ 'system.value.value': dyingMax });
    }

    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.KILLED', {
      tokenName: token.name,
      afflictionName: affliction?.name ?? 'Unknown'
    }));

    button.disabled = true;
    button.innerHTML = `<i class="fas fa-skull"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.DEATH_CONFIRMED')}`;
  });
}
