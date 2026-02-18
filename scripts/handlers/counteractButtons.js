/**
 * Counteract Button Handlers - Counteract spells and affliction selection
 *
 * TODO: Extract full implementation from registration.js lines 686-748 and 1031+
 * For now, this is a placeholder - the actual implementation is still in registration.js
 */

import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionService } from '../services/AfflictionService.js';
import { CounteractService } from '../services/CounteractService.js';

/**
 * Register counteract button handlers
 */
export function registerCounteractButtonHandlers(root) {
  // Handle apply counteract consequences buttons (GM confirmation)
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
      if (!token) { ui.notifications.warn('Token not found'); return; }

      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) { ui.notifications.warn('Affliction not found'); return; }

      if (game.user.isGM) {
        await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);
      } else {
        const { SocketService } = await import('../services/SocketService.js');
        await SocketService.requestHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree);
      }

      btn.disabled = true;
      btn.textContent = '✓ Applied';
      btn.style.opacity = '0.5';
    });
  });

  // Handle roll counteract buttons
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
        ui.notifications.warn('Token not found');
        return;
      }

      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn('Affliction not found');
        return;
      }

      // Get caster (whoever has the spell or is doing the counteract)
      const caster = canvas.tokens.controlled[0] || token;
      const casterActor = caster.actor;

      // Try storyframe integration first
      const { StoryframeIntegrationService } = await import('../services/StoryframeIntegrationService.js');
      const sentToStoryframe = await StoryframeIntegrationService.sendCounteractRequest(
        token,
        affliction,
        casterActor,
        skill,
        counteractRank,
        afflictionRank
      );

      if (sentToStoryframe) {
        // Disable button - result will be handled via polling
        btn.disabled = true;
        return;
      }

      // Capture roll message ID before rolling
      let rollMessageId = null;
      Hooks.once('createChatMessage', (message) => {
        if (message.speaker?.actor === casterActor.id || message.actor?.id === casterActor.id) {
          rollMessageId = message.id;
        }
      });

      // Fallback: Roll via chat button
      // For spellcasting counteract: use spellcasting entry statistic (attr mod + proficiency)
      // For skill counteract: use the skill directly
      let roll;
      if (skill.startsWith('spellcasting:')) {
        const tradition = skill.split(':')[1];
        const entries = casterActor.spellcasting?.contents || [];
        const entry = entries.find(e => e.tradition === tradition);
        if (entry?.statistic?.check) {
          roll = await entry.statistic.check.roll({ dc: { value: dc } });
        } else {
          const fallback = { arcane: 'arcana', divine: 'religion', occult: 'occultism', primal: 'nature' };
          const fallbackSkill = fallback[tradition] || 'arcana';
          if (!casterActor.skills?.[fallbackSkill]) {
            ui.notifications.warn(`No ${tradition} spellcasting or ${fallbackSkill} skill found. Select the caster token first.`);
            return;
          }
          roll = await casterActor.skills[fallbackSkill].roll({ dc: { value: dc } });
        }
      } else {
        if (!casterActor.skills?.[skill]) {
          ui.notifications.warn(`No ${skill} skill found. Select the caster token first.`);
          return;
        }
        roll = await casterActor.skills[skill].roll({ dc: { value: dc } });
      }

      // Wait for hook to fire
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!rollMessageId) {
        rollMessageId = game.messages.contents[game.messages.contents.length - 1]?.id;
      }

      // Compute degree as string
      const { DEGREE_OF_SUCCESS, MODULE_ID } = await import('../constants.js');
      const degreeConstant = AfflictionService.calculateDegreeOfSuccess(roll.total, dc);
      const degreeMap = {
        [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: 'criticalSuccess',
        [DEGREE_OF_SUCCESS.SUCCESS]: 'success',
        [DEGREE_OF_SUCCESS.FAILURE]: 'failure',
        [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: 'criticalFailure'
      };
      const degree = degreeMap[degreeConstant] ?? 'criticalFailure';

      // Check setting - if confirmation not required, apply immediately
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

      // Flag the roll message so injectCounteractConfirmButton can inject the Apply button
      // Note: degree is NOT stored here - it's recomputed from message.rolls at render time
      // so that rerolls (hero points, etc.) automatically update the button
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

      // Disable button after use
      btn.disabled = true;
    });
  });
}

/**
 * Inject "Apply Counteract Consequences" button onto the roll message (like save confirmation)
 */
