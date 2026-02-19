import { MODULE_ID } from '../constants.js';

export function getAfflictions(token) {
  const afflictions = token?.document.getFlag(MODULE_ID, 'afflictions') ?? {};
  return afflictions;
}

export async function setAfflictions(token, afflictions) {
  if (!token?.document) {
    console.error('AfflictionStore: No token document');
    return;
  }

  if (!game.user.isGM) {
    console.error('AfflictionStore: Non-GM user attempted to set afflictions');
    ui.notifications.error('Only GMs can manage afflictions');
    return;
  }

  await token.document.setFlag(MODULE_ID, 'afflictions', afflictions);
}

export function getAffliction(token, afflictionId) {
  const afflictions = getAfflictions(token);
  return afflictions[afflictionId] || null;
}

export async function addAffliction(token, afflictionData) {
  const afflictions = { ...getAfflictions(token) };
  afflictions[afflictionData.id] = afflictionData;
  await setAfflictions(token, afflictions);
}

export async function updateAffliction(token, afflictionId, updates) {
  const afflictions = { ...getAfflictions(token) };
  if (afflictions[afflictionId]) {
    afflictions[afflictionId] = { ...afflictions[afflictionId], ...updates };
    await setAfflictions(token, afflictions);
  }
}

export async function removeAffliction(token, afflictionId) {
  if (!game.user.isGM) {
    console.error('AfflictionStore: Non-GM user attempted to remove affliction');
    ui.notifications.error('Only GMs can manage afflictions');
    return;
  }

  await token.document.unsetFlag(MODULE_ID, `afflictions.${afflictionId}`);

  await new Promise(resolve => setTimeout(resolve, 50));
}

export function getTokensWithAfflictions() {
  const tokensWithAfflictions = [];

  for (const token of canvas.tokens.placeables) {
    const afflictions = getAfflictions(token);
    if (Object.keys(afflictions).length > 0) {
      tokensWithAfflictions.push({
        token: token,
        afflictions: afflictions
      });
    }
  }

  return tokensWithAfflictions;
}
