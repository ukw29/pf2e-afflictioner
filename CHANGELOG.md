# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-alpha.4] - 2026-02-15

### Added

- **Storyframe Integration**: Optional integration with Storyframe module
  - New setting: "Integrate with Storyframe" (world, GM only)
  - When enabled, sends save and counteract rolls through Storyframe's pending roll system
  - Players receive roll prompts in Storyframe UI instead of chat buttons
  - Automatically falls back to chat buttons if player offline or Storyframe unavailable
  - Prompts GM to add actors as Storyframe participants if needed
  - Results processed via polling and routed to existing affliction handlers

## [1.0.0-alpha.3] - 2026-02-15

### Added

- **Condition Stacking (PF2e Rules)**: Implements official condition stacking rules
  - Tracks multiple condition instances with different values from different afflictions
  - Applies highest value when multiple sources exist
  - Automatically downgrades to next highest when top value expires
  - Example: slowed 2 (1 round) + slowed 1 (6 rounds) = slowed 2 for round 1, then slowed 1 for rounds 2-6
  - Stored in actor flags: `pf2e-afflictioner.conditionInstances`

- **Maximum Duration Expiration**: World time support for afflictions with maximum duration
  - Afflictions with max duration now expire correctly in both combat and world time
  - Combat: Uses elapsed rounds vs max duration
  - World time: Uses elapsed time vs max duration in seconds

- **Clickable Affliction Indicator**: Token names in indicator tooltip are now clickable
  - Click token name to open Affliction Manager filtered to that token
  - Tooltip stays visible when hovering over it
  - Improved hover behavior with 200ms delay

### Fixed

- **Duration Display**: Show durations in appropriate units instead of always minutes
  - Days for 24+ hours, hours for 1-23 hours, minutes for 1-59 minutes, seconds for < 1 minute
  - Applied to onset timers, save countdowns, and all duration displays
  - Example: "4320m" now shows as "3d"

- **Dice Roll Duration**: Fixed 1d4 rolling 0 due to Foundry v11+ async evaluation
  - Added fallback manual dice simulation when roll.evaluate() fails
  - Custom chat message ensures correct total is displayed

- **Onset Save Timing**: Fixed save prompts during onset period
  - No save prompts during onset - only when onset completes or stage duration expires
  - Added `inOnset` checks to both combat and world time save logic
  - Reset `durationElapsed` when onset completes to start stage duration fresh

- **World Time Save Prompts**: Always send chat prompts when saves are due during world time
  - Previously only sent if `autoPromptSaves` setting enabled
  - Now consistent with combat save behavior

- **Treatment Target Selection**: Treatment actions now use targeted tokens
  - Shows afflictions from targeted token(s), not all tokens
  - Falls back to all tokens if no targets selected

- **Affliction Editor (Foundry v13+ Compatibility)**:
  - Fixed FormDataExtended reference for Foundry v13+
  - Fixed TextEditor reference for Foundry v13+
  - Fixed form data extraction to handle flat structure (condition.0.name vs nested arrays)
  - Conditions, damage, and weakness now save correctly

- **Stage Change Edge Cases**:
  - Cap target stage when onset completes if affliction has fewer stages than expected
  - Prevents "Stage 2 not found" errors when afflictions are edited to have fewer stages

- **Affliction Indicator Display**: Show "Initial Save" instead of "Stage -1" for afflictions awaiting initial save

- **Backward Compatibility**: Conditions from old afflictions (before stacking service) are now cleaned up properly on removal

### Changed

- Treatment buttons now prioritize targeted tokens over all tokens on canvas

## [1.0.0-alpha.2] - 2026-02-14

### Added

- **Curse Affliction Support**: Full support for curse afflictions alongside poisons and diseases
  - Curse trait detection and parsing
  - Updated all UI elements to handle curses
  - Updated language strings and documentation

- **Virulent Trait (Official PF2e Rules)**:
  - Properly implements the virulent trait per Core Rulebook rules
  - Requires **two consecutive successful saves** to reduce stage by 1
  - Critical success reduces stage by only 1 (instead of 2)
  - Tracks consecutive success counter across saves
  - Shows notification when first success is achieved
  - Resets counter on failures or critical successes
  - UI badge shows `[Virulent]` with tooltip in Affliction Manager
  - Chat messages display virulent trait status and mechanics

