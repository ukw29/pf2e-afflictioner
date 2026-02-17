/**
 * Hook Registration - Central registry for all module hooks
 *
 * This file orchestrates hook registration by importing modular hook handlers.
 * Individual hook implementations are in separate files for better organization.
 */

import { onDamageRoll } from './damage.js';
import { onCreateChatMessage } from './chat.js';
import { onCombatUpdate, onPf2eStartTurn } from './combat.js';
import { onWorldTimeUpdate } from './worldTime.js';
import { onRenderTokenHUD } from './tokenHUD.js';
import { onRenderChatMessage } from '../handlers/chatButtons.js';
import { onPreDeleteItem, onPreUpdateItem } from './conditions.js';

/**
 * Register all affliction hooks
 */
export function registerAfflictionHooks() {
  // Damage roll hook - detect poison/disease/curse items
  Hooks.on('pf2e.rollDamage', onDamageRoll);

  // Chat message creation - detect strikes with afflictions
  Hooks.on('createChatMessage', onCreateChatMessage);

  // Combat hooks
  Hooks.on('updateCombat', onCombatUpdate);

  // PF2e turn start - check for scheduled saves
  Hooks.on('pf2e.startTurn', onPf2eStartTurn);

  // World time tracking (out-of-combat)
  Hooks.on('updateWorldTime', onWorldTimeUpdate);

  // Token HUD
  Hooks.on('renderTokenHUD', onRenderTokenHUD);

  // Chat message rendering - add button handlers and drag support
  Hooks.on('renderChatMessage', onRenderChatMessage);

  // Condition deletion prevention - prevent manual removal of affliction-managed conditions
  Hooks.on('preDeleteItem', onPreDeleteItem);

  // Condition update prevention - prevent manual modification of affliction-managed conditions
  Hooks.on('preUpdateItem', onPreUpdateItem);

  console.log('PF2e Afflictioner | Hooks registered');
}
