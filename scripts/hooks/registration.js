import { onDamageRoll } from './damage.js';
import { onCreateChatMessage } from './chat.js';
import { onCombatUpdate, onPf2eStartTurn } from './combat.js';
import { onWorldTimeUpdate } from './worldTime.js';
import { onRenderTokenHUD } from './tokenHUD.js';
import { onRenderChatMessage } from '../handlers/chatButtons.js';
import { onPreUpdateItem } from './conditions.js';

export function registerAfflictionHooks() {
  Hooks.on('pf2e.rollDamage', onDamageRoll);
  Hooks.on('createChatMessage', onCreateChatMessage);
  Hooks.on('updateCombat', onCombatUpdate);
  Hooks.on('pf2e.startTurn', onPf2eStartTurn);
  Hooks.on('updateWorldTime', onWorldTimeUpdate);
  Hooks.on('renderTokenHUD', onRenderTokenHUD);
  Hooks.on('renderChatMessage', onRenderChatMessage);
  Hooks.on('preUpdateItem', onPreUpdateItem);

  console.log('PF2e Afflictioner | Hooks registered');
}
