/**
 * Public API for pf2e-afflictioner
 */

import * as AfflictionStore from './stores/AfflictionStore.js';
import { AfflictionService } from './services/AfflictionService.js';
import { TreatmentService } from './services/TreatmentService.js';
import { AfflictionParser } from './services/AfflictionParser.js';
import { AfflictionManager } from './managers/AfflictionManager.js';
import { VisualService } from './services/VisualService.js';

export class Pf2eAfflictionerApi {
  /**
   * Open the affliction manager UI
   * @param {Object} options
   * @param {string} options.filterTokenId - Optional token ID to filter by
   */
  static async openManager(options = {}) {
    if (AfflictionManager.currentInstance) {
      AfflictionManager.currentInstance.close();
    }

    new AfflictionManager(options).render(true);
  }

  /**
   * Get all afflictions for a token
   * @param {Token} token
   * @returns {Object}
   */
  static getAfflictions(token) {
    return AfflictionStore.getAfflictions(token);
  }

  /**
   * Get a specific affliction from a token
   * @param {Token} token
   * @param {string} afflictionId
   * @returns {Object|null}
   */
  static getAffliction(token, afflictionId) {
    return AfflictionStore.getAffliction(token, afflictionId);
  }

  /**
   * Add an affliction to a token
   * @param {Token} token
   * @param {Object} afflictionData
   */
  static async addAffliction(token, afflictionData) {
    await AfflictionStore.addAffliction(token, afflictionData);
    await VisualService.addAfflictionIndicator(token);
  }

  /**
   * Remove an affliction from a token
   * @param {Token} token
   * @param {string} afflictionId
   */
  static async removeAffliction(token, afflictionId) {
    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    const oldStageData = affliction?.stages[affliction.currentStage - 1];
    await AfflictionStore.removeAffliction(token, afflictionId);
    await AfflictionService.removeStageEffects(token, affliction, oldStageData, null);
    await VisualService.removeAfflictionIndicator(token);
  }

  /**
   * Update an affliction
   * @param {Token} token
   * @param {string} afflictionId
   * @param {Object} updates
   */
  static async updateAffliction(token, afflictionId, updates) {
    await AfflictionStore.updateAffliction(token, afflictionId, updates);
  }

  /**
   * Parse affliction from item
   * @param {Item} item
   * @returns {Object|null}
   */
  static parseAffliction(item) {
    return AfflictionParser.parseFromItem(item);
  }

  /**
   * Prompt initial save for affliction
   * @param {Token} token
   * @param {Object} afflictionData
   */
  static async promptInitialSave(token, afflictionData) {
    await AfflictionService.promptInitialSave(token, afflictionData);
  }

  /**
   * Prompt stage save for affliction
   * @param {Token} token
   * @param {Object} affliction
   */
  static async promptSave(token, affliction) {
    await AfflictionService.promptSave(token, affliction);
  }

  /**
   * Prompt treatment for affliction
   * @param {Token} token
   * @param {Object} affliction
   */
  static async promptTreatment(token, affliction) {
    await TreatmentService.promptTreatment(token, affliction);
  }

  /**
   * Get all tokens with afflictions in current scene
   * @returns {Array}
   */
  static getTokensWithAfflictions() {
    return AfflictionStore.getTokensWithAfflictions();
  }

  /**
   * Refresh all visual indicators
   */
  static refreshAllIndicators() {
    VisualService.refreshAllIndicators();
  }
}

// Export as api
export const api = Pf2eAfflictionerApi;
