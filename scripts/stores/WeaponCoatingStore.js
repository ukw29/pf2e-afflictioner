import { MODULE_ID } from '../constants.js';

export function getCoatings(actor) {
  return actor.getFlag(MODULE_ID, 'weaponCoatings') || {};
}

export function getCoating(actor, weaponId) {
  return getCoatings(actor)[weaponId] || null;
}

export async function addCoating(actor, weaponId, coatingData) {
  const coatings = getCoatings(actor);
  coatings[weaponId] = coatingData;
  await actor.setFlag(MODULE_ID, 'weaponCoatings', coatings);
}

export async function removeCoating(actor, weaponId) {
  await actor.unsetFlag(MODULE_ID, `weaponCoatings.${weaponId}`);
}

export function getAllCoatingsOnCanvas() {
  const result = [];
  for (const token of canvas.tokens.placeables) {
    const actor = token.actor;
    if (!actor) continue;
    const coatings = getCoatings(actor);
    for (const [weaponId, coating] of Object.entries(coatings)) {
      result.push({
        actorId: actor.id,
        actorName: actor.name,
        weaponId,
        ...coating
      });
    }
  }
  return result;
}
