/**
 * Affliction Store - Flag-based storage for per-token affliction data
 */

import { MODULE_ID } from '../constants.js';

/**
 * Get all afflictions for a token
 * @param {Token} token
 * @returns {Record<string,Object>}
 */
export function getAfflictions(token) {
  const afflictions = token?.document.getFlag(MODULE_ID, 'afflictions') ?? {};
  return afflictions;
}

/**
 * Set all afflictions for a token
 * @param {Token} token
 * @param {Record<string,Object>} afflictions
 */
export async function setAfflictions(token, afflictions) {
  if (!token?.document) {
    console.error('AfflictionStore: No token document');
    return;
  }

  // Only GMs can manage afflictions
  if (!game.user.isGM) {
    console.error('AfflictionStore: Non-GM user attempted to set afflictions');
    ui.notifications.error('Only GMs can manage afflictions');
    return;
  }

  console.log('AfflictionStore: setAfflictions called', { tokenId: token.id, afflictions });

  // Use setFlag instead of update for proper flag handling
  await token.document.setFlag(MODULE_ID, 'afflictions', afflictions);

  console.log('AfflictionStore: Token flag set successfully');
}

/**
 * Get a single affliction from a token
 * @param {Token} token
 * @param {string} afflictionId
 * @returns {Object|null}
 */
export function getAffliction(token, afflictionId) {
  const afflictions = getAfflictions(token);
  return afflictions[afflictionId] || null;
}

/**
 * Add a new affliction to a token
 * @param {Token} token
 * @param {Object} afflictionData
 */
export async function addAffliction(token, afflictionData) {
  const afflictions = { ...getAfflictions(token) };
  afflictions[afflictionData.id] = afflictionData;
  await setAfflictions(token, afflictions);
}

/**
 * Update an existing affliction
 * @param {Token} token
 * @param {string} afflictionId
 * @param {Object} updates
 */
export async function updateAffliction(token, afflictionId, updates) {
  const afflictions = { ...getAfflictions(token) };
  if (afflictions[afflictionId]) {
    afflictions[afflictionId] = { ...afflictions[afflictionId], ...updates };
    await setAfflictions(token, afflictions);
  }
}

/**
 * Remove an affliction from a token
 * @param {Token} token
 * @param {string} afflictionId
 */
export async function removeAffliction(token, afflictionId) {
  if (!game.user.isGM) {
    console.error('AfflictionStore: Non-GM user attempted to remove affliction');
    ui.notifications.error('Only GMs can manage afflictions');
    return;
  }

  console.log('AfflictionStore: removeAffliction called', { tokenId: token.id, afflictionId });

  // Use unsetFlag to directly remove the specific affliction
  await token.document.unsetFlag(MODULE_ID, `afflictions.${afflictionId}`);

  console.log('AfflictionStore: Affliction unset successfully');

  // Wait for document to sync
  await new Promise(resolve => setTimeout(resolve, 50));

  const verifyAfflictions = getAfflictions(token);
  console.log('AfflictionStore: Verification after removal', verifyAfflictions);
}

/**
 * Get all tokens with active afflictions in current scene
 * @returns {Array<{token: Token, afflictions: Object}>}
 */
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
