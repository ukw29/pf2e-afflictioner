import { MODULE_ID } from '../constants.js';
import * as AfflictionStore from '../stores/AfflictionStore.js';

export class VisualService {
  static async addAfflictionIndicator(token) {
    if (!game.settings.get(MODULE_ID, 'showVisualIndicators')) return;

    this.refreshTokenIndicator(token);
  }

  static async removeAfflictionIndicator(token) {
    const afflictions = AfflictionStore.getAfflictions(token);

    if (Object.keys(afflictions).length === 0) {
      this.refreshTokenIndicator(token);
    }
  }

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

  static async addIndicatorElement(token) {
    await token.document.setFlag(MODULE_ID, 'hasAffliction', true);

    if (!token.document.texture.tint) {
      await token.document.update({ 'texture.tint': '#ff000020' });
    }
  }

  static async removeIndicatorElement(token) {
    await token.document.unsetFlag(MODULE_ID, 'hasAffliction');

    if (token.document.texture.tint === '#ff000020') {
      await token.document.update({ 'texture.tint': null });
    }
  }

  static refreshAllIndicators() {
    if (!canvas.tokens) return;

    for (const token of canvas.tokens.placeables) {
      this.refreshTokenIndicator(token);
    }
  }
}

Hooks.on('refreshToken', (token) => {
  VisualService.refreshTokenIndicator(token);
});

Hooks.on('canvasReady', () => {
  VisualService.refreshAllIndicators();
});
