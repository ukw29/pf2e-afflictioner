/**
 * Affliction Service - Core automation logic
 */

import { DEGREE_OF_SUCCESS } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionParser } from './AfflictionParser.js';

export class AfflictionService {
  /**
   * Prompt initial save when first exposed to affliction
   */
  static async promptInitialSave(token, afflictionData) {
    const actor = token.actor;
    if (!actor) return;

    const dialogContent = `
      <p>${game.i18n.format('PF2E_AFFLICTIONER.DIALOG.INITIAL_SAVE_CONTENT', {
        actorName: actor.name,
        afflictionName: afflictionData.name
      })}</p>
      <p><strong>${game.i18n.format('PF2E_AFFLICTIONER.DIALOG.SAVE_DC', {
        dc: afflictionData.dc
      })}</strong></p>
    `;

    new Dialog({
      title: game.i18n.format('PF2E_AFFLICTIONER.DIALOG.INITIAL_SAVE_TITLE', {
        afflictionName: afflictionData.name
      }),
      content: dialogContent,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice-d20"></i>',
          label: game.i18n.localize('PF2E_AFFLICTIONER.DIALOG.ROLL_SAVE'),
          callback: async () => {
            // Roll Fortitude save
            const save = await actor.saves.fortitude.roll({ dc: afflictionData.dc });
            await this.handleInitialSave(token, afflictionData, save.total, afflictionData.dc);
          }
        },
        later: {
          icon: '<i class="fas fa-clock"></i>',
          label: game.i18n.localize('PF2E_AFFLICTIONER.DIALOG.ROLL_LATER')
        }
      },
      default: 'roll'
    }).render(true);
  }

  /**
   * Handle result of initial save
   */
  static async handleInitialSave(token, afflictionData, saveTotal, dc) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc);

    if (degree === DEGREE_OF_SUCCESS.SUCCESS || degree === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RESISTED', {
        tokenName: token.name,
        afflictionName: afflictionData.name
      }));
      return;
    }

    // Failure: become afflicted
    const afflictionId = foundry.utils.randomID();
    const combat = game.combat;

    const affliction = {
      id: afflictionId,
      ...afflictionData,
      currentStage: 0, // onset stage
      inOnset: !!afflictionData.onset,
      onsetRemaining: AfflictionParser.durationToSeconds(afflictionData.onset),
      nextSaveRound: combat ? combat.round : null,
      nextSaveInitiative: combat ? combat.combatant.initiative : null,
      stageStartRound: combat ? combat.round : null,
      durationElapsed: 0,
      treatmentBonus: 0,
      treatedThisStage: false,
      addedTimestamp: Date.now(),
      addedInCombat: !!combat,
      combatId: combat?.id
    };

    // Calculate next save timing
    if (afflictionData.onset) {
      // Save happens after onset expires
      const onsetRounds = Math.ceil(affliction.onsetRemaining / 6);
      affliction.nextSaveRound = combat.round + onsetRounds;
    } else {
      // No onset - go straight to stage 1
      const firstStage = afflictionData.stages[0];
      affliction.currentStage = 1;
      affliction.inOnset = false;
      affliction.nextSaveRound = combat.round + firstStage.duration.value;

      // Apply stage 1 effects
      await this.applyStageEffects(token, affliction, firstStage);
    }

    await AfflictionStore.addAffliction(token, affliction);

    // Add visual indicator
    const { VisualService } = await import('./VisualService.js');
    await VisualService.addAfflictionIndicator(token);

    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.AFFLICTED', {
      tokenName: token.name,
      afflictionName: afflictionData.name
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
      await AfflictionStore.removeAffliction(token, affliction.id);
      await this.removeStageEffects(token, affliction);

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

    // Only update round-based tracking if in combat
    if (combat && newStageData) {
      updates.nextSaveRound = combat.round + (newStageData.duration?.value || 1);
      updates.stageStartRound = combat.round;
    }

    await AfflictionStore.updateAffliction(token, affliction.id, updates);

    // Re-fetch updated affliction for correct badge value
    const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

    // Remove old stage effects (passing new stage to preserve overlapping conditions)
    await this.removeStageEffects(token, updatedAffliction, newStageData);

    // Apply new stage effects with updated affliction
    if (newStageData) {
      await this.applyStageEffects(token, updatedAffliction, newStageData);
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

    // Apply damage
    for (const damageStr of stage.damage || []) {
      try {
        const damageRoll = await new Roll(damageStr).evaluate({ async: true });
        await actor.applyDamage({ damage: damageRoll.total, type: 'untyped' });
      } catch (error) {
        console.error('PF2e Afflictioner | Error applying damage:', error);
      }
    }

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
   * @param {Object} newStageData - New stage to transition to (to preserve overlapping conditions)
   */
  static async removeStageEffects(token, affliction, newStageData = null) {
    const actor = token.actor;
    if (!actor) return;

    // Only delete affliction effect if removing affliction entirely (no new stage)
    if (!newStageData && affliction.appliedEffectUuid) {
      try {
        const effect = await fromUuid(affliction.appliedEffectUuid);
        if (effect) {
          await effect.delete();
        }
      } catch (error) {
        console.error('PF2e Afflictioner | Error removing effect item:', error);
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

    const currentStage = affliction.stages[affliction.currentStage - 1];
    if (!currentStage) return;

    // Get conditions in new stage (to preserve them)
    const newConditions = new Set();
    if (newStageData && newStageData.conditions) {
      for (const cond of newStageData.conditions) {
        newConditions.add(cond.name.toLowerCase());
      }
    }

    // Remove conditions that don't exist in new stage
    for (const condition of currentStage.conditions || []) {
      const conditionSlug = condition.name.toLowerCase();

      // Skip if condition exists in new stage
      if (newConditions.has(conditionSlug)) continue;

      try {
        await actor.decreaseCondition(conditionSlug, { forceRemove: true });
      } catch (error) {
        console.error('PF2e Afflictioner | Error removing condition:', error);
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
          // Onset complete - advance to stage 1
          const firstStage = affliction.stages[0];
          await AfflictionStore.updateAffliction(token, id, {
            inOnset: false,
            currentStage: 1,
            onsetRemaining: 0,
            nextSaveRound: combat.round + firstStage.duration.value
          });

          await this.applyStageEffects(token, affliction, firstStage);
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
