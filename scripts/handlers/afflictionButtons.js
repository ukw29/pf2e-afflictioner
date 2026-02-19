import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';

export function registerAfflictionButtonHandlers(root, message) {
  registerDamageButtons(root);
  registerTargetButtons(root);

  if (message) {
    addApplyAfflictionButton(message, root);
    addApplyAfflictionToSelectedButton(message, root);
    addAfflictionDragSupport(message, root);
  }
}

function registerDamageButtons(root) {
  const rollDamageButtons = root.querySelectorAll('.affliction-roll-damage');
  rollDamageButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const tokenId = btn.dataset.tokenId;
      const afflictionId = btn.dataset.afflictionId;

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

      const currentStageIndex = affliction.currentStage - 1;
      if (currentStageIndex < 0 || !affliction.stages || !affliction.stages[currentStageIndex]) {
        ui.notifications.warn('No active stage to roll damage for');
        return;
      }

      const stage = affliction.stages[currentStageIndex];
      const actor = token.actor;

      if (!stage.damage || stage.damage.length === 0) {
        ui.notifications.info(`${affliction.name} Stage ${affliction.currentStage} has no damage to roll`);
        return;
      }

      for (const damageEntry of stage.damage) {
        try {
          const formula = typeof damageEntry === 'string' ? damageEntry : damageEntry.formula;
          const type = typeof damageEntry === 'object' ? damageEntry.type : 'untyped';

          if (!formula || formula.trim() === '') {
            continue;
          }

          const cleanFormula = formula.trim().replace(/\[.*$/, '');

          const damageRoll = await new Roll(cleanFormula).evaluate({ async: true });

          const enrichedFlavor = type !== 'untyped'
            ? `${affliction.name} - Stage ${affliction.currentStage}: @Damage[${cleanFormula}[${type}]]`
            : `${affliction.name} - Stage ${affliction.currentStage}: @Damage[${cleanFormula}]`;

          await damageRoll.toMessage({
            speaker: ChatMessage.getSpeaker({ token: token }),
            flavor: enrichedFlavor
          });

          ui.notifications.info(`Rolled ${damageRoll.total} damage for ${token.name} - Click @Damage button to apply with resistances`);
        } catch (error) {
          console.error('PF2e Afflictioner | Error rolling damage:', error);
          const displayFormula = typeof damageEntry === 'string' ? damageEntry : damageEntry.formula;
          ui.notifications.error(`Failed to roll damage: ${displayFormula}`);
        }
      }

      btn.disabled = true;
    });
  });
}

function registerTargetButtons(root) {
  const targetTokenButtons = root.querySelectorAll('.affliction-target-token');
  targetTokenButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const tokenId = btn.dataset.tokenId;

      const token = canvas.tokens.get(tokenId);
      if (!token) {
        ui.notifications.warn('Token not found on canvas');
        return;
      }

      token.setTarget(true, { user: game.user, releaseOthers: true, groupSelection: false });

      ui.notifications.info(`Targeted ${token.name}`);
    });
  });
}

async function addApplyAfflictionButton(message, htmlElement) {
  if (!game.user.isGM) return;

  if (htmlElement.dataset.applyAfflictionEnabled === 'true') return;

  const notes = message.flags?.pf2e?.context?.notes || [];

  let afflictionNote = notes.find(note => {
    const text = note.text || '';
    return text.includes('Saving Throw') && (text.includes('Stage 1') || text.includes('Stage 2'));
  });

  if (!afflictionNote) {
    const actor = message.actor;
    if (actor) {
      afflictionNote = notes.find(note => {
        if (!note.title) return false;
        const item = actor.items.find(i => {
          if (i.name === note.title) {
            const traits = i.system?.traits?.value || [];
            return traits.includes('curse') || traits.includes('poison') || traits.includes('disease');
          }
          return false;
        });
        return !!item;
      });
    }
  }

  if (!afflictionNote) return;

  const target = message.flags?.pf2e?.context?.target;
  if (!target?.token) return;

  htmlElement.dataset.applyAfflictionEnabled = 'true';

  const actor = message.actor;
  if (!actor) return;

  let item = actor.items.find(i => {
    if (i.name === afflictionNote.title) {
      const traits = i.system?.traits?.value || [];
      return traits.includes('poison') || traits.includes('disease') || traits.includes('curse');
    }
    return false;
  });

  if (!item) return;

  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  const rollNote = htmlElement.querySelector('.roll-note');
  if (!rollNote) return;

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'affliction-apply-container';
  buttonContainer.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(139, 0, 0, 0.3);';

  const button = document.createElement('button');
  button.className = 'affliction-apply-to-target';
  button.style.cssText = 'width: 100%; padding: 8px; background: var(--afflictioner-primary, #8b0000); border: 2px solid var(--afflictioner-primary-hover, #a00000); color: white; border-radius: 6px; cursor: pointer; font-weight: bold;';
  button.innerHTML = '<i class="fas fa-biohazard"></i> Apply Affliction to Target';
  button.dataset.targetToken = target.token;
  button.dataset.itemUuid = item.uuid;

  button.addEventListener('click', async () => {
    try {
      const targetTokenDoc = await fromUuid(target.token);
      if (!targetTokenDoc) {
        ui.notifications.error('Target token not found');
        return;
      }

      const token = targetTokenDoc.object;
      if (!token) {
        ui.notifications.error('Token not on canvas');
        return;
      }

      await AfflictionService.promptInitialSave(token, afflictionData);

      button.disabled = true;
      button.textContent = 'Applied';
    } catch (error) {
      console.error('PF2e Afflictioner | Error applying affliction:', error);
      ui.notifications.error('Failed to apply affliction');
    }
  });

  buttonContainer.appendChild(button);
  rollNote.appendChild(buttonContainer);
}

