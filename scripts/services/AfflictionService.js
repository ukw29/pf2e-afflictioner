/**
 * Affliction Service - Core automation logic
 */

import { DEGREE_OF_SUCCESS } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionParser } from './AfflictionParser.js';
import * as AfflictionDefinitionStore from '../stores/AfflictionDefinitionStore.js';
import { AfflictionEditorService } from './AfflictionEditorService.js';
import { ConditionStackingService } from './ConditionStackingService.js';

export class AfflictionService {
  /**
   * Prompt initial save when first exposed to affliction
   */
  static async promptInitialSave(token, afflictionData) {
    const actor = token.actor;
    if (!actor) return;

    // Check for edited version FIRST
    const key = AfflictionDefinitionStore.generateDefinitionKey(afflictionData);
    const editedDef = AfflictionDefinitionStore.getEditedDefinition(key);

    if (editedDef) {
      afflictionData = AfflictionEditorService.applyEditedDefinition(afflictionData, editedDef);
    }

    // Check for existing affliction with the same name (multiple exposure)
    const existingAffliction = this.findExistingAffliction(token, afflictionData.name);

    if (existingAffliction) {
      // Handle multiple exposure based on affliction type
      if (afflictionData.multipleExposure?.enabled) {
        // Custom multiple exposure rules (from description)
        await this.handleMultipleExposure(token, existingAffliction, afflictionData);
        return;
      } else if (afflictionData.type === 'poison') {
        // Default poison behavior: new exposure affects stage based on initial save
        // We continue with normal initial save, but flag it as re-exposure
        afflictionData._isReExposure = true;
        afflictionData._existingAfflictionId = existingAffliction.id;
      } else {
        // Curses and diseases: multiple exposures have no effect
        ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MULTIPLE_EXPOSURE_NO_EFFECT_DEFAULT', {
          tokenName: token.name,
          afflictionName: afflictionData.name,
          type: afflictionData.type
        }));
        return;
      }
    }

    // Create affliction in "Initial Save" state
    const afflictionId = foundry.utils.randomID();
    const combat = game.combat;

    const affliction = {
      id: afflictionId,
      ...afflictionData,
      currentStage: -1, // Special "Initial Save" stage
      inOnset: false,
      needsInitialSave: true,
      onsetRemaining: 0,
      nextSaveRound: null,
      nextSaveInitiative: null,
      stageStartRound: combat ? combat.round : null,
      durationElapsed: 0,
      nextSaveTimestamp: null,
      treatmentBonus: 0,
      treatedThisStage: false,
      addedTimestamp: Date.now(),
      addedInCombat: !!combat,
      combatId: combat?.id
    };

    // Add affliction to store
    await AfflictionStore.addAffliction(token, affliction);

    // Add visual indicator
    const { VisualService } = await import('./VisualService.js');
    await VisualService.addAfflictionIndicator(token);

    // Create initial save effect
    const effectUuid = await this.createOrUpdateAfflictionEffect(
      token.actor,
      affliction,
      { effects: '', rawText: 'Awaiting initial save' }
    );
    if (effectUuid) {
      affliction.appliedEffectUuid = effectUuid;
      await AfflictionStore.updateAffliction(token, affliction.id, {
        appliedEffectUuid: effectUuid
      });
    }

    // Check PF2e metagame setting for showing DCs to players
    const showDCToPlayers = game.pf2e?.settings?.metagame?.dcs ?? true;

    // Try storyframe integration first
    const { StoryframeIntegrationService } = await import('./StoryframeIntegrationService.js');
    const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'initial');

    if (!sentToStoryframe) {
      // Fallback: Build player message content with button (may hide DC)
      const playerContent = `
        <div class="pf2e-afflictioner-save-request">
          <h3><i class="fas fa-biohazard"></i> ${afflictionData.name} - Initial Save</h3>
          <p><strong>${actor.name}</strong> has been exposed to <strong>${afflictionData.name}</strong></p>
          <p>Make a <strong>Fortitude save${showDCToPlayers ? ` (DC ${afflictionData.dc})` : ''}</strong> to resist the affliction</p>
          <hr>
          <button class="affliction-roll-initial-save"
                  data-token-id="${token.id}"
                  data-affliction-id="${afflictionId}"
                  data-dc="${afflictionData.dc}"
                  style="width: 100%; padding: 8px; margin-top: 10px;">
            <i class="fas fa-dice-d20"></i> Roll Fortitude Save
          </button>
        </div>
      `;

      // Send player message to players only (exclude GMs)
      const playerWhisper = actor.hasPlayerOwner
        ? game.users.filter(u => !u.isGM && actor.testUserPermission(u, 'OWNER')).map(u => u.id)
        : [];

      if (playerWhisper.length > 0 || !actor.hasPlayerOwner) {
        await ChatMessage.create({
          content: playerContent,
          speaker: ChatMessage.getSpeaker({ token: token }),
          whisper: playerWhisper
        });
      }
    }

    // Send GM-only message with DC info (only if DCs are hidden from players)
    if (!showDCToPlayers && actor.hasPlayerOwner) {
      const gmContent = `
        <div class="pf2e-afflictioner-save-request" style="border-color: #8b0000; padding: 8px;">
          <p style="margin: 0;"><strong>${afflictionData.name} - DC ${afflictionData.dc}</strong> (GM Info)</p>
        </div>
      `;
      await ChatMessage.create({
        content: gmContent,
        speaker: ChatMessage.getSpeaker({ token: token }),
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
    }
  }

  /**
   * Handle result of initial save
   */
  static async handleInitialSave(token, affliction, saveTotal, dc) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc);
    const isReExposure = affliction._isReExposure;
    const existingAfflictionId = affliction._existingAfflictionId;

    if (degree === DEGREE_OF_SUCCESS.SUCCESS || degree === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) {
      // Success: Remove the affliction (or the temporary re-exposure tracking)
      const oldStageData = null; // No stage data for initial save
      await AfflictionStore.removeAffliction(token, affliction.id);
      await this.removeStageEffects(token, affliction, oldStageData, null);

      // Remove visual indicator if no more afflictions
      const remainingAfflictions = AfflictionStore.getAfflictions(token);
      if (Object.keys(remainingAfflictions).length === 0) {
        const { VisualService } = await import('./VisualService.js');
        await VisualService.removeAfflictionIndicator(token);
      }

      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RESISTED', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));
      return;
    }

    // Failure or Critical Failure
    // Check if this is a poison re-exposure
    if (isReExposure && existingAfflictionId && affliction.type === 'poison') {
      // Poison re-exposure: increase existing affliction's stage without affecting duration
      const existingAffliction = AfflictionStore.getAffliction(token, existingAfflictionId);
      if (existingAffliction) {
        // Remove the temporary affliction created for the initial save
        await AfflictionStore.removeAffliction(token, affliction.id);
        await this.removeStageEffects(token, affliction, null, null);

        // Increase the existing affliction's stage by 1 (failure) or 2 (critical failure)
        const stageIncrease = degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE ? 2 : 1;
        await this.handlePoisonReExposure(token, existingAffliction, stageIncrease);
        return;
      }
    }

    // Normal affliction behavior (not a re-exposure)
    const combat = game.combat;

    // Determine starting stage based on onset and degree of success
    let startingStage = 0; // onset stage
    let stageAdvancement = 1; // How many stages to advance after onset (1 for failure, 2 for crit failure)

    if (affliction.onset) {
      // Has onset: Start in onset (stage 0), but remember how many stages to advance after
      startingStage = 0;
      stageAdvancement = degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE ? 2 : 1;
    } else {
      // No onset: Failure = stage 1, Critical Failure = stage 2
      startingStage = degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE ? 2 : 1;
      stageAdvancement = 1; // Not used when no onset
    }

    // Update affliction from initial save state to onset/stage
    const updates = {
      currentStage: startingStage,
      needsInitialSave: false,
      inOnset: !!affliction.onset,
      onsetRemaining: AfflictionParser.durationToSeconds(affliction.onset),
      stageAdvancement: stageAdvancement, // Store for onset completion
      nextSaveRound: combat ? combat.round : null,
      nextSaveInitiative: combat ? combat.combatants.find(c => c.tokenId === token.id)?.initiative : null,
      stageStartRound: combat ? combat.round : null,
      nextSaveTimestamp: null
    };

    // Calculate next save timing and apply effects
    if (affliction.onset) {
      // Has onset: Save happens after onset expires
      if (combat) {
        const onsetRounds = Math.ceil(updates.onsetRemaining / 6);
        updates.nextSaveRound = combat.round + onsetRounds;
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
      } else {
        updates.nextSaveTimestamp = game.time.worldTime + updates.onsetRemaining;
      }

      // Update affliction
      await AfflictionStore.updateAffliction(token, affliction.id, updates);
      const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

      // Update effect to show onset
      await this.createOrUpdateAfflictionEffect(
        token.actor,
        updatedAffliction,
        { effects: '', rawText: `Onset: ${affliction.onset.value} ${affliction.onset.unit}(s)` }
      );
    } else {
      // No onset: Go directly to stage 1 or 2
      const initialStage = affliction.stages[startingStage - 1];
      if (!initialStage) {
        ui.notifications.error(`Stage ${startingStage} not found for ${affliction.name}`);
        return;
      }

      // Set next save timing
      if (combat) {
        const durationSeconds = AfflictionParser.durationToSeconds(initialStage.duration);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
      } else {
        const durationSeconds = AfflictionParser.durationToSeconds(initialStage.duration);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }

      // Update affliction
      await AfflictionStore.updateAffliction(token, affliction.id, updates);
      const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

      // Apply initial stage effects
      await this.applyStageEffects(token, updatedAffliction, initialStage);

      // If initial stage has damage, post damage to chat
      if (initialStage.damage && initialStage.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.AFFLICTED', {
      tokenName: token.name,
      afflictionName: affliction.name
    }));
  }

  /**
   * Check if token has scheduled saves this turn
   */
  static async checkForScheduledSaves(token, combat) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [_id, affliction] of Object.entries(afflictions)) {
      // Skip if still in onset period
      if (affliction.inOnset) continue;

      // Check if save is due or overdue
      // If we're past the scheduled round, definitely prompt
      // If we're in the scheduled round, check initiative matches
      const isOverdue = combat.round > affliction.nextSaveRound;
      const isDueNow = combat.round === affliction.nextSaveRound &&
        affliction.nextSaveInitiative === combat.combatant.initiative;

      if (isOverdue || isDueNow) {
        await this.promptSave(token, affliction);
      }
    }
  }

  /**
   * Prompt for stage save via chat message
   */
  static async promptSave(token, affliction) {
    const actor = token.actor;

    // Check PF2e metagame setting for showing DCs to players
    const showDCToPlayers = game.pf2e?.settings?.metagame?.dcs ?? true;

    // Try storyframe integration first
    const { StoryframeIntegrationService } = await import('./StoryframeIntegrationService.js');
    const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'stage');

    if (!sentToStoryframe) {
      // Fallback: Build player message content with button (may hide DC)
      const playerContent = `
        <div class="pf2e-afflictioner-save-request">
          <h3><i class="fas fa-biohazard"></i> ${affliction.name} Save Required${affliction.isVirulent ? ' <span style="color: #c45500; font-size: 0.75em;">(Virulent)</span>' : ''}</h3>
          <p><strong>${actor.name}</strong> must make a <strong>Fortitude save</strong></p>
          ${showDCToPlayers ? `<p><strong>DC:</strong> ${affliction.dc}</p>` : ''}
          <p>Current Stage: ${affliction.currentStage}</p>
          ${affliction.isVirulent ? `<p><em style="color: #c45500; font-size: 0.75em;">Virulent: Success has no effect, critical success reduces by only 1 stage</em></p>` : ''}
          ${affliction.treatmentBonus ? `<p><em>Treatment bonus active (${affliction.treatmentBonus > 0 ? '+' : ''}${affliction.treatmentBonus})</em></p>` : ''}
          <hr>
          <button class="affliction-roll-save" data-token-id="${token.id}" data-affliction-id="${affliction.id}" data-dc="${affliction.dc}" style="width: 100%; padding: 8px; margin-top: 10px;">
            <i class="fas fa-dice-d20"></i> Roll Fortitude Save
          </button>
        </div>
      `;

      // Send player message to players only (exclude GMs)
      const playerWhisper = actor.hasPlayerOwner
        ? game.users.filter(u => !u.isGM && actor.testUserPermission(u, 'OWNER')).map(u => u.id)
        : [];

      if (playerWhisper.length > 0 || !actor.hasPlayerOwner) {
        await ChatMessage.create({
          content: playerContent,
          speaker: ChatMessage.getSpeaker({ token: token }),
          whisper: playerWhisper
        });
      }
    }

    // Create chat message
    try {

      // Send GM-only message with DC info (only if DCs are hidden from players)
      if (!showDCToPlayers && actor.hasPlayerOwner) {
        const gmContent = `
          <div class="pf2e-afflictioner-save-request" style="border-color: #8b0000; padding: 8px;">
            <p style="margin: 0;"><strong>${affliction.name} - DC ${affliction.dc}</strong> (GM Info) - Stage ${affliction.currentStage}</p>
          </div>
        `;
        await ChatMessage.create({
          content: gmContent,
          speaker: ChatMessage.getSpeaker({ token: token }),
          whisper: game.users.filter(u => u.isGM).map(u => u.id)
        });
      }
    } catch (error) {
      console.error(`PF2e Afflictioner | Error creating chat message:`, error);
    }
  }

  /**
   * Prompt for stage damage via chat message
   */
  static async promptDamage(token, affliction) {
    const actor = token.actor;

    // Get current stage
    const currentStageIndex = affliction.currentStage - 1;
    if (currentStageIndex < 0 || !affliction.stages || !affliction.stages[currentStageIndex]) {
      ui.notifications.warn('No active stage to roll damage for');
      return;
    }

    const stage = affliction.stages[currentStageIndex];
    if (!stage.damage || stage.damage.length === 0) {
      ui.notifications.info(`${affliction.name} Stage ${affliction.currentStage} has no damage to roll`);
      return;
    }

    // Build damage with @Damage enrichment for clickable damage links
    const damageLinks = stage.damage.map(d => {
      const formula = typeof d === 'string' ? d : d.formula;
      const type = typeof d === 'object' ? d.type : 'untyped';
      const isChoice = typeof d === 'object' && d.isChoice;
      const altType = typeof d === 'object' ? d.alternativeType : null;

      // Clean formula
      const cleanFormula = formula.trim().replace(/\[.*$/, '');

      // If this is a choice damage, show both options
      if (isChoice && altType) {
        const link1 = `@Damage[${cleanFormula}[${type}]]`;
        const link2 = `@Damage[${cleanFormula}[${altType}]]`;
        return `<div style="background: rgba(255, 165, 0, 0.15); padding: 8px; border-radius: 4px; border-left: 3px solid #992001; margin: 4px 0;">
          <div style="font-weight: bold; color: #ff3300; margin-bottom: 4px; font-size: 0.9em;">Choose one:</div>
          <div style="margin-left: 8px;">${link1}</div>
          <div style="margin: 4px 0 0 8px;"><strong style="color: #ff3300;">OR</strong></div>
          <div style="margin-left: 8px;">${link2}</div>
        </div>`;
      }

      // Create @Damage enrichment
      return type !== 'untyped'
        ? `@Damage[${cleanFormula}[${type}]]`
        : `@Damage[${cleanFormula}]`;
    }).join(', ');

    // Build chat message content
    let content = `
      <div class="pf2e-afflictioner-save-request">
        <h3><i class="fas fa-heart-broken"></i> ${affliction.name} Damage</h3>
        <p><strong>${actor.name}</strong> takes damage from affliction</p>
        <p>Current Stage: ${affliction.currentStage}</p>
        <p><strong>Damage:</strong> ${damageLinks}</p>
        <p><em>Click the damage link above to roll and apply</em></p>
        <hr>
        <button class="affliction-target-token" data-token-id="${token.id}" style="width: 100%; padding: 8px; margin-top: 10px; background: #2a4a7c; border: 2px solid #3a5a8c; color: white; border-radius: 6px; cursor: pointer;">
          <i class="fas fa-crosshairs"></i> Target ${actor.name}
        </button>
      </div>
    `;

    // Create chat message (GM only)
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  /**
   * Handle stage save result
   * @param {boolean} isManual - If true, prevents curing (limits to stage 1)
   */
  static async handleStageSave(token, affliction, saveTotal, dc, isManual = false) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc);
    const combat = game.combat;

    let stageChange = 0;
    let newVirulentConsecutiveSuccesses = affliction.virulentConsecutiveSuccesses || 0;
    let showVirulentMessage = false;

    // Virulent trait modifies save outcomes (but not for manual stage control)
    if (affliction.isVirulent && !isManual) {
      switch (degree) {
        case DEGREE_OF_SUCCESS.CRITICAL_SUCCESS:
          stageChange = -1; // Virulent: Critical success reduces by 1 instead of 2
          newVirulentConsecutiveSuccesses = 0; // Reset counter
          break;
        case DEGREE_OF_SUCCESS.SUCCESS:
          // Virulent: Must succeed twice consecutively to reduce stage by 1
          if (newVirulentConsecutiveSuccesses >= 1) {
            // Second consecutive success: reduce stage by 1
            stageChange = -1;
            newVirulentConsecutiveSuccesses = 0; // Reset counter after reduction
          } else {
            // First success: no effect yet, but track it
            stageChange = 0;
            newVirulentConsecutiveSuccesses++;
            showVirulentMessage = true;
          }
          break;
        case DEGREE_OF_SUCCESS.FAILURE:
          stageChange = 1;
          newVirulentConsecutiveSuccesses = 0; // Reset counter
          break;
        case DEGREE_OF_SUCCESS.CRITICAL_FAILURE:
          stageChange = 2;
          newVirulentConsecutiveSuccesses = 0; // Reset counter
          break;
      }
    } else {
      // Normal save outcomes (or manual control)
      switch (degree) {
        case DEGREE_OF_SUCCESS.CRITICAL_SUCCESS:
          stageChange = -2;
          break;
        case DEGREE_OF_SUCCESS.SUCCESS:
          stageChange = -1;
          break;
        case DEGREE_OF_SUCCESS.FAILURE:
          stageChange = 1;
          break;
        case DEGREE_OF_SUCCESS.CRITICAL_FAILURE:
          stageChange = 2;
          break;
      }
    }

    // Manual operations clamp to stage 1, automatic saves can cure (stage 0)
    const minStage = isManual ? 1 : 0;
    const newStage = Math.max(minStage, affliction.currentStage + stageChange);


    // Stage 0 = cured (only possible from automatic saves)
    if (newStage === 0) {
      // Get old stage data before removing
      const oldStageData = affliction.stages[affliction.currentStage - 1];

      await AfflictionStore.removeAffliction(token, affliction.id);
      await this.removeStageEffects(token, affliction, oldStageData, null);

      // Remove visual indicator
      const { VisualService } = await import('./VisualService.js');
      await VisualService.removeAfflictionIndicator(token);

      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RECOVERED', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));
      return;
    }

    // Validate stages exist
    if (!affliction.stages || affliction.stages.length === 0) {
      ui.notifications.error(`Affliction ${affliction.name} has no stages defined`);
      return;
    }

    // Cap at max stage
    let finalStage = newStage;
    if (newStage > affliction.stages.length) {
      ui.notifications.error(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MAX_STAGE', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));
      finalStage = affliction.stages.length;
    }

    // Get old and new stage data
    const oldStageData = affliction.stages[affliction.currentStage - 1];
    const newStageData = affliction.stages[finalStage - 1];

    // Update affliction data FIRST so currentStage is correct for effect badge
    const updates = {
      currentStage: finalStage,
      treatmentBonus: 0, // reset after use
      treatedThisStage: false,
      virulentConsecutiveSuccesses: newVirulentConsecutiveSuccesses
    };

    // Clear onset flag if advancing from onset
    if (affliction.inOnset && finalStage > 0) {
      updates.inOnset = false;
      updates.onsetRemaining = 0;
      updates.durationElapsed = 0;  // Reset duration tracking for new stage
    }

    // Update tracking based on combat state
    if (newStageData) {
      if (combat) {
        // In combat - use round-based tracking
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        // Use the afflicted token's initiative, not the current combatant's
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
        updates.stageStartRound = combat.round;
      } else {
        // Out of combat - use world time timestamp tracking
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
    }

    await AfflictionStore.updateAffliction(token, affliction.id, updates);

    // Re-fetch updated affliction for correct badge value
    const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

    // Remove old stage effects (passing old and new stage data)
    await this.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);

    // Apply new stage effects with updated affliction
    if (newStageData) {
      await this.applyStageEffects(token, updatedAffliction, newStageData);

      // If new stage has damage, prompt immediately
      if (newStageData.damage && newStageData.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    // Show virulent consecutive success message if needed
    if (showVirulentMessage) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.VIRULENT_CONSECUTIVE_SUCCESS', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));
    }

    // Check if stage actually changed
    const oldStage = affliction.currentStage || 0;
    if (finalStage === oldStage) {
      // Stage didn't change (capped at max or min)
      return;
    }

    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.STAGE_CHANGED', {
      tokenName: token.name,
      stage: finalStage,
      afflictionName: affliction.name
    }));

    // Create chat message for stage change
    const oldStageText = oldStage === 0 ? 'Initial Exposure' : `Stage ${oldStage}`;
    const stageDirection = finalStage > oldStage ? 'increased' : 'decreased';
    const stageIcon = finalStage > oldStage ? 'fa-arrow-up' : 'fa-arrow-down';
    const stageColor = finalStage > oldStage ? '#ff6b00' : '#4a7c2a';
    const bgColor = finalStage > oldStage ? 'rgba(255, 107, 0, 0.1)' : 'rgba(74, 124, 42, 0.1)';

    // Build stage effects summary
    let effectsSummary = '';
    if (newStageData) {
      const effects = [];
      if (newStageData.damage?.length) {
        effects.push(`Damage: ${newStageData.damage.map(d => `${d.formula} ${d.type}`).join(', ')}`);
      }
      if (newStageData.conditions?.length) {
        effects.push(`Conditions: ${newStageData.conditions.map(c => c.value ? `${c.name} ${c.value}` : c.name).join(', ')}`);
      }
      if (newStageData.weakness?.length) {
        effects.push(`Weakness: ${newStageData.weakness.map(w => `${w.type} ${w.value}`).join(', ')}`);
      }
      if (effects.length > 0) {
        effectsSummary = `<div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 0.9em;">${effects.join(' • ')}</div>`;
      }
    }

    let content = `
      <div class="pf2e-afflictioner-stage-change" style="border-left: 5px solid ${stageColor}; padding: 12px; background: ${bgColor}; border-radius: 4px; margin: 8px 0;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <i class="fas ${stageIcon}" style="color: ${stageColor}; font-size: 24px;"></i>
          <div style="flex: 1;">
            <h3 style="margin: 0; font-size: 1.2em; color: ${stageColor};">${affliction.name} - Stage ${stageDirection}</h3>
            <p style="margin: 4px 0 0 0; font-size: 0.95em;"><strong>${token.name}</strong> is now at <strong>Stage ${finalStage}</strong> <span style="color: #888;">(was ${oldStageText})</span></p>
          </div>
        </div>
        ${effectsSummary}
        ${newStageData && newStageData.effects ? `<div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; font-style: italic; color: #f5f5f5; font-size: 0.9em; border-left: 3px solid ${stageColor}; padding-left: 10px;">${newStageData.effects}</div>` : ''}
      </div>
    `;

    // Stage change messages are GM-only
    await ChatMessage.create({
      content: content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  /**
   * Apply stage effects (damage, conditions, bonuses via Rule Elements)
   */
  static async applyStageEffects(token, affliction, stage) {
    const actor = token.actor;
    if (!actor || !stage) return;

    // Skip if requires manual handling
    if (stage.requiresManualHandling) {
      ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MANUAL_EFFECTS', {
        tokenName: token.name
      }));
      return;
    }

    // Note: Damage is NOT auto-applied on stage change
    // In PF2e, affliction damage is taken over time during the stage, not when changing stages
    // The GM should use the "Roll Damage" button to apply damage when appropriate

    // Apply conditions (SET to specific value, not increment)
    for (const condition of stage.conditions || []) {
      try {
        const conditionSlug = condition.name.toLowerCase();
        const expirationData = this._buildExpirationData(affliction, stage, token);

        await ConditionStackingService.addConditionInstance(
          actor,
          token.id,
          affliction.id,
          conditionSlug,
          condition.value || null,
          expirationData
        );
      } catch (error) {
        console.error('PF2e Afflictioner | Error applying condition:', error);
      }
    }

    // Recalculate to apply highest values across all afflictions
    await ConditionStackingService.recalculateConditions(actor);

    // Apply auto-effects if any
    if (stage.autoEffects && Array.isArray(stage.autoEffects) && stage.autoEffects.length > 0) {
      for (const effectData of stage.autoEffects) {
        try {
          const effectItem = await fromUuid(effectData.uuid);
          if (effectItem && effectItem.type === 'effect') {
            // Check if effect already exists on actor
            const existingEffect = actor.items.find(i =>
              i.type === 'effect' &&
              i.name === effectItem.name &&
              i.flags?.['pf2e-afflictioner']?.autoAppliedEffect === true
            );

            if (!existingEffect) {
              // Create effect on actor
              const effectSource = effectItem.toObject();
              effectSource.flags = effectSource.flags || {};
              effectSource.flags['pf2e-afflictioner'] = {
                autoAppliedEffect: true,
                afflictionId: affliction.id,
                stageNumber: affliction.currentStage
              };

              await actor.createEmbeddedDocuments('Item', [effectSource]);
            }
          }
        } catch (error) {
          console.error('PF2e Afflictioner | Error applying auto-effect:', error);
        }
      }
    }

    // Create or update affliction effect with counter badge and rule elements
    const effectUuid = await this.createOrUpdateAfflictionEffect(actor, affliction, stage);
    if (effectUuid && !affliction.appliedEffectUuid) {
      // Store effect UUID on first creation
      await AfflictionStore.updateAffliction(token, affliction.id, {
        appliedEffectUuid: effectUuid
      });
    }
  }

  /**
   * Extract bonuses/penalties from effect text
   */
  static extractBonuses(effectText) {
    const bonuses = [];

    // Match patterns like "+1 item bonus to saving throws against mental effects"
    const bonusMatch = effectText.match(/([+-]\d+)\s+(item|circumstance|status)\s+bonus\s+to\s+([^(]+)/gi);
    if (bonusMatch) {
      for (const match of bonusMatch) {
        const parts = match.match(/([+-]\d+)\s+(\w+)\s+bonus\s+to\s+(.+)/i);
        if (parts) {
          const value = parseInt(parts[1]);
          const type = parts[2].toLowerCase();
          const targetText = parts[3];

          // Split targets by ", and" or "and" to handle multiple selectors
          const targets = targetText.split(/,\s*(?:and\s+)?|\s+and\s+/);

          for (const target of targets) {
            const trimmed = target.trim();
            if (!trimmed) continue;

            bonuses.push({
              value: value,
              type: type,
              selector: this.parseSelector(trimmed),
              predicate: this.parsePredicate(trimmed)
            });
          }
        }
      }
    }

    return bonuses;
  }

  /**
   * Parse selector from bonus text
   */
  static parseSelector(text) {
    const lower = text.toLowerCase().trim();

    if (lower.includes('saving throw') || lower.includes('saves')) {
      if (lower.includes('fortitude')) return 'fortitude';
      if (lower.includes('reflex')) return 'reflex';
      if (lower.includes('will')) return 'will';
      return 'saving-throw';
    }

    // Check for AC with word boundaries to avoid matching "Acrobatics"
    if (lower.includes('armor class') || /\bac\b/.test(lower)) return 'ac';
    if (lower.includes('attack')) return 'attack-roll';
    if (lower.includes('weapon') || lower.includes('unarmed')) return 'attack-roll';
    if (lower.includes('perception')) return 'perception';
    if (lower.includes('acrobatics')) return 'acrobatics';
    if (lower.includes('athletics')) return 'athletics';
    if (lower.includes('skill') || lower.includes('check')) return 'skill-check';

    return 'attack-roll'; // default for weapon/unarmed
  }

  /**
   * Parse predicate from bonus text
   */
  static parsePredicate(text) {
    const lower = text.toLowerCase().trim();
    const predicates = [];

    // Check for trait restrictions
    if (lower.includes('against mental')) predicates.push('item:trait:mental');
    if (lower.includes('against emotion')) predicates.push('item:trait:emotion');
    if (lower.includes('against fear')) predicates.push('item:trait:fear');
    if (lower.includes('against poison')) predicates.push('item:trait:poison');
    if (lower.includes('against disease')) predicates.push('item:trait:disease');

    return predicates.length > 0 ? predicates : undefined;
  }

  /**
   * Create or update affliction effect with counter badge
   */
  static async createOrUpdateAfflictionEffect(actor, affliction, stage) {
    const bonuses = this.extractBonuses(stage.effects);

    // Check if effect already exists
    if (affliction.appliedEffectUuid) {
      return await this.updateAfflictionEffect(actor, affliction, stage, bonuses);
    }

    // Create new effect
    try {
      // Build rules from bonuses
      const rules = bonuses.map(bonus => {
        const rule = {
          key: 'FlatModifier',
          selector: bonus.selector,
          type: bonus.type,
          value: bonus.value,
          label: affliction.name
        };
        if (bonus.predicate) rule.predicate = bonus.predicate;
        return rule;
      });

      // Add weakness rules if present in stage
      if (stage.weakness && stage.weakness.length > 0) {
        for (const weak of stage.weakness) {
          const weaknessRule = {
            key: 'Weakness',
            type: weak.type,
            value: weak.value,
            label: `${affliction.name} (Weakness)`
          };
          rules.push(weaknessRule);
        }
      }

      // Get source item image
      let itemImg = 'icons/svg/hazard.svg'; // default
      if (affliction.sourceItemUuid) {
        try {
          // Suppress notifications for missing items
          const notify = ui.notifications.notify;
          ui.notifications.notify = () => { };
          const sourceItem = await fromUuid(affliction.sourceItemUuid);
          ui.notifications.notify = notify;
          if (sourceItem?.img) itemImg = sourceItem.img;
        } catch {
          // Restore notifications on error
          ui.notifications.notify = ui.notifications.notify.bind?.(ui.notifications) || ui.notifications.notify;
        }
      }

      // Build stage description
      const stageDesc = affliction.inOnset
        ? `<p><strong>Onset:</strong> ${affliction.onset?.value || 0} ${affliction.onset?.unit || 'rounds'} remaining</p>`
        : stage?.rawText
          ? `<p>${stage.rawText}</p>`
          : `<p>Stage ${affliction.currentStage}</p>`;

      const effectData = {
        type: 'effect',
        name: affliction.name,
        img: itemImg,
        system: {
          description: { value: stageDesc },
          tokenIcon: { show: true },
          duration: {
            value: -1,
            unit: 'unlimited',
            expiry: null,
            sustained: false
          },
          badge: {
            type: 'counter',
            value: affliction.currentStage,
            min: 0,
            max: affliction.stages?.length || 4
          },
          rules: rules,
          slug: `${affliction.name.toLowerCase().replace(/\s+/g, '-')}-affliction`
        },
        flags: {
          'pf2e-afflictioner': {
            afflictionId: affliction.id,
            isAfflictionEffect: true
          }
        }
      };

      const [created] = await actor.createEmbeddedDocuments('Item', [effectData]);
      return created?.uuid;
    } catch (error) {
      console.error('PF2e Afflictioner | Error creating effect:', error);
      return null;
    }
  }

  /**
   * Update existing affliction effect for new stage
   */
  static async updateAfflictionEffect(_actor, affliction, stage, bonuses) {
    try {
      const effect = await fromUuid(affliction.appliedEffectUuid);
      if (!effect) return null;

      // Build rules from bonuses
      const rules = bonuses.map(bonus => {
        const rule = {
          key: 'FlatModifier',
          selector: bonus.selector,
          type: bonus.type,
          value: bonus.value,
          label: affliction.name
        };
        if (bonus.predicate) rule.predicate = bonus.predicate;
        return rule;
      });

      // Add weakness rules if present in stage
      if (stage.weakness && stage.weakness.length > 0) {
        for (const weak of stage.weakness) {
          const weaknessRule = {
            key: 'Weakness',
            type: weak.type,
            value: weak.value,
            label: `${affliction.name} (Weakness)`
          };
          rules.push(weaknessRule);
        }
      }

      // Build updated stage description
      const stageDesc = affliction.inOnset
        ? `<p><strong>Onset:</strong> ${Math.ceil((affliction.onsetRemaining || 0) / 60)} minutes remaining</p>`
        : stage?.rawText
          ? `<p>${stage.rawText}</p>`
          : `<p>Stage ${affliction.currentStage}</p>`;

      // Update effect with new stage counter, rules, and description
      await effect.update({
        'system.badge.value': affliction.currentStage,
        'system.rules': rules,
        'system.description.value': stageDesc
      });

      return effect.uuid;
    } catch (error) {
      console.error('PF2e Afflictioner | Error updating effect:', error);
      return null;
    }
  }

  /**
   * Remove stage effects (cleanup conditions and effect items)
   * @param {Object} oldStageData - Old stage being transitioned from (null if removing entirely)
   * @param {Object} newStageData - New stage to transition to (null if removing entirely)
   */
  static async removeStageEffects(token, affliction, oldStageData = null, newStageData = null) {
    const actor = token.actor;
    if (!actor) return;

    // Only delete affliction effect if removing affliction entirely (no new stage)
    if (!newStageData) {
      let effectRemoved = false;

      // Try to remove by UUID first
      if (affliction.appliedEffectUuid) {
        try {
          const effect = await fromUuid(affliction.appliedEffectUuid);
          if (effect) {
            await effect.delete();
            effectRemoved = true;
          }
        } catch (error) {
          console.warn('PF2e Afflictioner | Could not remove effect by UUID:', error);
        }
      }

      // Fallback: Search for effect by affliction ID in flags
      if (!effectRemoved) {
        try {
          const effects = actor.itemTypes.effect.filter(e =>
            e.flags['pf2e-afflictioner']?.afflictionId === affliction.id
          );

          for (const effect of effects) {
            await effect.delete();
          }
        } catch (error) {
          console.error('PF2e Afflictioner | Error removing effect by flag search:', error);
        }
      }
    }

    // Always remove treatment effect on stage change
    if (affliction.treatmentEffectUuid) {
      try {
        const treatmentEffect = await fromUuid(affliction.treatmentEffectUuid);
        if (treatmentEffect) {
          await treatmentEffect.delete();
        }
      } catch (error) {
        console.error('PF2e Afflictioner | Error removing treatment effect:', error);
      }
    }

    // Remove auto-applied effects from the old stage
    // These are effects that were dragged onto the stage editor
    if (oldStageData && oldStageData.autoEffects && Array.isArray(oldStageData.autoEffects)) {
      for (const effectData of oldStageData.autoEffects) {
        try {
          // Find and remove auto-applied effects by matching UUID or name
          const autoEffects = actor.itemTypes.effect.filter(e =>
            e.flags?.['pf2e-afflictioner']?.autoAppliedEffect === true &&
            e.flags?.['pf2e-afflictioner']?.afflictionId === affliction.id &&
            (e.flags?.['pf2e-afflictioner']?.stageNumber === affliction.currentStage ||
              e.name === effectData.name)
          );

          for (const effect of autoEffects) {
            await effect.delete();
          }
        } catch (error) {
          console.error('PF2e Afflictioner | Error removing auto-effect:', error);
        }
      }
    }

    // If no old stage data provided, try to get it from the affliction
    // (This handles legacy calls where oldStageData wasn't passed)
    const oldStage = oldStageData || affliction.stages[affliction.currentStage - 1];
    if (!oldStage) return;

    // Get conditions in new stage (to preserve them)
    const newConditions = new Map(); // Use Map to store condition name -> value
    if (newStageData && newStageData.conditions) {
      for (const cond of newStageData.conditions) {
        newConditions.set(cond.name.toLowerCase(), cond.value || null);
      }
    }

    // Remove condition instances from this affliction
    // ConditionStackingService will recalculate and apply highest remaining values
    await ConditionStackingService.removeConditionInstancesForAffliction(actor, affliction.id);
    await ConditionStackingService.recalculateConditions(actor);

    // BACKWARD COMPATIBILITY: Also remove conditions the old way for afflictions applied before ConditionStackingService
    // This ensures conditions from old afflictions are cleaned up even if not tracked
    if (!newStageData && oldStage?.conditions) {
      for (const condition of oldStage.conditions) {
        const conditionSlug = condition.name.toLowerCase();
        try {
          // Check if this condition is still tracked (has instances from other afflictions)
          const instances = await ConditionStackingService._getConditionInstances(actor, conditionSlug);
          if (instances.length === 0) {
            // No tracked instances - remove directly as fallback
            await actor.decreaseCondition(conditionSlug, { forceRemove: true });
          }
        } catch (error) {
          console.error(`PF2e Afflictioner | Fallback condition removal for ${conditionSlug}`);
        }
      }
    }
  }

  /**
   * Update onset timers for all afflicted tokens
   */
  static async updateOnsetTimers(token, combat) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [id, affliction] of Object.entries(afflictions)) {
      if (affliction.inOnset && affliction.onsetRemaining > 0) {
        const newRemaining = affliction.onsetRemaining - 6; // 6 seconds per round

        if (newRemaining <= 0) {
          // Onset complete - advance to stage based on initial save result
          // stageAdvancement: 1 for failure, 2 for critical failure
          const targetStage = Math.min(affliction.stageAdvancement || 1, affliction.stages.length);
          const stageData = affliction.stages[targetStage - 1];

          if (!stageData) {
            console.error(`PF2e Afflictioner | Stage ${targetStage} not found for ${affliction.name}`);
            return;
          }

          const durationSeconds = AfflictionParser.durationToSeconds(stageData.duration);
          const durationRounds = Math.ceil(durationSeconds / 6);
          const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0,
            durationElapsed: 0,  // Reset for consistency
            nextSaveRound: combat.round + durationRounds,
            nextSaveInitiative: tokenCombatant?.initiative
          });

          // Get updated affliction after stage change
          const updatedAffliction = AfflictionStore.getAffliction(token, id);
          await this.applyStageEffects(token, updatedAffliction, stageData);

          // If stage has damage, post damage to chat
          if (stageData.damage && stageData.damage.length > 0) {
            await this.promptDamage(token, updatedAffliction);
          }
        } else {
          await AfflictionStore.updateAffliction(token, id, {
            onsetRemaining: newRemaining
          });
        }
      }
    }
  }

  /**
   * Check durations and expire afflictions if needed
   */
  static async checkDurations(token, combat) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [id, affliction] of Object.entries(afflictions)) {
      if (!affliction.maxDuration) continue; // indefinite

      const elapsed = combat.round - affliction.stageStartRound;
      const maxRounds = affliction.maxDuration.value;

      if (elapsed >= maxRounds) {
        // Duration expired
        await AfflictionStore.removeAffliction(token, id);
        await this.removeStageEffects(token, affliction);

        // Remove visual indicator
        const { VisualService } = await import('./VisualService.js');
        await VisualService.removeAfflictionIndicator(token);

        ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RECOVERED', {
          tokenName: token.name,
          afflictionName: affliction.name
        }));
      }
    }
  }

  /**
   * Check maximum duration expiration for world time (non-combat)
   */
  static async checkWorldTimeMaxDuration(token, affliction) {
    if (!affliction.maxDuration) return false; // indefinite

    // Track total elapsed time since affliction was added
    const totalElapsed = (game.time.worldTime - (affliction.addedTimestamp / 1000)) || 0;
    const maxDurationSeconds = AfflictionParser.durationToSeconds(affliction.maxDuration);

    if (totalElapsed >= maxDurationSeconds) {
      // Duration expired
      await AfflictionStore.removeAffliction(token, affliction.id);
      await this.removeStageEffects(token, affliction);

      // Remove visual indicator
      const { VisualService } = await import('./VisualService.js');
      await VisualService.removeAfflictionIndicator(token);

      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RECOVERED', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));

      return true; // Affliction was removed
    }

    return false;
  }

  /**
   * Check if affliction needs save based on world time elapsed
   */
  static async checkWorldTimeSave(token, affliction, deltaSeconds) {
    // Skip if still in onset period
    if (affliction.inOnset) {
      return;
    }

    // Skip if no current stage
    if (!affliction.currentStage || affliction.currentStage === 0) return;

    const stage = affliction.stages[affliction.currentStage - 1];
    if (!stage || !stage.duration) return;

    // Convert stage duration to seconds
    const { AfflictionParser } = await import('./AfflictionParser.js');
    const stageDurationSeconds = AfflictionParser.durationToSeconds(stage.duration);

    // Track elapsed time
    const newElapsed = (affliction.durationElapsed || 0) + deltaSeconds;

    // Check if save is due
    if (newElapsed >= stageDurationSeconds) {
      // Reset elapsed time
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: 0
      });

      // Always prompt save in chat during world time updates
      await this.promptSave(token, affliction);
    } else {
      // Update elapsed time
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: newElapsed
      });
    }
  }

  /**
   * Build expiration data for condition instance tracking
   */
  static _buildExpirationData(_affliction, stage, token) {
    const combat = game.combat;

    if (!stage.duration) {
      return { type: "permanent" };
    }

    if (combat) {
      const durationSeconds = AfflictionParser.durationToSeconds(stage.duration);
      const durationRounds = Math.ceil(durationSeconds / 6);
      const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);

      return {
        type: "combat",
        round: combat.round + durationRounds,
        initiative: tokenCombatant?.initiative,
        timestamp: null
      };
    } else {
      const durationSeconds = AfflictionParser.durationToSeconds(stage.duration);
      return {
        type: "worldTime",
        round: null,
        initiative: null,
        timestamp: game.time.worldTime + durationSeconds
      };
    }
  }

  /**
   * Handle poison re-exposure (default behavior)
   * Increases stage by stageIncrease without affecting duration
   */
  static async handlePoisonReExposure(token, existingAffliction, stageIncrease) {
    const newStage = Math.min(
      existingAffliction.currentStage + stageIncrease,
      existingAffliction.stages.length
    );

    if (newStage === existingAffliction.currentStage) {
      ui.notifications.warn(`${token.name} is already at maximum stage of ${existingAffliction.name}`);
      return;
    }

    // Get old and new stage data
    const oldStageData = existingAffliction.stages[existingAffliction.currentStage - 1];
    const newStageData = existingAffliction.stages[newStage - 1];

    // Update affliction stage (duration unchanged)
    const updates = {
      currentStage: newStage
    };

    await AfflictionStore.updateAffliction(token, existingAffliction.id, updates);

    // Re-fetch updated affliction
    const updatedAffliction = AfflictionStore.getAffliction(token, existingAffliction.id);

    // Remove old stage effects and apply new ones
    await this.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);
    if (newStageData) {
      await this.applyStageEffects(token, updatedAffliction, newStageData);

      // If new stage has damage, prompt immediately
      if (newStageData.damage && newStageData.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    // Notify user
    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.POISON_RE_EXPOSURE', {
      tokenName: token.name,
      afflictionName: existingAffliction.name,
      stageIncrease: stageIncrease
    }));

    // Create chat message
    const content = `
      <div class="pf2e-afflictioner-save-request" style="border-color: #8b008b;">
        <h3><i class="fas fa-biohazard"></i> ${existingAffliction.name} - Poison Re-Exposure</h3>
        <p><strong>${token.name}</strong> is exposed to <strong>${existingAffliction.name}</strong> again</p>
        <p>Failed initial save: Stage increased by ${stageIncrease} (now Stage ${newStage})</p>
        <p><em>Maximum duration unchanged</em></p>
      </div>
    `;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  /**
   * Find existing affliction on token by name
   */
  static findExistingAffliction(token, afflictionName) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [_id, affliction] of Object.entries(afflictions)) {
      if (affliction.name === afflictionName) {
        return affliction;
      }
    }

    return null;
  }

  /**
   * Handle multiple exposure to the same affliction
   */
  static async handleMultipleExposure(token, existingAffliction, afflictionData) {
    const multipleExposure = afflictionData.multipleExposure;

    // Check if current stage meets minimum requirement
    if (multipleExposure.minStage !== null && existingAffliction.currentStage < multipleExposure.minStage) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MULTIPLE_EXPOSURE_NO_EFFECT', {
        tokenName: token.name,
        afflictionName: afflictionData.name,
        minStage: multipleExposure.minStage
      }));
      return;
    }

    // Advance stage by the specified amount
    const newStage = Math.min(
      existingAffliction.currentStage + multipleExposure.stageIncrease,
      existingAffliction.stages.length
    );

    // Get old and new stage data
    const oldStageData = existingAffliction.stages[existingAffliction.currentStage - 1];
    const newStageData = existingAffliction.stages[newStage - 1];

    const combat = game.combat;

    // Update affliction stage
    const updates = {
      currentStage: newStage,
      stageStartRound: combat ? combat.round : existingAffliction.stageStartRound
    };

    // Update save timing based on new stage
    if (newStageData) {
      if (combat) {
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
      } else {
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
    }

    await AfflictionStore.updateAffliction(token, existingAffliction.id, updates);

    // Re-fetch updated affliction
    const updatedAffliction = AfflictionStore.getAffliction(token, existingAffliction.id);

    // Remove old stage effects and apply new ones
    await this.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);
    if (newStageData) {
      await this.applyStageEffects(token, updatedAffliction, newStageData);

      // If new stage has damage, prompt immediately
      if (newStageData.damage && newStageData.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    // Notify user
    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MULTIPLE_EXPOSURE', {
      tokenName: token.name,
      afflictionName: afflictionData.name,
      stageIncrease: multipleExposure.stageIncrease,
      newStage: newStage
    }));

    // Create chat message
    const content = `
      <div class="pf2e-afflictioner-save-request" style="border-color: #c45500;">
        <h3><i class="fas fa-biohazard"></i> ${afflictionData.name} - Multiple Exposure</h3>
        <p><strong>${token.name}</strong> is exposed to <strong>${afflictionData.name}</strong> again</p>
        <p>Stage increased by ${multipleExposure.stageIncrease} (now Stage ${newStage})</p>
        ${multipleExposure.rawText ? `<p><em>${multipleExposure.rawText}</em></p>` : ''}
      </div>
    `;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  /**
   * Calculate degree of success
   */
  static calculateDegreeOfSuccess(total, dc) {
    const diff = total - dc;
    if (diff >= 10) return DEGREE_OF_SUCCESS.CRITICAL_SUCCESS;
    if (diff >= 0) return DEGREE_OF_SUCCESS.SUCCESS;
    if (diff >= -10) return DEGREE_OF_SUCCESS.FAILURE;
    return DEGREE_OF_SUCCESS.CRITICAL_FAILURE;
  }
}
