import * as AfflictionStore from '../stores/AfflictionStore.js';

export function registerSaveButtonHandlers(root) {
  registerInitialSaveButtons(root);
  registerStageSaveButtons(root);
  registerConfirmationButtons(root);
}

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
        ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
        return;
      }

      let affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND'));
        return;
      }

      const AfflictionDefinitionStore = await import('../stores/AfflictionDefinitionStore.js');
      const key = AfflictionDefinitionStore.generateDefinitionKey(affliction);
      const editedDef = AfflictionDefinitionStore.getEditedDefinition(key);
      if (editedDef) {
        const { AfflictionEditorService } = await import('../services/AfflictionEditorService.js');
        affliction = AfflictionEditorService.applyEditedDefinition(affliction, editedDef);
      }

      const currentDC = affliction.dc || dc;

      const { StoryframeIntegrationService } = await import('../services/StoryframeIntegrationService.js');
      const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'initial');

      if (sentToStoryframe) {
        btn.disabled = true;
        return;
      }

      const actor = token.actor;

      const isBlindRoll = btn.dataset.blindRoll === 'true' || actor.type === 'npc';

      let rollMessageId = null;
      Hooks.once('createChatMessage', (message) => {
        if (message.actor?.id === actor.id && message.flags?.pf2e?.context?.type === 'saving-throw') {
          rollMessageId = message.id;
        }
      });

      const rollOptions = { dc: { value: currentDC } };
      if (isBlindRoll) {
        rollOptions.rollMode = CONST.DICE_ROLL_MODES.BLIND;
      }

      await actor.saves.fortitude.roll(rollOptions);

      await new Promise(resolve => setTimeout(resolve, 100));

      if (!rollMessageId) {
        rollMessageId = game.messages.contents[game.messages.contents.length - 1]?.id;
      }

      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleInitialSave(tokenId, afflictionId, rollMessageId, currentDC);

      btn.disabled = true;

      const messageElement = btn.closest('.message');
      const msgId = messageElement?.dataset.messageId;
      if (msgId) {
        const { SocketService } = await import('../services/SocketService.js');
        await SocketService.syncButtonState(msgId, btn.className, true);
      }

      if (game.user.isGM && !btn.nextElementSibling?.classList.contains('affliction-unlock-save')) {
        const unlockBtn = document.createElement('button');
        unlockBtn.className = 'affliction-unlock-save';
        unlockBtn.style.cssText = 'display: inline-block; margin-left: 8px; padding: 4px 8px; background: #555; border: 1px solid #777; color: #ffd700; border-radius: 4px; cursor: pointer; font-size: 11px; vertical-align: middle;';
        unlockBtn.innerHTML = `<i class="fas fa-unlock"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.UNLOCK')}`;

        unlockBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

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

        btn.insertAdjacentElement('afterend', unlockBtn);
      }
    });
  });
}

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
        ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
        return;
      }

      let affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND'));
        return;
      }

      const AfflictionDefinitionStore = await import('../stores/AfflictionDefinitionStore.js');
      const key = AfflictionDefinitionStore.generateDefinitionKey(affliction);
      const editedDef = AfflictionDefinitionStore.getEditedDefinition(key);
      if (editedDef) {
        const { AfflictionEditorService } = await import('../services/AfflictionEditorService.js');
        affliction = AfflictionEditorService.applyEditedDefinition(affliction, editedDef);
      }

      const currentDC = affliction.dc || dc;

      const { StoryframeIntegrationService } = await import('../services/StoryframeIntegrationService.js');
      const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'stage');

      if (sentToStoryframe) {
        btn.disabled = true;
        return;
      }

      const actor = token.actor;

      let rollMessageId = null;
      Hooks.once('createChatMessage', (message) => {
        if (message.actor?.id === actor.id && message.flags?.pf2e?.context?.type === 'saving-throw') {
          rollMessageId = message.id;
        }
      });

      const stageRollOptions = { dc: { value: currentDC } };
      if (actor.type === 'npc') {
        stageRollOptions.rollMode = CONST.DICE_ROLL_MODES.BLIND;
      }

      await actor.saves.fortitude.roll(stageRollOptions);

      await new Promise(resolve => setTimeout(resolve, 100));

      if (!rollMessageId) {
        rollMessageId = game.messages.contents[game.messages.contents.length - 1]?.id;
      }

      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleSave(tokenId, afflictionId, rollMessageId, currentDC);

      btn.disabled = true;

      const messageElement = btn.closest('.message');
      const msgId = messageElement?.dataset.messageId;
      if (msgId) {
        const { SocketService } = await import('../services/SocketService.js');
        await SocketService.syncButtonState(msgId, btn.className, true);
      }

      if (game.user.isGM && !btn.nextElementSibling?.classList.contains('affliction-unlock-save')) {
        const unlockBtn = document.createElement('button');
        unlockBtn.className = 'affliction-unlock-save';
        unlockBtn.style.cssText = 'display: inline-block; margin-left: 8px; padding: 4px 8px; background: #555; border: 1px solid #777; color: #ffd700; border-radius: 4px; cursor: pointer; font-size: 11px; vertical-align: middle;';
        unlockBtn.innerHTML = `<i class="fas fa-unlock"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.UNLOCK')}`;

        unlockBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

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

        btn.insertAdjacentElement('afterend', unlockBtn);
      }
    });
  });
}

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

      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestApplySaveConsequences(tokenId, afflictionId, rollMessageId, dc, saveType);

      btn.disabled = true;
      btn.textContent = game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.APPLIED');
      btn.style.opacity = '0.5';
    });
  });
}

