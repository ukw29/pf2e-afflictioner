import * as AfflictionStore from '../stores/AfflictionStore.js';

export function registerTreatmentButtonHandlers(root) {
  const rollTreatmentButtons = root.querySelectorAll('.affliction-roll-treatment');
  rollTreatmentButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const tokenId = btn.dataset.tokenId;
      const afflictionId = btn.dataset.afflictionId;
      const dc = parseInt(btn.dataset.dc);

      const token = canvas.tokens.get(tokenId);
      if (!token) {
        ui.notifications.warn('Token not found');
        return;
      }

      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn('Affliction not found');
        return;
      }

      const treater = canvas.tokens.controlled[0] || token;
      const treatingActor = treater.actor;

      if (!treatingActor.skills?.medicine) {
        ui.notifications.warn('No Medicine skill found');
        return;
      }

      const roll = await treatingActor.skills.medicine.roll({ dc: { value: dc } });

      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleTreatment(tokenId, afflictionId, roll.total, dc);

      btn.disabled = true;
    });
  });
}

export async function addTreatmentAfflictionSelection(message, htmlElement) {
  if (!game.user.isGM) return;

  if (htmlElement.dataset.treatmentSelectionEnabled === 'true') return;

  const flags = message.flags?.pf2e;
  if (!flags?.context?.type || flags.context.type !== 'skill-check') return;

  const options = flags.context?.options || [];
  const isTreatPoison = options.includes('action:treat-poison');
  const isTreatDisease = options.includes('action:treat-disease');

  if (!isTreatPoison && !isTreatDisease) return;

  const rollTotal = message.rolls?.[0]?.total;
  if (typeof rollTotal !== 'number') return;

  const actorId = flags.context?.actor;
  if (!actorId) return;

  const actor = game.actors.get(actorId);
  if (!actor) return;

  if (!canvas?.tokens) return;

  const afflictionType = isTreatPoison ? 'poison' : 'disease';
  const tokensWithAfflictions = [];

  const tokensToCheck = game.user.targets.size > 0
    ? Array.from(game.user.targets)
    : canvas.tokens.placeables;

  for (const token of tokensToCheck) {
    const afflictions = AfflictionStore.getAfflictions(token);
    const matching = Object.values(afflictions).filter(a => a.type === afflictionType);
    if (matching.length > 0) {
      tokensWithAfflictions.push({ token, afflictions: matching });
    }
  }

  if (tokensWithAfflictions.length === 0) return;

  htmlElement.dataset.treatmentSelectionEnabled = 'true';

  const messageContent = htmlElement.querySelector('.message-content') || htmlElement.querySelector('.card-content');
  if (!messageContent) return;

  const selectionDiv = document.createElement('div');
  selectionDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: rgba(74, 124, 42, 0.15); border-left: 3px solid #4a7c2a; border-radius: 4px;';

  const header = document.createElement('div');
  header.style.cssText = 'font-weight: bold; color: #4a7c2a; margin-bottom: 8px;';
  header.innerHTML = '<i class="fas fa-medkit"></i> Apply Treatment To:';
  selectionDiv.appendChild(header);

  for (const { token, afflictions: matchingAfflictions } of tokensWithAfflictions) {
    for (const affliction of matchingAfflictions) {
      const button = document.createElement('button');
      button.style.cssText = 'width: 100%; padding: 6px; margin: 4px 0; background: #4a7c2a; border: 1px solid #5a8c3a; color: white; border-radius: 4px; cursor: pointer;';
      const stageDisplay = affliction.currentStage === -1 ? 'Initial Save' : `Stage ${affliction.currentStage}`;
      button.innerHTML = `${token.name}: ${affliction.name} (${stageDisplay})`;

      button.addEventListener('click', async () => {
        try {
          const { TreatmentService } = await import('../services/TreatmentService.js');
          await TreatmentService.handleTreatmentResult(token, affliction, rollTotal, affliction.dc);

          button.disabled = true;
          button.style.opacity = '0.5';
          button.innerHTML = `<i class="fas fa-check"></i> ${token.name}: ${affliction.name} - Treatment Applied`;
        } catch (error) {
          console.error('Error applying treatment:', error);
          ui.notifications.error('Failed to apply treatment');
        }
      });

      selectionDiv.appendChild(button);
    }
  }

  messageContent.appendChild(selectionDiv);
}
