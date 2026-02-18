/**
 * Affliction Service - Core automation logic
 */

import { DEGREE_OF_SUCCESS } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionParser } from './AfflictionParser.js';
import * as AfflictionDefinitionStore from '../stores/AfflictionDefinitionStore.js';
import { AfflictionEditorService } from './AfflictionEditorService.js';
import { AfflictionEffectBuilder } from './AfflictionEffectBuilder.js';
import { AfflictionChatService } from './AfflictionChatService.js';
import { AfflictionTimerService } from './AfflictionTimerService.js';

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
      addedRound: combat ? combat.round : null, // Track when affliction was first added (for max duration)
      durationElapsed: 0,
      maxDurationElapsed: 0, // Track total elapsed time in seconds for max duration (accumulates across combat and world time)
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

    // Don't create effect yet - effect will be created when affliction enters onset or first stage

    // Send save prompts to players
    await AfflictionChatService.promptInitialSave(token, affliction, afflictionData, afflictionId);
  }

  /**
   * Handle result of initial save
   */
  static async handleInitialSave(token, affliction, saveTotal, dc, dieValue = null) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc, dieValue);
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

      // Create effect to show onset with duration
      await AfflictionEffectBuilder.createOrUpdateEffect(
        token,
        token.actor,
        updatedAffliction,
        {
          effects: '',
          rawText: 'Onset',
          duration: affliction.onset // Pass onset duration for effect
        }
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
        const durationSeconds = await AfflictionParser.resolveStageDuration(initialStage.duration, `${affliction.name} Stage ${startingStage}`);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
      } else {
        const durationSeconds = await AfflictionParser.resolveStageDuration(initialStage.duration, `${affliction.name} Stage ${startingStage}`);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
      if (initialStage.duration?.value > 0) {
        updates.currentStageResolvedDuration = { value: initialStage.duration.value, unit: initialStage.duration.unit };
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
    await AfflictionTimerService.checkForScheduledSaves(token, combat, this);
  }

  /**
   * Prompt for stage save via chat message
   */
  static async promptSave(token, affliction) {
    await AfflictionChatService.promptStageSave(token, affliction);
  }

  /**
   * Prompt for stage damage via chat message
   */
  static async promptDamage(token, affliction) {
    await AfflictionChatService.promptDamage(token, affliction);
  }

  /**
   * Handle stage save result
   * @param {boolean} isManual - If true, prevents curing (limits to stage 1)
   * @param {number} dieValue - Optional d20 die value for nat 1/20 handling
   */
  static async handleStageSave(token, affliction, saveTotal, dc, isManual = false, dieValue = null) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc, dieValue);
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
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${affliction.name} Stage ${finalStage}`);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        // Use the afflicted token's initiative, not the current combatant's
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
        updates.stageStartRound = combat.round;
      } else {
        // Out of combat - use world time timestamp tracking
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${affliction.name} Stage ${finalStage}`);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
      if (newStageData.duration?.value > 0) {
        updates.currentStageResolvedDuration = { value: newStageData.duration.value, unit: newStageData.duration.unit };
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

    // Post stage change message to chat
    await AfflictionChatService.postStageChange(token, affliction, oldStage, finalStage);
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

    // NOTE: Conditions are now applied via GrantItem rules on the affliction effect
    // PF2e's GrantItem system handles:
    // - Condition creation and cleanup
    // - Deletion prevention (onDeleteActions)
    // - Stacking from multiple sources
    // ConditionStackingService is no longer needed for condition management

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
    const effectUuid = await AfflictionEffectBuilder.createOrUpdateEffect(token, actor, affliction, stage);
    if (effectUuid && !affliction.appliedEffectUuid) {
      // Store effect UUID on first creation
      await AfflictionStore.updateAffliction(token, affliction.id, {
        appliedEffectUuid: effectUuid
      });
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

    // NOTE: Conditions are now managed via GrantItem rules on the affliction effect
    // When the effect is deleted (above), PF2e automatically removes granted conditions
    // No need for manual condition cleanup - GrantItem handles it automatically!
  }

  /**
   * Update onset timers for all afflicted tokens
   */
  static async updateOnsetTimers(token, combat) {
    await AfflictionTimerService.updateOnsetTimers(token, combat, this);
  }

  /**
   * Check durations - delegated to timer service
   */
  static async checkDurations(token, combat) {
    await AfflictionTimerService.checkDurations(token, combat);
  }

  /**
   * Check world time max duration - delegated to timer service
   */
  static async checkWorldTimeMaxDuration(token, affliction, deltaSeconds) {
    return await AfflictionTimerService.checkWorldTimeMaxDuration(token, affliction, deltaSeconds);
  }

  /**
   * Check world time save - delegated to timer service
   */
  static async checkWorldTimeSave(token, affliction, deltaSeconds) {
    await AfflictionTimerService.checkWorldTimeSave(token, affliction, deltaSeconds, this);
  }

  /**
   * Build expiration data - delegated to timer service
   */
  static _buildExpirationData(affliction, stage, token) {
    return AfflictionTimerService.buildExpirationData(affliction, stage, token);
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

    // Notify user and post chat message
    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.POISON_RE_EXPOSURE', {
      tokenName: token.name,
      afflictionName: existingAffliction.name,
      stageIncrease: stageIncrease
    }));

    await AfflictionChatService.postPoisonReExposure(token, existingAffliction, stageIncrease, newStage);
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
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${existingAffliction.name} Stage ${newStage}`);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
      } else {
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${existingAffliction.name} Stage ${newStage}`);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
      if (newStageData.duration?.value > 0) {
        updates.currentStageResolvedDuration = { value: newStageData.duration.value, unit: newStageData.duration.unit };
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

    // Notify user and post chat message
    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MULTIPLE_EXPOSURE', {
      tokenName: token.name,
      afflictionName: afflictionData.name,
      stageIncrease: multipleExposure.stageIncrease,
      newStage: newStage
    }));

    await AfflictionChatService.postMultipleExposure(token, afflictionData, multipleExposure, newStage);
  }

  /**
   * Extract the die value (d20 result) from a roll or message
   */
  static getDieValue(rollOrMessage) {
    if (!rollOrMessage) return null;

    // If it's a message, get the first roll
    const roll = rollOrMessage.rolls ? rollOrMessage.rolls[0] : rollOrMessage;
    if (!roll) return null;

    // Try to get the first d20 die result
    const d20Die = roll.dice?.find(d => d.faces === 20);
    if (d20Die?.results?.length > 0) {
      return d20Die.results[0].result;
    }

    // Fallback: Try terms array (Foundry v10+)
    const d20Term = roll.terms?.find(t => t.faces === 20);
    if (d20Term?.results?.length > 0) {
      return d20Term.results[0].result;
    }

    return null;
  }

  /**
   * Calculate degree of success with natural 1/20 rules
   */
  static calculateDegreeOfSuccess(total, dc, dieValue = null) {
    // Calculate base degree from total vs DC
    const diff = total - dc;
    let degree;
    if (diff >= 10) degree = DEGREE_OF_SUCCESS.CRITICAL_SUCCESS;
    else if (diff >= 0) degree = DEGREE_OF_SUCCESS.SUCCESS;
    else if (diff >= -10) degree = DEGREE_OF_SUCCESS.FAILURE;
    else degree = DEGREE_OF_SUCCESS.CRITICAL_FAILURE;

    // Apply natural 1/20 adjustments
    if (dieValue === 20) {
      // Natural 20: Improve degree by one step
      if (degree === DEGREE_OF_SUCCESS.FAILURE) degree = DEGREE_OF_SUCCESS.SUCCESS;
      else if (degree === DEGREE_OF_SUCCESS.SUCCESS) degree = DEGREE_OF_SUCCESS.CRITICAL_SUCCESS;
      // Critical failure → failure, already critical success stays critical success
      else if (degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE) degree = DEGREE_OF_SUCCESS.FAILURE;
    } else if (dieValue === 1) {
      // Natural 1: Reduce degree by one step
      if (degree === DEGREE_OF_SUCCESS.SUCCESS) degree = DEGREE_OF_SUCCESS.FAILURE;
      else if (degree === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) degree = DEGREE_OF_SUCCESS.SUCCESS;
      // Failure → critical failure, already critical failure stays critical failure
      else if (degree === DEGREE_OF_SUCCESS.FAILURE) degree = DEGREE_OF_SUCCESS.CRITICAL_FAILURE;
    }

    return degree;
  }
}
