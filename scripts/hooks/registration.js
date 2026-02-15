/**
 * Hook registration - Central registry for all module hooks
 */

import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';
import { CounteractService } from '../services/CounteractService.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export function registerAfflictionHooks() {
  // Damage roll hook - detect poison/disease/curse items
  Hooks.on('pf2e.rollDamage', onDamageRoll);

  // Chat message creation - detect strikes with afflictions
  Hooks.on('createChatMessage', onCreateChatMessage);

  // Combat hooks
  Hooks.on('updateCombat', onCombatUpdate);

  // PF2e turn start - check for scheduled saves
  Hooks.on('pf2e.startTurn', onPf2eStartTurn);

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

  // Check if origin item has affliction (poison/disease/curse trait)
  const traits = item.system?.traits?.value || [];
  if (!traits.includes('poison') && !traits.includes('disease') && !traits.includes('curse')) return;

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

  // Note: Save checking is now handled by pf2e.startTurn hook (see onPf2eStartTurn)
  // This is more reliable than trying to detect turn changes from updateCombat
}

/**
 * Handle PF2e turn start - check for scheduled saves
 */
async function onPf2eStartTurn(_combatant, _encounter, _userId) {
  const combat = game.combat;
  if (!combat) return;

  // Check saves for all combatants
  for (const c of combat.combatants) {
    const token = canvas.tokens.get(c.tokenId);
    if (!token) continue;

    await AfflictionService.checkForScheduledSaves(token, combat);
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

          // Calculate next save time for world time tracking
          const stageDurationSeconds = AfflictionParser.durationToSeconds(stageData.duration);

          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0,
            durationElapsed: 0,  // Reset duration tracking for new stage
            nextSaveTimestamp: game.time.worldTime + stageDurationSeconds
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

  // Add "Apply Affliction" button to chat messages with affliction notes
  addApplyAfflictionButton(message, root);

  // Add treatment affliction selection for Treat Poison/Disease actions
  addTreatmentAfflictionSelection(message, root);

  // Add counteract affliction selection for counteract spells (Cleanse Affliction, etc.)
  addCounteractAfflictionSelection(message, root);

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
 * Add "Apply Affliction" button to chat messages with affliction notes
 */
async function addApplyAfflictionButton(message, htmlElement) {
  // Only for GMs
  if (!game.user.isGM) return;

  // Check if already initialized
  if (htmlElement.dataset.applyAfflictionEnabled === 'true') return;

  // Check for affliction data in message flags (PF2e context notes)
  const notes = message.flags?.pf2e?.context?.notes || [];

  const afflictionNote = notes.find(note => {
    const text = note.text || '';
    return text.includes('Saving Throw') && (text.includes('Stage 1') || text.includes('Stage 2'));
  });

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

      ui.notifications.info(`Applied ${afflictionData.name} to ${token.name}`);
      button.disabled = true;
      button.style.opacity = '0.5';
      button.innerHTML = '<i class="fas fa-check"></i> Affliction Applied';
    } catch (error) {
      console.error('PF2e Afflictioner | Error applying affliction:', error);
      ui.notifications.error('Failed to apply affliction');
    }
  });

  buttonContainer.appendChild(button);
  rollNote.appendChild(buttonContainer);
}

/**
 * Add drag support to chat messages with affliction items
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

/**
 * Add affliction selection buttons to Treat Poison/Disease chat messages
 */
async function addTreatmentAfflictionSelection(message, htmlElement) {
  // Only for GMs
  if (!game.user.isGM) return;

  // Check if already initialized
  if (htmlElement.dataset.treatmentSelectionEnabled === 'true') return;

  // Check if this is a skill check for Medicine
  const flags = message.flags?.pf2e;
  if (!flags?.context?.type || flags.context.type !== 'skill-check') return;

  // Check if it's specifically Treat Poison or Treat Disease (in options array)
  const options = flags.context?.options || [];
  const isTreatPoison = options.includes('action:treat-poison');
  const isTreatDisease = options.includes('action:treat-disease');

  if (!isTreatPoison && !isTreatDisease) return;

  // Get the roll total
  const rollTotal = message.rolls?.[0]?.total;
  if (typeof rollTotal !== 'number') return;

  // Get the actor who performed the treatment (the roller)
  const actorId = flags.context?.actor;
  if (!actorId) return;

  const actor = game.actors.get(actorId);
  if (!actor) return;

  // Check if canvas is ready
  if (!canvas?.tokens) {
    return;
  }

  // Get targeted tokens with matching afflictions
  const afflictionType = isTreatPoison ? 'poison' : 'disease';
  const tokensWithAfflictions = [];

  // Check for targeted tokens first
  const tokensToCheck = game.user.targets.size > 0
    ? Array.from(game.user.targets)
    : canvas.tokens.placeables;

  for (const token of tokensToCheck) {
    const afflictions = AfflictionStore.getAfflictions(token);
    const matching = Object.values(afflictions).filter(a => a.type === afflictionType);
    if (matching.length > 0) {
      tokensWithAfflictions.push({ token, afflictions: matching });
    }
  }

  if (tokensWithAfflictions.length === 0) return;

  // Mark as initialized
  htmlElement.dataset.treatmentSelectionEnabled = 'true';

  // Find where to add the buttons (try both selectors)
  const messageContent = htmlElement.querySelector('.message-content') || htmlElement.querySelector('.card-content');
  if (!messageContent) return;

  // Create selection UI
  const selectionDiv = document.createElement('div');
  selectionDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: rgba(74, 124, 42, 0.15); border-left: 3px solid #4a7c2a; border-radius: 4px;';

  const header = document.createElement('div');
  header.style.cssText = 'font-weight: bold; color: #4a7c2a; margin-bottom: 8px;';
  header.innerHTML = '<i class="fas fa-medkit"></i> Apply Treatment To:';
  selectionDiv.appendChild(header);

  // Add button for each token's afflictions
  for (const { token, afflictions: matchingAfflictions } of tokensWithAfflictions) {
    for (const affliction of matchingAfflictions) {
      const button = document.createElement('button');
      button.style.cssText = 'width: 100%; padding: 6px; margin: 4px 0; background: #4a7c2a; border: 1px solid #5a8c3a; color: white; border-radius: 4px; cursor: pointer;';
      const stageDisplay = affliction.currentStage === -1 ? 'Initial Save' : `Stage ${affliction.currentStage}`;
      button.innerHTML = `${token.name}: ${affliction.name} (${stageDisplay})`;

      button.addEventListener('click', async () => {
        try {
          // Apply treatment with the roll total and affliction DC
          const { TreatmentService } = await import('../services/TreatmentService.js');
          await TreatmentService.handleTreatmentResult(token, affliction, rollTotal, affliction.dc);

          button.disabled = true;
          button.style.opacity = '0.5';
          button.innerHTML = `<i class="fas fa-check"></i> ${token.name}: ${affliction.name} - Treatment Applied`;
        } catch (error) {
          console.error('Error applying treatment:', error);
          ui.notifications.error('Failed to apply treatment');
        }
      });

      selectionDiv.appendChild(button);
    }
  }

  messageContent.appendChild(selectionDiv);
}

/**
 * Add affliction selection buttons to counteract spell messages (Cleanse Affliction, etc.)
 */
async function addCounteractAfflictionSelection(message, htmlElement) {
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
        const { CounteractService } = await import('../services/CounteractService.js');

        // Get affliction rank for the prompt
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

