import { AfflictionService } from '../services/AfflictionService.js';
import { AfflictionParser } from '../services/AfflictionParser.js';

export async function onDamageRoll(item, rollData) {
  if (!game.settings.get('pf2e-afflictioner', 'autoDetectAfflictions')) return;

  const afflictionData = AfflictionParser.parseFromItem(item);
  if (!afflictionData) return;

  const targets = Array.from(game.user.targets);
  if (!targets.length) return;

  for (const target of targets) {
    await AfflictionService.promptInitialSave(target, afflictionData);
  }
}
