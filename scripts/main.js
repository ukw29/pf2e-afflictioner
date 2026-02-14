/**
 * PF2e Afflictioner - Main entry point
 */

import { MODULE_ID } from './constants.js';
import { registerSettings } from './settings.js';
import { registerAfflictionHooks } from './hooks/registration.js';

Hooks.once('init', async () => {
  // Register settings
  registerSettings();

  // Register hooks
  registerAfflictionHooks();

  // Set up API
  const { api } = await import('./api.js');
  game.modules.get(MODULE_ID).api = api;

  console.log('PF2e Afflictioner | Initialized');
});

Hooks.once('ready', async () => {
  console.log('PF2e Afflictioner | Ready');

  // Initialize socket service for cross-client sync
  const { SocketService } = await import('./services/SocketService.js');
  SocketService.initialize();

  // Initialize monitor indicator for GMs
  if (game.user.isGM) {
    const { default: indicator } = await import('./ui/AfflictionMonitorIndicator.js');
    game.modules.get(MODULE_ID).indicator = indicator;

    // Refresh on canvas ready
    Hooks.on('canvasReady', () => {
      indicator.refresh();
    });

    // Refresh when tokens update
    Hooks.on('updateToken', () => {
      indicator.refresh();
    });

    // Refresh when combat updates
    Hooks.on('updateCombat', () => {
      indicator.refresh();
    });

    // Refresh when world time updates
    Hooks.on('updateWorldTime', () => {
      indicator.refresh();
    });

    // Refresh when token selection changes
    Hooks.on('controlToken', () => {
      indicator.refresh();
    });

    // Initial refresh
    indicator.refresh();
  }
});
