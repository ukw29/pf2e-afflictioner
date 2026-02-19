import { MODULE_ID } from '../constants.js';

export class StoryframeIntegrationService {
  constructor() {
    this.pendingRequests = new Map();
  }

  static isAvailable() {
    const enabled = game.settings.get(MODULE_ID, 'integrateWithStoryframe');
    const storyframeActive = game.modules.get('storyframe')?.active;
    const apiAvailable = !!game.storyframe?.socketManager;

    return enabled && storyframeActive && apiAvailable;
  }

  static findOwnerUser(actor) {
    return game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'));
  }

  static async sendSaveRequest(token, affliction, saveType) {
    if (!this.isAvailable()) return false;

    const actor = token.actor;
    const user = this.findOwnerUser(actor);
    if (!user) return false;

    const dc = affliction.dc;
    if (!dc) {
      console.warn(`PF2e Afflictioner | No DC found for affliction "${affliction.name}". Cannot send save request to Storyframe.`);
      ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.NO_DC_FOUND', {
        itemName: affliction.name
      }));
      return false;
    }

    if (!game.afflictioner?.storyframeService) {
      console.error(`${MODULE_ID} | Storyframe service not initialized`);
      return false;
    }

    const requestId = foundry.utils.randomID();

    const request = {
      id: requestId,
      actorUuid: actor.uuid,
      userId: user.id,
      skillSlug: 'fortitude',
      checkType: 'save',
      dc,
      isSecretRoll: false,
      timestamp: Date.now()
    };

    game.afflictioner.storyframeService.pendingRequests.set(requestId, {
      tokenId: token.id,
      afflictionId: affliction.id,
      saveType,
      dc,
      timestamp: Date.now()
    });

    try {
      await game.storyframe.socketManager.requestAddPendingRoll(request);
      await game.storyframe.socketManager.triggerSkillCheckOnPlayer(user.id, request);

      ui.notifications.info(`Fortitude save requested from ${actor.name} via Storyframe`);
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to send to storyframe:`, error);
      game.afflictioner.storyframeService.pendingRequests.delete(requestId);
      return false;
    }
  }

  async pollResults() {
    if (!StoryframeIntegrationService.isAvailable()) return;
    if (this.pendingRequests.size === 0) return;

    const state = game.storyframe.stateManager.getState();
    if (!state?.rollHistory) return;

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

    const now = Date.now();
    for (const [requestId, context] of this.pendingRequests.entries()) {
      if (now - context.timestamp > 300000) {
        console.warn(`${MODULE_ID} | Request ${requestId} expired after 5 minutes`);
        this.pendingRequests.delete(requestId);
      }
    }
  }

  findRollMessage(actorId, total) {
    const recent = game.messages.contents.slice(-20);
    for (let i = recent.length - 1; i >= 0; i--) {
      const msg = recent[i];
      if (msg.flags?.pf2e?.context?.type === 'saving-throw' &&
          msg.actor?.id === actorId &&
          msg.rolls?.[0]?.total === total) {
        return msg.id;
      }
    }
    return null;
  }

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

    const rollMessageId = result.chatMessageId || this.findRollMessage(token.actor?.id, result.total);

    if (context.saveType === 'initial') {
      const { SocketService } = await import('./SocketService.js');
      await SocketService.requestHandleInitialSave(context.tokenId, context.afflictionId, rollMessageId, context.dc);
    } else if (context.saveType === 'stage') {
      const { SocketService } = await import('./SocketService.js');
      await SocketService.requestHandleSave(context.tokenId, context.afflictionId, rollMessageId, context.dc);
    }
  }
}
