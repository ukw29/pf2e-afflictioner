import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { CounteractService } from '../services/CounteractService.js';
import { shouldSkipAffliction } from '../utils.js';

export function registerCounteractButtonHandlers(root) {
  const applyButtons = root.querySelectorAll('.affliction-apply-counteract');
  applyButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const tokenId = btn.dataset.tokenId;
      const afflictionId = btn.dataset.afflictionId;
      const counteractRank = parseInt(btn.dataset.counteractRank);
      const afflictionRank = parseInt(btn.dataset.afflictionRank);
      const degree = btn.dataset.degree;

      const token = canvas.tokens.get(tokenId);
      if (!token) { ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND')); return; }

      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) { ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND')); return; }

      if (game.user.isGM) {
        await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);
      } else {
        const { SocketService } = await import('../services/SocketService.js');
        await SocketService.requestHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree);
      }

      btn.disabled = true;
      btn.textContent = `✓ ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.APPLIED')}`;
      btn.style.opacity = '0.5';
    });
  });

  const rollCounteractButtons = root.querySelectorAll('.affliction-roll-counteract');
  rollCounteractButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const tokenId = btn.dataset.tokenId;
      const afflictionId = btn.dataset.afflictionId;
      const counteractRank = parseInt(btn.dataset.counteractRank);
      const afflictionRank = parseInt(btn.dataset.afflictionRank);
      const dc = parseInt(btn.dataset.dc);
      const skill = btn.dataset.skill || 'medicine';

      const token = canvas.tokens.get(tokenId);
      if (!token) {
        ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND'));
        return;
      }

      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND'));
        return;
      }

      const caster = canvas.tokens.controlled[0] || token;
      const casterActor = caster.actor;

      let rollMessageId = null;
      Hooks.once('createChatMessage', (message) => {
        if (message.speaker?.actor === casterActor.id || message.actor?.id === casterActor.id) {
          rollMessageId = message.id;
        }
      });

      let roll;
      if (skill.startsWith('spellcasting:')) {
        const identifier = skill.split(':')[1];
        const entries = casterActor.spellcasting?.contents || [];
        const entry = entries.find(e => e.id === identifier) || entries.find(e => e.tradition === identifier);
        const tradition = entry?.tradition || identifier;
        if (entry?.statistic?.check) {
          roll = await entry.statistic.check.roll({ dc: { value: dc } });
        } else {
          const fallback = { arcane: 'arcana', divine: 'religion', occult: 'occultism', primal: 'nature' };
          const fallbackSkill = fallback[tradition] || 'arcana';
          if (!casterActor.skills?.[fallbackSkill]) {
            ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.ERRORS.NO_SPELLCASTING_OR_SKILL', { tradition, skill: fallbackSkill }));
            return;
          }
          roll = await casterActor.skills[fallbackSkill].roll({ dc: { value: dc } });
        }
      } else {
        if (!casterActor.skills?.[skill]) {
          ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.ERRORS.NO_SKILL_FOUND', { skill }));
          return;
        }
        roll = await casterActor.skills[skill].roll({ dc: { value: dc } });
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      if (!rollMessageId) {
        rollMessageId = game.messages.contents[game.messages.contents.length - 1]?.id;
      }

      const { DEGREE_OF_SUCCESS, MODULE_ID } = await import('../constants.js');
      const degreeConstant = AfflictionService.calculateDegreeOfSuccess(roll.total, dc);
      const degreeMap = {
        [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: DEGREE_OF_SUCCESS.CRITICAL_SUCCESS,
        [DEGREE_OF_SUCCESS.SUCCESS]: DEGREE_OF_SUCCESS.SUCCESS,
        [DEGREE_OF_SUCCESS.FAILURE]: DEGREE_OF_SUCCESS.FAILURE,
        [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: DEGREE_OF_SUCCESS.CRITICAL_FAILURE
      };
      const degree = degreeMap[degreeConstant] ?? 'criticalFailure';

      const requireConfirmation = game.settings.get(MODULE_ID, 'requireSaveConfirmation');
      if (!requireConfirmation) {
        if (game.user.isGM) {
          await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);
        } else {
          const { SocketService } = await import('../services/SocketService.js');
          await SocketService.requestHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree);
        }
        btn.disabled = true;
        return;
      }

      const rollMessage = game.messages.get(rollMessageId);
      if (rollMessage) {
        await rollMessage.update({
          flags: {
            'pf2e-afflictioner': {
              needsCounteractConfirmation: true,
              tokenId,
              afflictionId,
              counteractRank,
              afflictionRank,
              dc
            }
          }
        });
      }

      btn.disabled = true;
    });
  });
}

