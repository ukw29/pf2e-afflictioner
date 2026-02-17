/**
 * Save Button Handlers - Initial saves, stage saves, and confirmation buttons
 */

import * as AfflictionStore from '../stores/AfflictionStore.js';

/**
 * Register save button handlers
 */
export function registerSaveButtonHandlers(root) {
  // Handle initial save buttons
  registerInitialSaveButtons(root);

  // Handle stage save buttons
  registerStageSaveButtons(root);

  // Handle save confirmation buttons
  registerConfirmationButtons(root);
}

/**
 * Register initial save button handlers
 */
function registerInitialSaveButtons(root) {
  const rollInitialSaveButtons = root.querySelectorAll('.affliction-roll-initial-save');
  rollInitialSaveButtons.forEach(button => {
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

      let affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn('Affliction not found');
        return;
      }

      // Check for edited definition and apply it to get current DC
      const AfflictionDefinitionStore = await import('../stores/AfflictionDefinitionStore.js');
      const key = AfflictionDefinitionStore.generateDefinitionKey(affliction);
      const editedDef = AfflictionDefinitionStore.getEditedDefinition(key);
      if (editedDef) {
        const { AfflictionEditorService } = await import('../services/AfflictionEditorService.js');
        affliction = AfflictionEditorService.applyEditedDefinition(affliction, editedDef);
      }

      // Use the current DC from the affliction (potentially edited)
      const currentDC = affliction.dc || dc;

      // Try storyframe integration first
      const { StoryframeIntegrationService } = await import('../services/StoryframeIntegrationService.js');
      const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'initial');

      if (sentToStoryframe) {
        // Disable button - result will be handled via polling
        btn.disabled = true;
        return;
      }

      // Fallback: Roll the save via chat button
      const actor = token.actor;

      // Capture the message ID by tracking message creation
      let rollMessageId = null;
      Hooks.once('createChatMessage', (message) => {
        if (message.actor?.id === actor.id && message.flags?.pf2e?.context?.type === 'saving-throw') {
          rollMessageId = message.id;
        }
      });

      await actor.saves.fortitude.roll({ dc: { value: currentDC } });

      // Wait a bit for the hook to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      // If hook didn't capture it, fall back to finding the last message
      if (!rollMessageId) {
        rollMessageId = game.messages.contents[game.messages.contents.length - 1]?.id;
      }

      // Send roll message ID to GM for processing (not the total, so rerolls are captured)
      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleInitialSave(tokenId, afflictionId, rollMessageId, currentDC);

      // Disable button after use and broadcast to all clients
      btn.disabled = true;

      // Broadcast button disable to all clients
      const messageElement = btn.closest('.message');
      const msgId = messageElement?.dataset.messageId;
      if (msgId) {
        const { SocketService } = await import('../services/SocketService.js');
        await SocketService.syncButtonState(msgId, btn.className, true); // true = disabled
      }

      // Add small unlock button for GMs (inline next to the disabled button)
      if (game.user.isGM && !btn.nextElementSibling?.classList.contains('affliction-unlock-save')) {
        const unlockBtn = document.createElement('button');
        unlockBtn.className = 'affliction-unlock-save';
        unlockBtn.style.cssText = 'display: inline-block; margin-left: 8px; padding: 4px 8px; background: #555; border: 1px solid #777; color: #ffd700; border-radius: 4px; cursor: pointer; font-size: 11px; vertical-align: middle;';
        unlockBtn.innerHTML = '<i class="fas fa-unlock"></i> Unlock';

        unlockBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Find message ID from the chat message element
          const messageElement = btn.closest('.message');
          const messageId = messageElement?.dataset.messageId;

          if (messageId) {
            const { SocketService } = await import('../services/SocketService.js');
            await SocketService.unlockSaveButton(messageId, btn.className);
            unlockBtn.remove();
          } else {
            console.error('Could not find message ID for unlock');
          }
        });

        // Insert after the button
        btn.insertAdjacentElement('afterend', unlockBtn);
      }
    });
  });
}

/**
 * Register stage save button handlers
 */
