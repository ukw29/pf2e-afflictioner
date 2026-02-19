export const MODULE_ID = 'pf2e-afflictioner';

export const AFFLICTION_TYPES = {
  POISON: 'poison',
  DISEASE: 'disease',
  CURSE: 'curse'
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
    scope: 'world',
    type: Boolean,
    default: true,
    config: true,
    restricted: true
  },
  'autoDetectAfflictions': {
    name: 'Auto-Detect Afflictions',
    hint: 'Automatically detect poison/disease/curse items and prompt for initial saves',
    scope: 'world',
    type: Boolean,
    default: true,
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
  },
  'integrateWithStoryframe': {
    name: 'Integrate with Storyframe',
    hint: 'Send save and counteract rolls through Storyframe module',
    scope: 'world',
    type: Boolean,
    default: false,
    config: true,
    restricted: true
  },
  'requireSaveConfirmation': {
    name: 'Require Save Confirmation',
    hint: 'Require GM confirmation before applying save consequences (allows hero point rerolls)',
    scope: 'world',
    type: Boolean,
    default: false,
    config: true,
    restricted: true
  },
  'anonymizeSaveMessages': {
    name: 'Anonymize Save Messages',
    hint: 'Hide affliction details in player save messages. Players see only "Fortitude Save Required" without affliction name, stage, or effects. Works with automatic unidentified effects to keep afflictions mysterious.',
    scope: 'world',
    type: Boolean,
    default: false,
    config: true,
    restricted: true
  },
  'gmRollMysteriousSaves': {
    name: 'GM Rolls Mysterious Initial Saves',
    hint: 'GM rolls initial saves for mysterious afflictions (onset or no stage 1 mechanical effects). Players never see the save request, maintaining complete secrecy.',
    scope: 'world',
    type: Boolean,
    default: false,
    config: true,
    restricted: true
  },
  'useApplicationInitiative': {
    name: 'Use Application Initiative',
    hint: 'When enabled, affliction saves trigger on the same initiative step the affliction was first applied, rather than the afflicted token\'s own initiative. Unofficial rule — not explicitly stated in the PF2e rulebook.',
    scope: 'world',
    type: Boolean,
    default: false,
    config: true,
    restricted: true
  },
  'editedAfflictions': {
    name: 'Edited Afflictions',
    hint: 'Stores GM-edited affliction definitions',
    scope: 'world',
    type: Object,
    default: {},
    config: false,
    restricted: true
  },
  'communityDataVersion': {
    name: 'Community Data Version',
    hint: 'Version of community afflictions data last imported',
    scope: 'world',
    type: String,
    default: '',
    config: false,
    restricted: true
  }
};

export const VALUELESS_CONDITIONS = [
  'blinded', 'confused', 'controlled', 'dazzled', 'deafened', 'fascinated',
  'fatigued', 'fleeing', 'grabbed', 'hidden', 'immobilized', 'invisible',
  'observed', 'off-guard', 'paralyzed', 'petrified', 'prone', 'quickened',
  'restrained', 'unconscious', 'undetected'
];

export const PF2E_CONDITIONS = [
  'blinded', 'broken', 'clumsy', 'concealed', 'confused', 'controlled',
  'cursebound', 'dazzled', 'deafened', 'doomed', 'drained', 'dying',
  'encumbered', 'enfeebled', 'fascinated', 'fatigued', 'fleeing', 'frightened',
  'friendly', 'grabbed', 'helpful', 'hidden', 'hostile', 'immobilized',
  'indifferent', 'invisible', 'malevolence', 'observed', 'off-guard',
  'paralyzed', 'persistent-damage', 'petrified', 'prone', 'quickened',
  'restrained', 'sickened', 'slowed', 'stunned', 'stupefied', 'unconscious',
  'undetected', 'unfriendly', 'unnoticed', 'wounded'
];

export const DURATION_MULTIPLIERS = {
  'round': 6,
  'minute': 60,
  'hour': 3600,
  'day': 86400,
  'week': 604800
};
