/**
 * Hook registration - Central registry for all module hooks
 */

import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export function registerAfflictionHooks() {
  // Damage roll hook - detect poison/disease items
  Hooks.on('pf2e.rollDamage', onDamageRoll);

  // Chat message creation - detect strikes with afflictions
  Hooks.on('createChatMessage', onCreateChatMessage);

  // Combat hooks
  Hooks.on('updateCombat', onCombatUpdate);

  // World time tracking (out-of-combat)
  Hooks.on('updateWorldTime', onWorldTimeUpdate);


  // Token HUD
  Hooks.on('renderTokenHUD', onRenderTokenHUD);

  // Chat message rendering - add button handlers and drag support
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
 * Handle chat message creation - detect saving throws against afflictions
 */
async function onCreateChatMessage(message, options, userId) {
  // Only GM processes auto-application
  if (!game.user.isGM) return;

  // Check if auto-detection is enabled
  if (!game.settings.get('pf2e-afflictioner', 'autoDetectAfflictions')) return;

  // Check if this is a saving throw
  const flags = message.flags?.pf2e;
  if (!flags?.context?.type || flags.context.type !== 'saving-throw') return;

  // Get the origin item (what triggered the save)
  const origin = flags.origin;
  if (!origin?.uuid) return;

  let item;
  try {
    item = await fromUuid(origin.uuid);
  } catch {
    return;
  }

  if (!item) return;

  // Check if origin item has affliction (poison/disease trait)
  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease')) return;

  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  // Get the actor who rolled the save (the target of the affliction)
  const actorUuid = flags.actor?.uuid;
  if (!actorUuid) return;

  let actor;
  try {
    actor = await fromUuid(actorUuid);
  } catch {
    return;
  }

  if (!actor) return;

  // Find the token for this actor on the current scene
  const token = canvas.tokens.placeables.find(t => t.actor?.uuid === actor.uuid);
  if (!token) {
    return;
  }

  // Get the save result from the message
  const degreeOfSuccess = flags.context?.outcome;
  if (!degreeOfSuccess) return;

  // Auto-apply based on save result
  // Success or Critical Success = resisted
  if (degreeOfSuccess === 'success' || degreeOfSuccess === 'criticalSuccess') {
    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RESISTED', {
      tokenName: token.name,
      afflictionName: afflictionData.name
    }));
    return;
  }

  // Failure or Critical Failure = afflicted
  // Create affliction
  const afflictionId = foundry.utils.randomID();
  const combat = game.combat;

  const affliction = {
    id: afflictionId,
    ...afflictionData,
    currentStage: 0, // onset stage
    inOnset: !!afflictionData.onset,
    onsetRemaining: AfflictionParser.durationToSeconds(afflictionData.onset),
    nextSaveRound: combat ? combat.round : null,
    nextSaveInitiative: combat ? combat.combatant?.initiative : null,
    stageStartRound: combat ? combat.round : null,
    durationElapsed: 0,
    nextSaveTimestamp: !combat ? game.time.worldTime + AfflictionParser.durationToSeconds(afflictionData.onset || afflictionData.stages?.[0]?.duration) : null,
    treatmentBonus: 0,
    treatedThisStage: false,
    addedTimestamp: Date.now(),
    addedInCombat: !!combat,
    combatId: combat?.id
  };

  // Calculate next save timing
  if (afflictionData.onset) {
    // Save happens after onset expires
    if (combat) {
      const onsetRounds = Math.ceil(affliction.onsetRemaining / 6);
      affliction.nextSaveRound = combat.round + onsetRounds;
    }
  } else {
    // No onset - go straight to stage 1
    const firstStage = afflictionData.stages[0];
    affliction.currentStage = 1;
    affliction.inOnset = false;
    if (combat && firstStage?.duration) {
      // Convert duration to rounds (6 seconds per round)
      const durationSeconds = AfflictionParser.durationToSeconds(firstStage.duration);
      const durationRounds = Math.ceil(durationSeconds / 6);
      affliction.nextSaveRound = combat.round + durationRounds;
    }

    // Apply stage 1 effects
    await AfflictionService.applyStageEffects(token, affliction, firstStage);
  }

  await AfflictionStore.addAffliction(token, affliction);

  // Add visual indicator
  const { VisualService } = await import('../services/VisualService.js');
  await VisualService.addAfflictionIndicator(token);

  ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.AFFLICTED', {
    tokenName: token.name,
    afflictionName: afflictionData.name
  }));
}

/**
 * Handle combat updates - check for scheduled saves and update timers
 */
