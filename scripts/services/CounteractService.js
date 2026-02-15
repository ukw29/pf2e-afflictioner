/**
 * Counteract Service - Handle counteract checks for afflictions
 */

import { AfflictionService } from './AfflictionService.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export class CounteractService {
  /**
   * Calculate affliction's counteract rank
   * Per rules: "halve its level and round up to determine its counteract rank (minimum 0)"
   * "If an effect's level is unclear and it came from a creature, halve and round up the creature's level"
   */
  static async calculateAfflictionRank(affliction) {
    let afflictionLevel = affliction.level;

    if (!afflictionLevel && affliction.sourceItemUuid) {
      try {
        const sourceItem = await fromUuid(affliction.sourceItemUuid);

        // Try to get item level
        afflictionLevel = sourceItem?.level || sourceItem?.system?.level?.value;

        // If no item level and it came from a creature, use creature's level
        if (!afflictionLevel && sourceItem?.actor) {
          afflictionLevel = sourceItem.actor.level || sourceItem.actor.system?.details?.level?.value;
        }
      } catch {
        console.warn('PF2e Afflictioner | Could not load source item for level detection');
      }
    }

    if (!afflictionLevel) {
      // Fallback: estimate from DC (rough approximation)
      afflictionLevel = Math.max(1, Math.floor(affliction.dc / 2));
    }

    // Counteract rank = half level rounded up (minimum 0)
    return {
      level: afflictionLevel,
      rank: Math.max(0, Math.ceil(afflictionLevel / 2))
    };
  }

  /**
   * Prompt for counteract attempt via chat message
   * @param {Token} token - The afflicted token
   * @param {Object} affliction - The affliction data
   * @param {Actor} casterActor - Optional: The actor casting the counteract (for whisper targeting)
   */
  static async promptCounteract(token, affliction, casterActor = null) {
    const afflictedActor = token.actor;
    const { level: afflictionLevel, rank: afflictionRank } = await this.calculateAfflictionRank(affliction);

    // Prompt for counteract rank and DC
    const template = `
      <form>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: bold;">Your Counteract Rank</label>
          <input type="number" name="counteractRank" value="${Math.max(1, afflictionRank)}" min="0" max="10" required
                 style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;"/>
          <p style="font-size: 0.85em; color: #666; margin: 4px 0 0 0;">Spell rank or half creature/item level (rounded up)</p>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: bold;">Counteract DC</label>
          <input type="number" name="dc" value="${affliction.dc}" min="1" max="50" required
                 style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;"/>
          <p style="font-size: 0.85em; color: #666; margin: 4px 0 0 0;">DC from affliction (can override if needed)</p>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: bold;">Check Type</label>
          <select name="skill" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="medicine">Medicine</option>
            <option value="religion">Religion</option>
            <option value="nature">Nature</option>
            <option value="arcana">Arcana</option>
            <option value="occultism">Occultism</option>
            <option value="acrobatics">Acrobatics</option>
            <option value="athletics">Athletics</option>
            <option value="crafting">Crafting</option>
            <option value="deception">Deception</option>
            <option value="diplomacy">Diplomacy</option>
            <option value="intimidation">Intimidation</option>
            <option value="performance">Performance</option>
            <option value="society">Society</option>
            <option value="stealth">Stealth</option>
            <option value="survival">Survival</option>
            <option value="thievery">Thievery</option>
          </select>
          <p style="font-size: 0.85em; color: #666; margin: 4px 0 0 0;">Skill to roll for counteract check</p>
        </div>
        <div style="padding: 10px; background: rgba(74, 124, 42, 0.1); border-left: 3px solid #4a7c2a; border-radius: 4px;">
          <p style="margin: 0; font-size: 0.9em;"><strong>Target Affliction:</strong> ${affliction.name}</p>
          <p style="margin: 4px 0 0 0; font-size: 0.9em;"><strong>Affliction Level:</strong> ${afflictionLevel} (Rank ${afflictionRank})</p>
        </div>
      </form>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: 'Counteract Affliction' },
      content: template,
      ok: {
        label: 'Create Counteract Prompt',
        callback: (_event, button, _dialog) => new FormDataExtended(button.form).object
      }
    });

    if (!result) return;

    const counteractRank = parseInt(result.counteractRank);
    const dc = parseInt(result.dc);
    const skill = result.skill || 'medicine';

    // Format skill name for display
    const skillNames = {
      acrobatics: 'Acrobatics',
      arcana: 'Arcana',
      athletics: 'Athletics',
      crafting: 'Crafting',
      deception: 'Deception',
      diplomacy: 'Diplomacy',
      intimidation: 'Intimidation',
      medicine: 'Medicine',
      nature: 'Nature',
      occultism: 'Occultism',
      performance: 'Performance',
      religion: 'Religion',
      society: 'Society',
      stealth: 'Stealth',
      survival: 'Survival',
      thievery: 'Thievery'
    };
    const skillDisplay = skillNames[skill] || skill.charAt(0).toUpperCase() + skill.slice(1);

    // Check PF2e metagame setting for showing DCs to players
    const showDCToPlayers = game.pf2e?.settings?.metagame?.dcs ?? true;

    // Try storyframe integration first (if casterActor provided)
    let sentToStoryframe = false;
    if (casterActor) {
      const { StoryframeIntegrationService } = await import('./StoryframeIntegrationService.js');

      // Convert full skill name to slug
      const skillSlugMap = {
        'acrobatics': 'acr', 'arcana': 'arc', 'athletics': 'ath', 'crafting': 'cra',
        'deception': 'dec', 'diplomacy': 'dip', 'intimidation': 'itm', 'medicine': 'med',
        'nature': 'nat', 'occultism': 'occ', 'performance': 'prf', 'religion': 'rel',
        'society': 'soc', 'stealth': 'ste', 'survival': 'sur', 'thievery': 'thi'
      };
      const skillSlug = skillSlugMap[skill] || 'med';

      sentToStoryframe = await StoryframeIntegrationService.sendCounteractRequest(
        token,
        affliction,
        casterActor,
        skillSlug,
        counteractRank,
        afflictionRank
      );
    }

    if (!sentToStoryframe) {
      // Fallback: Build player message content with button
      const playerContent = `
        <div class="pf2e-afflictioner-counteract-request">
          <h3><i class="fas fa-shield-alt"></i> Counteract: ${affliction.name}</h3>
          <p><strong>${afflictedActor.name}</strong> - Attempt to counteract affliction</p>
          ${showDCToPlayers ? `<p><strong>${skillDisplay} Check DC:</strong> ${dc}</p>` : ''}
          <hr>
          <button class="affliction-roll-counteract"
                  data-token-id="${token.id}"
                  data-affliction-id="${affliction.id}"
                  data-counteract-rank="${counteractRank}"
                  data-affliction-rank="${afflictionRank}"
                  data-dc="${dc}"
                  data-skill="${skill}"
                  style="width: 100%; padding: 8px; margin-top: 10px; background: #4a7c2a; border: 2px solid #5a8c3a; color: white; border-radius: 6px; cursor: pointer;">
            <i class="fas fa-dice-d20"></i> Roll ${skillDisplay} Check
          </button>
        </div>
      `;

      // Determine who to whisper to (caster if provided, otherwise GM only for manual counteract)
      const playerWhisper = casterActor?.hasPlayerOwner
        ? game.users.filter(u => !u.isGM && casterActor.testUserPermission(u, 'OWNER')).map(u => u.id)
        : [];

      // Send message to caster or GM
      if (playerWhisper.length > 0 || !casterActor) {
        await ChatMessage.create({
          content: playerContent,
          speaker: ChatMessage.getSpeaker({ token }),
          whisper: playerWhisper.length > 0 ? playerWhisper : game.users.filter(u => u.isGM).map(u => u.id)
        });
      }
    }

    // Send GM-only message with DC info (only if DCs are hidden from players and caster is a player)
    if (!showDCToPlayers && casterActor?.hasPlayerOwner) {
      const gmContent = `
        <div class="pf2e-afflictioner-counteract-request" style="border-color: #8b0000; padding: 8px;">
          <p style="margin: 0;"><strong>Counteract ${affliction.name} - DC ${dc}</strong> (GM Info) - Rank ${afflictionRank} vs ${counteractRank}</p>
        </div>
      `;
      await ChatMessage.create({
        content: gmContent,
        speaker: ChatMessage.getSpeaker({ token }),
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
    }
  }

  /**
   * Handle counteract result
   * Applies official counteract rules based on degree of success and rank comparison
   */
  static async handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree) {
    // Determine max counteractable rank based on degree
    // Per rules: Critical Success = rank+3, Success = rank+1, Failure = rank-1, Critical Failure = fail
    let maxRankDifference;
    switch (degree) {
      case 'criticalSuccess':
        maxRankDifference = 3; // Can counteract up to +3 ranks higher
        break;
      case 'success':
        maxRankDifference = 1; // Can counteract up to +1 rank higher
        break;
      case 'failure':
        maxRankDifference = -1; // Can only counteract lower ranks
        break;
      default: // criticalFailure
        maxRankDifference = -Infinity; // Cannot counteract
        break;
    }

    // Check if counteract succeeds
    const rankDiff = afflictionRank - counteractRank;
    const succeeds = rankDiff <= maxRankDifference;

    if (!succeeds) {
      ui.notifications.warn(`Failed to counteract ${affliction.name} (Affliction Rank ${afflictionRank} vs Your Rank ${counteractRank})`);
      return false;
    }

    // Counteract succeeds - reduce stage by 1 (Cleanse Affliction behavior)
    if (affliction.currentStage <= 1) {
      // Stage 1 - cure completely
      const oldStageData = affliction.stages[affliction.currentStage - 1];
      await AfflictionStore.removeAffliction(token, affliction.id);
      await AfflictionService.removeStageEffects(token, affliction, oldStageData, null);

      // Remove visual indicator if no more afflictions
      const remainingAfflictions = AfflictionStore.getAfflictions(token);
      if (Object.keys(remainingAfflictions).length === 0) {
        const { VisualService } = await import('./VisualService.js');
        await VisualService.removeAfflictionIndicator(token);
      }

      ui.notifications.info(`${affliction.name} counteracted! ${token.name} is cured.`);
    } else {
      // Reduce stage by 1 directly
      await this.reduceAfflictionStage(token, affliction);
      ui.notifications.info(`${affliction.name} counteracted! Stage reduced by 1.`);
    }

    return true;
  }

  /**
   * Directly reduce affliction stage by 1 (for counteract/cure effects)
   */
  static async reduceAfflictionStage(token, affliction) {
    const newStage = affliction.currentStage - 1;
    const combat = game.combat;

    // Get old and new stage data
    const oldStageData = affliction.stages[affliction.currentStage - 1];
    const newStageData = affliction.stages[newStage - 1];

    // Update affliction
    const updates = {
      currentStage: newStage,
      treatmentBonus: 0, // Reset treatment
      treatedThisStage: false
    };

    // Update save timing for new stage
    if (newStageData) {
      const { AfflictionParser } = await import('./AfflictionParser.js');
      if (combat) {
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        const durationRounds = Math.ceil(durationSeconds / 6);
        updates.nextSaveRound = combat.round + durationRounds;
        const tokenCombatant = combat.combatants.find(c => c.tokenId === token.id);
        updates.nextSaveInitiative = tokenCombatant?.initiative;
        updates.stageStartRound = combat.round;
      } else {
        const durationSeconds = AfflictionParser.durationToSeconds(newStageData.duration);
        updates.nextSaveTimestamp = game.time.worldTime + durationSeconds;
      }
    }

    await AfflictionStore.updateAffliction(token, affliction.id, updates);

    // Re-fetch updated affliction
    const updatedAffliction = AfflictionStore.getAffliction(token, affliction.id);

    // Update effects
    await AfflictionService.removeStageEffects(token, updatedAffliction, oldStageData, newStageData);
    if (newStageData) {
      await AfflictionService.applyStageEffects(token, updatedAffliction, newStageData);
    }
  }
}

