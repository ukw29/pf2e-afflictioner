import { onDamageRoll } from './damage.js';
import { onCreateChatMessage } from './chat.js';
import { onCombatUpdate, onPf2eStartTurn } from './combat.js';
import { onWorldTimeUpdate } from './worldTime.js';
import { onRenderTokenHUD } from './tokenHUD.js';
import { onRenderChatMessage } from '../handlers/chatButtons.js';
import { onPreUpdateItem } from './conditions.js';
import { onGetSceneControlButtons, onRenderSceneControls, onControlToken } from './tokenTools.js';

export function registerAfflictionHooks() {
  Hooks.on('pf2e.rollDamage', onDamageRoll);
  Hooks.on('createChatMessage', onCreateChatMessage);
  Hooks.on('updateCombat', onCombatUpdate);
  Hooks.on('pf2e.startTurn', onPf2eStartTurn);
  Hooks.on('updateWorldTime', onWorldTimeUpdate);
  Hooks.on('renderTokenHUD', onRenderTokenHUD);
  Hooks.on('renderChatMessage', onRenderChatMessage);
  Hooks.on('preUpdateItem', onPreUpdateItem);
  Hooks.on('getSceneControlButtons', onGetSceneControlButtons);
  Hooks.on('renderSceneControls', onRenderSceneControls);
  Hooks.on('controlToken', onControlToken);

  console.log('PF2e Afflictioner | Hooks registered');
}
