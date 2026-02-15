# PF2e Afflictioner

Automated affliction (poison/disease/curse) manager for Pathfinder 2e in FoundryVTT implementing official PF2e rules.

## Features

### Core Functionality

- **Auto-detection**: Automatically detects when poison/disease/curse items are used and prompts for initial saves
- **Full Affliction Type Support**: Poisons, diseases, and curses with type-specific rules
- **Stage Tracking**: Tracks affliction stages, onset, and duration per token
- **Automatic Saves**: Prompts for saves at correct timing in combat and world time
  - Combat: Based on initiative and round tracking
  - World time: Based on elapsed seconds with optional auto-prompts
- **Maximum Duration Expiration**: Afflictions with max duration expire correctly in both combat and world time
- **Manual Handling**: Flags stages with complex instructions for GM review

### PF2e Rules Implementation

- **Condition Stacking**: Implements official condition stacking rules
  - Tracks multiple condition instances with different values from different afflictions
  - Applies highest value when multiple sources exist
  - Automatically downgrades to next highest when top value expires
  - Example: slowed 2 (1 round) + slowed 1 (6 rounds) = slowed 2 for round 1, then slowed 1 for rounds 2-6
  - Stored in actor flags: `pf2e-afflictioner.conditionInstances`

- **Virulent Trait**: Requires two consecutive successes to reduce stage by 1, critical success reduces by 1 instead of 2

- **Multiple Exposure**:
  - **Poisons**: New exposure increases stage by 1 (or 2 on crit fail) without affecting duration
  - **Curses/Diseases**: Multiple exposures have no effect (unless custom rules specified)
  - **Custom Rules**: Parses and applies affliction-specific multiple exposure rules from item descriptions

### Treatment & Counteraction

- **Treatment Support**: Integrates "Treat Poison/Disease/Curse" Medicine checks
  - Automatic detection when treatment actions are used
  - Applies circumstance bonuses/penalties based on check result
  - Targets selected tokens or shows all afflictions if none selected

- **Counteract Button**: Counteract afflictions using spells (e.g., Cleanse Affliction)
  - Calculates affliction counteract rank (half level, rounded up)
  - Uses official counteract rules based on degree of success and rank comparison
  - Reduces stage by 1 on success, cures if at stage 1

### UI & Visualization

- **Visual Indicators**: Biohazard icon on afflicted tokens (per-client toggle)
  - Red when afflicted, gray otherwise
  - Shows affliction count and stage info
  - Clickable token names open Affliction Manager filtered to that token
  - Tooltip stays visible when hovering over it

- **Affliction Monitor Indicator** (GM only): Real-time indicator showing all afflicted tokens in scene
  - Shows token names, affliction names, and current stages
  - Clickable to open manager filtered to specific token
  - Auto-refreshes on combat/world time updates

- **Manager UI**: Comprehensive interface for manual management
  - Roll saves, treat, progress/regress stages, remove afflictions
  - Shows trait badges (virulent, multiple exposure)
  - Displays all stage effects (damage, conditions, durations)

### Advanced Features

- **Manual Affliction Entry**: Create custom afflictions directly via "Manual Entry" button
  - Prompts for name, type, DC, and number of stages
  - Creates template affliction that can be customized via editor

- **Edited Afflictions Manager**: GM-only interface to edit affliction definitions
  - Accessible via settings menu
  - Customized versions override default item data
  - Stored per-world

- **"OR" Damage Parsing**: Automatically detects and displays damage choices
  - Parses patterns like "3d6 cold or fire damage"
  - Shows both options as clickable damage links
  - Vertical layout with "Choose one:" header

- **Cross-Client Sync**: Uses socketlib (optional) for multiplayer synchronization

## Usage

### Automatic Workflow

1. GM uses a poison/disease/curse item in combat (drag to hotbar and use)
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
- **Monitor Indicator** (GM only): Click token name in indicator tooltip
- **API**: `game.modules.get('pf2e-afflictioner').api.openManager()`
- **Filtered to Token**: `game.modules.get('pf2e-afflictioner').api.openManager({ filterTokenId: token.id })`