function registerStageSaveButtons(root) {
  const rollSaveButtons = root.querySelectorAll('.affliction-roll-save');
  rollSaveButtons.forEach(button => {
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

      let affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn('Affliction not found');
        return;
      }

      // Check for edited definition and apply it to get current DC
      const AfflictionDefinitionStore = await import('../stores/AfflictionDefinitionStore.js');
      const key = AfflictionDefinitionStore.generateDefinitionKey(affliction);
      const editedDef = AfflictionDefinitionStore.getEditedDefinition(key);
      if (editedDef) {
        const { AfflictionEditorService } = await import('../services/AfflictionEditorService.js');
        affliction = AfflictionEditorService.applyEditedDefinition(affliction, editedDef);
      }

      // Use the current DC from the affliction (potentially edited)
      const currentDC = affliction.dc || dc;

      // Try storyframe integration first
      const { StoryframeIntegrationService } = await import('../services/StoryframeIntegrationService.js');
      const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'stage');

      if (sentToStoryframe) {
        // Disable button - result will be handled via polling
        btn.disabled = true;
        return;
      }

      // Fallback: Roll the save via chat button
      const actor = token.actor;

      // Capture the message ID by tracking message creation
      let rollMessageId = null;
      Hooks.once('createChatMessage', (message) => {
        if (message.actor?.id === actor.id && message.flags?.pf2e?.context?.type === 'saving-throw') {
          rollMessageId = message.id;
        }
      });

      await actor.saves.fortitude.roll({ dc: { value: currentDC } });

      // Wait a bit for the hook to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      // If hook didn't capture it, fall back to finding the last message
      if (!rollMessageId) {
        rollMessageId = game.messages.contents[game.messages.contents.length - 1]?.id;
      }

      // Send roll message ID to GM for processing (not the total, so rerolls are captured)
      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleSave(tokenId, afflictionId, rollMessageId, currentDC);

      // Disable button after use and broadcast to all clients
      btn.disabled = true;

      // Broadcast button disable to all clients
      const messageElement = btn.closest('.message');
      const msgId = messageElement?.dataset.messageId;
      if (msgId) {
        const { SocketService } = await import('../services/SocketService.js');
        await SocketService.syncButtonState(msgId, btn.className, true); // true = disabled
      }

      // Add small unlock button for GMs (inline next to the disabled button)
      if (game.user.isGM && !btn.nextElementSibling?.classList.contains('affliction-unlock-save')) {
        const unlockBtn = document.createElement('button');
        unlockBtn.className = 'affliction-unlock-save';
        unlockBtn.style.cssText = 'display: inline-block; margin-left: 8px; padding: 4px 8px; background: #555; border: 1px solid #777; color: #ffd700; border-radius: 4px; cursor: pointer; font-size: 11px; vertical-align: middle;';
        unlockBtn.innerHTML = '<i class="fas fa-unlock"></i> Unlock';

        unlockBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Find message ID from the chat message element
          const messageElement = btn.closest('.message');
          const messageId = messageElement?.dataset.messageId;

          if (messageId) {
            const { SocketService } = await import('../services/SocketService.js');
            await SocketService.unlockSaveButton(messageId, btn.className);
            unlockBtn.remove();
          } else {
            console.error('Could not find message ID for unlock');
          }
        });

        // Insert after the button
        btn.insertAdjacentElement('afterend', unlockBtn);
      }
    });
  });
}

/**
 * Register save confirmation button handlers
 */
function registerConfirmationButtons(root) {
  const confirmSaveButtons = root.querySelectorAll('.affliction-confirm-save');
  confirmSaveButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const tokenId = btn.dataset.tokenId;
      const afflictionId = btn.dataset.afflictionId;
      const rollMessageId = btn.dataset.rollMessageId;
      const dc = parseInt(btn.dataset.dc);
      const saveType = btn.dataset.saveType;

      // Send to GM for processing via socket
      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestApplySaveConsequences(tokenId, afflictionId, rollMessageId, dc, saveType);

      // Disable button after use
      btn.disabled = true;
      btn.textContent = 'Applied';
      btn.style.opacity = '0.5';
    });
  });
}

/**
 * Inject confirmation button directly onto roll messages (when requireSaveConfirmation is enabled)
 */