export async function injectCounteractConfirmButton(message, root) {
  if (!game.user.isGM) return;
  if (!message.flags?.['pf2e-afflictioner']?.needsCounteractConfirmation) return;

  const flags = message.flags['pf2e-afflictioner'];
  const { tokenId, afflictionId, counteractRank, afflictionRank, dc } = flags;

  const roll = message.rolls?.[0];
  if (!roll) return;
  const { AfflictionService } = await import('../services/AfflictionService.js');
  const { DEGREE_OF_SUCCESS } = await import('../constants.js');
  const dieValue = AfflictionService.getDieValue(message);
  const degreeConstant = AfflictionService.calculateDegreeOfSuccess(roll.total, dc, dieValue);
  const degreeMap = {
    [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: DEGREE_OF_SUCCESS.CRITICAL_SUCCESS,
    [DEGREE_OF_SUCCESS.SUCCESS]: DEGREE_OF_SUCCESS.SUCCESS,
    [DEGREE_OF_SUCCESS.FAILURE]: DEGREE_OF_SUCCESS.FAILURE,
    [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: DEGREE_OF_SUCCESS.CRITICAL_FAILURE
  };
  const degree = degreeMap[degreeConstant] ?? DEGREE_OF_SUCCESS.CRITICAL_FAILURE;

  const degreeColors = { criticalSuccess: '#2d8a2d', success: '#1a5cb8', failure: '#c85a00', criticalFailure: '#b00000' };
  const degreeLabels = { criticalSuccess: '✨ Critical Success', success: '✅ Success', failure: '❌ Failure', criticalFailure: '💀 Critical Failure' };

  const maxRankDiffs = { criticalSuccess: 3, success: 1, failure: -1, criticalFailure: -Infinity };
  const maxRankDiff = maxRankDiffs[degree] ?? -Infinity;
  const maxCounterableRank = isFinite(maxRankDiff) ? counteractRank + maxRankDiff : null;
  const wouldSucceed = (afflictionRank - counteractRank) <= maxRankDiff;
  let rankExplanation;
  if (degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE) {
    rankExplanation = game.i18n.localize('PF2E_AFFLICTIONER.NOTIFICATIONS.CANNOT_COUNTERACT');
  } else if (wouldSucceed) {
    rankExplanation = game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.CAN_COUNTERACT_RANGE', { maxRank: maxCounterableRank, afflictionRank });
  } else {
    rankExplanation = game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.CANNOT_COUNTERACT_RANK', { maxRank: maxCounterableRank, afflictionRank });
  }

  const color = degreeColors[degree];

  root.querySelector('.pf2e-afflictioner-counteract-confirm')?.remove();

  const container = document.createElement('div');
  container.className = 'pf2e-afflictioner-counteract-confirm';
  container.style.cssText = 'margin-top: 8px; padding: 8px; border-left: 3px solid ' + color + '; background: rgba(0,0,0,0.05); border-radius: 4px;';

  const label = document.createElement('p');
  label.style.cssText = 'margin:0 0 4px 0; font-size:0.9em;';
  label.innerHTML = `<strong style="color:${color}">${degreeLabels[degree]}:</strong> <em>${rankExplanation}</em>`;

  const applyBtn = document.createElement('button');
  applyBtn.className = 'pf2e-afflictioner-btn affliction-apply-counteract';
  applyBtn.style.cssText = `width:100%; background:${color}; border:none; color:white; padding:6px; border-radius:4px; cursor:pointer;`;
  applyBtn.textContent = game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.APPLY_COUNTERACT');
  applyBtn.dataset.tokenId = tokenId;
  applyBtn.dataset.afflictionId = afflictionId;
  applyBtn.dataset.counteractRank = counteractRank;
  applyBtn.dataset.afflictionRank = afflictionRank;
  applyBtn.dataset.degree = degree;

  applyBtn.addEventListener('click', async () => {
    const token = canvas.tokens.get(tokenId);
    if (!token) { ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.TOKEN_NOT_FOUND')); return; }
    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) { ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.AFFLICTION_NOT_FOUND')); return; }

    if (game.user.isGM) {
      await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);
    } else {
      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree);
    }
    applyBtn.disabled = true;
    applyBtn.textContent = `✓ ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.APPLIED')}`;
    applyBtn.style.opacity = '0.5';
  });

  container.appendChild(label);
  if (wouldSucceed) {
    container.appendChild(applyBtn);
  }

  const messageContent = root.querySelector('.message-content');
  if (messageContent) {
    messageContent.appendChild(container);
    ui.chat?.scrollBottom?.();
  }
}

export async function addCounteractAfflictionSelection(message, htmlElement) {
  if (!game.user.isGM) return;
  if (!message) return;

  if (htmlElement.dataset.counteractSelectionEnabled === 'true') return;

  const originType = message.flags?.pf2e?.origin?.type;
  if (originType !== 'spell') return;

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
  const isCleanse = item.name.toLowerCase().includes('cleanse affliction');
  const isCounteractSpell = traits.includes('healing') &&
    (isCleanse || item.name.toLowerCase().includes('counteract'));

  if (!isCounteractSpell) return;

  const spellRank = message.flags?.pf2e?.origin?.castRank ||
    item.system?.location?.heightenedLevel ||
    item.system?.level?.value || 1;

  const isBaseCleanse = isCleanse && spellRank === 2;

  if (!canvas?.tokens) {
    return;
  }

  const targetedTokens = Array.from(game.user.targets).map(t => t);
  const targetedWithAfflictions = targetedTokens.filter(t => {
    const afflictions = AfflictionStore.getAfflictions(t);
    return Object.keys(afflictions).length > 0;
  });

  const tokensWithAfflictions = targetedWithAfflictions.length > 0
    ? targetedWithAfflictions
    : canvas.tokens.placeables.filter(t => {
      const afflictions = AfflictionStore.getAfflictions(t);
      return Object.keys(afflictions).length > 0;
    });

  if (tokensWithAfflictions.length === 0) return;

  htmlElement.dataset.counteractSelectionEnabled = 'true';

  const messageContent = htmlElement.querySelector('.message-content') || htmlElement.querySelector('.card-content');
  if (!messageContent) return;

  const selectionDiv = document.createElement('div');
  selectionDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: rgba(74, 124, 42, 0.15); border-left: 3px solid #4a7c2a; border-radius: 4px;';

  const header = document.createElement('div');
  header.style.cssText = 'font-weight: bold; color: #4a7c2a; margin-bottom: 8px;';
  if (isBaseCleanse) {
    header.innerHTML = `<i class="fas fa-shield-alt"></i> ${game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.COUNTERACT_CLEANSE')}`;
  } else {
    header.innerHTML = `<i class="fas fa-shield-alt"></i> ${game.i18n.format('PF2E_AFFLICTIONER.BUTTONS.COUNTERACT_RANK', { rank: spellRank })}`;
  }
  selectionDiv.appendChild(header);

  let buttonsAdded = 0;

  for (const token of tokensWithAfflictions) {
    const afflictions = AfflictionStore.getAfflictions(token);
    const allAfflictions = Object.values(afflictions);

    for (const affliction of allAfflictions) {
      if (shouldSkipAffliction(affliction)) continue;

      if (isBaseCleanse && affliction.currentStage < 2) {
        continue;
      }

      if (isBaseCleanse && affliction.cleansedOnce) {
        continue;
      }

      if (!isBaseCleanse && isCleanse) {
        const afflictionType = affliction.type?.toLowerCase() || '';
        if (spellRank === 3) {
          if (afflictionType !== 'disease' && afflictionType !== 'poison') {
            continue;
          }
        } else if (spellRank >= 4) {
          if (afflictionType !== 'curse' && afflictionType !== 'disease' && afflictionType !== 'poison') {
            continue;
          }
        }
      }

      const button = document.createElement('button');
      button.style.cssText = 'width: 100%; padding: 6px; margin: 4px 0; background: #4a7c2a; border: 1px solid #5a8c3a; color: white; border-radius: 4px; cursor: pointer;';
      const stageDisplay = affliction.currentStage === -1 ? game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.INITIAL_SAVE') : `${game.i18n.localize('PF2E_AFFLICTIONER.MANAGER.STAGE')} ${affliction.currentStage}`;
      button.innerHTML = `${token.name}: ${affliction.name} (${affliction.type}, ${stageDisplay})`;

      button.addEventListener('click', async () => {
        try {
          if (isBaseCleanse) {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
              window: { title: game.i18n.localize('PF2E_AFFLICTIONER.DIALOG.CLEANSE_TITLE') },
              content: `
                <div style="padding: 10px; background: rgba(74, 124, 42, 0.1); border-left: 3px solid #4a7c2a; border-radius: 4px;">
                  <p style="margin: 0; font-size: 0.9em;"><strong>Spell:</strong> ${item.name} (Rank ${spellRank})</p>
                  <p style="margin: 4px 0 0 0; font-size: 0.9em;"><strong>Target:</strong> ${token.name}</p>
                  <p style="margin: 4px 0 0 0; font-size: 0.9em;"><strong>Affliction:</strong> ${affliction.name} (Stage ${affliction.currentStage})</p>
                  <p style="margin: 8px 0 0 0; font-size: 0.9em;">This will reduce the affliction stage by 1. This reduction can only be applied once to this affliction.</p>
                </div>
              `,
              yes: { label: game.i18n.localize('PF2E_AFFLICTIONER.BUTTONS.APPLY_STAGE_REDUCTION') },
              no: { label: game.i18n.localize('PF2E_AFFLICTIONER.DIALOG.CANCEL') }
            });

            if (!confirmed) return;

            await AfflictionStore.updateAffliction(token, affliction.id, { cleansedOnce: true });

            await CounteractService.reduceAfflictionStage(token, affliction);

            ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.STAGE_REDUCED', { afflictionName: affliction.name, tokenName: token.name }));

            button.disabled = true;
            button.style.opacity = '0.5';
            button.innerHTML = game.i18n.format('PF2E_AFFLICTIONER.BUTTONS.COUNTERACT_APPLIED', { tokenName: token.name, afflictionName: affliction.name });
            return;
          }

          const casterId = message.flags?.pf2e?.context?.actor || message.speaker?.actor;
          const casterActor = casterId ? game.actors.get(casterId) : null;

          const spellEntryId = item.spellcasting?.id || item.system?.location?.value || null;
          await CounteractService.promptCounteract(token, affliction, casterActor, spellRank, spellEntryId);
        } catch (error) {
          console.error('Error processing cleanse/counteract:', error);
          ui.notifications.error(game.i18n.localize('PF2E_AFFLICTIONER.ERRORS.FAILED_PROCESS_SPELL'));
        }
      });

      selectionDiv.appendChild(button);
      buttonsAdded++;
    }
  }

  if (buttonsAdded > 0) {
    messageContent.appendChild(selectionDiv);
  }
}
