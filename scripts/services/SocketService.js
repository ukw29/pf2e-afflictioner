/**
 * Socket Service - Cross-client sync via socketlib
 */

import { MODULE_ID, DEGREE_OF_SUCCESS } from '../constants.js';
import { VisualService } from './VisualService.js';
import { AfflictionService } from './AfflictionService.js';

export class SocketService {
  static socket = null;

  /**
   * Convert DEGREE_OF_SUCCESS constant to string key for UI
   */
  static degreeToString(degree) {
    const map = {
      [DEGREE_OF_SUCCESS.CRITICAL_SUCCESS]: 'criticalSuccess',
      [DEGREE_OF_SUCCESS.SUCCESS]: 'success',
      [DEGREE_OF_SUCCESS.FAILURE]: 'failure',
      [DEGREE_OF_SUCCESS.CRITICAL_FAILURE]: 'criticalFailure'
    };
    return map[degree] || 'failure';
  }

  /**
   * Initialize socket communication
   */
  static initialize() {
    // Check if socketlib is available
    if (!game.modules.get('socketlib')?.active) {
      return;
    }

    this.socket = socketlib.registerModule(MODULE_ID);

    // Register socket handlers
    this.socket.register('refreshAfflictionIndicators', this.refreshAfflictionIndicators.bind(this));
    this.socket.register('notifyAfflictionChange', this.notifyAfflictionChange.bind(this));
    this.socket.register('gmRemoveAffliction', this.gmRemoveAffliction.bind(this));
    this.socket.register('gmUpdateAfflictions', this.gmUpdateAfflictions.bind(this));
    this.socket.register('gmHandleSave', this.gmHandleSave.bind(this));
    this.socket.register('gmHandleInitialSave', this.gmHandleInitialSave.bind(this));
    this.socket.register('gmHandleTreatment', this.gmHandleTreatment.bind(this));
    this.socket.register('gmHandleCounteract', this.gmHandleCounteract.bind(this));
    this.socket.register('gmApplySaveConsequences', this.gmApplySaveConsequences.bind(this));
    this.socket.register('unlockSaveButton', this.handleUnlockSaveButton.bind(this));
    this.socket.register('syncButtonState', this.handleSyncButtonState.bind(this));

    // Register PF2e-specific reroll hooks (preReroll captures old message before deletion)
    const preRerollHookId = Hooks.on('pf2e.preReroll', this.onPf2ePreReroll.bind(this));
    const rerollHookId = Hooks.on('pf2e.reroll', this.onPf2eReroll.bind(this));

  }

  /**
   * Request GM to process save result
   */
  static async requestHandleSave(tokenId, afflictionId, rollMessageId, dc) {
    if (!this.socket) return false;

    try {
      await this.socket.executeAsGM('gmHandleSave', tokenId, afflictionId, rollMessageId, dc);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting save handling:', error);
      return false;
    }
  }

  /**
   * GM handler for processing save result
   */
  static async gmHandleSave(tokenId, afflictionId, rollMessageId, dc) {

    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { AfflictionService } = await import('./AfflictionService.js');
    const AfflictionStoreModule = await import('../stores/AfflictionStore.js');

    const affliction = AfflictionStoreModule.getAffliction(token, afflictionId);
    if (!affliction) return;

    // Check if confirmation is required
    const { MODULE_ID } = await import('../constants.js');
    const requireConfirmation = game.settings.get(MODULE_ID, 'requireSaveConfirmation');

    if (requireConfirmation) {
      // Add flag to roll message to trigger button injection in renderChatMessage hook
      const rollMessage = game.messages.get(rollMessageId);
      if (rollMessage) {
        await rollMessage.update({
          'flags.pf2e-afflictioner.needsConfirmation': true,
          'flags.pf2e-afflictioner.tokenId': tokenId,
          'flags.pf2e-afflictioner.afflictionId': afflictionId,
          'flags.pf2e-afflictioner.saveType': 'stage',
          'flags.pf2e-afflictioner.dc': dc
        });
      }
    } else {
      // Apply immediately - read current result from message
      // Add small delay to ensure message is fully created
      await new Promise(resolve => setTimeout(resolve, 150));
      const message = game.messages.get(rollMessageId);
      const saveTotal = await this.getCurrentRollTotal(rollMessageId);
      const dieValue = AfflictionService.getDieValue(message);
      if (saveTotal !== null) {
        await AfflictionService.handleStageSave(token, affliction, saveTotal, dc, false, dieValue);
      } else {
        console.error('PF2e Afflictioner | Failed to read save result for immediate application');
      }
    }
  }

