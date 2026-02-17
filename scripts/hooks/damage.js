/**
 * Damage Roll Hook - Detects afflictions when damage is rolled
 */

import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';

/**
 * Handle damage rolls - detect afflictions
 */
export async function onDamageRoll(item, rollData) {
  // Check if auto-detection is enabled
  if (!game.settings.get('pf2e-afflictioner', 'autoDetectAfflictions')) return;

  // Parse affliction from item
  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  // Get target tokens
  const targets = Array.from(game.user.targets);
  if (!targets.length) return;

  // Prompt initial saves for all targets
  for (const target of targets) {
    await AfflictionService.promptInitialSave(target, afflictionData);
  }
}
