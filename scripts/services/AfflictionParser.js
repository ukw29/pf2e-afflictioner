/**
 * Affliction Parser - Extract affliction data from PF2e items
 */

import { PF2E_CONDITIONS, DURATION_MULTIPLIERS } from '../constants.js';

export class AfflictionParser {
  /**
   * Parse affliction from PF2e item with poison/disease trait
   * @param {Item} item - PF2e item document
   * @returns {Object|null} parsed affliction data
   */
  static parseFromItem(item) {
    // Check for poison/disease trait
    const traits = item.system?.traits?.value || [];
    const type = traits.includes('poison') ? 'poison' :
                 traits.includes('disease') ? 'disease' : null;

    if (!type) return null;

    // Check for structured affliction data first (PF2e native afflictions)
    if (item.system?.stage) {
      return this.parseStructuredAffliction(item);
    }

    // Parse from description text
    const description = item.system?.description?.value || '';

    const stages = this.extractStages(description);

    return {
      name: item.name,
      type,
      dc: this.extractDC(description, item),
      onset: this.extractOnset(description),
      stages: stages,
      maxDuration: this.extractMaxDuration(description),
      sourceItemUuid: item.uuid
    };
  }

  /**
   * Parse structured affliction data from PF2e native affliction format
   */
  static parseStructuredAffliction(item) {
    const stageData = item.system?.stage || 1;
    const dc = item.system?.save?.dc || item.system?.save?.value || game.settings.get('pf2e-afflictioner', 'defaultDC');

    // Build stages array from structured data
    const stages = [];
    if (typeof stageData === 'object' && !Array.isArray(stageData)) {
      // Structured stage object (e.g., {1: {effects: [...], duration: {...}}, 2: {...}})
      for (const [stageNum, stageInfo] of Object.entries(stageData)) {
        if (!isNaN(stageNum)) {
          stages.push({
            number: parseInt(stageNum),
            effects: this.formatEffectsFromStructured(stageInfo.effects || []),
            rawText: `Stage ${stageNum}: ${this.formatEffectsFromStructured(stageInfo.effects || [])}`,
            duration: stageInfo.duration || { value: 1, unit: 'hour', isDice: false },
            damage: this.extractDamageFromStructured(stageInfo.effects || []),
            conditions: this.extractConditionsFromStructured(stageInfo.effects || []),
            weakness: this.extractWeaknessFromStructured(stageInfo.effects || []),
            requiresManualHandling: false
          });
        }
      }
    }

    return {
      name: item.name,
      type: item.system?.traits?.value?.includes('poison') ? 'poison' : 'disease',
      dc: dc,
      onset: item.system?.onset ? this.parseDuration(item.system.onset) : null,
      stages: stages,
      maxDuration: item.system?.maxDuration ? this.parseDuration(item.system.maxDuration) : null,
      sourceItemUuid: item.uuid
    };
  }

  /**
   * Format effects from structured data into readable text
   */
  static formatEffectsFromStructured(effects) {
    if (!Array.isArray(effects)) return '';
    return effects.map(e => {
      if (typeof e === 'string') return e;
      if (e.name && e.value) return `${e.name} ${e.value}`;
      if (e.name) return e.name;
      return JSON.stringify(e);
    }).join(', ');
  }

  /**
   * Extract damage from structured effects
   */
  static extractDamageFromStructured(effects) {
    if (!Array.isArray(effects)) return [];
    return effects.filter(e => e.type === 'damage' || e.damageType).map(e => {
      return e.formula || `${e.value || '0'} ${e.damageType || 'damage'}`;
    });
  }

  /**
   * Extract conditions from structured effects
   */
  static extractConditionsFromStructured(effects) {
    if (!Array.isArray(effects)) return [];
    return effects.filter(e => PF2E_CONDITIONS.includes(e.name?.toLowerCase() || e.condition?.toLowerCase())).map(e => ({
      name: e.name || e.condition,
      value: e.value || null
    }));
  }

  /**
   * Extract weakness from structured effects
   */
  static extractWeaknessFromStructured(effects) {
    if (!Array.isArray(effects)) return [];
    return effects.filter(e => e.type === 'weakness' || e.weakness).map(e => ({
      type: e.damageType || e.type || 'physical',
      value: e.value || 0
    }));
  }

  /**
   * Extract DC from text or item data
   */
  static extractDC(description, item) {
    // Try system data first (check both .dc and .value)
    if (item.system?.save?.dc) return item.system.save.dc;
    if (item.system?.save?.value) return item.system.save.value;

    // Parse from text: PF2e enriched format "@Check[fortitude|dc:22]" or plain "DC 17 Fortitude"
    // Try enriched format first
    let dcMatch = description.match(/@Check\[[^\]]*\|dc:(\d+)\]/i);
    if (dcMatch) return parseInt(dcMatch[1]);

    // Try plain text format
    dcMatch = description.match(/DC\s+(\d+)/i);
    if (dcMatch) return parseInt(dcMatch[1]);

