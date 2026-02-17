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

      // Handle counteract result
      await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);

      // Disable button after use
      btn.disabled = true;
    });
  });
}

/**
 * Add affliction selection buttons to counteract spell messages
 */
export async function addCounteractAfflictionSelection(message, htmlElement) {
  // Only for GMs and players
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
  const isCounteractSpell = traits.includes('healing') &&
    (item.name.toLowerCase().includes('cleanse') || item.name.toLowerCase().includes('counteract'));

  if (!isCounteractSpell) return;

  // Get the spell rank (check castRank first, then heightened level, then base level)
  const spellRank = message.flags?.pf2e?.origin?.castRank ||
                    item.system?.location?.heightenedLevel ||
                    item.system?.level?.value || 1;

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
  header.innerHTML = `<i class="fas fa-shield-alt"></i> Counteract Affliction (Rank ${spellRank}):`;
  selectionDiv.appendChild(header);

  // Add button for each token with afflictions
  for (const token of tokensWithAfflictions) {
    const afflictions = AfflictionStore.getAfflictions(token);
    const allAfflictions = Object.values(afflictions);

    for (const affliction of allAfflictions) {
      const button = document.createElement('button');
      button.style.cssText = 'width: 100%; padding: 6px; margin: 4px 0; background: #4a7c2a; border: 1px solid #5a8c3a; color: white; border-radius: 4px; cursor: pointer;';
      const stageDisplay = affliction.currentStage === -1 ? 'Initial Save' : `Stage ${affliction.currentStage}`;
      button.innerHTML = `${token.name}: ${affliction.name} (${affliction.type}, ${stageDisplay})`;

      button.addEventListener('click', async () => {
        try {
          // Auto-fill the counteract prompt with spell rank
          const { level: afflictionLevel, rank: afflictionRank } = await CounteractService.calculateAfflictionRank(affliction);

          // Create auto-filled template
          const template = `
            <form>
              <input type="hidden" name="counteractRank" value="${spellRank}" />
              <input type="hidden" name="dc" value="${affliction.dc}" />
              <input type="hidden" name="skill" value="medicine" />
              <div style="padding: 10px; background: rgba(74, 124, 42, 0.1); border-left: 3px solid #4a7c2a; border-radius: 4px;">
                <p style="margin: 0; font-size: 0.9em;"><strong>Spell:</strong> ${item.name} (Rank ${spellRank})</p>
                <p style="margin: 4px 0 0 0; font-size: 0.9em;"><strong>Target:</strong> ${affliction.name} (Level ${afflictionLevel}, Rank ${afflictionRank})</p>
                <p style="margin: 4px 0 0 0; font-size: 0.9em;"><strong>Check:</strong> Medicine vs DC ${affliction.dc}</p>
              </div>
            </form>
          `;

          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: 'Counteract Affliction' },
            content: template,
            yes: { label: 'Create Counteract Prompt' },
            no: { label: 'Cancel' }
          });

          if (!confirmed) return;

          // Get caster actor from message
          const casterId = message.flags?.pf2e?.context?.actor || message.speaker?.actor;
          const casterActor = casterId ? game.actors.get(casterId) : null;

          // Create counteract prompt with auto-detected values
          await CounteractService.promptCounteract(token, affliction, casterActor);
        } catch (error) {
          console.error('Error creating counteract prompt:', error);
          ui.notifications.error('Failed to create counteract prompt');
        }
      });

      selectionDiv.appendChild(button);
    }
  }

  messageContent.appendChild(selectionDiv);
}
