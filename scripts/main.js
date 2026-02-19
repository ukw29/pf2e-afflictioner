import { MODULE_ID } from './constants.js';
import { registerSettings } from './settings.js';
import { registerAfflictionHooks } from './hooks/registration.js';

Hooks.once('init', async () => {
  registerSettings();
  registerAfflictionHooks();

  const { api } = await import('./api.js');
  game.modules.get(MODULE_ID).api = api;

  console.log('PF2e Afflictioner | Initialized');
});

Hooks.once('ready', async () => {
  console.log('PF2e Afflictioner | Ready');

  const { SocketService } = await import('./services/SocketService.js');
  SocketService.initialize();

  const { StoryframeIntegrationService } = await import('./services/StoryframeIntegrationService.js');
  game.afflictioner = game.afflictioner || {};
  game.afflictioner.storyframeService = new StoryframeIntegrationService();

  setInterval(async () => {
    if (StoryframeIntegrationService.isAvailable()) {
      await game.afflictioner.storyframeService.pollResults();
    }
  }, 2000);

  if (game.user.isGM) {
    const { CommunityAfflictionsService } = await import('./services/CommunityAfflictionsService.js');
    await CommunityAfflictionsService.maybeImport();
  }

  if (game.user.isGM) {
    const { default: indicator } = await import('./ui/AfflictionMonitorIndicator.js');
    game.modules.get(MODULE_ID).indicator = indicator;

    Hooks.on('canvasReady', () => {
      indicator.refresh();
    });

    Hooks.on('updateToken', () => {
      indicator.refresh();
    });

    Hooks.on('updateCombat', () => {
      indicator.refresh();
    });

    Hooks.on('updateWorldTime', () => {
      indicator.refresh();
    });

    Hooks.on('controlToken', () => {
      indicator.refresh();
    });

    indicator.refresh();
  }
});
