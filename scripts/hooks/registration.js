/**
 * Hook registration - Central registry for all module hooks
 */

import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export function registerAfflictionHooks() {
  // Damage roll hook - detect poison/disease items
  Hooks.on('pf2e.rollDamage', onDamageRoll);

  // Combat hooks
  Hooks.on('updateCombat', onCombatUpdate);
  Hooks.on('combatRound', onRoundAdvance);

  // World time tracking (out-of-combat)
  Hooks.on('updateWorldTime', onWorldTimeUpdate);

  // Token lifecycle
  Hooks.on('deleteToken', onTokenDelete);

  // Token HUD
  Hooks.on('renderTokenHUD', onRenderTokenHUD);

  // Chat message rendering - add button handlers
  Hooks.on('renderChatMessage', onRenderChatMessage);

  console.log('PF2e Afflictioner | Hooks registered');
}

/**
 * Handle damage rolls - detect afflictions
 */
async function onDamageRoll(item, rollData) {
  // Check if auto-detection is enabled
  if (!game.settings.get('pf2e-afflictioner', 'autoDetectAfflictions')) return;

  // Parse affliction from item
  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  // Get target tokens
  const targets = Array.from(game.user.targets);
  if (!targets.length) return;

  // Prompt initial saves for all targets
  for (const target of targets) {
    await AfflictionService.promptInitialSave(target, afflictionData);
  }
}

/**
 * Handle combat updates - check for scheduled saves
 */
async function onCombatUpdate(combat, changed, options, userId) {
  // Only check on turn changes
  if (!changed.turn && !changed.round) return;

  // Get current combatant
  const combatant = combat.combatant;
  if (!combatant?.tokenId) return;

  const token = canvas.tokens.get(combatant.tokenId);
  if (!token) return;

  // Check for scheduled saves
  await AfflictionService.checkForScheduledSaves(token, combat);
}

/**
 * Handle round advance - update timers and check durations
 */
async function onRoundAdvance(combat, updateData, options) {
  // Update all afflicted tokens in combat
  for (const combatant of combat.combatants) {
    const token = canvas.tokens.get(combatant.tokenId);
    if (!token) continue;

    // Update onset timers
    await AfflictionService.updateOnsetTimers(token, combat);

    // Check durations
    await AfflictionService.checkDurations(token, combat);
  }
}

/**
 * Handle world time changes - check afflictions need saves
 */
async function onWorldTimeUpdate(worldTime, delta) {
  // Only GM processes time updates
  if (!game.user.isGM) return;

  // Only check if significant time passed (> 1 minute)
  if (delta < 60) return;

  // Check all tokens with afflictions
  for (const token of canvas.tokens.placeables) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [id, affliction] of Object.entries(afflictions)) {
      // Skip if in combat
      if (affliction.addedInCombat && game.combat) continue;

      // Update onset timers
      if (affliction.inOnset && affliction.onsetRemaining > 0) {
        const newRemaining = affliction.onsetRemaining - delta;

        if (newRemaining <= 0) {
          // Onset complete - advance to stage 1
          const firstStage = affliction.stages[0];
          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: 1,
            onsetRemaining: 0
          });

          if (firstStage) {
            // Re-fetch affliction with updated currentStage
            const updatedAffliction = AfflictionStore.getAffliction(token, id);
            await AfflictionService.applyStageEffects(token, updatedAffliction, firstStage);
          }

          ui.notifications.info(`${token.name} - ${affliction.name} onset complete, now at stage 1`);
        } else {
          await AfflictionStore.updateAffliction(token, id, {
            onsetRemaining: newRemaining
          });
        }
      } else {
        // Check if save is due based on elapsed time
        await AfflictionService.checkWorldTimeSave(token, affliction, delta);
      }
    }
  }
}

/**
 * Handle token deletion - cleanup affliction data
 */
async function onTokenDelete(tokenDocument, options, userId) {
  // Afflictions are stored in token flags, so they're automatically cleaned up
  // This hook is here for future extensibility (e.g., cleanup visual effects)
  console.log(`PF2e Afflictioner | Token ${tokenDocument.name} deleted`);
}

/**
 * Add affliction manager button to token HUD
 */
function onRenderTokenHUD(app, html) {
  // Only show for GMs
  if (!game.user.isGM) return;

  const token = app.object;
  if (!token) return;

  // html is a jQuery in Foundry; normalize to a DOM element
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  // Find the right column to add the button
  let column = root.querySelector('div.col.right');
  if (!column && html?.find) {
    column = html.find('div.col.right')[0];
  }
  if (!column) {
    console.warn('PF2e Afflictioner: Could not find right column in token HUD');
    return;
  }

  // Remove any existing instance first
  const existing = column.querySelector('[data-action="pf2e-afflictioner-manage"]');
  if (existing) existing.remove();

  // Check if token has afflictions
  const afflictions = AfflictionStore.getAfflictions(token);
  const hasAfflictions = Object.keys(afflictions).length > 0;

  // Create the button element
  const buttonElement = document.createElement('div');
  buttonElement.className = hasAfflictions ? 'control-icon active' : 'control-icon';
  buttonElement.style.display = 'flex';
  buttonElement.setAttribute('data-action', 'pf2e-afflictioner-manage');
  buttonElement.setAttribute('data-tooltip', 'Manage Afflictions');
  buttonElement.innerHTML = '<i class="fas fa-biohazard"></i>';

  // Add click handler
  buttonElement.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      // Import manager
      const { AfflictionManager } = await import('../managers/AfflictionManager.js');

      // Open manager filtered to this token
      if (AfflictionManager.currentInstance) {
        AfflictionManager.currentInstance.close();
      }

      new AfflictionManager({ filterTokenId: token.id }).render(true);
    } catch (error) {
      console.error('PF2e Afflictioner: Error opening manager:', error);
    }
  });

  // Add the button to the column (prepend to put at top)
  column.insertBefore(buttonElement, column.firstChild);
}

/**
 * Handle chat message rendering - add roll button click handlers
 */
function onRenderChatMessage(message, html) {
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  // Handle roll save buttons
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

      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn('Affliction not found');
        return;
      }

      // Roll the save
      const actor = token.actor;
      const save = await actor.saves.fortitude.roll({ dc: { value: dc } });

      // Send to GM for processing via socket
      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleSave(tokenId, afflictionId, save.total, dc);

      // Disable button after use
      btn.disabled = true;
    });
  });

  // Handle roll treatment buttons
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

      // Get treating character (whoever clicked or controlled token)
      const treater = canvas.tokens.controlled[0] || token;
      const treatingActor = treater.actor;

      if (!treatingActor.skills?.medicine) {
        ui.notifications.warn('No Medicine skill found');
        return;
      }

      // Roll Medicine
      const roll = await treatingActor.skills.medicine.roll({ dc: { value: dc } });

      // Send to GM for processing via socket
      const { SocketService } = await import('../services/SocketService.js');
      await SocketService.requestHandleTreatment(tokenId, afflictionId, roll.total, dc);

      // Disable button after use
      btn.disabled = true;
    });
  });
}
