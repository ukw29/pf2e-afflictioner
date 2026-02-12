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

    // Debug logging
    console.log('AfflictionParser: Parsing item', item.name);
    console.log('AfflictionParser: item.system', item.system);

    // Check for structured affliction data first (PF2e native afflictions)
    if (item.system?.stage) {
      console.log('AfflictionParser: Found structured stages', item.system.stage);
      return this.parseStructuredAffliction(item);
    }

    // Parse from description text
    const description = item.system?.description?.value || '';
    console.log('AfflictionParser: Parsing from description', description.substring(0, 200));

    const stages = this.extractStages(description);
    console.log('AfflictionParser: Extracted stages', stages);

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
   * Extract DC from text or item data
   */
  static extractDC(description, item) {
    // Try system data first
    if (item.system?.save?.dc) return item.system.save.dc;

    // Parse from text: "DC 17 Fortitude"
    const dcMatch = description.match(/DC\s+(\d+)/i);
    return dcMatch ? parseInt(dcMatch[1]) : game.settings.get('pf2e-afflictioner', 'defaultDC');
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
      console.log('AfflictionParser: No onset found');
      return null;
    }

    const text = onsetMatch[1].trim();
    console.log('AfflictionParser: Extracted onset text', text);

    const duration = this.parseDuration(text);
    console.log('AfflictionParser: Parsed onset duration', duration);

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
   */
  static extractDamage(text) {
    // Match damage patterns like "1d6 poison", "2d8+5 fire"
    const damageMatch = text.match(/(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+(acid|bludgeoning|cold|electricity|fire|force|mental|piercing|poison|slashing|sonic|bleed|persistent)/gi);
    return damageMatch ? damageMatch.map(d => d.trim()) : [];
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
        const conditionRegex = new RegExp(`^${condition}\\s*(\\d+)?$`, 'gi');
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

      const regex = new RegExp(`\\b${condition}\\s*(\\d+)?\\b`, 'gi');
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
