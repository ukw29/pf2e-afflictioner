import { DEGREE_OF_SUCCESS, MODULE_ID } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';
import { AfflictionParser } from './AfflictionParser.js';
import * as AfflictionDefinitionStore from '../stores/AfflictionDefinitionStore.js';
import { AfflictionEditorService } from './AfflictionEditorService.js';
import { AfflictionEffectBuilder } from './AfflictionEffectBuilder.js';
import { AfflictionChatService } from './AfflictionChatService.js';
import { AfflictionTimerService } from './AfflictionTimerService.js';

export class AfflictionService {
  static async promptInitialSave(token, afflictionData) {
    const actor = token.actor;
    if (!actor) return;

    const key = AfflictionDefinitionStore.generateDefinitionKey(afflictionData);
    const editedDef = AfflictionDefinitionStore.getEditedDefinition(key);

    if (editedDef) {
      afflictionData = AfflictionEditorService.applyEditedDefinition(afflictionData, editedDef);
    }

    const existingAffliction = this.findExistingAffliction(token, afflictionData.name);

    if (existingAffliction) {
      if (afflictionData.multipleExposure?.enabled) {
        await this.handleMultipleExposure(token, existingAffliction, afflictionData);
        return;
      } else if (afflictionData.type === 'poison') {
        afflictionData._isReExposure = true;
        afflictionData._existingAfflictionId = existingAffliction.id;
      } else {
        ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MULTIPLE_EXPOSURE_NO_EFFECT_DEFAULT', {
          tokenName: token.name,
          afflictionName: afflictionData.name,
          type: afflictionData.type
        }));
        return;
      }
    }

    const afflictionId = foundry.utils.randomID();
    const combat = game.combat;

    const affliction = {
      id: afflictionId,
      ...afflictionData,
      currentStage: -1,
      inOnset: false,
      needsInitialSave: true,
      onsetRemaining: 0,
      nextSaveRound: null,
      nextSaveInitiative: null,
      applicationInitiative: combat?.combatant?.initiative ?? null,
      stageStartRound: combat ? combat.round : null,
      addedRound: combat ? combat.round : null,
      durationElapsed: 0,
      maxDurationElapsed: 0,
      nextSaveTimestamp: null,
      treatmentBonus: 0,
      treatedThisStage: false,
      addedTimestamp: Date.now(),
      addedInCombat: !!combat,
      combatId: combat?.id
    };

    await AfflictionStore.addAffliction(token, affliction);

    const { VisualService } = await import('./VisualService.js');
    await VisualService.addAfflictionIndicator(token);

    await AfflictionChatService.promptInitialSave(token, affliction, afflictionData, afflictionId);
  }

  static async handleInitialSave(token, affliction, saveTotal, dc, dieValue = null) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc, dieValue);
    const isReExposure = affliction._isReExposure;
    const existingAfflictionId = affliction._existingAfflictionId;

    if (degree === DEGREE_OF_SUCCESS.SUCCESS || degree === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) {
      const oldStageData = null;
      await AfflictionStore.removeAffliction(token, affliction.id);
      await this.removeStageEffects(token, affliction, oldStageData, null);

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

    if (isReExposure && existingAfflictionId && affliction.type === 'poison') {
      const existingAffliction = AfflictionStore.getAffliction(token, existingAfflictionId);
      if (existingAffliction) {
        await AfflictionStore.removeAffliction(token, affliction.id);
        await this.removeStageEffects(token, affliction, null, null);

        const stageIncrease = degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE ? 2 : 1;
        await this.handlePoisonReExposure(token, existingAffliction, stageIncrease);
        return;
      }
    }

    const combat = game.combat;

    let startingStage = 0;
    let stageAdvancement = 1;

    if (affliction.onset) {
      startingStage = 0;
      stageAdvancement = degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE ? 2 : 1;
    } else {
      startingStage = degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE ? 2 : 1;
      stageAdvancement = 1;
    }

    const updates = {
      currentStage: startingStage,
      needsInitialSave: false,
      inOnset: !!affliction.onset,
      onsetRemaining: AfflictionParser.durationToSeconds(affliction.onset),
      stageAdvancement: stageAdvancement,
      nextSaveRound: combat ? combat.round : null,
      nextSaveInitiative: combat ? combat.combatants.find(c => c.tokenId === token.id)?.initiative : null,
      stageStartRound: combat ? combat.round : null,
      nextSaveTimestamp: null
    };

    if (affliction.onset) {
      if (combat) {
        const onsetRounds = Math.ceil(updates.onsetRemaining / 6);
        updates.nextSaveRound = combat.round + onsetRounds;
        updates.nextSaveInitiative = this.getSaveInitiative(affliction, token, combat);
      } else {
        updates.nextSaveTimestamp = game.time.worldTime + updates.onsetRemaining;
      }

      await AfflictionStore.updateAffliction(token, affliction.id, updates);
      const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

      await AfflictionEffectBuilder.createOrUpdateEffect(
        token,
        token.actor,
        updatedAffliction,
        {
          effects: '',
          rawText: 'Onset',
          duration: affliction.onset
        }
      );
    } else {
      const initialStage = affliction.stages[startingStage - 1];
      if (!initialStage) {
        ui.notifications.error(`Stage ${startingStage} not found for ${affliction.name}`);
        return;
      }

      if (combat) {
        const durationSeconds = await AfflictionParser.resolveStageDuration(initialStage.duration, `${affliction.name} Stage ${startingStage}`);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        updates.nextSaveInitiative = this.getSaveInitiative(affliction, token, combat);
      } else {
        const durationSeconds = await AfflictionParser.resolveStageDuration(initialStage.duration, `${affliction.name} Stage ${startingStage}`);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
      if (initialStage.duration?.value > 0) {
        updates.currentStageResolvedDuration = { value: initialStage.duration.value, unit: initialStage.duration.unit };
      }

      await AfflictionStore.updateAffliction(token, affliction.id, updates);
      const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

      await this.applyStageEffects(token, updatedAffliction, initialStage);

      if (initialStage.damage && initialStage.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.AFFLICTED', {
      tokenName: token.name,
      afflictionName: affliction.name
    }));
  }

  static async checkForScheduledSaves(token, combat) {
    await AfflictionTimerService.checkForScheduledSaves(token, combat, this);
  }

  static async promptSave(token, affliction) {
    await AfflictionChatService.promptStageSave(token, affliction);
  }

  static async promptDamage(token, affliction) {
    await AfflictionChatService.promptDamage(token, affliction);
  }

  static async handleStageSave(token, affliction, saveTotal, dc, isManual = false, dieValue = null) {
    const degree = this.calculateDegreeOfSuccess(saveTotal, dc, dieValue);
    const combat = game.combat;

    let stageChange = 0;
    let newVirulentConsecutiveSuccesses = affliction.virulentConsecutiveSuccesses || 0;
    let showVirulentMessage = false;

    if (affliction.isVirulent && !isManual) {
      switch (degree) {
        case DEGREE_OF_SUCCESS.CRITICAL_SUCCESS:
          stageChange = -1;
          newVirulentConsecutiveSuccesses = 0;
          break;
        case DEGREE_OF_SUCCESS.SUCCESS:
          if (newVirulentConsecutiveSuccesses >= 1) {
            stageChange = -1;
            newVirulentConsecutiveSuccesses = 0;
          } else {
            stageChange = 0;
            newVirulentConsecutiveSuccesses++;
            showVirulentMessage = true;
          }
          break;
        case DEGREE_OF_SUCCESS.FAILURE:
          stageChange = 1;
          newVirulentConsecutiveSuccesses = 0;
          break;
        case DEGREE_OF_SUCCESS.CRITICAL_FAILURE:
          stageChange = 2;
          newVirulentConsecutiveSuccesses = 0;
          break;
      }
    } else {
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

    const minStage = isManual ? 1 : 0;
    const newStage = Math.max(minStage, affliction.currentStage + stageChange);

    if (newStage === 0) {
      const oldStageData = affliction.stages[affliction.currentStage - 1];

      await AfflictionStore.removeAffliction(token, affliction.id);
      await this.removeStageEffects(token, affliction, oldStageData, null);

      const { VisualService } = await import('./VisualService.js');
      await VisualService.removeAfflictionIndicator(token);

      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.RECOVERED', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));
      return;
    }

    if (!affliction.stages || affliction.stages.length === 0) {
      ui.notifications.error(`Affliction ${affliction.name} has no stages defined`);
      return;
    }

    let finalStage = newStage;
    if (newStage > affliction.stages.length) {
      ui.notifications.error(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MAX_STAGE', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));
      finalStage = affliction.stages.length;
    }

    const oldStageData = affliction.stages[affliction.currentStage - 1];
    const newStageData = affliction.stages[finalStage - 1];

    const updates = {
      currentStage: finalStage,
      treatmentBonus: 0,
      treatedThisStage: false,
      virulentConsecutiveSuccesses: newVirulentConsecutiveSuccesses
    };

    if (affliction.inOnset && finalStage > 0) {
      updates.inOnset = false;
      updates.onsetRemaining = 0;
      updates.durationElapsed = 0;
    }

    if (newStageData) {
      if (combat) {
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${affliction.name} Stage ${finalStage}`);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        updates.nextSaveInitiative = this.getSaveInitiative(affliction, token, combat);
        updates.stageStartRound = combat.round;
      } else {
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${affliction.name} Stage ${finalStage}`);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
      if (newStageData.duration?.value > 0) {
        updates.currentStageResolvedDuration = { value: newStageData.duration.value, unit: newStageData.duration.unit };
      }
    }

    await AfflictionStore.updateAffliction(token, affliction.id, updates);

    const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

    await this.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);

    if (newStageData) {
      await this.applyStageEffects(token, updatedAffliction, newStageData);

      if (newStageData.damage && newStageData.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    if (showVirulentMessage) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.VIRULENT_CONSECUTIVE_SUCCESS', {
        tokenName: token.name,
        afflictionName: affliction.name
      }));
    }

    const oldStage = affliction.currentStage || 0;
    if (finalStage === oldStage) {
      return;
    }

    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.STAGE_CHANGED', {
      tokenName: token.name,
      stage: finalStage,
      afflictionName: affliction.name
    }));

    await AfflictionChatService.postStageChange(token, affliction, oldStage, finalStage);
  }

  static async applyStageEffects(token, affliction, stage) {
    const actor = token.actor;
    if (!actor || !stage) return;

    if (stage.requiresManualHandling) {
      ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MANUAL_EFFECTS', {
        tokenName: token.name
      }));
      return;
    }

    if (stage.isDead) {
      await AfflictionEffectBuilder.createOrUpdateEffect(token, actor, affliction, stage);
      await AfflictionChatService.promptDeathConfirmation(token, affliction);
      return;
    }

    if (stage.autoEffects && Array.isArray(stage.autoEffects) && stage.autoEffects.length > 0) {
      for (const effectData of stage.autoEffects) {
        try {
          const effectItem = await fromUuid(effectData.uuid);
          if (effectItem && effectItem.type === 'effect') {
            const existingEffect = actor.items.find(i =>
              i.type === 'effect' &&
              i.name === effectItem.name &&
              i.flags?.['pf2e-afflictioner']?.autoAppliedEffect === true
            );

            if (!existingEffect) {
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

    await AfflictionEffectBuilder.removePersistentDamage(actor, affliction.id);

    const effectUuid = await AfflictionEffectBuilder.createOrUpdateEffect(token, actor, affliction, stage);
    if (effectUuid && !affliction.appliedEffectUuid) {
      await AfflictionStore.updateAffliction(token, affliction.id, {
        appliedEffectUuid: effectUuid
      });
    }

    await AfflictionEffectBuilder.applyPersistentDamage(actor, affliction, stage);
  }

  static async removeStageEffects(token, affliction, oldStageData = null, newStageData = null) {
    const actor = token.actor;
    if (!actor) return;

    if (!newStageData) {
      let effectRemoved = false;

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

    if (oldStageData && oldStageData.autoEffects && Array.isArray(oldStageData.autoEffects)) {
      for (const effectData of oldStageData.autoEffects) {
        try {
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

    const oldStage = oldStageData || affliction.stages[affliction.currentStage - 1];
    if (!oldStage) return;

    await AfflictionEffectBuilder.removePersistentDamage(actor, affliction.id);
  }

  static async updateOnsetTimers(token, combat) {
    await AfflictionTimerService.updateOnsetTimers(token, combat, this);
  }

  static async checkDurations(token, combat) {
    await AfflictionTimerService.checkDurations(token, combat);
  }

  static async checkWorldTimeMaxDuration(token, affliction, deltaSeconds) {
    return await AfflictionTimerService.checkWorldTimeMaxDuration(token, affliction, deltaSeconds);
  }

  static async checkWorldTimeSave(token, affliction, deltaSeconds) {
    await AfflictionTimerService.checkWorldTimeSave(token, affliction, deltaSeconds, this);
  }

  static _buildExpirationData(affliction, stage, token) {
    return AfflictionTimerService.buildExpirationData(affliction, stage, token);
  }

  static async handlePoisonReExposure(token, existingAffliction, stageIncrease) {
    const newStage = Math.min(
      existingAffliction.currentStage + stageIncrease,
      existingAffliction.stages.length
    );

    if (newStage === existingAffliction.currentStage) {
      ui.notifications.warn(`${token.name} is already at maximum stage of ${existingAffliction.name}`);
      return;
    }

    const oldStageData = existingAffliction.stages[existingAffliction.currentStage - 1];
    const newStageData = existingAffliction.stages[newStage - 1];

    const updates = {
      currentStage: newStage
    };

    await AfflictionStore.updateAffliction(token, existingAffliction.id, updates);

    const updatedAffliction = AfflictionStore.getAffliction(token, existingAffliction.id);

    await this.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);
    if (newStageData) {
      await this.applyStageEffects(token, updatedAffliction, newStageData);

      if (newStageData.damage && newStageData.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.POISON_RE_EXPOSURE', {
      tokenName: token.name,
      afflictionName: existingAffliction.name,
      stageIncrease: stageIncrease
    }));

    await AfflictionChatService.postPoisonReExposure(token, existingAffliction, stageIncrease, newStage);
  }

  static findExistingAffliction(token, afflictionName) {
    const afflictions = AfflictionStore.getAfflictions(token);

    for (const [_id, affliction] of Object.entries(afflictions)) {
      if (affliction.name === afflictionName) {
        return affliction;
      }
    }

    return null;
  }

  static async handleMultipleExposure(token, existingAffliction, afflictionData) {
    const multipleExposure = afflictionData.multipleExposure;

    if (multipleExposure.minStage !== null && existingAffliction.currentStage < multipleExposure.minStage) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MULTIPLE_EXPOSURE_NO_EFFECT', {
        tokenName: token.name,
        afflictionName: afflictionData.name,
        minStage: multipleExposure.minStage
      }));
      return;
    }

    const newStage = Math.min(
      existingAffliction.currentStage + multipleExposure.stageIncrease,
      existingAffliction.stages.length
    );

    const oldStageData = existingAffliction.stages[existingAffliction.currentStage - 1];
    const newStageData = existingAffliction.stages[newStage - 1];

    const combat = game.combat;

    const updates = {
      currentStage: newStage,
      stageStartRound: combat ? combat.round : existingAffliction.stageStartRound
    };

    if (newStageData) {
      if (combat) {
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${existingAffliction.name} Stage ${newStage}`);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        updates.nextSaveInitiative = this.getSaveInitiative(existingAffliction, token, combat);
      } else {
        const durationSeconds = await AfflictionParser.resolveStageDuration(newStageData.duration, `${existingAffliction.name} Stage ${newStage}`);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
      if (newStageData.duration?.value > 0) {
        updates.currentStageResolvedDuration = { value: newStageData.duration.value, unit: newStageData.duration.unit };
      }
    }

    await AfflictionStore.updateAffliction(token, existingAffliction.id, updates);

    const updatedAffliction = AfflictionStore.getAffliction(token, existingAffliction.id);

    await this.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);
    if (newStageData) {
      await this.applyStageEffects(token, updatedAffliction, newStageData);

      if (newStageData.damage && newStageData.damage.length > 0) {
        await this.promptDamage(token, updatedAffliction);
      }
    }

    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.MULTIPLE_EXPOSURE', {
      tokenName: token.name,
      afflictionName: afflictionData.name,
      stageIncrease: multipleExposure.stageIncrease,
      newStage: newStage
    }));

    await AfflictionChatService.postMultipleExposure(token, afflictionData, multipleExposure, newStage);
  }

  static getSaveInitiative(affliction, token, combat) {
    const useAppInit = game.settings.get(MODULE_ID, 'useApplicationInitiative');
    if (useAppInit && affliction.applicationInitiative != null) {
      return affliction.applicationInitiative;
    }
    return combat?.combatants?.find(c => c.tokenId === token.id)?.initiative ?? null;
  }

  static getDieValue(rollOrMessage) {
    if (!rollOrMessage) return null;

    const roll = rollOrMessage.rolls ? rollOrMessage.rolls[0] : rollOrMessage;
    if (!roll) return null;

    const d20Die = roll.dice?.find(d => d.faces === 20);
    if (d20Die?.results?.length > 0) {
      return d20Die.results[0].result;
    }

    const d20Term = roll.terms?.find(t => t.faces === 20);
    if (d20Term?.results?.length > 0) {
      return d20Term.results[0].result;
    }

    return null;
  }

  static calculateDegreeOfSuccess(total, dc, dieValue = null) {
    const diff = total - dc;
    let degree;
    if (diff >= 10) degree = DEGREE_OF_SUCCESS.CRITICAL_SUCCESS;
    else if (diff >= 0) degree = DEGREE_OF_SUCCESS.SUCCESS;
    else if (diff >= -10) degree = DEGREE_OF_SUCCESS.FAILURE;
    else degree = DEGREE_OF_SUCCESS.CRITICAL_FAILURE;

    if (dieValue === 20) {
      if (degree === DEGREE_OF_SUCCESS.FAILURE) degree = DEGREE_OF_SUCCESS.SUCCESS;
      else if (degree === DEGREE_OF_SUCCESS.SUCCESS) degree = DEGREE_OF_SUCCESS.CRITICAL_SUCCESS;
      else if (degree === DEGREE_OF_SUCCESS.CRITICAL_FAILURE) degree = DEGREE_OF_SUCCESS.FAILURE;
    } else if (dieValue === 1) {
      if (degree === DEGREE_OF_SUCCESS.SUCCESS) degree = DEGREE_OF_SUCCESS.FAILURE;
      else if (degree === DEGREE_OF_SUCCESS.CRITICAL_SUCCESS) degree = DEGREE_OF_SUCCESS.SUCCESS;
      else if (degree === DEGREE_OF_SUCCESS.FAILURE) degree = DEGREE_OF_SUCCESS.CRITICAL_FAILURE;
    }

    return degree;
  }
}
