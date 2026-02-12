# PF2e Afflictioner

Automated affliction (poison/disease) manager for Pathfinder 2e in FoundryVTT.

## Features

- **Auto-detection**: Automatically detects when poison/disease items are used and prompts for initial saves
- **Stage Tracking**: Tracks affliction stages, onset, and duration per token
- **Automatic Saves**: Prompts for saves on the correct initiative based on stage duration
- **Treatment Support**: Integrates "Treat Poison/Disease" Medicine checks with bonuses
- **Visual Indicators**: Shows biohazard icon on afflicted tokens
- **Manager UI**: Comprehensive UI for manual management of afflictions
- **Manual Handling**: Flags stages with complex instructions for GM review

## Usage

### Automatic Workflow

1. GM uses a poison/disease item in combat (drag to hotbar and use)
2. Target token(s) with the affliction
3. Module prompts for initial Fortitude saves
4. On failure, affliction is added to token with visual indicator
5. On token's turn after onset, save prompt appears automatically
6. Saves determine stage progression (±1/±2 stages)
7. Conditions and damage applied automatically
8. Continue until cured (stage 0) or max duration reached

### Manual Management

**Open Manager:**
- **Token HUD Button**: Right-click token → click biohazard icon (red if afflicted, gray otherwise)
- **API**: `game.modules.get('pf2e-afflictioner').api.openManager()`
- **Filtered to Token**: `game.modules.get('pf2e-afflictioner').api.openManager({ filterTokenId: token.id })`

Manager actions:
- **Roll Save**: Prompt save dialog for current stage
- **Treat**: Use Treat Poison/Disease action
- **Progress/Regress**: Manually adjust stage
- **Remove**: Remove affliction from token

### API

```js
const api = game.modules.get('pf2e-afflictioner').api;

// Get afflictions
const afflictions = api.getAfflictions(token);

// Add affliction manually
api.addAffliction(token, afflictionData);

// Remove affliction
api.removeAffliction(token, afflictionId);

// Parse from item
const afflictionData = api.parseAffliction(item);

// Prompt saves
api.promptInitialSave(token, afflictionData);
api.promptSave(token, affliction);

// Treatment
api.promptTreatment(token, affliction);
```

## Settings

- **Show Visual Indicators**: Toggle biohazard icons on tokens (per-client)
- **Auto-Detect Afflictions**: Auto-detect poison/disease usage (world, GM only)
- **Default DC**: Fallback DC if parsing fails (world, GM only)

## Affliction Data Format

Afflictions are stored in token flags:
```js
token.document.flags['pf2e-afflictioner'].afflictions[afflictionId] = {
  id: 'uuid',
  name: 'Affliction Name',
  type: 'poison' | 'disease',
  dc: 17,
  onset: { duration, unit },
  currentStage: 1,
  stages: [{ damage, conditions, duration, requiresManualHandling }],
  nextSaveRound: 3,
  treatmentBonus: 0,
  // ... more fields
}
```

## Manual Handling

Stages with complex instructions (secret rolls, special abilities, etc.) are flagged with `requiresManualHandling: true`. The module shows warnings and includes raw text for GM review.

## Dependencies

- **FoundryVTT**: v13+
- **PF2e System**: Required
- **socketlib**: Optional (for multiplayer sync)

## Credits

Based on architecture patterns from [pf2e-visioner](https://github.com/reonZ/pf2e-visioner).
