/**
 * Combat Hooks - Handle combat updates and turn management
 */

import { AfflictionService } from '../services/AfflictionService.js';
import { ConditionStackingService } from '../services/ConditionStackingService.js';

/**
 * Handle combat updates - check for scheduled saves and update timers
 */
export async function onCombatUpdate(combat, changed, options, userId) {
  // Only check on turn/round changes
  if (!changed.turn && !changed.round) return;

  // Handle round advancement - update timers for all afflicted tokens
  if (changed.round) {
    for (const combatant of combat.combatants) {
      const token = canvas.tokens.get(combatant.tokenId);
      if (!token) continue;

      // Update onset timers
      await AfflictionService.updateOnsetTimers(token, combat);

      // Check durations
      await AfflictionService.checkDurations(token, combat);

      // Cleanup expired condition instances
      if (token.actor) {
        await ConditionStackingService.cleanupExpiredInstances(
          token.actor,
          combat.round,
          combat.combatant?.initiative,
          null
        );
      }
    }
  }

  // Note: Save checking is now handled by pf2e.startTurn hook (see onPf2eStartTurn)
  // This is more reliable than trying to detect turn changes from updateCombat
}

/**
 * Handle PF2e turn start - check for scheduled saves
 */
export async function onPf2eStartTurn(_combatant, _encounter, _userId) {
  const combat = game.combat;
  if (!combat) return;

  // Check saves for all combatants
  for (const c of combat.combatants) {
    const token = canvas.tokens.get(c.tokenId);
    if (!token) continue;

    await AfflictionService.checkForScheduledSaves(token, combat);
  }
}
