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
    // Check for poison/disease/curse trait
    const traits = item.system?.traits?.value || [];
    const type = traits.includes('poison') ? 'poison' :
                 traits.includes('disease') ? 'disease' :
                 traits.includes('curse') ? 'curse' : null;

    if (!type) return null;

    // Check for virulent trait
    const isVirulent = traits.includes('virulent');

    // Check for structured affliction data first (PF2e native afflictions)
    if (item.system?.stage) {
      return this.parseStructuredAffliction(item);
    }

    // Parse from description text
    const description = item.system?.description?.value || '';

    const stages = this.extractStages(description);

    const maxDuration = item.system?.maxDuration ? this.parseDuration(item.system.maxDuration) : this.extractMaxDuration(description);

    return {
      name: item.name,
      type,
      dc: this.extractDC(description, item),
      onset: item.system?.onset ? this.parseDuration(item.system.onset) : this.extractOnset(description),
      stages: stages,
      maxDuration,
      isVirulent: isVirulent,
      multipleExposure: this.extractMultipleExposure(description),
      sourceItemUuid: item.uuid
    };
  }

  /**
   * Parse structured affliction data from PF2e native affliction format
   */
  static parseStructuredAffliction(item) {
    const stageData = item.system?.stage || 1;
    const dc = item.system?.save?.dc || item.system?.save?.value || game.settings.get('pf2e-afflictioner', 'defaultDC');

    // Check for virulent trait
    const traits = item.system?.traits?.value || [];
    const isVirulent = traits.includes('virulent');

    // Build stages array from structured data
    const stages = [];
    if (typeof stageData === 'object' && !Array.isArray(stageData)) {
      // Structured stage object (e.g., {1: {effects: [...], duration: {...}}, 2: {...}})
      for (const [stageNum, stageInfo] of Object.entries(stageData)) {
        if (!isNaN(stageNum)) {
          const effectsText = this.formatEffectsFromStructured(stageInfo.effects || []);
          stages.push({
            number: parseInt(stageNum),
            effects: effectsText,
            rawText: `Stage ${stageNum}: ${effectsText}`,
            duration: stageInfo.duration || { value: 1, unit: 'hour', isDice: false },
            damage: this.extractDamageFromStructured(stageInfo.effects || []),
            conditions: this.extractConditionsFromStructured(stageInfo.effects || []),
            weakness: this.extractWeaknessFromStructured(stageInfo.effects || []),
            requiresManualHandling: false,
            isDead: this.detectDeath(effectsText)
          });
        }
      }
    }

    const description = item.system?.description?.value || '';

    // Determine type from traits
    const itemTraits = item.system?.traits?.value || [];
    const afflictionType = itemTraits.includes('poison') ? 'poison' :
                          itemTraits.includes('disease') ? 'disease' :
                          itemTraits.includes('curse') ? 'curse' : 'poison';

    return {
      name: item.name,
      type: afflictionType,
      dc,
      onset: item.system?.onset ? this.parseDuration(item.system.onset) : null,
      stages: stages,
      maxDuration: item.system?.maxDuration ? this.parseDuration(item.system.maxDuration) : this.extractMaxDuration(description),
      isVirulent: isVirulent,
      multipleExposure: this.extractMultipleExposure(description),
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
    const matchedStageNums = new Set();

    // Try HTML format first: <p><strong>Stage X</strong> effects (duration)</p>
    const htmlMatches = description.matchAll(/<strong>Stage\s+(\d+)<\/strong>\s+(.+?)\(([^)]+)\)([^<]*)/gi);

    for (const match of htmlMatches) {
      const stageNum = parseInt(match[1]);
      const effectsBefore = match[2].trim();
      const durationText = match[3];
      const effectsAfter = match[4].trim();
      const effects = [effectsBefore, effectsAfter].filter(e => e).join(' ');
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
        requiresManualHandling: requiresManualHandling,
        isDead: this.detectDeath(effects)
      });
      matchedStageNums.add(stageNum);
    }

    // Second pass: catch stages without parenthesized duration (e.g., "for 2d4 hours")
    const htmlParaMatches = description.matchAll(/<strong>Stage\s+(\d+)<\/strong>\s*([\s\S]*?)<\/p>/gi);
    for (const match of htmlParaMatches) {
      const stageNum = parseInt(match[1]);
      if (matchedStageNums.has(stageNum)) continue;

      const rawContent = match[2];
      const plainText = this.stripEnrichment(rawContent);

      // Try Foundry inline roll notation first: [[/br 2d4 #hours]] or [[2d4 #hours]]
      const inlineRollMatch = rawContent.match(/\[\[(?:\/br\s+)?(\d+d\d+(?:[+-]\d+)?)\s+#(\w+)\]\]/i);
      let duration;
      if (inlineRollMatch) {
        duration = this.parseDuration(`${inlineRollMatch[1]} ${inlineRollMatch[2]}`);
      } else {
        const forMatch = plainText.match(/\bfor\s+(\d+d\d+\s+\w+|\d+\s+\w+)\s*$/i);
        duration = forMatch ? this.parseDuration(forMatch[1]) : null;
      }

      const requiresManualHandling = this.detectManualHandling(plainText);

      stages.push({
        number: stageNum,
        effects: rawContent.trim(),
        rawText: match[0],
        duration: duration,
        damage: this.extractDamage(rawContent),
        conditions: this.extractConditions(rawContent),
        weakness: this.extractWeakness(rawContent),
        requiresManualHandling: requiresManualHandling,
        isDead: this.detectDeath(rawContent)
      });
      matchedStageNums.add(stageNum);
    }

    stages.sort((a, b) => a.number - b.number);

    // If no HTML matches, try plain text format
    if (stages.length === 0) {
      const plainMatches = description.matchAll(/Stage\s+(\d+)\s+(.+?)\(([^)]+)\)([^]*)/gi);

      for (const match of plainMatches) {
        const stageNum = parseInt(match[1]);
        const effectsBefore = match[2].trim();
        const durationText = match[3];
        const effectsAfter = match[4].trim();
        const effects = [effectsBefore, effectsAfter].filter(e => e).join(' ');
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
          requiresManualHandling: requiresManualHandling,
          isDead: this.detectDeath(effects)
        });
      }
    }

    this.resolveStageReferences(stages);
    return stages;
  }

  /**
   * Strip Foundry enrichment notation and HTML, returning plain text.
   * Handles [[/br formula #unit]]{display}, @Tag[...]{display}, and HTML tags.
   */
  static stripEnrichment(text) {
    return text
      .replace(/\[\[[^\]]*\]\]\{([^}]+)\}/g, '$1')  // [[...]]{ display } → display
      .replace(/@\w+\[[^\]]*\]\{([^}]+)\}/g, '$1')  // @Tag[...]{display} → display
      .replace(/@\w+\[[^\]]*\]/g, '')               // @Tag[...] (no display) → ''
      .replace(/<[^>]+>/g, ' ')                     // HTML tags → space
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Detect if stage requires manual handling by GM
   */
  static detectManualHandling(effectsText) {
    const manualKeywords = [
      'secret', 'gm', 'special', 'ability', 'save again',
      'choose', 'option', 'or', 'either', 'instead',
      'permanent'
    ];

    const lowerText = effectsText.toLowerCase();
    return manualKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Detect if stage causes death
   */
  static detectDeath(effectsText) {
    const stripped = this.stripEnrichment(effectsText).toLowerCase();
    return /\bdead\b|\bdies\b|\binstant\s+death\b/.test(stripped);
  }

  /**
   * Resolve "as stage X" references — copy mechanical data from referenced stage
   */
  static resolveStageReferences(stages) {
    for (const stage of stages) {
      const stripped = this.stripEnrichment(stage.effects || stage.rawText || '').toLowerCase();
      const match = stripped.match(/\bas\s+stage\s+(\d+)\b/i);
      if (!match) continue;

      const refNum = parseInt(match[1]);
      const ref = stages.find(s => s.number === refNum);
      if (!ref) continue;

      stage.damage = ref.damage;
      stage.conditions = ref.conditions;
      stage.weakness = ref.weakness;
      stage.requiresManualHandling = ref.requiresManualHandling;
      stage.isDead = ref.isDead;
    }
  }

  /**
   * Parse duration text into structured format
   * For dice durations, stores formula for rolling at stage entry
   */
  static parseDuration(text) {
    // Handle PF2e duration objects: {value: 6, unit: "rounds"}
    if (text !== null && typeof text === 'object') {
      if (!text.value || text.unit === 'unlimited') return null;
      return {
        value: text.value,
        unit: text.unit.toLowerCase().replace(/s$/, ''),
        isDice: false
      };
    }

    // Handle dice: "1d4 rounds" - store formula, roll deferred to stage entry
    const diceMatch = text.match(/(\d+d\d+)\s+(\w+)/i);
    if (diceMatch) {
      const formula = diceMatch[1];
      const unit = diceMatch[2].toLowerCase().replace(/s$/, ''); // Remove plural 's'

      return {
        formula: formula,
        value: null, // resolved when entering stage via resolveStageDuration
        unit: unit,
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

    // Check for "or" damage (e.g., "3d6 cold or fire damage")
    const orDamagePattern = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(\w+)\s+or\s+(\w+)\s+damage/gi;
    const orMatches = text.matchAll(orDamagePattern);
    for (const match of orMatches) {
      const formula = match[1].trim();
      const type1 = match[2].trim().toLowerCase();
      const type2 = match[3].trim().toLowerCase();

      if (!seenFormulas.has(formula)) {
        damageEntries.push({
          formula,
          type: type1,
          isChoice: true,
          alternativeType: type2
        });
        seenFormulas.add(formula);
      }
    }

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
    // Skip if already matched by "or" pattern
    const plainDamageMatches = text.matchAll(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(acid|bludgeoning|cold|electricity|fire|force|mental|piercing|poison|slashing|sonic|bleed|persistent)(?!\s+or)/gi);
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
    const maxMatch = description.match(/Maximum Duration(?:<\/[^>]+>)?\s+([^;.<]+)/i);
    if (maxMatch) {
      return this.parseDuration(maxMatch[1].trim());
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
    return (duration.value ?? 0) * multiplier;
  }

  /**
   * Resolve a stage duration: rolls dice if needed, posts result to GM, returns seconds.
   * Use this at stage-entry points instead of durationToSeconds.
   */
  static async resolveStageDuration(duration, stageName = 'Stage') {
    if (!duration) return 0;

    if (!duration.isDice || !duration.formula) {
      return this.durationToSeconds(duration);
    }

    const formula = duration.formula;
    let total;
    try {
      const roll = new Roll(formula);
      await roll.evaluate();
      total = roll.total;
    } catch (e) {
      console.warn('PF2e Afflictioner | Roll.evaluate failed, using fallback:', e);
    }
    if (!total || total < 1) {
      const [numDice, dieSize] = formula.split('d').map(Number);
      total = 0;
      for (let i = 0; i < numDice; i++) {
        total += Math.floor(Math.random() * dieSize) + 1;
      }
    }

    ChatMessage.create({
      flavor: `${stageName} Duration`,
      content: `<div class="dice-roll"><div class="dice-result"><h4 class="dice-formula">${formula} ${duration.unit}(s)</h4><div class="dice-total">${total}</div></div></div>`,
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
    ui.notifications.info(`${stageName}: rolled ${formula} → ${total} ${duration.unit}(s)`);

    // Update in-memory value so elapsed-time checks in the same session stay consistent
    duration.value = total;

    const unit = duration.unit.toLowerCase();
    const multiplier = DURATION_MULTIPLIERS[unit] || DURATION_MULTIPLIERS['round'];
    return total * multiplier;
  }

  /**
   * Format seconds into human-readable duration string
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration (e.g., "3d", "2h", "45m", "30s")
   */
  static formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0s';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  /**
   * Extract multiple exposure rules from description
   * Parses patterns like:
   * - "Each time you're exposed while already afflicted, you increase the stage by 1"
   * - "Multiple exposures increase the stage by 1"
   * - "Each additional exposure advances the stage by 2"
   *
   * Returns object with:
   * - enabled: boolean
   * - stageIncrease: number of stages to advance on re-exposure
   * - minStage: minimum stage required for re-exposure to apply (null if any stage)
   * - rawText: original text for reference
   */
  static extractMultipleExposure(description) {
    if (!description) return null;

    // Strip HTML tags for cleaner matching
    const plainText = description.replace(/<[^>]+>/g, ' ');

    // Pattern 1: "each time you're exposed" or "each additional exposure"
    const pattern1 = /(?:each\s+(?:time\s+you(?:'re|are)\s+exposed|additional\s+exposure)).*?(?:increase|advance).*?(?:stage|stages)\s*(?:by\s*)?(\d+)/i;
    const match1 = plainText.match(pattern1);

    if (match1) {
      const stageIncrease = parseInt(match1[1]) || 1;

      // Check if there's a minimum stage requirement
      const minStageMatch = plainText.match(/(?:while|at|when)\s+(?:already\s+)?(?:at\s+)?stage\s+(\d+)/i);
      const minStage = minStageMatch ? parseInt(minStageMatch[1]) : null;

      return {
        enabled: true,
        stageIncrease: stageIncrease,
        minStage: minStage,
        rawText: match1[0]
      };
    }

    // Pattern 2: "multiple exposures" variant
    const pattern2 = /multiple\s+exposures.*?(?:increase|advance).*?(?:stage|stages)\s*(?:by\s*)?(\d+)/i;
    const match2 = plainText.match(pattern2);

    if (match2) {
      const stageIncrease = parseInt(match2[1]) || 1;

      return {
        enabled: true,
        stageIncrease: stageIncrease,
        minStage: null,
        rawText: match2[0]
      };
    }

    return null;
  }
}