export async function injectCounteractConfirmButton(message, root) {
  if (!game.user.isGM) return;
  if (!message.flags?.['pf2e-afflictioner']?.needsCounteractConfirmation) return;

  const flags = message.flags['pf2e-afflictioner'];
  const { tokenId, afflictionId, counteractRank, afflictionRank, dc } = flags;

  // Compute degree from current roll (supports rerolls - hero points etc.)
  const roll = message.rolls?.[0];
  if (!roll) return;
  const { AfflictionService } = await import('../services/AfflictionService.js');
  const { DEGREE_OF_SUCCESS } = await import('../constants.js');
  const dieValue = AfflictionService.getDieValue(message);
  const degreeConstant = AfflictionService.calculateDegreeOfSuccess(roll.total, dc, dieValue);
  const degreeMap = {
    [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: 'criticalSuccess',
    [DEGREE_OF_SUCCESS.SUCCESS]: 'success',
    [DEGREE_OF_SUCCESS.FAILURE]: 'failure',
    [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: 'criticalFailure'
  };
  const degree = degreeMap[degreeConstant] ?? 'criticalFailure';

  const degreeColors = { criticalSuccess: '#2d8a2d', success: '#1a5cb8', failure: '#c85a00', criticalFailure: '#b00000' };
  const degreeLabels = { criticalSuccess: '✨ Critical Success', success: '✅ Success', failure: '❌ Failure', criticalFailure: '💀 Critical Failure' };

  const maxRankDiffs = { criticalSuccess: 3, success: 1, failure: -1, criticalFailure: -Infinity };
  const maxRankDiff = maxRankDiffs[degree] ?? -Infinity;
  const maxCounterableRank = isFinite(maxRankDiff) ? counteractRank + maxRankDiff : null;
  const wouldSucceed = (afflictionRank - counteractRank) <= maxRankDiff;
  let rankExplanation;
  if (degree === 'criticalFailure') {
    rankExplanation = `Cannot counteract anything.`;
  } else if (wouldSucceed) {
    rankExplanation = `Can counteract up to rank ${maxCounterableRank} — affliction rank ${afflictionRank} is within range.`;
  } else {
    rankExplanation = `Can counteract up to rank ${maxCounterableRank}, but affliction is rank ${afflictionRank}.`;
  }

  const color = degreeColors[degree];

  // Remove existing container so it refreshes with updated degree after reroll
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
  applyBtn.textContent = 'Apply Counteract Consequences';
  applyBtn.dataset.tokenId = tokenId;
  applyBtn.dataset.afflictionId = afflictionId;
  applyBtn.dataset.counteractRank = counteractRank;
  applyBtn.dataset.afflictionRank = afflictionRank;
  applyBtn.dataset.degree = degree;

  // Attach handler directly since this button is injected after renderChatMessage fires
  applyBtn.addEventListener('click', async () => {
    const token = canvas.tokens.get(tokenId);
    if (!token) { ui.notifications.warn('Token not found'); return; }
    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) { ui.notifications.warn('Affliction not found'); return; }

    if (game.user.isGM) {
      await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);
    } else {
      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree);
    }
    applyBtn.disabled = true;
    applyBtn.textContent = '✓ Applied';
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

/**
 * Add affliction selection buttons to counteract spell messages
 */
export async function addCounteractAfflictionSelection(message, htmlElement) {
  // Only for GMs
  if (!game.user.isGM) return;
  if (!message) return;

  // Check if already initialized
  if (htmlElement.dataset.counteractSelectionEnabled === 'true') return;

  // Check if this is a spell message (check origin type)
  const originType = message.flags?.pf2e?.origin?.type;
  if (originType !== 'spell') return;

  // Get item from message data
  const itemUuid = message.flags?.pf2e?.origin?.uuid;
  if (!itemUuid) return;

  let item;
  try {
    item = await fromUuid(itemUuid);
  } catch {
    return;
  }

  if (!item) return;

  // Check if spell has healing trait and is counteract spell
  const traits = item.system?.traits?.value || [];
  const isCleanse = item.name.toLowerCase().includes('cleanse affliction');
  const isCounteractSpell = traits.includes('healing') &&
    (isCleanse || item.name.toLowerCase().includes('counteract'));

  if (!isCounteractSpell) return;

  // Get the spell rank (check castRank first, then heightened level, then base level)
  const spellRank = message.flags?.pf2e?.origin?.castRank ||
                    item.system?.location?.heightenedLevel ||
                    item.system?.level?.value || 1;

  // Cleanse Affliction at rank 2 (base) doesn't counteract, just reduces stage
  const isBaseCleanse = isCleanse && spellRank === 2;

  // Check if canvas is ready
  if (!canvas?.tokens) {
    return;
  }

  // Get all tokens with afflictions (no target in message for willing creature spells)
  const tokensWithAfflictions = canvas.tokens.placeables.filter(t => {
    const afflictions = AfflictionStore.getAfflictions(t);
    return Object.keys(afflictions).length > 0;
  });

  if (tokensWithAfflictions.length === 0) return;

  // Mark as initialized
  htmlElement.dataset.counteractSelectionEnabled = 'true';

  // Find where to add the buttons (try both selectors)
  const messageContent = htmlElement.querySelector('.message-content') || htmlElement.querySelector('.card-content');
  if (!messageContent) return;

  // Create selection UI
  const selectionDiv = document.createElement('div');
  selectionDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: rgba(74, 124, 42, 0.15); border-left: 3px solid #4a7c2a; border-radius: 4px;';

  const header = document.createElement('div');
  header.style.cssText = 'font-weight: bold; color: #4a7c2a; margin-bottom: 8px;';
  if (isBaseCleanse) {
    header.innerHTML = `<i class="fas fa-shield-alt"></i> Cleanse Affliction - Reduce Stage:`;
  } else {
    header.innerHTML = `<i class="fas fa-shield-alt"></i> Counteract Affliction (Rank ${spellRank}):`;
  }
  selectionDiv.appendChild(header);

  // Track if any buttons were added
  let buttonsAdded = 0;

  // Add button for each token with afflictions
  for (const token of tokensWithAfflictions) {
    const afflictions = AfflictionStore.getAfflictions(token);
    const allAfflictions = Object.values(afflictions);

    for (const affliction of allAfflictions) {
      // For base Cleanse Affliction: Only show afflictions at stage 2+
      if (isBaseCleanse && affliction.currentStage < 2) {
        continue;
      }

      // Check if already used (stored in affliction flags)
      if (isBaseCleanse && affliction.cleansedOnce) {
        continue; // Can only be used once per affliction
      }

      // For heightened Cleanse: Filter by affliction type
      if (!isBaseCleanse && isCleanse) {
        const afflictionType = affliction.type?.toLowerCase() || '';
        if (spellRank === 3) {
          // Rank 3: Only disease or poison
          if (afflictionType !== 'disease' && afflictionType !== 'poison') {
            continue;
          }
        } else if (spellRank >= 4) {
          // Rank 4+: curse, disease, or poison
          if (afflictionType !== 'curse' && afflictionType !== 'disease' && afflictionType !== 'poison') {
            continue;
          }
        }
      }

      const button = document.createElement('button');
      button.style.cssText = 'width: 100%; padding: 6px; margin: 4px 0; background: #4a7c2a; border: 1px solid #5a8c3a; color: white; border-radius: 4px; cursor: pointer;';
      const stageDisplay = affliction.currentStage === -1 ? 'Initial Save' : `Stage ${affliction.currentStage}`;
      button.innerHTML = `${token.name}: ${affliction.name} (${affliction.type}, ${stageDisplay})`;

      button.addEventListener('click', async () => {
        try {
          // Base Cleanse Affliction: Directly apply stage reduction
          if (isBaseCleanse) {
            // Confirm with GM
            const confirmed = await foundry.applications.api.DialogV2.confirm({
              window: { title: 'Cleanse Affliction' },
              content: `
                <div style="padding: 10px; background: rgba(74, 124, 42, 0.1); border-left: 3px solid #4a7c2a; border-radius: 4px;">
                  <p style="margin: 0; font-size: 0.9em;"><strong>Spell:</strong> ${item.name} (Rank ${spellRank})</p>
                  <p style="margin: 4px 0 0 0; font-size: 0.9em;"><strong>Target:</strong> ${token.name}</p>
                  <p style="margin: 4px 0 0 0; font-size: 0.9em;"><strong>Affliction:</strong> ${affliction.name} (Stage ${affliction.currentStage})</p>
                  <p style="margin: 8px 0 0 0; font-size: 0.9em;">This will reduce the affliction stage by 1. This reduction can only be applied once to this affliction.</p>
                </div>
              `,
              yes: { label: 'Apply Stage Reduction' },
              no: { label: 'Cancel' }
            });

            if (!confirmed) return;

            // Mark as cleansed once
            await AfflictionStore.updateAffliction(token, affliction.id, { cleansedOnce: true });

            // Reduce stage by 1
            await CounteractService.reduceAfflictionStage(token, affliction);

            ui.notifications.info(`${affliction.name} stage reduced by 1 for ${token.name}`);

            // Disable button after use
            button.disabled = true;
            button.style.opacity = '0.5';
            button.innerHTML = `${token.name}: ${affliction.name} - Applied`;
            return;
          }

          // Heightened Cleanse or other counteract spells: Normal counteract flow
          // Get caster actor from message
          const casterId = message.flags?.pf2e?.context?.actor || message.speaker?.actor;
          const casterActor = casterId ? game.actors.get(casterId) : null;

          // Create counteract prompt directly (no intermediate dialog)
          // Pass spellRank as the default counteract rank (per PF2e rules, spell rank = counteract rank)
          await CounteractService.promptCounteract(token, affliction, casterActor, spellRank);
        } catch (error) {
          console.error('Error processing cleanse/counteract:', error);
          ui.notifications.error('Failed to process spell effect');
        }
      });

      selectionDiv.appendChild(button);
      buttonsAdded++;
    }
  }

  // Only append if at least one button was added
  if (buttonsAdded > 0) {
    messageContent.appendChild(selectionDiv);
  }
}
