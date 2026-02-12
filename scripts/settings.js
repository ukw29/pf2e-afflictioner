/**
 * Settings registration
 */

import { MODULE_ID, DEFAULT_SETTINGS } from './constants.js';

export function registerSettings() {
  // Register all settings
  Object.entries(DEFAULT_SETTINGS).forEach(([key, config]) => {
    game.settings.register(MODULE_ID, key, config);
  });

  console.log('PF2e Afflictioner | Settings registered');
}
