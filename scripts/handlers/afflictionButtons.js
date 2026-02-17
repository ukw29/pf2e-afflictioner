/**
 * Affliction Button Handlers - Damage, target, and apply affliction buttons
 */

import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';

/**
 * Register affliction-related button handlers
 */
export function registerAfflictionButtonHandlers(root, message) {
  // Handle damage roll buttons
  registerDamageButtons(root);

  // Handle target token buttons
  registerTargetButtons(root);

  // Add "Apply Affliction" buttons and drag support to chat messages
  if (message) {
    addApplyAfflictionButton(message, root);           // For attack messages with targets
    addApplyAfflictionToSelectedButton(message, root); // For items sent directly to chat
    addAfflictionDragSupport(message, root);
  }
}

/**
 * Register damage roll button handlers
 */
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

      // Get current stage
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

      // Roll and display typed damage - let PF2e handle resistances
      for (const damageEntry of stage.damage) {
        try {
          // Handle both old format (string) and new format (object)
          const formula = typeof damageEntry === 'string' ? damageEntry : damageEntry.formula;
          const type = typeof damageEntry === 'object' ? damageEntry.type : 'untyped';

          // Validate formula
          if (!formula || formula.trim() === '') {
            continue;
          }

          // Clean formula - remove any trailing brackets
          const cleanFormula = formula.trim().replace(/\[.*$/, '');

          // Roll plain formula for display
          const damageRoll = await new Roll(cleanFormula).evaluate({ async: true });

          // Create flavor with @Damage formula enrichment - creates clickable damage roll!
          const enrichedFlavor = type !== 'untyped'
            ? `${affliction.name} - Stage ${affliction.currentStage}: @Damage[${cleanFormula}[${type}]]`
            : `${affliction.name} - Stage ${affliction.currentStage}: @Damage[${cleanFormula}]`;

          // Show damage roll in chat - @Damage creates clickable roll button
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

      // Disable button after use
      btn.disabled = true;
    });
  });
}

/**
 * Register target token button handlers
 */
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

      // Target the token
      token.setTarget(true, { user: game.user, releaseOthers: true, groupSelection: false });

      // Pan to token
      ui.notifications.info(`Targeted ${token.name}`);
    });
  });
}

/**
 * Add "Apply Affliction" button to chat messages with affliction notes
 */
