/**
 * Treatment Service - Handle Treat Poison/Disease action
 */

import { AfflictionService } from './AfflictionService.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export class TreatmentService {
  /**
   * Prompt for Treat Poison/Disease roll
   */
  static async promptTreatment(token, affliction) {
    const actor = token.actor;

    if (affliction.treatedThisStage) {
      ui.notifications.warn(game.i18n.localize('PF2E_AFFLICTIONER.NOTIFICATIONS.ALREADY_TREATED'));
      return;
    }

    // Build chat message content
    const content = `
      <div class="pf2e-afflictioner-treatment-request">
        <h3><i class="fas fa-briefcase-medical"></i> Treatment: ${affliction.type === 'poison' ? 'Poison' : 'Disease'}</h3>
        <p><strong>${actor.name}</strong> needs treatment for <strong>${affliction.name}</strong></p>
        <p><em>Crit Success +4, Success +2, Failure 0, Crit Failure -2 to next save</em></p>
        <hr>
        <button class="affliction-roll-treatment" data-token-id="${token.id}" data-affliction-id="${affliction.id}" data-dc="${affliction.dc}" style="width: 100%; padding: 8px; margin-top: 10px;">
          <i class="fas fa-dice-d20"></i> Roll Medicine (Treat ${affliction.type === 'poison' ? 'Poison' : 'Disease'})
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
   * Apply treatment result - creates Rule Element effect for bonus
   */
  static async handleTreatmentResult(token, affliction, total, dc) {
    const degree = AfflictionService.calculateDegreeOfSuccess(total, dc);
    const actor = token.actor;

    let bonus = 0;
    switch (degree) {
      case 'criticalSuccess':
        bonus = 4;
        break;
      case 'success':
        bonus = 2;
        break;
      case 'criticalFailure':
        bonus = -2;
        break;
    }

    // Create effect with rule element for treatment bonus
    if (bonus !== 0) {
      const effectUuid = await this.createTreatmentEffect(actor, affliction, bonus);

      await AfflictionStore.updateAffliction(token, affliction.id, {
        treatmentBonus: bonus,
        treatedThisStage: true,
        treatmentEffectUuid: effectUuid
      });
    } else {
      await AfflictionStore.updateAffliction(token, affliction.id, {
        treatmentBonus: 0,
        treatedThisStage: true
      });
    }

    if (bonus > 0) {
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.TREATMENT_POSITIVE', {
        tokenName: token.name,
        bonus: bonus,
        afflictionName: affliction.name
      }));
    } else if (bonus < 0) {
      ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.TREATMENT_NEGATIVE', {
        tokenName: token.name,
        bonus: bonus,
        afflictionName: affliction.name
      }));
    } else {
      ui.notifications.info(game.i18n.localize('PF2E_AFFLICTIONER.NOTIFICATIONS.TREATMENT_NONE'));
    }
  }

  /**
   * Create treatment effect with rule element
   */
  static async createTreatmentEffect(actor, affliction, bonus) {
    try {
      const rules = [{
        key: 'FlatModifier',
        selector: 'saving-throw',
        type: 'circumstance',
        value: bonus,
        label: `Treatment: ${affliction.name}`
      }];

      const effectData = {
        type: 'effect',
        name: `Treatment: ${affliction.name}`,
        system: {
          tokenIcon: { show: true },
          duration: {
            value: -1,
            unit: 'unlimited',
            expiry: null,
            sustained: false
          },
          rules: rules,
          slug: `treatment-${affliction.name.toLowerCase().replace(/\s+/g, '-')}`
        },
        flags: {
          'pf2e-afflictioner': {
            afflictionId: affliction.id,
            isTreatmentBonus: true
          }
        }
      };

      const [created] = await actor.createEmbeddedDocuments('Item', [effectData]);
      return created?.uuid;
    } catch (error) {
      console.error('PF2e Afflictioner | Error creating treatment effect:', error);
      return null;
    }
  }
}
