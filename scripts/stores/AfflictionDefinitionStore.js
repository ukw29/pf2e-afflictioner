/**
 * Affliction Definition Store - Manages persistent storage of edited affliction definitions
 */

import { MODULE_ID } from '../constants.js';

/**
 * Get an edited affliction definition by key
 * @param {string} key - The affliction definition key
 * @returns {Object|null} - The edited definition or null if not found
 */
export function getEditedDefinition(key) {
  if (!key) return null;

  const editedAfflictions = game.settings.get(MODULE_ID, 'editedAfflictions');
  return editedAfflictions[key] || null;
}

/**
 * Save an edited affliction definition
 * @param {string} key - The affliction definition key
 * @param {Object} editedData - The edited affliction data
 */
export async function saveEditedDefinition(key, editedData) {
  if (!game.user.isGM) {
    console.error('AfflictionDefinitionStore: Non-GM user attempted to save definition');
    ui.notifications.error('Only GMs can edit affliction definitions');
    return;
  }

  if (!key || !editedData) {
    console.error('AfflictionDefinitionStore: Invalid key or data');
    return;
  }

  console.log('AfflictionDefinitionStore: Saving edited definition', { key, editedData });

  const editedAfflictions = { ...game.settings.get(MODULE_ID, 'editedAfflictions') };

  // Add metadata
  editedData.editedAt = Date.now();
  editedData.editedBy = game.user.id;

  editedAfflictions[key] = editedData;

  await game.settings.set(MODULE_ID, 'editedAfflictions', editedAfflictions);

  console.log('AfflictionDefinitionStore: Edited definition saved successfully');
}

/**
 * Remove an edited affliction definition (reset to default)
 * @param {string} key - The affliction definition key
 */
export async function removeEditedDefinition(key) {
  if (!game.user.isGM) {
    console.error('AfflictionDefinitionStore: Non-GM user attempted to remove definition');
    ui.notifications.error('Only GMs can manage affliction definitions');
    return;
  }

  if (!key) {
    console.error('AfflictionDefinitionStore: Invalid key');
    return;
  }

  console.log('AfflictionDefinitionStore: Removing edited definition', { key });

  const editedAfflictions = { ...game.settings.get(MODULE_ID, 'editedAfflictions') };
  delete editedAfflictions[key];

  await game.settings.set(MODULE_ID, 'editedAfflictions', editedAfflictions);

  console.log('AfflictionDefinitionStore: Edited definition removed successfully');
}

/**
 * Get all edited affliction definitions
 * @returns {Object} - All edited definitions keyed by their definition keys
 */
export function getAllEditedDefinitions() {
  return game.settings.get(MODULE_ID, 'editedAfflictions') || {};
}

/**
 * Generate a consistent key for an affliction definition
 * Uses sourceItemUuid if available, otherwise generates a custom ID from name and type
 * @param {Object} afflictionData - The affliction data
 * @returns {string} - The generated key
 */
export function generateDefinitionKey(afflictionData) {
  if (!afflictionData) {
    console.error('AfflictionDefinitionStore: Cannot generate key from invalid data');
    return null;
  }

  // Prefer sourceItemUuid for item-based afflictions
  if (afflictionData.sourceItemUuid) {
    return afflictionData.sourceItemUuid;
  }

  // Generate custom ID for manually created afflictions
  const name = afflictionData.name?.toLowerCase().replace(/\s+/g, '-') || 'unknown';
  const type = afflictionData.type || 'affliction';
  return `custom-${name}-${type}`;
}