async function addApplyAfflictionButton(message, htmlElement) {
  // Only for GMs
  if (!game.user.isGM) return;

  // Check if already initialized
  if (htmlElement.dataset.applyAfflictionEnabled === 'true') return;

  // Check for affliction data in message flags (PF2e context notes)
  const notes = message.flags?.pf2e?.context?.notes || [];

  // Try to find a note with standard affliction format (poisons/diseases)
  let afflictionNote = notes.find(note => {
    const text = note.text || '';
    return text.includes('Saving Throw') && (text.includes('Stage 1') || text.includes('Stage 2'));
  });

  // If no standard format found, look for any note that might be a curse or simpler affliction
  // Check if the note title matches an item with curse/poison/disease trait
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

  // Check if there's a target
  const target = message.flags?.pf2e?.context?.target;
  if (!target?.token) return;

  // Mark as initialized
  htmlElement.dataset.applyAfflictionEnabled = 'true';

  // Get the affliction item by searching the actor's items for one matching the note title
  const actor = message.actor;
  if (!actor) return;

  // Search actor's items for the affliction
  let item = actor.items.find(i => {
    if (i.name === afflictionNote.title) {
      const traits = i.system?.traits?.value || [];
      return traits.includes('poison') || traits.includes('disease') || traits.includes('curse');
    }
    return false;
  });

  if (!item) return;

  // Parse affliction
  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  // Find the roll-note element to add our button
  const rollNote = htmlElement.querySelector('.roll-note');
  if (!rollNote) return;

  // Create button
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
      // Get target token
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

      // Apply affliction
      await AfflictionService.promptInitialSave(token, afflictionData);

      // Disable button
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

/**
 * Add "Apply Affliction" button for items sent directly to chat (no target)
 */
async function addApplyAfflictionToSelectedButton(message, htmlElement) {
  // Only for GMs
  if (!game.user.isGM) return;


  // Check if already initialized
  if (htmlElement.dataset.applyAfflictionToSelectedEnabled === 'true') {
    return;
  }

  // Try to get item from flags (for action cards sent to chat)
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

  // Check if item is an affliction (poison/disease/curse trait)
  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease') && !traits.includes('curse')) {
    return;
  }

  // Don't show this button if there's already a target-specific button
  if (message.flags?.pf2e?.context?.target?.token) {
    return;
  }

  // Parse affliction
  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) {
    return;
  }

  // Mark as initialized
  htmlElement.dataset.applyAfflictionToSelectedEnabled = 'true';

  // Find where to add the button
  const messageContent = htmlElement.querySelector('.message-content') || htmlElement.querySelector('.card-content');
  if (!messageContent) return;

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'affliction-apply-container';
  buttonContainer.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(139, 0, 0, 0.3);';

  const button = document.createElement('button');
  button.className = 'affliction-apply-to-selected';
  button.style.cssText = 'width: 100%; padding: 8px; background: var(--afflictioner-primary, #8b0000); border: 2px solid var(--afflictioner-primary-hover, #a00000); color: white; border-radius: 6px; cursor: pointer; font-weight: bold;';
  button.innerHTML = '<i class="fas fa-biohazard"></i> Apply to Selected Token';

  button.addEventListener('click', async () => {
    try {
      // Get selected tokens
      const selectedTokens = canvas.tokens.controlled;
      if (selectedTokens.length === 0) {
        ui.notifications.warn('Please select a token first');
        return;
      }

      // Apply affliction to all selected tokens
      for (const token of selectedTokens) {
        await AfflictionService.promptInitialSave(token, afflictionData);
      }

      // Disable button
      button.disabled = true;
      button.textContent = `Applied to ${selectedTokens.length} token(s)`;
      button.style.opacity = '0.5';
    } catch (error) {
      console.error('PF2e Afflictioner | Error applying affliction:', error);
      ui.notifications.error('Failed to apply affliction');
    }
  });

  buttonContainer.appendChild(button);
  messageContent.appendChild(buttonContainer);
}

/**
 * Add drag support for affliction items in chat messages
 */
async function addAfflictionDragSupport(message, htmlElement) {
  // Only for GMs
  if (!game.user.isGM) return;

  // Check if already initialized (prevent duplicate listeners)
  if (htmlElement.dataset.afflictionDragEnabled === 'true') return;

  // Check if message contains an item with poison/disease/curse trait
  const item = message.getAssociatedItem?.();
  if (!item) return;

  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease') && !traits.includes('curse')) return;

  // Parse affliction data
  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  // Mark as initialized
  htmlElement.dataset.afflictionDragEnabled = 'true';

  // Make the message draggable
  htmlElement.setAttribute('draggable', 'true');
  htmlElement.style.cursor = 'grab';

  // Add visual indicator (check if it doesn't already exist)
  const contentElement = htmlElement.querySelector('.message-content');
  if (contentElement && !contentElement.querySelector('.affliction-drag-hint')) {
    const dragHint = document.createElement('div');
    dragHint.className = 'affliction-drag-hint';
    dragHint.innerHTML = '<i class="fas fa-hand-rock"></i> Drag to Affliction Manager to apply';
    contentElement.appendChild(dragHint);
  }

  // Handle drag start
  const onDragStart = (event) => {
    htmlElement.style.cursor = 'grabbing';

    // Store affliction data for drag-drop
    const dragData = {
      type: 'Affliction',
      afflictionData: afflictionData,
      itemUuid: item.uuid
    };

    event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'copy';
  };

  // Handle drag end
  const onDragEnd = () => {
    htmlElement.style.cursor = 'grab';
  };

  htmlElement.addEventListener('dragstart', onDragStart);
  htmlElement.addEventListener('dragend', onDragEnd);
}