export async function injectConfirmationButton(message, root) {
  if (!game.user.isGM) return;

  if (!message.flags?.['pf2e-afflictioner']?.needsConfirmation) return;

  if (root.querySelector('.affliction-confirm-save')) return;

  const flags = message.flags['pf2e-afflictioner'];
  const { tokenId, afflictionId, saveType, dc } = flags;

  const { AfflictionService } = await import('../services/AfflictionService.js');
  const roll = message.rolls?.[0];
  if (!roll) return;

  const saveTotal = roll.total;
  const dieValue = AfflictionService.getDieValue(message);
  const degreeConstant = AfflictionService.calculateDegreeOfSuccess(saveTotal, dc, dieValue);

  const { DEGREE_OF_SUCCESS } = await import('../constants.js');
  const degreeMap = {
    [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: DEGREE_OF_SUCCESS.CRITICAL_SUCCESS,
    [DEGREE_OF_SUCCESS.SUCCESS]: DEGREE_OF_SUCCESS.SUCCESS,
    [DEGREE_OF_SUCCESS.FAILURE]: DEGREE_OF_SUCCESS.FAILURE,
    [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: DEGREE_OF_SUCCESS.CRITICAL_FAILURE
  };
  const degree = degreeMap[degreeConstant] || DEGREE_OF_SUCCESS.FAILURE;

  const colorScheme = {
    [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: {
      gradient: 'linear-gradient(135deg, rgb(0, 180, 0) 0%, rgb(0, 128, 0) 100%)',
      border: 'rgb(0, 200, 0)',
      glow: 'rgba(0, 255, 0, 0.4)'
    },
    [DEGREE_OF_SUCCESS.SUCCESS]: {
      gradient: 'linear-gradient(135deg, rgb(50, 100, 255) 0%, rgb(0, 0, 200) 100%)',
      border: 'rgb(0, 100, 255)',
      glow: 'rgba(0, 100, 255, 0.4)'
    },
    [DEGREE_OF_SUCCESS.FAILURE]: {
      gradient: 'linear-gradient(135deg, rgb(255, 120, 50) 0%, rgb(255, 69, 0) 100%)',
      border: 'rgb(255, 100, 0)',
      glow: 'rgba(255, 100, 0, 0.4)'
    },
    [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: {
      gradient: 'linear-gradient(135deg, rgb(255, 50, 50) 0%, rgb(200, 0, 0) 100%)',
      border: 'rgb(255, 0, 0)',
      glow: 'rgba(255, 0, 0, 0.4)'
    }
  };

  // Blowgun Poisoner: degrade the displayed degree for initial saves
  let effectiveDegree = degree;
  let blowgunPoisonerActive = false;
  if (saveType === 'initial') {
    const token = canvas.tokens.get(tokenId);
    if (token) {
      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (affliction?.blowgunPoisonerCrit) {
        const { FeatsService } = await import('../services/FeatsService.js');
        const degraded = FeatsService.degradeDegree(degree);
        if (degraded !== degree) {
          effectiveDegree = degraded;
          blowgunPoisonerActive = true;
        }
      }
    }
  }

  const colors = colorScheme[effectiveDegree];

  const messageContent = root.querySelector('.message-content');
  if (!messageContent) return;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = 'margin-top: 8px; padding-top: 8px;';

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

  const degreeLabels = {
    [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: game.i18n.localize('PF2E_AFFLICTIONER.DEGREES.CRITICAL_SUCCESS'),
    [DEGREE_OF_SUCCESS.SUCCESS]: game.i18n.localize('PF2E_AFFLICTIONER.DEGREES.SUCCESS'),
    [DEGREE_OF_SUCCESS.FAILURE]: game.i18n.localize('PF2E_AFFLICTIONER.DEGREES.FAILURE'),
    [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: game.i18n.localize('PF2E_AFFLICTIONER.DEGREES.CRITICAL_FAILURE'),
  };
  const infoHtml = blowgunPoisonerActive
    ? ` <i class="fas fa-info-circle" style="margin-left:5px;font-size:12px;opacity:0.9;pointer-events:all;" data-tooltip="${game.i18n.format('PF2E_AFFLICTIONER.FEATS.BLOWGUN_POISONER_DEGRADED_TOOLTIP', { to: degreeLabels[effectiveDegree] })}"></i>`
    : '';
  button.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.APPLY_CONSEQUENCES')}${infoHtml}`;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-1px)';
    button.style.boxShadow = `0 5px 12px rgba(0,0,0,0.4), 0 0 25px ${colors.glow}`;
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = `0 3px 8px rgba(0,0,0,0.3), 0 0 15px ${colors.glow}`;
  });

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

    btn.disabled = true;
    btn.textContent = game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.APPLIED');
    btn.style.opacity = '0.5';
  });

  buttonContainer.appendChild(button);
  messageContent.appendChild(buttonContainer);

  setTimeout(() => {
    ui.chat?.scrollBottom();
  }, 100);
}
