/**
 * Visual Service - Token indicators for afflictions
 */

import { MODULE_ID } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export class VisualService {
  /**
   * Add affliction indicator to token
   */
  static async addAfflictionIndicator(token) {
    if (!game.settings.get(MODULE_ID, 'showVisualIndicators')) return;

    // Add indicator to token HUD
    this.refreshTokenIndicator(token);
  }

  /**
   * Remove affliction indicator from token
   */
  static async removeAfflictionIndicator(token) {
    const afflictions = AfflictionStore.getAfflictions(token);

    // Only remove if no more afflictions
    if (Object.keys(afflictions).length === 0) {
      this.refreshTokenIndicator(token);
    }
  }

  /**
   * Refresh indicator for a token
   */
  static refreshTokenIndicator(token) {
    if (!game.settings.get(MODULE_ID, 'showVisualIndicators')) {
      this.removeIndicatorElement(token);
      return;
    }

    const afflictions = AfflictionStore.getAfflictions(token);
    const hasAfflictions = Object.keys(afflictions).length > 0;

    if (hasAfflictions) {
      this.addIndicatorElement(token);
    } else {
      this.removeIndicatorElement(token);
    }
  }

  /**
   * Add indicator DOM element (using token tint for now - simpler approach)
   */
  static async addIndicatorElement(token) {
    // Use token document flag to indicate affliction
    // The visual will be handled by CSS on the token HUD icon being active
    await token.document.setFlag(MODULE_ID, 'hasAffliction', true);

    // Alternative: Apply a subtle tint to the token
    if (!token.document.texture.tint) {
      await token.document.update({ 'texture.tint': '#ff000020' }); // Very subtle red tint
    }
  }

  /**
   * Remove indicator DOM element
   */
  static async removeIndicatorElement(token) {
    await token.document.unsetFlag(MODULE_ID, 'hasAffliction');

    // Remove tint if it was applied by us
    if (token.document.texture.tint === '#ff000020') {
      await token.document.update({ 'texture.tint': null });
    }
  }

  /**
   * Refresh all token indicators on canvas
   */
  static refreshAllIndicators() {
    if (!canvas.tokens) return;

    for (const token of canvas.tokens.placeables) {
      this.refreshTokenIndicator(token);
    }
  }
}

// Hook into token refresh to maintain indicators
Hooks.on('refreshToken', (token) => {
  VisualService.refreshTokenIndicator(token);
});

// Refresh all indicators when canvas is ready
Hooks.on('canvasReady', () => {
  VisualService.refreshAllIndicators();
});
