/**
 * Constants for pf2e-afflictioner
 */

export const MODULE_ID = 'pf2e-afflictioner';

export const AFFLICTION_TYPES = {
  POISON: 'poison',
  DISEASE: 'disease'
};

export const DEGREE_OF_SUCCESS = {
  CRITICAL_SUCCESS: 'criticalSuccess',
  SUCCESS: 'success',
  FAILURE: 'failure',
  CRITICAL_FAILURE: 'criticalFailure'
};

export const DEFAULT_SETTINGS = {
  'showVisualIndicators': {
    name: 'Show Visual Indicators',
    hint: 'Display biohazard icon on tokens with active afflictions',
    scope: 'client',
    type: Boolean,
    default: true,
    config: true
  },
  'autoDetectAfflictions': {
    name: 'Auto-Detect Afflictions',
    hint: 'Automatically detect poison/disease items and prompt for initial saves',
    scope: 'world',
    type: Boolean,
    default: true,
    config: true,
    restricted: true
  },
  'defaultDC': {
    name: 'Default DC',
    hint: 'Default DC for afflictions if none can be parsed',
    scope: 'world',
    type: Number,
    default: 15,
    config: true,
    restricted: true
  },
  'autoPromptSaves': {
    name: 'Auto-Prompt Saves (Out of Combat)',
    hint: 'Automatically prompt for saves when game time elapses outside combat',
    scope: 'world',
    type: Boolean,
    default: false,
    config: true,
    restricted: true
  }
};

// PF2e condition names for parsing
export const PF2E_CONDITIONS = [
  'blinded', 'broken', 'clumsy', 'concealed', 'confused', 'controlled',
  'dazzled', 'deafened', 'doomed', 'drained', 'dying', 'encumbered',
  'enfeebled', 'fascinated', 'fatigued', 'fleeing', 'frightened',
  'grabbed', 'immobilized', 'invisible', 'paralyzed', 'persistent damage',
  'petrified', 'prone', 'quickened', 'restrained', 'sickened', 'slowed',
  'stunned', 'stupefied', 'unconscious', 'undetected', 'wounded'
];

// Duration unit multipliers to seconds
export const DURATION_MULTIPLIERS = {
  'round': 6,
  'minute': 60,
  'hour': 3600,
  'day': 86400
};
