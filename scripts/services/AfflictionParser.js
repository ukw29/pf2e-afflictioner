import { PF2E_CONDITIONS, DURATION_MULTIPLIERS } from '../constants.js';

export class AfflictionParser {
  static parseFromItem(item) {
    const traits = item.system?.traits?.value || [];
    const type = traits.includes('poison') ? 'poison' :
      traits.includes('disease') ? 'disease' :
        traits.includes('curse') ? 'curse' : null;

    if (!type) return null;

    const isVirulent = traits.includes('virulent');

    if (item.system?.stage) {
      return this.parseStructuredAffliction(item);
    }

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

  static parseStructuredAffliction(item) {
    const stageData = item.system?.stage || 1;
    const dc = item.system?.save?.dc || item.system?.save?.value;

    if (!dc) {
      console.warn(`PF2e Afflictioner | No DC found for affliction item "${item.name}" (${item.uuid}).`);
      ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.NO_DC_FOUND', {
        itemName: item.name,
      }));
      return null;
    }

    const traits = item.system?.traits?.value || [];
    const isVirulent = traits.includes('virulent');

    const stages = [];
    if (typeof stageData === 'object' && !Array.isArray(stageData)) {
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

  static formatEffectsFromStructured(effects) {
    if (!Array.isArray(effects)) return '';
    return effects.map(e => {
      if (typeof e === 'string') return e;
      if (e.name && e.value) return `${e.name} ${e.value}`;
      if (e.name) return e.name;
      return JSON.stringify(e);
    }).join(', ');
  }

  static extractDamageFromStructured(effects) {
    if (!Array.isArray(effects)) return [];
    return effects.filter(e => e.type === 'damage' || e.damageType).map(e => {
      return e.formula || `${e.value || '0'} ${e.damageType || 'damage'}`;
    });
  }

  static extractConditionsFromStructured(effects) {
    if (!Array.isArray(effects)) return [];
    return effects.filter(e => PF2E_CONDITIONS.includes(e.name?.toLowerCase() || e.condition?.toLowerCase())).map(e => ({
      name: e.name || e.condition,
      value: e.value || null
    }));
  }

  static extractWeaknessFromStructured(effects) {
    if (!Array.isArray(effects)) return [];
    return effects.filter(e => e.type === 'weakness' || e.weakness).map(e => ({
      type: e.damageType || e.type || 'physical',
      value: e.value || 0
    }));
  }

  static extractDC(description, item) {
    if (item.system?.save?.dc) return item.system.save.dc;
    if (item.system?.save?.value) return item.system.save.value;

    let dcMatch = description.match(/@Check\[[^\]]*\|dc:(\d+)\]/i);
    if (dcMatch) return parseInt(dcMatch[1]);

    dcMatch = description.match(/DC\s+(\d+)/i);
    if (dcMatch) return parseInt(dcMatch[1]);

    console.warn(`PF2e Afflictioner | No DC found for affliction item "${item.name}" (${item.uuid}).`);
    ui.notifications.warn(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.NO_DC_FOUND', {
      itemName: item.name
    }));
    return null;
  }

  static extractOnset(description) {
    let onsetMatch = description.match(/<strong>Onset<\/strong>\s+([^<]+)/i);

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

  static extractStages(description) {
    const stages = [];
    const matchedStageNums = new Set();

    const htmlMatches = description.matchAll(/<strong>Stage\s+(\d+)<\/strong>\s+(.+?)\(([^)]+)\)([^<]*)/gi);

    for (const match of htmlMatches) {
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
      matchedStageNums.add(stageNum);
    }

    const htmlParaMatches = description.matchAll(/<strong>Stage\s+(\d+)<\/strong>\s*([\s\S]*?)<\/p>/gi);
    for (const match of htmlParaMatches) {
      const stageNum = parseInt(match[1]);
      if (matchedStageNums.has(stageNum)) continue;

      const rawContent = match[2];
      const plainText = this.stripEnrichment(rawContent);

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

  static stripEnrichment(text) {
    return text
      .replace(/\[\[[^\]]*\]\]\{([^}]+)\}/g, '$1')
      .replace(/@\w+\[[^\]]*\]\{([^}]+)\}/g, '$1')
      .replace(/@\w+\[[^\]]*\]/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static detectManualHandling(effectsText) {
    const manualKeywords = [
      'secret', 'gm', 'special', 'ability', 'save again',
      'choose', 'option', 'or', 'either', 'instead',
      'permanent'
    ];

    const lowerText = effectsText.toLowerCase();
    return manualKeywords.some(keyword => lowerText.includes(keyword));
  }

  static detectDeath(effectsText) {
    const stripped = this.stripEnrichment(effectsText).toLowerCase();
    return /\bdead\b|\bdies\b|\binstant\s+death\b/.test(stripped);
  }

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

  static parseDuration(text) {
    if (text !== null && typeof text === 'object') {
      if (!text.value || text.unit === 'unlimited') return null;
      return {
        value: text.value,
        unit: text.unit.toLowerCase().replace(/s$/, ''),
        isDice: false
      };
    }

    const diceMatch = text.match(/(\d+d\d+)\s+(\w+)/i);
    if (diceMatch) {
      const formula = diceMatch[1];
      const unit = diceMatch[2].toLowerCase().replace(/s$/, '');

      return {
        formula: formula,
        value: null,
        unit: unit,
        isDice: true
      };
    }

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

  static extractDamage(text) {
    const damageEntries = [];
    const seenFormulas = new Set();

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

    const typedDamageMatches = text.matchAll(/@Damage\[([\d\w+-]+)\[([^\]]+)\]\]/gi);
    for (const match of typedDamageMatches) {
      const formula = match[1].trim();
      const type = match[2].trim().toLowerCase();

      if (!seenFormulas.has(formula)) {
        damageEntries.push({ formula, type });
        seenFormulas.add(formula);
      }
    }

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

  static extractWeakness(text) {
    const weaknesses = [];
    const seenTypes = new Set();

    const pattern1Matches = text.matchAll(/weakness\s+to\s+(\w+)\s+(\d+)/gi);
    for (const match of pattern1Matches) {
      const type = match[1].trim().toLowerCase();
      const value = parseInt(match[2]);

      if (!seenTypes.has(type)) {
        weaknesses.push({ type, value });
        seenTypes.add(type);
      }
    }

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

  static extractConditions(text) {
    const conditions = [];
    const foundConditions = new Set();

    const uuidMatches = text.matchAll(/@UUID\[[^\]]+\]\{([^}]+)\}/gi);
    for (const match of uuidMatches) {
      const conditionText = match[1].trim();

      for (const condition of PF2E_CONDITIONS) {
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

    const plainText = text.replace(/<[^>]+>/g, ' ').replace(/@UUID\[[^\]]+\]\{[^}]+\}/g, ' ');

    for (const condition of PF2E_CONDITIONS) {
      const condKey = condition.toLowerCase();
      if (foundConditions.has(condKey)) continue;

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

  static extractMaxDuration(description) {
    const maxMatch = description.match(/Maximum Duration(?:<\/[^>]+>)?\s+([^;.<]+)/i);
    if (maxMatch) {
      return this.parseDuration(maxMatch[1].trim());
    }
    return null;
  }

  static durationToSeconds(duration) {
    if (!duration) return 0;
    const unit = duration.unit.toLowerCase();
    const multiplier = DURATION_MULTIPLIERS[unit] || DURATION_MULTIPLIERS['round'];
    return (duration.value ?? 0) * multiplier;
  }

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

    duration.value = total;

    const unit = duration.unit.toLowerCase();
    const multiplier = DURATION_MULTIPLIERS[unit] || DURATION_MULTIPLIERS['round'];
    return total * multiplier;
  }

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

  static extractMultipleExposure(description) {
    if (!description) return null;

    const plainText = description.replace(/<[^>]+>/g, ' ');

    const pattern1 = /(?:each\s+(?:time\s+you(?:'re|are)\s+exposed|additional\s+exposure)).*?(?:increase|advance).*?(?:stage|stages)\s*(?:by\s*)?(\d+)/i;
    const match1 = plainText.match(pattern1);

    if (match1) {
      const stageIncrease = parseInt(match1[1]) || 1;

      const minStageMatch = plainText.match(/(?:while|at|when)\s+(?:already\s+)?(?:at\s+)?stage\s+(\d+)/i);
      const minStage = minStageMatch ? parseInt(minStageMatch[1]) : null;

      return {
        enabled: true,
        stageIncrease: stageIncrease,
        minStage: minStage,
        rawText: match1[0]
      };
    }

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