export async function injectConfirmationButton(message, root) {
  // Only for GMs
  if (!game.user.isGM) return;

  // Check if this message needs a confirmation button
  if (!message.flags?.['pf2e-afflictioner']?.needsConfirmation) return;

  // Check if already injected
  if (root.querySelector('.affliction-confirm-save')) return;

  const flags = message.flags['pf2e-afflictioner'];
  const { tokenId, afflictionId, saveType, dc } = flags;

  // Get the roll result
  const { AfflictionService } = await import('../services/AfflictionService.js');
  const roll = message.rolls?.[0];
  if (!roll) return;

  const saveTotal = roll.total;
  const dieValue = AfflictionService.getDieValue(message);
  const degreeConstant = AfflictionService.calculateDegreeOfSuccess(saveTotal, dc, dieValue);

  // Convert to string for UI
  const { DEGREE_OF_SUCCESS } = await import('../constants.js');
  const degreeMap = {
    [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: 'criticalSuccess',
    [DEGREE_OF_SUCCESS.SUCCESS]: 'success',
    [DEGREE_OF_SUCCESS.FAILURE]: 'failure',
    [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: 'criticalFailure'
  };
  const degree = degreeMap[degreeConstant] || 'failure';

  // Define colors and gradients for each degree
  const colorScheme = {
    'criticalSuccess': {
      gradient: 'linear-gradient(135deg, rgb(0, 180, 0) 0%, rgb(0, 128, 0) 100%)',
      border: 'rgb(0, 200, 0)',
      glow: 'rgba(0, 255, 0, 0.4)'
    },
    'success': {
      gradient: 'linear-gradient(135deg, rgb(50, 100, 255) 0%, rgb(0, 0, 200) 100%)',
      border: 'rgb(0, 100, 255)',
      glow: 'rgba(0, 100, 255, 0.4)'
    },
    'failure': {
      gradient: 'linear-gradient(135deg, rgb(255, 120, 50) 0%, rgb(255, 69, 0) 100%)',
      border: 'rgb(255, 100, 0)',
      glow: 'rgba(255, 100, 0, 0.4)'
    },
    'criticalFailure': {
      gradient: 'linear-gradient(135deg, rgb(255, 50, 50) 0%, rgb(200, 0, 0) 100%)',
      border: 'rgb(255, 0, 0)',
      glow: 'rgba(255, 0, 0, 0.4)'
    }
  };

  const colors = colorScheme[degree];

  // Find the message content area
  const messageContent = root.querySelector('.message-content');
  if (!messageContent) return;

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = 'margin-top: 8px; padding-top: 8px;';

  // Create the confirmation button with gradient and animations
  const button = document.createElement('button');
  button.className = 'affliction-confirm-save';
  button.dataset.tokenId = tokenId;
  button.dataset.afflictionId = afflictionId;
  button.dataset.rollMessageId = message.id;
  button.dataset.dc = dc;
  button.dataset.saveType = saveType;
  button.style.cssText = `
    width: 100%;
    padding: 10px;
    background: ${colors.gradient};
    border: 2px solid ${colors.border};
    color: white;
    border-radius: 8px;
    cursor: pointer;
    font-weight: bold;
    font-size: 13px;
    margin-top: 4px;
    box-shadow: 0 3px 8px rgba(0,0,0,0.3), 0 0 15px ${colors.glow};
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `;
  button.innerHTML = '<i class="fas fa-check"></i> Apply Consequences';

  // Add hover effects
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-1px)';
    button.style.boxShadow = `0 5px 12px rgba(0,0,0,0.4), 0 0 25px ${colors.glow}`;
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = `0 3px 8px rgba(0,0,0,0.3), 0 0 15px ${colors.glow}`;
  });

  // Add click animation
  button.addEventListener('mousedown', () => {
    button.style.transform = 'translateY(1px)';
  });

  button.addEventListener('mouseup', () => {
    button.style.transform = 'translateY(-1px)';
  });

  button.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const { SocketService } = await import('../services/SocketService.js');
    await SocketService.requestApplySaveConsequences(
      btn.dataset.tokenId,
      btn.dataset.afflictionId,
      btn.dataset.rollMessageId,
      parseInt(btn.dataset.dc),
      btn.dataset.saveType
    );

    // Disable button and remove confirmation flag
    btn.disabled = true;
    btn.textContent = 'Applied';
    btn.style.opacity = '0.5';
  });

  buttonContainer.appendChild(button);
  messageContent.appendChild(buttonContainer);

  // Scroll chat to show the button
  setTimeout(() => {
    ui.chat?.scrollBottom();
  }, 100);
}