  /**
   * Request GM to process initial save result
   */
  static async requestHandleInitialSave(tokenId, afflictionId, rollMessageId, dc) {
    if (!this.socket) return false;

    try {
      await this.socket.executeAsGM('gmHandleInitialSave', tokenId, afflictionId, rollMessageId, dc);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting initial save handling:', error);
      return false;
    }
  }

  /**
   * GM handler for processing initial save result
   */
  static async gmHandleInitialSave(tokenId, afflictionId, rollMessageId, dc) {

    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { AfflictionService } = await import('./AfflictionService.js');
    const AfflictionStoreModule = await import('../stores/AfflictionStore.js');

    const affliction = AfflictionStoreModule.getAffliction(token, afflictionId);
    if (!affliction) return;

    // Check if confirmation is required
    const { MODULE_ID } = await import('../constants.js');
    const requireConfirmation = game.settings.get(MODULE_ID, 'requireSaveConfirmation');

    if (requireConfirmation) {
      // Add flag to roll message to trigger button injection in renderChatMessage hook
      const rollMessage = game.messages.get(rollMessageId);
      if (rollMessage) {
        await rollMessage.update({
          'flags.pf2e-afflictioner.needsConfirmation': true,
          'flags.pf2e-afflictioner.tokenId': tokenId,
          'flags.pf2e-afflictioner.afflictionId': afflictionId,
          'flags.pf2e-afflictioner.saveType': 'initial',
          'flags.pf2e-afflictioner.dc': dc
        });
      }
    } else {
      // Apply immediately - read current result from message
      // Add small delay to ensure message is fully created
      await new Promise(resolve => setTimeout(resolve, 150));
      const message = game.messages.get(rollMessageId);
      const saveTotal = await this.getCurrentRollTotal(rollMessageId);
      const dieValue = AfflictionService.getDieValue(message);
      if (saveTotal !== null) {
        await AfflictionService.handleInitialSave(token, affliction, saveTotal, dc, dieValue);
      } else {
        console.error('PF2e Afflictioner | Failed to read save result for immediate application');
      }
    }
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
   * Request GM to process counteract result
   */
  static async requestHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree) {
    if (!this.socket) return false;

    try {
      await this.socket.executeAsGM('gmHandleCounteract', tokenId, afflictionId, counteractRank, afflictionRank, degree);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting counteract handling:', error);
      return false;
    }
  }

  /**
   * GM handler for processing counteract result
   */
  static async gmHandleCounteract(tokenId, afflictionId, counteractRank, afflictionRank, degree) {
    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { CounteractService } = await import('./CounteractService.js');
    const AfflictionStoreModule = await import('../stores/AfflictionStore.js');

    const affliction = AfflictionStoreModule.getAffliction(token, afflictionId);
    if (!affliction) return;

    await CounteractService.handleCounteractResult(token, affliction, counteractRank, afflictionRank, degree);
  }