- **Multiple Exposure (Official PF2e Rules)**:
  - **Poisons** (default behavior):
    - Failing initial save against new exposure increases stage by 1 (or 2 on critical failure)
    - Maximum duration remains unchanged
    - Works even during onset period (doesn't change onset length)
    - If no onset or already elapsed, immediately applies new stage effects
  - **Curses & Diseases** (default behavior):
    - Multiple exposures have no effect
    - Shows notification when re-exposed
  - **Custom Multiple Exposure Rules**:
    - Parses affliction-specific multiple exposure rules from item descriptions
    - Recognizes patterns like "Each additional exposure advances the stage by 2"
    - Supports minimum stage requirements (e.g., "when already at stage 2 or higher")
    - Custom rules override default behavior for all affliction types
  - UI badge shows `[Multiple Exposure +X]` with stage increase amount

- **UI Enhancements**:
  - Affliction Manager displays trait badges for virulent and multiple exposure
  - Chat save prompts show virulent trait warnings and mechanics
  - Tooltips explain trait effects on hover
  - Color-coded badges (virulent: orange, multiple exposure: blue)

- **New Language Strings**:
  - `MULTIPLE_EXPOSURE_NO_EFFECT_DEFAULT`: For curse/disease re-exposure
  - `POISON_RE_EXPOSURE`: For poison stage increase notification
  - `VIRULENT_CONSECUTIVE_SUCCESS`: First successful save against virulent affliction

- **Manual Affliction Entry**: Create custom afflictions directly via "Manual Entry" button
  - Prompts for name, type, DC, and number of stages
  - Creates template affliction that can be customized via editor

- **"OR" Damage Parsing**: Automatically detect and display damage choices
  - Parses patterns like "3d6 cold or fire damage"
  - Shows both options as clickable damage links
  - Vertical layout with "Choose one:" header for clarity

- **Counteract Button**: New button in Affliction Manager to counteract afflictions
  - Prompts for counteract rank and check result
  - Calculates affliction counteract rank (half level, rounded up)
  - Uses official counteract rules to determine success
  - Reduces stage by 1 on success, cures if at stage 1
  - Supports spells like Cleanse Affliction

- **Treat Poison/Disease Integration**: Automatic integration with native PF2e actions
  - Detects when Treat Poison/Treat Disease is used
  - Shows "Apply Treatment To:" buttons for matching afflictions
  - Automatically applies treatment bonus based on check result
  - Green-highlighted selection UI appears in chat

### Fixed

- **Max/Min Stage Bugs**:
  - Fixed incorrect "stage changed" notification when already at max/min stage
  - Added early return when stage doesn't actually change
  - Prevent misleading "Stage 2 (was Stage 2)" messages

- **Stage Button Controls**:
  - Disabled increase stage button when at maximum stage
  - Disabled decrease stage button when at stage 1
  - Added visual disabled state (30% opacity, grayed out)
  - Added tooltips for stage limits

- **Virulent Manual Control**:
  - Manual stage decrease now works immediately for virulent afflictions
  - GM has full control via buttons without consecutive success requirement
  - Virulent logic only applies to automatic save rolls

### Changed

- Treatment effect names now include result: "Affliction (Treatment: Critical Success)"
- Clearer labeling for treatment circumstance bonuses/penalties
- Reduced virulent tooltip text size to 85% for better fit
- Updated stage control logic to check limits before processing
- Updated all trait detection logic to include curse trait
- Updated `AFFLICTION_TYPES` constant to include `CURSE: 'curse'`
- Revised README.md to accurately describe PF2e affliction mechanics
- Updated settings hint to mention curse detection

### Technical Details

- **AfflictionParser.js**:
  - Added `extractMultipleExposure()` method to parse custom rules
  - Enhanced `parseFromItem()` to detect virulent and curse traits
  - Updated structured affliction parsing for curse support

- **AfflictionService.js**:
  - Added `handlePoisonReExposure()` for default poison behavior
  - Modified `handleInitialSave()` to detect and handle re-exposure
  - Updated `handleStageSave()` to implement two-consecutive-saves for virulent
  - Added `findExistingAffliction()` helper method
  - Added `virulentConsecutiveSuccesses` counter to affliction data

- **AfflictionManager.js**:
  - Updated `_prepareContext()` to pass trait flags to template
  - Added `isVirulent`, `hasMultipleExposure`, and `multipleExposureIncrease` properties

- **Templates**:
  - Updated `affliction-manager.hbs` to display trait badges

- **Hooks & Dialogs**:
  - Updated all curse/disease/poison detection in `registration.js`
  - Updated `AddAfflictionDialog.js` for curse item handling

## [1.0.0-alpha.1] - Previous Release

- Initial alpha release with basic affliction management
- Auto-detection of poison/disease items
- Stage tracking and automatic saves
- Treatment support
- Visual indicators
- Manager UI

[1.0.0-alpha.2]: https://github.com/yourusername/pf2e-afflictioner/releases/tag/v1.0.0-alpha.2