Manager actions:

- **Roll Save**: Prompt save dialog for current stage
- **Treat**: Use Treat Poison/Disease/Curse action with skill check
- **Counteract**: Counteract with spell (e.g., Cleanse Affliction)
- **Progress/Regress**: Manually adjust stage
- **Edit**: Open affliction editor to customize stages
- **Remove**: Remove affliction from token

**Manual Entry:**

- Click "Manual Entry" button in Manager to create custom afflictions
- Specify name, type (poison/disease/curse), DC, and number of stages
- Customize via editor after creation

### API

```js
const api = game.modules.get('pf2e-afflictioner').api;

// Manager UI
api.openManager();                           // Open manager
api.openManager({ filterTokenId: token.id }); // Filter to specific token

// Get afflictions
const afflictions = api.getAfflictions(token);     // Get all afflictions on token
const affliction = api.getAffliction(token, id);   // Get specific affliction
const tokens = api.getTokensWithAfflictions();     // Get all tokens with afflictions in scene

// Manage afflictions
api.addAffliction(token, afflictionData);          // Add affliction
api.updateAffliction(token, id, updates);          // Update affliction data
api.removeAffliction(token, afflictionId);         // Remove affliction

// Parse from item
const afflictionData = api.parseAffliction(item);  // Parse affliction from item

// Prompt actions
api.promptInitialSave(token, afflictionData);      // Prompt initial save
api.promptSave(token, affliction);                 // Prompt stage save
api.promptTreatment(token, affliction);            // Prompt treatment

// Visual indicators
api.refreshAllIndicators();                        // Refresh all visual indicators
```

## Settings

- **Show Visual Indicators**: Toggle biohazard icons on tokens (per-client)
- **Auto-Detect Afflictions**: Auto-detect poison/disease/curse usage (world, GM only)
- **Auto-Prompt Saves (Out of Combat)**: Automatically prompt for saves when world time elapses (world, GM only)
- **Default DC**: Fallback DC if parsing fails (world, GM only)
- **Integrate with Storyframe**: Send save and counteract rolls through Storyframe module (world, GM only)
- **Edited Afflictions Manager**: Settings menu button to open manager for customizing affliction definitions (world, GM only)

## Affliction Data Format

Afflictions stored in token flags at `token.document.flags['pf2e-afflictioner'].afflictions`:

```js
{
  id: 'uuid',
  name: 'Affliction Name',
  type: 'poison' | 'disease' | 'curse',
  dc: 17,
  level: 5,                          // Affliction level (for counteract)
  onset: { duration, unit },
  currentStage: 1,
  stages: [{
    damage,
    conditions,
    duration,
    requiresManualHandling
  }],

  // Timing (combat)
  nextSaveRound: 3,
  nextSaveInitiative: 18,
  stageStartRound: 1,

  // Timing (world time)
  nextSaveTimestamp: 1234567890,
  addedAt: 1234567890,

  // Treatment
  treatmentBonus: 0,
  treatedThisStage: false,

  // Traits
  isVirulent: false,
  virulentConsecutiveSuccesses: 0,
  multipleExposure: { increase: 1, minStage: null },

  // Maximum duration
  maxDuration: { duration: 24, unit: 'hour' },
  maxDurationSeconds: 86400,

  // Source
  sourceItemUuid: 'Item.abc123',
  sourceActorId: 'Actor.xyz789'
}
```

Condition instances stored in actor flags at `actor.flags['pf2e-afflictioner'].conditionInstances`:

```js
{
  'slowed': [
    {
      id: 'randomId',
      value: 2,
      sourceAfflictionId: 'afflictionId',
      sourceTokenId: 'tokenId',
      expiresAt: { type: 'combat', round: 5, initiative: 18 },
      addedAt: 1234567890
    }
  ]
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
