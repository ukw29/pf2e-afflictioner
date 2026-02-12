/**
 * Socket Service - Cross-client sync via socketlib
 */

import { MODULE_ID } from '../constants.js';
import { VisualService } from './VisualService.js';

export class SocketService {
  static socket = null;

  /**
   * Initialize socket communication
   */
  static initialize() {
    // Check if socketlib is available
    if (!game.modules.get('socketlib')?.active) {
      console.warn('PF2e Afflictioner | socketlib not available, skipping socket initialization');
      return;
    }

    this.socket = socketlib.registerModule(MODULE_ID);

    // Register socket handlers
    this.socket.register('refreshAfflictionIndicators', this.refreshAfflictionIndicators.bind(this));
    this.socket.register('notifyAfflictionChange', this.notifyAfflictionChange.bind(this));
    this.socket.register('gmRemoveAffliction', this.gmRemoveAffliction.bind(this));
    this.socket.register('gmUpdateAfflictions', this.gmUpdateAfflictions.bind(this));
    this.socket.register('gmHandleSave', this.gmHandleSave.bind(this));
    this.socket.register('gmHandleTreatment', this.gmHandleTreatment.bind(this));

    console.log('PF2e Afflictioner | Socket service initialized');
  }

  /**
   * Request GM to process save result
   */
  static async requestHandleSave(tokenId, afflictionId, saveTotal, dc) {
    if (!this.socket) return false;

    try {
      await this.socket.executeAsGM('gmHandleSave', tokenId, afflictionId, saveTotal, dc);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting save handling:', error);
      return false;
    }
  }

  /**
   * GM handler for processing save result
   */
  static async gmHandleSave(tokenId, afflictionId, saveTotal, dc) {
    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { AfflictionService } = await import('./AfflictionService.js');
    const AfflictionStoreModule = await import('../stores/AfflictionStore.js');

    const affliction = AfflictionStoreModule.getAffliction(token, afflictionId);
    if (!affliction) return;

    await AfflictionService.handleStageSave(token, affliction, saveTotal, dc);
  }

  /**
   * Request GM to process treatment result
   */
  static async requestHandleTreatment(tokenId, afflictionId, total, dc) {
    if (!this.socket) return false;

    try {
      await this.socket.executeAsGM('gmHandleTreatment', tokenId, afflictionId, total, dc);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting treatment handling:', error);
      return false;
    }
  }

  /**
   * GM handler for processing treatment result
   */
  static async gmHandleTreatment(tokenId, afflictionId, total, dc) {
    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { TreatmentService } = await import('./TreatmentService.js');
    const AfflictionStoreModule = await import('../stores/AfflictionStore.js');

    const affliction = AfflictionStoreModule.getAffliction(token, afflictionId);
    if (!affliction) return;

    await TreatmentService.handleTreatmentResult(token, affliction, total, dc);
  }

  /**
   * Request GM to remove an affliction (for non-GM users)
   */
  static async requestRemoveAffliction(tokenId, afflictionId) {
    if (!this.socket) {
      console.error('PF2e Afflictioner | Socket not initialized');
      return false;
    }

    try {
      await this.socket.executeAsGM('gmRemoveAffliction', tokenId, afflictionId);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting affliction removal:', error);
      return false;
    }
  }

  /**
   * GM handler for removing affliction
   */
  static async gmRemoveAffliction(tokenId, afflictionId) {
    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { MODULE_ID } = await import('../constants.js');
    const afflictions = { ...token.document.getFlag(MODULE_ID, 'afflictions') ?? {} };
    delete afflictions[afflictionId];

    const path = `flags.${MODULE_ID}.afflictions`;
    await token.document.update({ [path]: afflictions }, { diff: false });

    // Broadcast refresh to all clients
    await this.broadcastAfflictionChange(tokenId, '', 'removed');
  }

  /**
   * Request GM to update afflictions (for non-GM users)
   */
  static async requestUpdateAfflictions(tokenId, afflictions) {
    if (!this.socket) {
      console.error('PF2e Afflictioner | Socket not initialized');
      return false;
    }

    try {
      await this.socket.executeAsGM('gmUpdateAfflictions', tokenId, afflictions);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting affliction update:', error);
      return false;
    }
  }

  /**
   * GM handler for updating afflictions
   */
  static async gmUpdateAfflictions(tokenId, afflictions) {
    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { MODULE_ID } = await import('../constants.js');
    const path = `flags.${MODULE_ID}.afflictions`;
    await token.document.update({ [path]: afflictions }, { diff: false });

    // Broadcast refresh to all clients
    await this.broadcastAfflictionChange(tokenId, '', 'updated');
  }

  /**
   * Broadcast affliction indicator refresh to all clients
   */
  static async broadcastRefreshIndicators(tokenId) {
    if (!this.socket) return;

    try {
      await this.socket.executeForEveryone('refreshAfflictionIndicators', tokenId);
    } catch (error) {
      console.error('PF2e Afflictioner | Error broadcasting refresh:', error);
    }
  }

  /**
   * Handle refresh indicators message
   */
  static async refreshAfflictionIndicators(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (token) {
      VisualService.refreshTokenIndicator(token);
    }
  }

  /**
   * Broadcast affliction change notification
   */
  static async broadcastAfflictionChange(tokenId, afflictionName, type) {
    if (!this.socket) return;

    try {
      await this.socket.executeForEveryone('notifyAfflictionChange', tokenId, afflictionName, type);
    } catch (error) {
      console.error('PF2e Afflictioner | Error broadcasting notification:', error);
    }
  }

  /**
   * Handle affliction change notification
   */
  static async notifyAfflictionChange(tokenId, afflictionName, type) {
    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    // Refresh manager if open
    const { AfflictionManager } = await import('../managers/AfflictionManager.js');
    if (AfflictionManager.currentInstance) {
      AfflictionManager.currentInstance.render({ force: true });
    }
  }
}
