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

      // Roll counteract check with selected skill
      if (!casterActor.skills?.[skill]) {
        ui.notifications.warn(`No ${skill} skill found. Select the caster token first.`);
        return;
      }

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

      // Fallback: Roll via chat button
      const roll = await casterActor.skills[skill].roll({ dc: { value: dc } });

      // Get degree from roll
      const degree = AfflictionService.calculateDegreeOfSuccess(roll.total, dc);

      // Handle counteract result via socket (or directly if GM)
      if (game.user.isGM) {
        await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);
      } else {
        const { SocketService } = await import('../services/SocketService.js');
        await SocketService.requestHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree);
      }

      // Disable button after use
      btn.disabled = true;
    });
  });
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
          await CounteractService.promptCounteract(token, affliction, casterActor);
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
