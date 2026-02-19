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
      ui.notifications.error('Token not found');
      return;
    }

    const AfflictionStore = await import('../stores/AfflictionStore.js');
    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) {
      ui.notifications.error('Affliction not found');
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

    const expiryNote = resolved?.value > 0
      ? `Effect will expire after ${resolved.value} ${resolved.unit}(s).`
      : `Effect and conditions persist on ${token.name} per PF2e rules.`;
    ui.notifications.info(`Removed ${affliction.name} from tracking. ${expiryNote}`);

    button.disabled = true;
    button.textContent = '✓ Affliction Removed';
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
      ui.notifications.error('Token not found');
      return;
    }

    const actor = token.actor;
    if (!actor) {
      ui.notifications.error('Actor not found');
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
    button.innerHTML = '<i class="fas fa-skull"></i> Confirmed';
  });
}
