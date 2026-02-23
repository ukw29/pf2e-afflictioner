import { PF2E_CONDITIONS, DURATION_MULTIPLIERS } from '../constants.js';
import { getParserLocale } from '../locales/parser-locales.js';

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

    if (!stages || stages.length === 0) {
      return {
        skip: true
      };
    }

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
    const dc = item.system?.save?.dc || item.system?.save?.value || item.system?.dc?.value;

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
            duration: stageInfo.duration ? this.parseDuration(stageInfo.duration) || { value: 1, unit: 'hour', isDice: false } : { value: 1, unit: 'hour', isDice: false },
            damage: this.extractDamageFromStructured(stageInfo.effects || []),
            conditions: this.extractConditionsFromStructured(stageInfo.effects || []),
            weakness: this.extractWeaknessFromStructured(stageInfo.effects || []),
            requiresManualHandling: false,
            isDead: this.detectDeath(effectsText)
          });
        }
      }
    }

    if (!stages || stages.length === 0) {
      return { skip: true };
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
    if (item.system?.dc?.value) return item.system.dc.value;

    // Engine-level enricher attributes — always ASCII regardless of locale.
    let dcMatch = description.match(/@Check\[[^\]]*\|dc:(\d+)\]/i);
    if (dcMatch) return parseInt(dcMatch[1]);

    dcMatch = description.match(/data-pf2-dc="(\d+)"/i);
    if (dcMatch) return parseInt(dcMatch[1]);

    // Locale-specific plain-text fallback (e.g. "DC 18").
    dcMatch = description.match(getParserLocale().dcPattern);
    if (dcMatch) return parseInt(dcMatch[1]);

    console.warn(`PF2e Afflictioner | No DC found for affliction item "${item.name}" (${item.uuid}).`);
    return null;
  }

  static extractOnset(description) {
    const { onsetLabel } = getParserLocale();
    const escaped = onsetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let onsetMatch = description.match(new RegExp(`<strong>${escaped}<\\/strong>\\s+([^<]+)`, 'i'));
    if (!onsetMatch) {
      onsetMatch = description.match(new RegExp(`${escaped}\\s+([^;.<]+)`, 'i'));
    }
    if (!onsetMatch) return null;

    return this.parseDuration(onsetMatch[1].trim());
  }

  static extractStages(description) {
    const locale = getParserLocale();
    const sl = locale.stageLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const stages = [];
    const matchedStageNums = new Set();

    const htmlInlineRe = new RegExp(`<strong>${sl}\\s+(\\d+)<\\/strong>\\s+(.+?)\\(([^)]+)\\)([^<]*)`, 'gi');
    for (const match of description.matchAll(htmlInlineRe)) {
      const stageNum = parseInt(match[1]);
      const effectsBefore = match[2].trim();
      const durationText = match[3];
      const effectsAfter = match[4].trim();
      const effects = [effectsBefore, effectsAfter].filter(e => e).join(' ');
      const duration = this.parseDuration(durationText);

      stages.push({
        number: stageNum,
        effects: effects,
        rawText: match[0],
        duration: duration,
        damage: this.extractDamage(effects),
        conditions: this.extractConditions(effects),
        weakness: this.extractWeakness(effects),
        requiresManualHandling: this.detectManualHandling(effects),
        isDead: this.detectDeath(effects)
      });
      matchedStageNums.add(stageNum);
    }

    const htmlParaRe = new RegExp(`<strong>${sl}\\s+(\\d+)<\\/strong>\\s*([\\s\\S]*?)<\\/p>`, 'gi');
    for (const match of description.matchAll(htmlParaRe)) {
      const stageNum = parseInt(match[1]);
      if (matchedStageNums.has(stageNum)) continue;

      const rawContent = match[2];
      const plainText = this.stripEnrichment(rawContent);

      // Inline roll duration: [[/br 2d6 #rounds]] — FoundryVTT syntax, locale-independent.
      const inlineRollMatch = rawContent.match(/\[\[(?:\/br\s+)?(\d+d\d+(?:[+-]\d+)?)\s+#(\w+)\]\]/i);
      let duration;
      if (inlineRollMatch) {
        duration = this.parseDuration(`${inlineRollMatch[1]} ${inlineRollMatch[2]}`);
      } else {
        const forMatch = plainText.match(locale.forDurationPattern);
        duration = forMatch ? this.parseDuration(forMatch[1]) : null;
      }

      stages.push({
        number: stageNum,
        effects: rawContent.trim(),
        rawText: match[0],
        duration: duration,
        damage: this.extractDamage(rawContent),
        conditions: this.extractConditions(rawContent),
        weakness: this.extractWeakness(rawContent),
        requiresManualHandling: this.detectManualHandling(plainText),
        isDead: this.detectDeath(rawContent)
      });
      matchedStageNums.add(stageNum);
    }

    stages.sort((a, b) => a.number - b.number);

    if (stages.length === 0) {
      const plainRe = new RegExp(`${sl}\\s+(\\d+)\\s+(.+?)\\(([^)]+)\\)([^]*)`, 'gi');
      for (const match of description.matchAll(plainRe)) {
        const stageNum = parseInt(match[1]);
        const effectsBefore = match[2].trim();
        const durationText = match[3];
        const effectsAfter = match[4].trim();
        const effects = [effectsBefore, effectsAfter].filter(e => e).join(' ');
        const duration = this.parseDuration(durationText);

        stages.push({
          number: stageNum,
          effects: effects,
          rawText: match[0],
          duration: duration,
          damage: this.extractDamage(effects),
          conditions: this.extractConditions(effects),
          weakness: this.extractWeakness(effects),
          requiresManualHandling: this.detectManualHandling(effects),
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
    const lowerText = effectsText.toLowerCase();
    return getParserLocale().manualKeywords.some(keyword => lowerText.includes(keyword));
  }

  static detectDeath(effectsText) {
    const stripped = this.stripEnrichment(effectsText).toLowerCase();
    return getParserLocale().deathPattern.test(stripped);
  }

  static resolveStageReferences(stages) {
    const { asStagePattern } = getParserLocale();
    for (const stage of stages) {
      const stripped = this.stripEnrichment(stage.effects || stage.rawText || '').toLowerCase();
      const match = stripped.match(asStagePattern);
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
    const locale = getParserLocale();

    if (text !== null && typeof text === 'object') {
      if (!text.value || text.unit === 'unlimited') return null;
      const unit = locale.durationUnitMap[text.unit.toLowerCase()] ?? text.unit.toLowerCase().replace(/s$/, '');
      return { value: text.value, unit, isDice: false };
    }

    const diceMatch = text.match(locale.durationDiceRegex);
    if (diceMatch) {
      const formula = diceMatch[1];
      const rawUnit = diceMatch[2];
      const unit = locale.durationUnitMap[rawUnit.toLowerCase()] ?? rawUnit.toLowerCase().replace(/s$/, '');
      return { formula, value: null, unit, isDice: true };
    }

    const fixedMatch = text.match(locale.durationFixedRegex);
    if (fixedMatch) {
      const rawUnit = fixedMatch[2];
      const unit = locale.durationUnitMap[rawUnit.toLowerCase()] ?? rawUnit.toLowerCase().replace(/s$/, '');
      return { value: parseInt(fixedMatch[1]), unit, isDice: false };
    }

    return { value: 1, unit: 'round', isDice: false };
  }

  static extractDamage(text) {
    const locale = getParserLocale();
    const damageEntries = [];
    const seenFormulas = new Set();

    for (const match of text.matchAll(locale.orDamagePattern)) {
      const formula = match[1].trim();
      const type1 = match[2].trim().toLowerCase();
      const type2 = match[3].trim().toLowerCase();
      if (!seenFormulas.has(formula)) {
        damageEntries.push({ formula, type: type1, isChoice: true, alternativeType: type2 });
        seenFormulas.add(formula);
      }
    }

    // Inline roll format: [[/r 1d6[poison]]] or [[/br 1d6[poison]]]
    // FoundryVTT engine syntax — locale-independent.
    for (const match of text.matchAll(/\[\[\/(?:br?\s+)([\dd\w+-]+)\[(\w+)\]\]\]/gi)) {
      const formula = match[1].trim();
      const type = match[2].trim().toLowerCase();
      if (!seenFormulas.has(formula)) {
        damageEntries.push({ formula, type });
        seenFormulas.add(formula);
      }
    }

    // @Damage enricher — FoundryVTT engine syntax, locale-independent.
    for (const match of text.matchAll(/@Damage\[([\d\w+-]+)\[([^\]]+)\]\]/gi)) {
      const formula = match[1].trim();
      const type = match[2].trim().toLowerCase();
      if (!seenFormulas.has(formula)) {
        damageEntries.push({ formula, type });
        seenFormulas.add(formula);
      }
    }

    for (const match of text.matchAll(/@Damage\[([\d\w+-]+)\](?!\])/gi)) {
      const formula = match[1].trim();
      if (!seenFormulas.has(formula)) {
        damageEntries.push({ formula, type: 'untyped' });
        seenFormulas.add(formula);
      }
    }

    // Plain-text fallback: "1d6 fire" — uses locale damage type list.
    const typePattern = locale.damageTypes.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const plainRe = new RegExp(`(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+(${typePattern})(?!\\s+or)`, 'gi');
    for (const match of text.matchAll(plainRe)) {
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

    for (const { regex, typeGroup, valueGroup } of getParserLocale().weaknessPatterns) {
      for (const match of text.matchAll(regex)) {
        const type = match[typeGroup].trim().toLowerCase();
        const value = parseInt(match[valueGroup]);
        if (!seenTypes.has(type)) {
          weaknesses.push({ type, value });
          seenTypes.add(type);
        }
      }
    }
    return weaknesses;
  }

  static extractConditions(text) {
    const conditions = [];
    const foundConditions = new Set();
    const locale = getParserLocale();

    // ── UUID enricher matches: @UUID[...]{Display Name} ────────────────────
    for (const match of text.matchAll(/@UUID\[[^\]]+\]\{([^}]+)\}/gi)) {
      const raw = match[1].trim();
      for (const [displayName, conditionKey] of locale.conditionDisplayMap) {
        const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`^${escaped}\\s*(\\d+)?$`, 'i').test(raw)) continue;

        const condKey = conditionKey.toLowerCase();
        if (!foundConditions.has(condKey)) {
          const valueMatch = raw.match(/\d+/);
          conditions.push({ name: conditionKey, value: valueMatch ? parseInt(valueMatch[0]) : null });
          foundConditions.add(condKey);
        }
        break;
      }
    }

    // ── Plain-text fallback ─────────────────────────────────────────────────
    const plainText = text.replace(/<[^>]+>/g, ' ').replace(/@UUID\[[^\]]+\]\{[^}]+\}/g, ' ');
    const b = locale.useWordBoundaries ? '\\b' : '';

    for (const [displayName, conditionKey] of locale.conditionDisplayMap) {
      const condKey = conditionKey.toLowerCase();
      if (foundConditions.has(condKey)) continue;

      const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`${b}${escaped}\\s*(\\d+)?${b}`, 'gi');
      const match = plainText.match(regex);
      if (match) {
        const valueMatch = match[0].match(/\d+/);
        conditions.push({ name: conditionKey, value: valueMatch ? parseInt(valueMatch[0]) : null });
        foundConditions.add(condKey);
      }
    }

    return conditions;
  }

  static extractMaxDuration(description) {
    const { maxDurationLabel } = getParserLocale();
    const escaped = maxDurationLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const maxMatch = description.match(new RegExp(`${escaped}(?:<\\/[^>]+>)?\\s+([^;.<]+)`, 'i'));
    if (maxMatch) return this.parseDuration(maxMatch[1].trim());
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
    ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.NOTIFICATIONS.DICE_DURATION_ROLLED', {
      stageName,
      formula,
      total,
      unit: duration.unit
    }));

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

    for (const { main, minStage } of getParserLocale().multipleExposurePatterns) {
      const match = plainText.match(main);
      if (!match) continue;

      const stageIncrease = parseInt(match[1]) || 1;
      const minStageMatch = minStage ? plainText.match(minStage) : null;
      return {
        enabled: true,
        stageIncrease,
        minStage: minStageMatch ? parseInt(minStageMatch[1]) : null,
        rawText: match[0]
      };
    }

    return null;
  }
}
