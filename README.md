[![Latest Version](https://img.shields.io/github/v/release/roi007leaf/pf2e-afflictioner?display_name=tag&sort=semver&label=Latest%20Version)](https://github.com/roi007leaf/pf2e-afflictioner/releases/latest)

[![GitHub all releases](https://img.shields.io/github/downloads/roi007leaf/pf2e-afflictioner/total)](https://github.com/roi007leaf/pf2e-afflictioner/releases)

[![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2Fpf2e-afflictioner)](https://forge-vtt.com/bazaar)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/roileaf)
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
  - Auto-detects multiple spellcasting traditions
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
  - Roll saves, treat, counteract, progress/regress stages, remove afflictions
  - Shows trait badges (virulent, multiple exposure)
  - Displays all stage effects (damage, conditions, weakness, durations)

### Adding Afflictions

- **Add Affliction Dialog**: Multiple ways to add afflictions to tokens
  - **Drag-and-Drop**: Drop poison/disease/curse items directly
  - **Actor Items**: Quick-select from the token's actor items
  - **Compendium Browse**: Search and add from the PF2e system compendium
  - **Manual Entry**: Create custom afflictions with name, type, DC, and stage count

### Affliction Editor

- **Affliction Editor**: Full editor for customizing affliction definitions
  - Basic properties: DC, save type (Fortitude/Reflex/Will), onset, max duration
  - Per-stage editing: duration, damage, conditions, weakness, instructions
  - **"OR" Damage Parsing**: Detects and displays damage choices (e.g., "3d6 cold or fire damage")
  - **Auto-Applied Effects**: Drag-drop item effects to auto-apply when a stage becomes active

- **Edited Afflictions Manager** (GM only): Manage all customized definitions
  - View, edit, and delete custom definitions
  - **Import/Export**: JSON file support for sharing configurations between worlds
  - **Conflict Resolution**: Field-by-field merge dialog when imports conflict with existing edits
  - Stored per-world

- **Community Afflictions**: Auto-imports bundled community affliction definitions on version updates, with conflict resolution for existing edits

### Mystery & Anonymization

- **Anonymize Save Messages**: Hide affliction details from players; they see only "Fortitude Save Required" without name, stage, or effects
- **GM Rolls Mysterious Saves**: GM rolls initial saves in secret for mysterious afflictions (those with onset or no visible stage 1 effects)
- **Save Confirmation**: Optional GM confirmation before applying save consequences, allowing hero point rerolls

### Advanced Options

- **Application Initiative**: Optional unofficial rule where saves trigger on the initiative the affliction was applied, rather than the afflicted token's initiative
- **Cross-Client Sync**: Uses socketlib for multiplayer synchronization
- **Storyframe Integration**: Optional integration for sending rolls through the Storyframe module

## Usage

### Automatic Workflow

1. GM uses a poison/disease/curse item in combat (drag to hotbar and use)
2. Target token(s) with the affliction
3. Module prompts for initial Fortitude saves
4. On failure, affliction is added to token with visual indicator
5. On token's turn after onset, save prompt appears automatically
6. Saves determine stage progression (+/-1 or +/-2 stages)
7. Conditions and damage applied automatically
8. Continue until cured (stage 0) or max duration reached

### Manual Management

**Open Manager:**

- **Token HUD Button**: Right-click token -> click biohazard icon (red if afflicted, gray otherwise)
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

**Adding Afflictions:**

- Click "Add Affliction" in the Manager
- Drag-and-drop items, select from actor/compendium, or use Manual Entry
- Manual Entry: specify name, type (poison/disease/curse), DC, and number of stages
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

### Client Settings (per-player)

- **Show Visual Indicators**: Toggle biohazard icons on tokens

### World Settings (GM only)

- **Auto-Detect Afflictions**: Auto-detect poison/disease/curse usage
- **Auto-Prompt Saves (Out of Combat)**: Automatically prompt for saves when world time elapses
- **Require Save Confirmation**: Require GM confirmation before applying save consequences (allows hero point rerolls)
- **Anonymize Save Messages**: Hide affliction details in player save messages
- **GM Rolls Mysterious Initial Saves**: GM rolls initial saves for mysterious afflictions in secret
- **Use Application Initiative**: Saves trigger at affliction application initiative instead of token initiative (unofficial rule)
- **Integrate with Storyframe**: Send save and counteract rolls through Storyframe module
- **Edited Afflictions Manager**: Settings menu button to open manager for customizing affliction definitions

## Dependencies

- **FoundryVTT**: v13+
- **PF2e System**: v7.0.0+
- **lib-wrapper**: Required
- **socketlib**: Required

### Optional

- **Storyframe**: For integrated roll handling
