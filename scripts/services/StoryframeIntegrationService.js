/**
 * Service for integrating with the Storyframe module
 * Handles sending save/counteract requests and processing results
 */

import { MODULE_ID } from '../constants.js';

export class StoryframeIntegrationService {
  constructor() {
    // Track pending requests: { requestId: { tokenId, afflictionId, saveType/counteractData, timestamp } }
    this.pendingRequests = new Map();
    this.lastProcessedIndex = 0;
  }

  /**
   * Check if Storyframe integration is available
   */
  static isAvailable() {
    const enabled = game.settings.get(MODULE_ID, 'integrateWithStoryframe');
    const storyframeActive = game.modules.get('storyframe')?.active;
    const apiAvailable = !!game.storyframe?.socketManager;

    return enabled && storyframeActive && apiAvailable;
  }

  /**
   * Find participant for actor in storyframe state
   * @param {Actor} actor
   * @returns {Object|null} participant or null if not found
   */
  static findParticipant(actor) {
    if (!game.storyframe?.stateManager) return null;

    const state = game.storyframe.stateManager.getState();
    if (!state) return null;

    return state.participants.find(p => p.actorUuid === actor.uuid);
  }

  /**
   * Prompt GM to add actor as participant
   * @param {Actor} actor
   * @returns {Promise<boolean>} true if added, false if declined
   */
  static async promptAddParticipant(actor) {
    return new Promise((resolve) => {
      new Dialog({
        title: 'Add to Storyframe?',
        content: `<p><strong>${actor.name}</strong> is not a Storyframe participant.</p><p>Add them to use Storyframe for rolls?</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Add to Storyframe',
            callback: async () => {
              const user = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'));
              if (!user) {
                ui.notifications.warn(`${actor.name} has no active owner. Cannot add to Storyframe.`);
                resolve(false);
                return;
              }

              await game.storyframe.socketManager.requestAddParticipant({
                actorUuid: actor.uuid,
                userId: user.id
              });

              ui.notifications.info(`${actor.name} added to Storyframe participants`);
              resolve(true);
            }
          },
          no: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Use Chat Buttons',
            callback: () => resolve(false)
          }
        },
        default: 'yes'
      }).render(true);
    });
  }

  /**
   * Send save request to storyframe
   * @param {Token} token
   * @param {Object} affliction
   * @param {string} saveType - 'initial' or 'stage'
   * @returns {Promise<boolean>} true if sent to storyframe, false to fallback
   */
  static async sendSaveRequest(token, affliction, saveType) {
    if (!this.isAvailable()) return false;

    const actor = token.actor;
    let participant = this.findParticipant(actor);

    // Prompt to add if not found
    if (!participant && game.user.isGM) {
      const added = await this.promptAddParticipant(actor);
      if (!added) return false;
      participant = this.findParticipant(actor);
    }

    if (!participant) {
      console.warn(`${MODULE_ID} | Cannot find participant for ${actor.name}`);
      return false;
    }

    const requestId = foundry.utils.randomID();
    const dc = affliction.dc || game.settings.get(MODULE_ID, 'defaultDC');

    const request = {
      id: requestId,
      participantId: participant.id,
      actorUuid: actor.uuid,
      userId: participant.userId,
      skillSlug: 'fortitude', // PF2e save name
      checkType: 'save',
      dc, // Always pass DC - storyframe handles visibility
      isSecretRoll: false,
      timestamp: Date.now()
    };

    // Store pending request context
    if (!game.afflictioner?.storyframeService) {
      console.error(`${MODULE_ID} | Storyframe service not initialized`);
      return false;
    }

    // Check if user is online
    const user = game.users.get(participant.userId);
    if (!user || !user.active) {
      console.warn(`${MODULE_ID} | User ${participant.userId} is not connected, falling back to chat`);
      return false;
    }

    game.afflictioner.storyframeService.pendingRequests.set(requestId, {
      tokenId: token.id,
      afflictionId: affliction.id,
      saveType,
      dc,
      timestamp: Date.now()
    });

    // Send request
    try {
      await game.storyframe.socketManager.requestAddPendingRoll(request);
      await game.storyframe.socketManager.triggerSkillCheckOnPlayer(participant.userId, request);

      ui.notifications.info(`Fortitude save requested from ${actor.name} via Storyframe`);
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to send to storyframe:`, error);
      game.afflictioner.storyframeService.pendingRequests.delete(requestId);
      return false;
    }
  }

  /**
   * Send counteract request to storyframe
   * @param {Token} token - Token with affliction
   * @param {Object} affliction - Affliction data
   * @param {Actor} casterActor - Actor performing counteract
   * @param {string} skillSlug - Skill slug (e.g., 'med', 'rel', 'occ')
   * @param {number} counteractRank
   * @param {number} afflictionRank
   * @returns {Promise<boolean>} true if sent to storyframe, false to fallback
   */
  static async sendCounteractRequest(token, affliction, casterActor, skillSlug, counteractRank, afflictionRank) {
    if (!this.isAvailable()) return false;

    let participant = this.findParticipant(casterActor);

    // Prompt to add if not found
    if (!participant && game.user.isGM) {
      const added = await this.promptAddParticipant(casterActor);
      if (!added) return false;
      participant = this.findParticipant(casterActor);
    }

    if (!participant) {
      console.warn(`${MODULE_ID} | Cannot find participant for ${casterActor.name}`);
      return false;
    }

    const requestId = foundry.utils.randomID();
    const dc = affliction.dc || game.settings.get(MODULE_ID, 'defaultDC');

    const request = {
      id: requestId,
      participantId: participant.id,
      actorUuid: casterActor.uuid,
      userId: participant.userId,
      skillSlug,
      checkType: 'skill',
      dc, // Always pass DC - storyframe handles visibility
      isSecretRoll: false,
      timestamp: Date.now()
    };

    // Store pending request context
    if (!game.afflictioner?.storyframeService) {
      console.error(`${MODULE_ID} | Storyframe service not initialized`);
      return false;
    }

    // Check if user is online
    const user = game.users.get(participant.userId);
    if (!user || !user.active) {
      console.warn(`${MODULE_ID} | User ${participant.userId} is not connected, falling back to chat`);
      return false;
    }

    game.afflictioner.storyframeService.pendingRequests.set(requestId, {
      tokenId: token.id,
      afflictionId: affliction.id,
      counteractData: {
        casterActorUuid: casterActor.uuid,
        skillSlug,
        counteractRank,
        afflictionRank
      },
      dc,
      timestamp: Date.now()
    });

    // Send request
    try {
      await game.storyframe.socketManager.requestAddPendingRoll(request);
      await game.storyframe.socketManager.triggerSkillCheckOnPlayer(participant.userId, request);

      const skillName = this.getSkillName(skillSlug);
      ui.notifications.info(`${skillName} check requested from ${casterActor.name} via Storyframe`);
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to send to storyframe:`, error);
      game.afflictioner.storyframeService.pendingRequests.delete(requestId);
      return false;
    }
  }

  /**
   * Get skill name from slug
   */
  static getSkillName(slug) {
    const skillMap = {
      'med': 'Medicine',
      'rel': 'Religion',
      'nat': 'Nature',
      'arc': 'Arcana',
      'occ': 'Occultism',
      'cra': 'Crafting',
      'dip': 'Diplomacy',
      'itm': 'Intimidation',
      'dec': 'Deception',
      'prf': 'Performance',
      'acr': 'Acrobatics',
      'ath': 'Athletics',
      'ste': 'Stealth',
      'thi': 'Thievery',
      'sur': 'Survival',
      'soc': 'Society',
      'per': 'Perception'
    };
    return skillMap[slug] || slug.toUpperCase();
  }

  /**
   * Poll storyframe state for new results
   * Called on interval by main.js
   */
  async pollResults() {
    if (!StoryframeIntegrationService.isAvailable()) return;
    if (this.pendingRequests.size === 0) return;

    const state = game.storyframe.stateManager.getState();
    if (!state?.rollHistory) return;

    // Check all roll history for matches
    for (const result of state.rollHistory) {
      const requestId = result.id || result.requestId;

      if (requestId) {
        const context = this.pendingRequests.get(requestId);

        if (context) {
          await this.handleRollResult(result, context);
          this.pendingRequests.delete(requestId);
        }
      }
    }

    // Clean up stale requests (> 5 minutes old)
    const now = Date.now();
    for (const [requestId, context] of this.pendingRequests.entries()) {
      if (now - context.timestamp > 300000) {
        console.warn(`${MODULE_ID} | Request ${requestId} expired after 5 minutes`);
        this.pendingRequests.delete(requestId);
      }
    }
  }

  /**
   * Handle roll result from storyframe
   * @param {Object} result - Roll result from storyframe
   * @param {Object} context - Pending request context
   */
  async handleRollResult(result, context) {
    const token = canvas.tokens.get(context.tokenId);
    if (!token) {
      console.warn(`${MODULE_ID} | Token ${context.tokenId} not found`);
      return;
    }

    const AfflictionStore = await import('../stores/AfflictionStore.js');
    const affliction = AfflictionStore.getAffliction(token, context.afflictionId);
    if (!affliction) {
      console.warn(`${MODULE_ID} | Affliction ${context.afflictionId} not found`);
      return;
    }

    // Route to appropriate handler
    if (context.saveType === 'initial') {
      const { AfflictionService } = await import('./AfflictionService.js');
      await AfflictionService.handleInitialSave(token, affliction, result.total, context.dc);
    } else if (context.saveType === 'stage') {
      const { SocketService } = await import('./SocketService.js');
      await SocketService.requestHandleSave(context.tokenId, context.afflictionId, result.total, context.dc);
    } else if (context.counteractData) {
      const { AfflictionService } = await import('./AfflictionService.js');
      const { CounteractService } = await import('./CounteractService.js');

      // Calculate degree of success from roll total and DC
      const degree = AfflictionService.calculateDegreeOfSuccess(result.total, context.dc);

      await CounteractService.handleCounteractResult(
        token,
        affliction,
        context.counteractData.counteractRank,
        context.counteractData.afflictionRank,
        degree
      );
    }
  }
}
