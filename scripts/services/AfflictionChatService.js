import { MODULE_ID } from '../constants.js';

export class AfflictionChatService {
  static async promptInitialSave(token, affliction, afflictionData, afflictionId) {
    const actor = token.actor;
    const showDCToPlayers = game.pf2e?.settings?.metagame?.dcs ?? true;
    const anonymizeSaves = game.settings.get(MODULE_ID, 'anonymizeSaveMessages') ?? false;
    const gmRollMysteriousSaves = game.settings.get(MODULE_ID, 'gmRollMysteriousSaves') ?? false;

    const isMysterious = this._isAfflictionMysterious(afflictionData);

    if (gmRollMysteriousSaves && isMysterious) {
      const gmContent = `
        <div class="pf2e-afflictioner-save-request" style="border-color: #8b0000; padding: 12px;">
          <h3><i class="fas fa-user-secret"></i> ${afflictionData.name} - GM Secret Initial Save</h3>
          <p><strong>${actor.name}</strong> has been exposed to <strong>${afflictionData.name}</strong></p>
          <p><strong>DC ${afflictionData.dc} Fortitude Save</strong></p>
          <p><em style="color: #752f00;">This affliction is mysterious - GM rolls in secret (blind roll)</em></p>
          <p><em style="font-size: 0.9em;">Reason: ${afflictionData.onset ? 'Has onset period' : 'Stage 1 has no mechanical effects'}</em></p>
          <hr>
          <button class="affliction-roll-initial-save"
                  data-token-id="${token.id}"
                  data-affliction-id="${afflictionId}"
                  data-dc="${afflictionData.dc}"
                  data-blind-roll="true"
                  style="width: 100%; padding: 8px; margin-top: 10px; background: #8b0000;">
            <i class="fas fa-user-secret"></i> Roll Blind Save for ${actor.name}
          </button>
        </div>
      `;
      await ChatMessage.create({
        content: gmContent,
        speaker: ChatMessage.getSpeaker({ token: token }),
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
      return;
    }

    const { StoryframeIntegrationService } = await import('./StoryframeIntegrationService.js');
    const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'initial');

    if (!sentToStoryframe) {
      const playerContent = this._buildInitialSaveMessage(
        actor,
        token,
        afflictionData,
        afflictionId,
        showDCToPlayers,
        anonymizeSaves
      );

      const whisperTargets = actor.hasPlayerOwner
        ? game.users.filter(u => !u.isGM && actor.testUserPermission(u, 'OWNER')).map(u => u.id)
        : game.users.filter(u => u.isGM).map(u => u.id);

      if (whisperTargets.length > 0) {
        await ChatMessage.create({
          content: playerContent,
          speaker: ChatMessage.getSpeaker({ token: token }),
          whisper: whisperTargets
        });
      }
    }

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

  static _isAfflictionMysterious(afflictionData) {
    if (afflictionData.onset) {
      return true;
    }

    const stage1 = afflictionData.stages?.[0];
    if (!stage1) return false;

    const hasConditions = stage1.conditions && stage1.conditions.length > 0;
    const hasWeakness = stage1.weakness && stage1.weakness.length > 0;
    const hasDamage = stage1.damage && stage1.damage.length > 0;

    return !hasConditions && !hasWeakness && !hasDamage;
  }

  static async promptStageSave(token, affliction) {
    const actor = token.actor;
    const showDCToPlayers = game.pf2e?.settings?.metagame?.dcs ?? true;
    const anonymizeSaves = game.settings.get(MODULE_ID, 'anonymizeSaveMessages') ?? false;

    const { StoryframeIntegrationService } = await import('./StoryframeIntegrationService.js');
    const sentToStoryframe = await StoryframeIntegrationService.sendSaveRequest(token, affliction, 'stage');

    if (!sentToStoryframe) {
      const playerContent = this._buildStageSaveMessage(
        actor,
        token,
        affliction,
        showDCToPlayers,
        anonymizeSaves
      );

      const whisperTargets = actor.hasPlayerOwner
        ? game.users.filter(u => !u.isGM && actor.testUserPermission(u, 'OWNER')).map(u => u.id)
        : game.users.filter(u => u.isGM).map(u => u.id);

      if (whisperTargets.length > 0) {
        await ChatMessage.create({
          content: playerContent,
          speaker: ChatMessage.getSpeaker({ token: token }),
          whisper: whisperTargets
        });
      }
    }

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
  }

  static async promptDamage(token, affliction) {
    const actor = token.actor;

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

    const damageLinks = stage.damage.map(d => {
      const formula = typeof d === 'string' ? d : d.formula;
      const type = typeof d === 'object' ? d.type : 'untyped';
      const isChoice = typeof d === 'object' && d.isChoice;
      const altType = typeof d === 'object' ? d.alternativeType : null;

      const cleanFormula = formula.trim().replace(/\[.*$/, '');

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

      return type !== 'untyped'
        ? `@Damage[${cleanFormula}[${type}]]`
        : `@Damage[${cleanFormula}]`;
    }).join(', ');

    const content = `
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

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  static _buildInitialSaveMessage(actor, token, afflictionData, afflictionId, showDCToPlayers, anonymizeSaves) {
    if (anonymizeSaves) {
      return `
        <div class="pf2e-afflictioner-save-request">
          <h3><i class="fas fa-dice-d20"></i> Fortitude Save Required</h3>
          <p><strong>${actor.name}</strong> needs to make a <strong>Fortitude save${showDCToPlayers ? ` (DC ${afflictionData.dc})` : ''}</strong></p>
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
    }

    return `
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
  }

  static _buildStageSaveMessage(actor, token, affliction, showDCToPlayers, anonymizeSaves) {
    if (anonymizeSaves) {
      return `
        <div class="pf2e-afflictioner-save-request">
          <h3><i class="fas fa-dice-d20"></i> Fortitude Save Required</h3>
          <p><strong>${actor.name}</strong> must make a <strong>Fortitude save</strong></p>
          ${showDCToPlayers ? `<p><strong>DC:</strong> ${affliction.dc}</p>` : ''}
          ${affliction.treatmentBonus ? `<p><em>Treatment bonus active (${affliction.treatmentBonus > 0 ? '+' : ''}${affliction.treatmentBonus})</em></p>` : ''}
          <hr>
          <button class="affliction-roll-save" data-token-id="${token.id}" data-affliction-id="${affliction.id}" data-dc="${affliction.dc}" style="width: 100%; padding: 8px; margin-top: 10px;">
            <i class="fas fa-dice-d20"></i> Roll Fortitude Save
          </button>
        </div>
      `;
    }

    return `
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
  }

  static async postMaxDurationExpired(token, affliction) {
    const maxDurationText = affliction.maxDuration
      ? `${affliction.maxDuration.value} ${affliction.maxDuration.unit}(s)`
      : 'unknown';

    const content = `
      <div class="pf2e-afflictioner-save-request" style="border-color: #6C757D;">
        <h3><i class="fas fa-hourglass-end"></i> ${affliction.name} - Maximum Duration Reached</h3>
        <p><strong>${token.name}</strong>'s affliction has reached its maximum duration (${maxDurationText})</p>
        <p><strong>The affliction should be removed, but any imposed conditions persist per PF2e rules.</strong></p>
        <p><em>Stage when expired: ${affliction.currentStage}</em></p>
        <div class="pf2e-afflictioner-button-group" style="margin-top: 10px;">
          <button class="pf2e-afflictioner-btn pf2e-afflictioner-remove-expired-btn"
                  data-token-id="${token.id}"
                  data-affliction-id="${affliction.id}"
                  style="background: #dc3545;">
            <i class="fas fa-trash-alt"></i> Remove Affliction (Conditions Persist)
          </button>
        </div>
      </div>
    `;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  static async postStageChange(token, affliction, oldStage, newStage) {
    const oldStageText = oldStage === 0 ? 'Initial Exposure' : `Stage ${oldStage}`;
    const stageDirection = newStage > oldStage ? 'increased' : 'decreased';
    const stageIcon = newStage > oldStage ? 'fa-arrow-up' : 'fa-arrow-down';
    const stageColor = newStage > oldStage ? '#ff6b00' : '#4a7c2a';
    const bgColor = newStage > oldStage ? 'rgba(255, 107, 0, 0.1)' : 'rgba(74, 124, 42, 0.1)';

    const newStageData = affliction.stages[newStage - 1];

    let effectsSummary = '';
    if (newStageData) {
      const effects = [];
      if (newStageData.damage?.length) {
        effects.push(`Damage: ${newStageData.damage.map(d => `${d.formula} ${d.type}`).join(', ')}`);
      }
      if (newStageData.conditions?.length) {
        effects.push(`Conditions: ${newStageData.conditions.map(c => {
          if (c.name === 'persistent damage' || c.name === 'persistent-damage') {
            return `${c.persistentFormula || '1d6'} ${c.persistentType || 'untyped'} persistent damage`;
          }
          return c.value ? `${c.name} ${c.value}` : c.name;
        }).join(', ')}`);
      }
      if (newStageData.weakness?.length) {
        effects.push(`Weakness: ${newStageData.weakness.map(w => `${w.type} ${w.value}`).join(', ')}`);
      }
      if (effects.length > 0) {
        effectsSummary = `<div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 0.9em;">${effects.join(' • ')}</div>`;
      }
    }

    const content = `
      <div class="pf2e-afflictioner-stage-change" style="border-left: 5px solid ${stageColor}; padding: 12px; background: ${bgColor}; border-radius: 4px; margin: 8px 0;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <i class="fas ${stageIcon}" style="color: ${stageColor}; font-size: 24px;"></i>
          <div style="flex: 1;">
            <h3 style="margin: 0; font-size: 1.2em; color: ${stageColor};">${affliction.name} - Stage ${stageDirection}</h3>
            <p style="margin: 4px 0 0 0; font-size: 0.95em;"><strong>${token.name}</strong> is now at <strong>Stage ${newStage}</strong> <span style="color: #888;">(was ${oldStageText})</span></p>
          </div>
        </div>
        ${effectsSummary}
        ${newStageData && newStageData.effects ? `<div style="margin: 8px 0; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; font-style: italic; color: #f5f5f5; font-size: 0.9em; border-left: 3px solid ${stageColor}; padding-left: 10px;">${newStageData.effects}</div>` : ''}
      </div>
    `;

    await ChatMessage.create({
      content: content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  static async promptDeathConfirmation(token, affliction) {
    const actor = token.actor;

    const content = `
      <div class="pf2e-afflictioner-save-request" style="border-color: #4a0000;">
        <h3><i class="fas fa-skull-crossbones"></i> ${affliction.name} - Lethal Stage</h3>
        <p><strong>${actor.name}</strong> has reached a lethal stage of <strong>${affliction.name}</strong> (Stage ${affliction.currentStage})</p>
        <p><em>The affliction description indicates the creature dies at this stage.</em></p>
        <hr>
        <button class="pf2e-afflictioner-btn pf2e-afflictioner-confirm-kill-btn"
                data-token-id="${token.id}"
                data-affliction-id="${affliction.id}"
                style="width: 100%; padding: 8px; margin-top: 10px; background: #8b0000;">
          <i class="fas fa-skull"></i> Confirm Kill
        </button>
      </div>
    `;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  static async postPoisonReExposure(token, affliction, stageIncrease, newStage) {
    const content = `
      <div class="pf2e-afflictioner-save-request" style="border-color: #8b008b;">
        <h3><i class="fas fa-biohazard"></i> ${affliction.name} - Poison Re-Exposure</h3>
        <p><strong>${token.name}</strong> is exposed to <strong>${affliction.name}</strong> again</p>
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

  static async postMultipleExposure(token, afflictionData, multipleExposure, newStage) {
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
}