  /**
   * Post a save confirmation button to chat
   */
  static async postSaveConfirmation(token, affliction, rollMessageId, dc, saveType) {
    // Read current result from the roll message (in case of rerolls)
    const message = game.messages.get(rollMessageId);
    if (!message) {
      console.error('PF2e Afflictioner | Message not found for confirmation');
      return;
    }

    const saveTotal = await this.getCurrentRollTotal(rollMessageId);
    if (saveTotal === null) {
      console.error('PF2e Afflictioner | Could not read roll total from message');
      return;
    }

    // Get die value for nat 1/20 handling
    const dieValue = AfflictionService.getDieValue(message);

    const degreeConstant = AfflictionService.calculateDegreeOfSuccess(saveTotal, dc, dieValue);
    const degree = this.degreeToString(degreeConstant);

    const degreeText = {
      'criticalSuccess': 'Critical Success',
      'success': 'Success',
      'failure': 'Failure',
      'criticalFailure': 'Critical Failure'
    }[degree];

    const degreeColor = {
      'criticalSuccess': '#4a7c2a',
      'success': '#5a8c3a',
      'failure': '#c45500',
      'criticalFailure': '#8b0000'
    }[degree];

    const saveTypeLabel = saveType === 'initial' ? 'Initial Save' : 'Stage Save';

    const content = `
      <div class="pf2e-afflictioner-save-confirmation" style="border-left: 5px solid ${degreeColor}; padding: 12px; background: rgba(0,0,0,0.1); border-radius: 4px; margin: 8px 0;">
        <h3 style="margin: 0 0 8px 0;"><i class="fas fa-biohazard"></i> ${affliction.name} - ${saveTypeLabel}</h3>
        <p style="margin: 4px 0;"><strong>${token.name}</strong> rolled <strong>${saveTotal}</strong> vs DC ${dc}</p>
        <p style="margin: 4px 0; color: ${degreeColor}; font-weight: bold;">Result: ${degreeText}</p>
        <p style="margin: 8px 0 4px 0; font-size: 0.9em; font-style: italic; color: #ccc;">Awaiting confirmation to apply consequences...</p>
        <p style="margin: 4px 0; font-size: 0.85em; color: #999;">If rerolled, click will use latest result</p>
        <button class="affliction-confirm-save"
                data-token-id="${token.id}"
                data-affliction-id="${affliction.id}"
                data-roll-message-id="${rollMessageId}"
                data-dc="${dc}"
                data-save-type="${saveType}"
                style="width: 100%; padding: 8px; margin-top: 10px; background: ${degreeColor}; border: 2px solid ${degreeColor}; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">
          <i class="fas fa-check"></i> Apply Consequences
        </button>
      </div>
    `;

    const confirmMsg = await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ token: token }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      flags: {
        'pf2e-afflictioner': {
          isConfirmation: true,
          rollMessageId: rollMessageId,
          tokenId: token.id,
          afflictionId: affliction.id,
          afflictionName: affliction.name,
          saveType: saveType,
          dc: dc
        }
      }
    });

  }

  /**
   * Get the current roll total from a chat message (handles rerolls)
   */
  static async getCurrentRollTotal(messageId) {
    if (!messageId) {
      return null;
    }

    const message = game.messages.get(messageId);
    if (!message) {
      return null;
    }

    // Try multiple methods to extract the roll total
    let total = null;

    // Method 1: Standard rolls array
    const roll = message.rolls?.[0];
    if (roll?.total !== undefined) {
      total = roll.total;
      return total;
    }

    // Method 2: PF2e flags (some messages store total here)
    if (message.flags?.pf2e?.context?.rollTotal !== undefined) {
      total = message.flags.pf2e.context.rollTotal;
      return total;
    }

    // Method 3: Parse from content HTML
    if (message.content) {
      // Look for result-total class (PF2e v11+)
      const match = message.content.match(/class="result-total[^"]*">(\d+)</);
      if (match) {
        total = parseInt(match[1]);
        return total;
      }
    }

    // If all methods fail, log detailed info for debugging
    console.error('PF2e Afflictioner | Could not extract roll total from message:', {
      messageId,
      hasRolls: !!message.rolls?.length,
      rolls: message.rolls,
      flags: message.flags?.pf2e,
      contentPreview: message.content?.substring(0, 300)
    });
    return null;
  }

  /**
   * Request GM to apply save consequences after confirmation
   */
  static async requestApplySaveConsequences(tokenId, afflictionId, rollMessageId, dc, saveType) {
    if (!this.socket) return false;

    try {
      await this.socket.executeAsGM('gmApplySaveConsequences', tokenId, afflictionId, rollMessageId, dc, saveType);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error requesting save consequence application:', error);
      return false;
    }
  }

  /**
   * GM handler for applying save consequences
   */
  static async gmApplySaveConsequences(tokenId, afflictionId, rollMessageId, dc, saveType) {

    if (!game.user.isGM) return;

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const { AfflictionService } = await import('./AfflictionService.js');
    const AfflictionStoreModule = await import('../stores/AfflictionStore.js');

    const affliction = AfflictionStoreModule.getAffliction(token, afflictionId);
    if (!affliction) return;

    // Read current result from message (captures rerolls)
    // Add small delay to ensure any recent rerolls are fully processed
    await new Promise(resolve => setTimeout(resolve, 100));

    const saveTotal = await this.getCurrentRollTotal(rollMessageId);

    if (saveTotal === null) {
      ui.notifications.error('Could not read roll result from message');
      console.error('PF2e Afflictioner | Failed to read save result from message ID:', rollMessageId);

      // Try to get the message and log its full structure
      const msg = game.messages.get(rollMessageId);
      if (msg) {
        console.error('PF2e Afflictioner | Message exists but no roll total. Full message:', msg);
        console.error('PF2e Afflictioner | Message.rolls:', msg.rolls);
        console.error('PF2e Afflictioner | Message.flags:', msg.flags);
      } else {
        console.error('PF2e Afflictioner | Message not found in game.messages');
      }
      return;
    }

    // Get die value for nat 1/20 handling
    const message = game.messages.get(rollMessageId);
    const dieValue = AfflictionService.getDieValue(message);

    if (saveType === 'initial') {
      await AfflictionService.handleInitialSave(token, affliction, saveTotal, dc, dieValue);
    } else {
      await AfflictionService.handleStageSave(token, affliction, saveTotal, dc, false, dieValue);
    }
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
  static async notifyAfflictionChange(tokenId, _afflictionName, _type) {
    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    // Refresh manager if open
    const { AfflictionManager } = await import('../managers/AfflictionManager.js');
    if (AfflictionManager.currentInstance) {
      AfflictionManager.currentInstance.render({ force: true });
    }
  }

  /**
   * Handle PF2e pre-reroll event (captures old message before deletion)
   */
  static async onPf2ePreReroll(oldRoll, ...args) {

    // Only GMs need to track this
    if (!game.user.isGM) return;

    // Try to find message by messageId on the roll options first (most reliable)
    // Fall back to roll total matching
    const messageId = oldRoll?.options?.messageId || oldRoll?.messageId;
    let oldMessage = messageId ? game.messages.get(messageId) : null;
    if (!oldMessage) {
      const recentMessages = game.messages.contents.slice(-20);
      oldMessage = recentMessages.find(msg =>
        msg.rolls?.some(r => r === oldRoll || r.total === oldRoll?.total)
      );
    }

    if (!oldMessage) {
      return;
    }

    // Store the old message ID (use simple property since rerolls happen sequentially)
    this._lastRerollOldMessageId = oldMessage.id;

    // Also store the confirmation flags if they exist (to copy to new message after reroll)
    if (oldMessage.flags?.['pf2e-afflictioner']?.needsConfirmation) {
      this._lastRerollConfirmationFlags = {
        needsConfirmation: true,
        tokenId: oldMessage.flags['pf2e-afflictioner'].tokenId,
        afflictionId: oldMessage.flags['pf2e-afflictioner'].afflictionId,
        saveType: oldMessage.flags['pf2e-afflictioner'].saveType,
        dc: oldMessage.flags['pf2e-afflictioner'].dc
      };
    }

    // For counteract flags: register a createChatMessage hook to reliably catch the new message
    if (oldMessage.flags?.['pf2e-afflictioner']?.needsCounteractConfirmation) {
      const counteractFlags = { ...oldMessage.flags['pf2e-afflictioner'] };
      const speakerActorId = oldMessage.speaker?.actor;
      Hooks.once('createChatMessage', async (newMsg) => {
        // Only copy if from same actor (the reroll)
        if (!speakerActorId || newMsg.speaker?.actor === speakerActorId || newMsg.actor?.id === speakerActorId) {
          await newMsg.update({ 'flags.pf2e-afflictioner': counteractFlags });
        }
      });
    }

  }

  /**
   * Handle PF2e reroll event
   * @param {CheckRoll} oldRoll - The original roll before reroll
   * @param {CheckRoll} newRoll - The new roll after reroll
   * @param {*} arg2 - Unknown parameter
   * @param {string} rerollMode - 'lower', 'higher', etc.
   */
  static async onPf2eReroll(oldRoll, newRoll, arg2, rerollMode) {
    // Only GMs need to update confirmation messages
    if (!game.user.isGM) return;

    // Get the old message ID that was stored in preReroll
    const oldMessageId = this._lastRerollOldMessageId;
    if (!oldMessageId) {
      return;
    }


    // Wait for new message to be created
    await new Promise(resolve => setTimeout(resolve, 200));

    // Find the NEW message - try messageId first, then fall back to total matching
    const newMessageId = newRoll?.options?.messageId || newRoll?.messageId;
    let newMessage = newMessageId ? game.messages.get(newMessageId) : null;
    if (!newMessage) {
      const recentMessages = game.messages.contents.slice(-20);
      newMessage = recentMessages.find(msg =>
        msg.id !== oldMessageId && msg.rolls?.some(r => r === newRoll || r.total === newRoll?.total)
      );
    }

    if (!newMessage) {
      return;
    }


    // If old message had confirmation flags, copy them to new message
    if (this._lastRerollConfirmationFlags) {
      await newMessage.update({
        'flags.pf2e-afflictioner': this._lastRerollConfirmationFlags
      });
      this._lastRerollConfirmationFlags = null;
    }

    // Note: counteract flags are copied via Hooks.once('createChatMessage') in onPf2ePreReroll

    // Clean up tracking
    this._lastRerollOldMessageId = null;
  }

  /**
   * Update a confirmation message with new roll result
   */
  static async updateConfirmationMessage(confirmationMessage, rollMessage) {
    const flags = confirmationMessage.flags['pf2e-afflictioner'];
    const { tokenId, afflictionId, afflictionName, saveType, dc } = flags;

    // Get new roll total using the robust extraction method
    const saveTotal = await this.getCurrentRollTotal(rollMessage.id);
    if (saveTotal === null) {
      return;
    }

    // Get die value for nat 1/20 handling
    const dieValue = AfflictionService.getDieValue(rollMessage);

    const degreeConstant = AfflictionService.calculateDegreeOfSuccess(saveTotal, dc, dieValue);
    const degree = this.degreeToString(degreeConstant);

    const degreeText = {
      'criticalSuccess': 'Critical Success',
      'success': 'Success',
      'failure': 'Failure',
      'criticalFailure': 'Critical Failure'
    }[degree];

    const degreeColor = {
      'criticalSuccess': '#4a7c2a',
      'success': '#5a8c3a',
      'failure': '#c45500',
      'criticalFailure': '#8b0000'
    }[degree];

    const saveTypeLabel = saveType === 'initial' ? 'Initial Save' : 'Stage Save';
    const token = canvas.tokens.get(tokenId);

    const newContent = `
      <div class="pf2e-afflictioner-save-confirmation" style="border-left: 5px solid ${degreeColor}; padding: 12px; background: rgba(0,0,0,0.1); border-radius: 4px; margin: 8px 0;">
        <h3 style="margin: 0 0 8px 0;"><i class="fas fa-biohazard"></i> ${afflictionName} - ${saveTypeLabel}</h3>
        <p style="margin: 4px 0;"><strong>${token?.name || 'Token'}</strong> rolled <strong>${saveTotal}</strong> vs DC ${dc}</p>
        <p style="margin: 4px 0; color: ${degreeColor}; font-weight: bold;">Result: ${degreeText}</p>
        <p style="margin: 8px 0 4px 0; font-size: 0.9em; font-style: italic; color: #ccc;">Awaiting confirmation to apply consequences...</p>
        <p style="margin: 4px 0; font-size: 0.85em; color: #ffa500;">✨ Updated from reroll</p>
        <button class="affliction-confirm-save"
                data-token-id="${tokenId}"
                data-affliction-id="${afflictionId}"
                data-roll-message-id="${flags.rollMessageId}"
                data-dc="${dc}"
                data-save-type="${saveType}"
                style="width: 100%; padding: 8px; margin-top: 10px; background: ${degreeColor}; border: 2px solid ${degreeColor}; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">
          <i class="fas fa-check"></i> Apply Consequences
        </button>
      </div>
    `;

    await confirmationMessage.update({ content: newContent });
  }

  /**
   * Request unlock of a save button for all users (delegates to syncButtonState)
   */
  static async unlockSaveButton(messageId, buttonClass) {
    // Just call syncButtonState with false (enabled)
    return await this.syncButtonState(messageId, buttonClass, false);
  }

  /**
   * Handle unlock save button for all users (delegates to handleSyncButtonState)
   */
  static async handleUnlockSaveButton(messageId, buttonClass) {
    // Delegate to the unified sync handler
    await this.handleSyncButtonState(messageId, buttonClass, false);
    ui.notifications.info('Save button unlocked');
  }

  /**
   * Sync button state across all clients
   */
  static async syncButtonState(messageId, buttonClass, disabled) {

    if (!this.socket) {
      console.error('PF2e Afflictioner | Socket not initialized');
      return false;
    }

    try {
      await this.socket.executeForEveryone('syncButtonState', messageId, buttonClass, disabled);
      return true;
    } catch (error) {
      console.error('PF2e Afflictioner | Error syncing button state:', error);
      return false;
    }
  }

  /**
   * Handle button state sync for all users
   */
  static async handleSyncButtonState(messageId, buttonClass, disabled) {

    if (!messageId || !buttonClass) {
      return;
    }

    // Find the chat container (try multiple methods for compatibility)
    let chatLog = document.getElementById('chat-log');
    if (!chatLog) {
      chatLog = document.querySelector('#chat .chat-log');
    }
    if (!chatLog && ui.chat?.element) {
      chatLog = ui.chat.element[0] || ui.chat.element;
    }

    if (!chatLog) {
      console.error('PF2e Afflictioner | Could not find chat element');
      return;
    }

    const messageElements = chatLog.querySelectorAll(`[data-message-id="${messageId}"]`);

    if (!messageElements.length) return;

    messageElements.forEach((msgElement, index) => {
      const button = msgElement.querySelector(`.${buttonClass}`);

      if (!button) {
        return;
      }


      // Set disabled state
      button.disabled = disabled;
      button.style.opacity = disabled ? '0.6' : '1';

      if (disabled && game.user.isGM) {
        // Add unlock button for GMs when button is disabled
        if (!button.nextElementSibling?.classList.contains('affliction-unlock-save')) {
          // Wrap button in relative container if not already wrapped
          let container = button.parentElement;
          if (!container.classList.contains('affliction-button-wrapper')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'affliction-button-wrapper';
            wrapper.style.cssText = 'position: relative; display: inline-block; width: 100%;';
            button.parentElement.insertBefore(wrapper, button);
            wrapper.appendChild(button);
            container = wrapper;
          }

          const unlockBtn = document.createElement('button');
          unlockBtn.className = 'affliction-unlock-save';
          unlockBtn.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; margin: 0; padding: 0; background: linear-gradient(135deg, rgb(180, 145, 0) 0%, rgb(140, 110, 0) 100%); border: 2px dashed #ffd700; color: #ffd700; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 3px 8px rgba(0,0,0,0.4), 0 0 15px rgba(255,215,0,0.5); transition: all 0.2s ease; z-index: 5; display: flex; align-items: center; justify-content: center;';
          unlockBtn.innerHTML = '<i class="fas fa-unlock-alt"></i> Unlock';

          unlockBtn.addEventListener('mouseenter', () => {
            unlockBtn.style.background = 'linear-gradient(135deg, rgb(200, 165, 0) 0%, rgb(160, 130, 0) 100%)';
            unlockBtn.style.transform = 'scale(1.01)';
            unlockBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5), 0 0 25px rgba(255,215,0,0.6)';
          });

          unlockBtn.addEventListener('mouseleave', () => {
            unlockBtn.style.background = 'linear-gradient(135deg, rgb(180, 145, 0) 0%, rgb(140, 110, 0) 100%)';
            unlockBtn.style.transform = 'scale(1)';
            unlockBtn.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4), 0 0 15px rgba(255,215,0,0.5)';
          });

          unlockBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await SocketService.syncButtonState(messageId, buttonClass, false);
          });

          // Add to container (completely overlays the button)
          container.appendChild(unlockBtn);
        }
      } else if (!disabled) {
        // Remove unlock button when re-enabled
        const unlockBtn = button.nextElementSibling;
        if (unlockBtn?.classList.contains('affliction-unlock-save')) {
          unlockBtn.remove();
        }
      }
    });
  }
}
