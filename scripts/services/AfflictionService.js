/**
 * Affliction Service - Core automation logic
 */

import { DEGREE_OF_SUCCESS } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionParser } from './AfflictionParser.js';
import * as AfflictionDefinitionStore from '../stores/AfflictionDefinitionStore.js';
import { AfflictionEditorService } from './AfflictionEditorService.js';

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
      console.log('AfflictionService: Applying edited definition', { key, editedDef });
      afflictionData = AfflictionEditorService.applyEditedDefinition(afflictionData, editedDef);
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

    // Build chat message content
    const content = `
      <div class="pf2e-afflictioner-save-request">
        <h3><i class="fas fa-biohazard"></i> ${afflictionData.name} - Initial Save</h3>
        <p><strong>${actor.name}</strong> has been exposed to <strong>${afflictionData.name}</strong></p>
        <p>Make a <strong>Fortitude save (DC ${afflictionData.dc})</strong> to resist the affliction</p>
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

    // Create chat message
    await ChatMessage.create({
      content: content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: actor.hasPlayerOwner ? game.users.filter(u => actor.testUserPermission(u, 'OWNER')).map(u => u.id) : []
    });
  }

  /**
   * Handle result of initial save
   */
  static async handleInitialSave(token, affliction, saveTotal, dc) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc);

    if (degree === DEGREE_OF_SUCCESS.SUCCESS || degree === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) {
      // Success: Remove the affliction
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

    // Failure or Critical Failure: advance to onset or stage
    const combat = game.combat;

    // Determine starting stage based on onset and degree of success
    let startingStage = 0; // onset stage
    let stageAdvancement = 1; // How many stages to advance after onset (1 for failure, 2 for crit failure)

    if (affliction.onset) {
      // Has onset: Start in onset (stage 0), but remember how many stages to advance after
      startingStage = 0;
      stageAdvancement = degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE ? 2 : 1;
      console.log(`PF2e Afflictioner | Initial save degree: ${degree}, stageAdvancement set to: ${stageAdvancement}`);
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
      nextSaveInitiative: combat ? combat.combatant?.initiative : null,
      stageStartRound: combat ? combat.round : null,
      nextSaveTimestamp: null
    };

    console.log(`PF2e Afflictioner | Updates object:`, updates);

    // Calculate next save timing and apply effects
    if (affliction.onset) {
      // Has onset: Save happens after onset expires
      if (combat) {
        const onsetRounds = Math.ceil(updates.onsetRemaining / 6);
        updates.nextSaveRound = combat.round + onsetRounds;
      } else {
        updates.nextSaveTimestamp = game.time.worldTime + updates.onsetRemaining;
      }

      // Update affliction
      await AfflictionStore.updateAffliction(token, affliction.id, updates);
      const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);
      console.log(`PF2e Afflictioner | After update, affliction.stageAdvancement:`, updatedAffliction.stageAdvancement);

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

    for (const [id, affliction] of Object.entries(afflictions)) {
      // Check if save is due this round on this initiative
      if (affliction.nextSaveRound === combat.round &&
        affliction.nextSaveInitiative === combat.combatant.initiative) {
        await this.promptSave(token, affliction);
      }
    }
  }

  /**
   * Prompt for stage save via chat message
   */
  static async promptSave(token, affliction) {
    const actor = token.actor;

    // Build chat message content
    let content = `
      <div class="pf2e-afflictioner-save-request">
        <h3><i class="fas fa-biohazard"></i> ${affliction.name} Save Required</h3>
        <p><strong>${actor.name}</strong> must make a <strong>Fortitude save</strong></p>
        <p>Current Stage: ${affliction.currentStage}</p>
        ${affliction.treatmentBonus ? `<p><em>Treatment bonus active (${affliction.treatmentBonus > 0 ? '+' : ''}${affliction.treatmentBonus})</em></p>` : ''}
        <hr>
        <button class="affliction-roll-save" data-token-id="${token.id}" data-affliction-id="${affliction.id}" data-dc="${affliction.dc}" style="width: 100%; padding: 8px; margin-top: 10px;">
          <i class="fas fa-dice-d20"></i> Roll Fortitude Save
        </button>
      </div>
    `;

    // Create chat message
    await ChatMessage.create({
      content: content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: actor.hasPlayerOwner ? game.users.filter(u => actor.testUserPermission(u, 'OWNER')).map(u => u.id) : []
    });
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

      // Clean formula
      const cleanFormula = formula.trim().replace(/\[.*$/, '');

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

    // Create chat message
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: actor.hasPlayerOwner ? game.users.filter(u => actor.testUserPermission(u, 'OWNER')).map(u => u.id) : []
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
      treatedThisStage: false
    };

    // Clear onset flag if advancing from onset
    if (affliction.inOnset && finalStage > 0) {
      updates.inOnset = false;
      updates.onsetRemaining = 0;
    }

    // Update tracking based on combat state
    if (newStageData) {
      if (combat) {
        // In combat - use round-based tracking
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        updates.stageStartRound = combat.round;
      } else {
        // Out of combat - use world time timestamp tracking
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
        console.log('AfflictionService | Setting nextSaveTimestamp for stage change:', {
          currentWorldTime: game.time.worldTime,
          durationSeconds,
          nextSaveTimestamp: updates.nextSaveTimestamp
        });
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

    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.STAGE_CHANGED', {
      tokenName: token.name,
      stage: finalStage,
      afflictionName: affliction.name
    }));
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

        // Get existing condition if any
        const existingCondition = actor.itemTypes.condition.find(
          c => c.slug === conditionSlug
        );

        if (existingCondition) {
          // Update existing condition value if different
          if (condition.value && existingCondition.value !== condition.value) {
            await existingCondition.update({ 'system.value.value': condition.value });
          }
        } else {
          // Add new condition
          if (condition.value) {
            await actor.increaseCondition(conditionSlug, { value: condition.value });
          } else {
            await actor.increaseCondition(conditionSlug);
          }
        }
      } catch (error) {
        console.error('PF2e Afflictioner | Error applying condition:', error);
      }
    }

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
              console.log('PF2e Afflictioner | Applied auto-effect:', effectItem.name);
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
        console.log('AfflictionService | Adding weakness rules:', stage.weakness);
        for (const weak of stage.weakness) {
          const weaknessRule = {
            key: 'Weakness',
            type: weak.type,
            value: weak.value,
            label: `${affliction.name} (Weakness)`
          };
          console.log('AfflictionService | Weakness rule:', weaknessRule);
          rules.push(weaknessRule);
        }
      }

      console.log('AfflictionService | Final rules array:', rules);

      // Get source item image
      let itemImg = 'icons/svg/hazard.svg'; // default
      if (affliction.sourceItemUuid) {
        try {
          const sourceItem = await fromUuid(affliction.sourceItemUuid);
          if (sourceItem?.img) itemImg = sourceItem.img;
        } catch { }
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
  static async updateAfflictionEffect(actor, affliction, stage, bonuses) {
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
        console.log('AfflictionService | Updating with weakness rules:', stage.weakness);
        for (const weak of stage.weakness) {
          const weaknessRule = {
            key: 'Weakness',
            type: weak.type,
            value: weak.value,
            label: `${affliction.name} (Weakness)`
          };
          console.log('AfflictionService | Weakness rule for update:', weaknessRule);
          rules.push(weaknessRule);
        }
      }

      console.log('AfflictionService | Update rules array:', rules);

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
            console.log('PF2e Afflictioner | Removed effect by UUID:', affliction.appliedEffectUuid);
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
            console.log('PF2e Afflictioner | Removed effect by flag search:', effect.name);
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
            console.log('PF2e Afflictioner | Removed auto-applied effect:', effect.name);
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

    // Remove or update conditions from old stage
    for (const condition of oldStage.conditions || []) {
      const conditionSlug = condition.name.toLowerCase();

      // If condition doesn't exist in new stage, remove it entirely
      if (!newConditions.has(conditionSlug)) {
        try {
          await actor.decreaseCondition(conditionSlug, { forceRemove: true });
        } catch (error) {
          console.error('PF2e Afflictioner | Error removing condition:', error);
        }
      } else {
        // Condition exists in both stages - check if value changed
        const newValue = newConditions.get(conditionSlug);
        const oldValue = condition.value || null;

        // If value decreased or was removed, update the condition
        if (oldValue !== null && (newValue === null || newValue < oldValue)) {
          try {
            // Remove the old condition entirely, it will be re-added with new value
            await actor.decreaseCondition(conditionSlug, { forceRemove: true });
          } catch (error) {
            console.error('PF2e Afflictioner | Error updating condition:', error);
          }
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
          console.log(`PF2e Afflictioner | Onset complete for ${affliction.name}, stageAdvancement:`, affliction.stageAdvancement);
          const targetStage = affliction.stageAdvancement || 1;
          console.log(`PF2e Afflictioner | Target stage:`, targetStage);
          const stageData = affliction.stages[targetStage - 1];

          if (!stageData) {
            console.error(`PF2e Afflictioner | Stage ${targetStage} not found for ${affliction.name}`);
            return;
          }

          const durationSeconds = AfflictionParser.durationToSeconds(stageData.duration);
          const durationRounds = Math.ceil(durationSeconds / 6);
          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: targetStage,
            onsetRemaining: 0,
            nextSaveRound: combat.round + durationRounds
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
   * Check if affliction needs save based on world time elapsed
   */
  static async checkWorldTimeSave(token, affliction, deltaSeconds) {
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
      // Notify GM that save is due
      ui.notifications.info(`${token.name} needs a save against ${affliction.name} (${Math.floor(newElapsed / 3600)}h elapsed)`);

      // Reset elapsed time
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: 0
      });

      // Optionally auto-prompt save
      if (game.settings.get('pf2e-afflictioner', 'autoPromptSaves')) {
        await this.promptSave(token, affliction);
      }
    } else {
      // Update elapsed time
      await AfflictionStore.updateAffliction(token, affliction.id, {
        durationElapsed: newElapsed
      });
    }
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
