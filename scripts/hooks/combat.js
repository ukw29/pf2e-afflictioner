import { AfflictionService } from '../services/AfflictionService.js';

export async function onCombatUpdate(combat, changed, options, userId) {
  if (!game.user.isGM) return;
  if (!changed.turn && !changed.round) return;

  if (changed.round) {
    for (const combatant of combat.combatants) {
      const token = canvas.tokens.get(combatant.tokenId);
      if (!token) continue;

      await AfflictionService.updateOnsetTimers(token, combat);
      await AfflictionService.checkDurations(token, combat);
    }
  }
}

export async function onPf2eStartTurn(_combatant, _encounter, _userId) {
  if (!game.user.isGM) return;
  const combat = game.combat;
  if (!combat) return;

  for (const c of combat.combatants) {
    const token = canvas.tokens.get(c.tokenId);
    if (!token) continue;

    await AfflictionService.checkForScheduledSaves(token, combat);
  }
}