async function onCombatUpdate(combat, changed, options, userId) {
  // Only check on turn/round changes
  if (!changed.turn && !changed.round) return;

  // Handle round advancement - update timers for all afflicted tokens
  if (changed.round) {
    for (const combatant of combat.combatants) {
      const token = canvas.tokens.get(combatant.tokenId);
      if (!token) continue;

      // Update onset timers
      await AfflictionService.updateOnsetTimers(token, combat);

      // Check durations
      await AfflictionService.checkDurations(token, combat);
    }
  }

  // Handle turn changes - check for scheduled saves and damage on current combatant
  if (changed.turn) {
    const combatant = combat.combatant;
    if (!combatant?.tokenId) return;

    const token = canvas.tokens.get(combatant.tokenId);
    if (!token) return;

    // Check for scheduled saves - this will prompt for saves when due
    await AfflictionService.checkForScheduledSaves(token, combat);

    // Note: Damage prompts are NOT posted here
    // Damage is only prompted when entering a new stage (via handleStageSave)
    // This matches PF2e rules: saves happen on schedule, damage happens when stage changes
  }
}

/**
 * Handle world time changes - check afflictions need saves
 */
async function onWorldTimeUpdate(worldTime, delta) {
  // Only GM processes time updates
  if (!game.user.isGM) return;

  // Skip very small time changes (< 1 second) to avoid noise
  if (delta < 1) return;


  // Check tokens on current canvas (we can only interact with rendered tokens)
  if (!canvas?.tokens) {
    return;
  }

  for (const token of canvas.tokens.placeables) {
    const afflictions = AfflictionStore.getAfflictions(token);
    if (Object.keys(afflictions).length === 0) continue;


    for (const [id, affliction] of Object.entries(afflictions)) {
      // Skip if in active combat (combat-based tracking takes precedence)
      if (game.combat && game.combat.started) {
        continue;
      }

      // Update onset timers
      if (affliction.inOnset && affliction.onsetRemaining > 0) {
        const newRemaining = affliction.onsetRemaining - delta;

        if (newRemaining <= 0) {
          // Onset complete - advance to stage based on initial save result
          // stageAdvancement: 1 for failure, 2 for critical failure
          const targetStage = affliction.stageAdvancement || 1;
          const stageData = affliction.stages[targetStage - 1];

          if (!stageData) {
            console.error(`PF2e Afflictioner | Stage ${targetStage} not found for ${affliction.name}`);
            continue;
          }

          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0
          });

          // Re-fetch affliction with updated currentStage
          const updatedAffliction = AfflictionStore.getAffliction(token, id);
          await AfflictionService.applyStageEffects(token, updatedAffliction, stageData);

          // If stage has damage, post damage to chat
          if (stageData.damage && stageData.damage.length > 0) {
            await AfflictionService.promptDamage(token, updatedAffliction);
          }

          ui.notifications.info(`${token.name} - ${affliction.name} onset complete, now at stage ${targetStage}`);
        } else {
          await AfflictionStore.updateAffliction(token, id, {
            onsetRemaining: newRemaining
          });
        }
      } else {
        // Check if save is due based on elapsed time
        await AfflictionService.checkWorldTimeSave(token, affliction, delta);

        // Note: Damage prompts are NOT posted during world time updates
        // Damage is only prompted when entering a new stage (via save result)
      }
    }
  }
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
 * Handle chat message rendering - add roll button click handlers and drag support
 */
function onRenderChatMessage(message, html) {
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  // Add drag support for messages with affliction items
  addAfflictionDragSupport(message, root);

  // Handle initial save buttons (affliction already in "Initial Save" state)
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

      const affliction = AfflictionStore.getAffliction(token, afflictionId);
      if (!affliction) {
        ui.notifications.warn('Affliction not found');
        return;
      }

      // Roll the save
      const actor = token.actor;
      const save = await actor.saves.fortitude.roll({ dc: { value: dc } });

      // Handle initial save (updates affliction based on result)
      const { AfflictionService } = await import('../services/AfflictionService.js');
      await AfflictionService.handleInitialSave(token, affliction, save.total, dc);

      // Disable button after use
      btn.disabled = true;
    });
  });

  // Handle roll save buttons (for existing afflictions)
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

  // Handle roll damage buttons
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
            console.warn('PF2e Afflictioner | Empty damage formula, skipping');
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

  // Handle target token buttons
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
      canvas.animatePan({ x: token.x, y: token.y, duration: 250 });

      ui.notifications.info(`Targeted ${token.name}`);
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

/**
 * Add drag support to chat messages with affliction items
 */
async function addAfflictionDragSupport(message, htmlElement) {
  // Only for GMs
  if (!game.user.isGM) return;

  // Check if already initialized (prevent duplicate listeners)
  if (htmlElement.dataset.afflictionDragEnabled === 'true') return;

  // Check if message contains an item with poison/disease trait
  const item = message.getAssociatedItem?.();
  if (!item) return;

  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease')) return;

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