    return game.settings.get('pf2e-afflictioner', 'defaultDC');
  }

  /**
   * Extract onset duration
   * Parse: "Onset 1 minute" or "Onset 1d4 rounds"
   * Also handles HTML: "<strong>Onset</strong> 10 minutes"
   */
  static extractOnset(description) {
    // Try HTML format first
    let onsetMatch = description.match(/<strong>Onset<\/strong>\s+([^<]+)/i);

    // Fall back to plain text
    if (!onsetMatch) {
      onsetMatch = description.match(/Onset\s+([^;.<]+)/i);
    }

    if (!onsetMatch) {
      return null;
    }

    const text = onsetMatch[1].trim();

    const duration = this.parseDuration(text);

    return duration;
  }

  /**
   * Extract stages with effects and durations
   * Parse: "Stage 1 1d6 poison and enfeebled 1 (1 round)"
   * Also handles HTML: "<p><strong>Stage 1</strong> effects (1 hour)</p>"
   */
  static extractStages(description) {
    const stages = [];

    // Try HTML format first: <p><strong>Stage X</strong> effects (duration)</p>
    const htmlMatches = description.matchAll(/<strong>Stage\s+(\d+)<\/strong>\s+([^<]+)\(([^)]+)\)/gi);

    for (const match of htmlMatches) {
      const stageNum = parseInt(match[1]);
      const effects = match[2].trim();
      const durationText = match[3];
      const duration = this.parseDuration(durationText);

      // Check if stage has complex instructions that need manual handling
      const requiresManualHandling = this.detectManualHandling(effects);

      stages.push({
        number: stageNum,
        effects: effects,
        rawText: match[0], // Store raw text for GM reference
        duration: duration,
        damage: this.extractDamage(effects),
        conditions: this.extractConditions(effects),
        weakness: this.extractWeakness(effects),
        requiresManualHandling: requiresManualHandling
      });
    }

    // If no HTML matches, try plain text format
    if (stages.length === 0) {
      const plainMatches = description.matchAll(/Stage\s+(\d+)\s+([^(]+)\(([^)]+)\)/gi);

      for (const match of plainMatches) {
        const stageNum = parseInt(match[1]);
        const effects = match[2].trim();
        const durationText = match[3];
        const duration = this.parseDuration(durationText);

        const requiresManualHandling = this.detectManualHandling(effects);

        stages.push({
          number: stageNum,
          effects: effects,
          rawText: match[0],
          duration: duration,
          damage: this.extractDamage(effects),
          conditions: this.extractConditions(effects),
          weakness: this.extractWeakness(effects),
          requiresManualHandling: requiresManualHandling
        });
      }
    }

    return stages;
  }

  /**
   * Detect if stage requires manual handling by GM
   */
  static detectManualHandling(effectsText) {
    const manualKeywords = [
      'secret', 'gm', 'special', 'ability', 'save again',
      'choose', 'option', 'or', 'either', 'instead',
      'permanent', 'instant death', 'dies'
    ];

    const lowerText = effectsText.toLowerCase();
    return manualKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Parse duration text into structured format
   */
  static parseDuration(text) {
    // Handle dice: "1d4 rounds"
    const diceMatch = text.match(/(\d+d\d+)\s+(\w+)/i);
    if (diceMatch) {
      const roll = new Roll(diceMatch[1]);
      const evaluated = roll.evaluateSync();
      return {
        value: evaluated.total,
        unit: diceMatch[2].toLowerCase().replace(/s$/, ''), // Remove plural 's'
        isDice: true
      };
    }

    // Handle fixed: "1 minute", "6 rounds"
    const fixedMatch = text.match(/(\d+)\s+(\w+)/i);
    if (fixedMatch) {
      return {
        value: parseInt(fixedMatch[1]),
        unit: fixedMatch[2].toLowerCase().replace(/s$/, ''),
        isDice: false
      };
    }

    return { value: 1, unit: 'round', isDice: false };
  }

  /**
   * Extract damage from effects text
   * Handles both plain text (e.g., "1d6 poison") and @Damage notation (e.g., "@Damage[1d6[poison]]")
   * Returns array of objects with formula and type: [{formula: "1d6", type: "poison"}]
   */
  static extractDamage(text) {
    const damageEntries = [];
    const seenFormulas = new Set(); // Prevent duplicates


    // First, extract @Damage[...] notation (PF2e format)
    // Two formats: @Damage[1d6[poison]] with type, or @Damage[1d6] without type

    // Match @Damage with typed damage: @Damage[formula[type]]
    const typedDamageMatches = text.matchAll(/@Damage\[([\d\w+-]+)\[([^\]]+)\]\]/gi);
    for (const match of typedDamageMatches) {
      const formula = match[1].trim();
      const type = match[2].trim().toLowerCase();

      if (!seenFormulas.has(formula)) {
        damageEntries.push({ formula, type });
        seenFormulas.add(formula);
      }
    }

    // Match @Damage without type: @Damage[formula]
    const untypedDamageMatches = text.matchAll(/@Damage\[([\d\w+-]+)\](?!\])/gi);
    for (const match of untypedDamageMatches) {
      const formula = match[1].trim();


      if (!seenFormulas.has(formula)) {
        damageEntries.push({
          formula: formula,
          type: 'untyped'
        });
        seenFormulas.add(formula);
      }
    }

    // Then, extract plain text damage patterns like "1d6 poison", "2d8+5 fire"
    const plainDamageMatches = text.matchAll(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(acid|bludgeoning|cold|electricity|fire|force|mental|piercing|poison|slashing|sonic|bleed|persistent)/gi);
    for (const match of plainDamageMatches) {
      const formula = match[1].trim();
      const type = match[2].trim().toLowerCase();

      if (!seenFormulas.has(formula)) {
        damageEntries.push({ formula, type });
        seenFormulas.add(formula);
      }
    }

    return damageEntries;
  }

  /**
   * Extract weakness from effects text
   * Handles patterns like "weakness to cold 5", "weakness 10 to fire", etc.
   * Returns array of objects: [{type: "cold", value: 5}]
   */
  static extractWeakness(text) {
    const weaknesses = [];
    const seenTypes = new Set();


    // Pattern 1: "weakness to [type] [value]" (e.g., "weakness to cold 5")
    const pattern1Matches = text.matchAll(/weakness\s+to\s+(\w+)\s+(\d+)/gi);
    for (const match of pattern1Matches) {
      const type = match[1].trim().toLowerCase();
      const value = parseInt(match[2]);

      if (!seenTypes.has(type)) {
        weaknesses.push({ type, value });
        seenTypes.add(type);
      }
    }

    // Pattern 2: "weakness [value] to [type]" (e.g., "weakness 5 to cold")
    const pattern2Matches = text.matchAll(/weakness\s+(\d+)\s+to\s+(\w+)/gi);
    for (const match of pattern2Matches) {
      const value = parseInt(match[1]);
      const type = match[2].trim().toLowerCase();

      if (!seenTypes.has(type)) {
        weaknesses.push({ type, value });
        seenTypes.add(type);
      }
    }
    return weaknesses;
  }

  /**
   * Extract conditions from effects text
   * Handles both UUID links and plain text conditions
   */
  static extractConditions(text) {
    const conditions = [];
    const foundConditions = new Set();

    // First, extract from UUID links: @UUID[...]{ConditionName} or @UUID[...]{ConditionName Value}
    const uuidMatches = text.matchAll(/@UUID\[[^\]]+\]\{([^}]+)\}/gi);
    for (const match of uuidMatches) {
      const conditionText = match[1].trim();

      // Check if it's a known condition
      for (const condition of PF2E_CONDITIONS) {
        // Escape special regex characters in condition name
        const escapedCondition = condition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const conditionRegex = new RegExp(`^${escapedCondition}\\s*(\\d+)?$`, 'gi');
        const condMatch = conditionText.match(conditionRegex);
        if (condMatch) {
          const valueMatch = conditionText.match(/\d+/);
          const condKey = condition.toLowerCase();
          if (!foundConditions.has(condKey)) {
            conditions.push({
              name: condition,
              value: valueMatch ? parseInt(valueMatch[0]) : null
            });
            foundConditions.add(condKey);
          }
          break;
        }
      }
    }

    // Then extract plain text conditions (strip HTML first)
    const plainText = text.replace(/<[^>]+>/g, ' ').replace(/@UUID\[[^\]]+\]\{[^}]+\}/g, ' ');

    for (const condition of PF2E_CONDITIONS) {
      const condKey = condition.toLowerCase();
      if (foundConditions.has(condKey)) continue; // Already found in UUID

      // Escape special regex characters in condition name
      const escapedCondition = condition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedCondition}\\s*(\\d+)?\\b`, 'gi');
      const match = plainText.match(regex);
      if (match) {
        const valueMatch = match[0].match(/\d+/);
        conditions.push({
          name: condition,
          value: valueMatch ? parseInt(valueMatch[0]) : null
        });
        foundConditions.add(condKey);
      }
    }

    return conditions;
  }

  /**
   * Extract maximum duration before affliction ends
   */
  static extractMaxDuration(description) {
    const maxMatch = description.match(/Maximum Duration\s+([^;.<]+)/i);
    if (maxMatch) {
      return this.parseDuration(maxMatch[1]);
    }
    return null; // no max = indefinite
  }

  /**
   * Convert duration to seconds for time tracking
   */
  static durationToSeconds(duration) {
    if (!duration) return 0;
    const unit = duration.unit.toLowerCase();
    const multiplier = DURATION_MULTIPLIERS[unit] || DURATION_MULTIPLIERS['round'];
    return duration.value * multiplier;
  }
}