async function addApplyAfflictionToSelectedButton(message, htmlElement) {
  if (!game.user.isGM) return;

  if (htmlElement.dataset.applyAfflictionToSelectedEnabled === 'true') {
    return;
  }

  const itemUuid = message.flags?.pf2e?.origin?.uuid;

  if (!itemUuid) {
    return;
  }

  let item;
  try {
    item = await fromUuid(itemUuid);
  } catch (error) {
    return;
  }

  if (!item) return;

  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease') && !traits.includes('curse')) {
    return;
  }

  if (message.flags?.pf2e?.context?.target?.token) {
    return;
  }

  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) {
    return;
  }

  if (!afflictionData.dc) {
    const dcMatch = message.content?.match(/data-dc="(\d+)"/);
    if (dcMatch) afflictionData.dc = parseInt(dcMatch[1]);
  }

  htmlElement.dataset.applyAfflictionToSelectedEnabled = 'true';

  const messageContent = htmlElement.querySelector('.message-content') || htmlElement.querySelector('.card-content');
  if (!messageContent) return;

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'affliction-apply-container';
  buttonContainer.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(139, 0, 0, 0.3);';

  const button = document.createElement('button');
  button.className = 'affliction-apply-to-selected';
  button.style.cssText = 'width: 100%; padding: 8px; background: var(--afflictioner-primary, #8b0000); border: 2px solid var(--afflictioner-primary-hover, #a00000); color: white; border-radius: 6px; cursor: pointer; font-weight: bold;';
  button.innerHTML = '<i class="fas fa-biohazard"></i> Apply to Target / Selected Token';

  button.addEventListener('click', async () => {
    try {
      let tokens = Array.from(game.user.targets);
      if (!tokens.length) {
        tokens = canvas.tokens.controlled;
      }
      if (!tokens.length) {
        ui.notifications.warn('Please target or select a token first');
        return;
      }

      for (const token of tokens) {
        await AfflictionService.promptInitialSave(token, afflictionData);
      }

      button.disabled = true;
      button.textContent = `Applied to ${tokens.length} token(s)`;
      button.style.opacity = '0.5';
    } catch (error) {
      console.error('PF2e Afflictioner | Error applying affliction:', error);
      ui.notifications.error('Failed to apply affliction');
    }
  });

  buttonContainer.appendChild(button);
  messageContent.appendChild(buttonContainer);
}

async function addAfflictionDragSupport(message, htmlElement) {
  if (!game.user.isGM) return;

  if (htmlElement.dataset.afflictionDragEnabled === 'true') return;

  const item = message.getAssociatedItem?.();
  if (!item) return;

  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease') && !traits.includes('curse')) return;

  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  htmlElement.dataset.afflictionDragEnabled = 'true';

  htmlElement.setAttribute('draggable', 'true');
  htmlElement.style.cursor = 'grab';

  const contentElement = htmlElement.querySelector('.message-content');
  if (contentElement && !contentElement.querySelector('.affliction-drag-hint')) {
    const dragHint = document.createElement('div');
    dragHint.className = 'affliction-drag-hint';
    dragHint.innerHTML = '<i class="fas fa-hand-rock"></i> Drag to Affliction Manager to apply';
    contentElement.appendChild(dragHint);
  }

  const onDragStart = (event) => {
    htmlElement.style.cursor = 'grabbing';

    const dragData = {
      type: 'Affliction',
      afflictionData: afflictionData,
      itemUuid: item.uuid
    };

    event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'copy';
  };

  const onDragEnd = () => {
    htmlElement.style.cursor = 'grab';
  };

  htmlElement.addEventListener('dragstart', onDragStart);
  htmlElement.addEventListener('dragend', onDragEnd);
}
