/**
 * Affliction Effect Builder - Handles effect creation and updates
 */

import * as AfflictionStore from '../stores/AfflictionStore.js';

export class AfflictionEffectBuilder {
  /**
   * Create or update affliction effect with counter badge
   */
  static async createOrUpdateEffect(token, actor, affliction, stage) {
    const bonuses = this.extractBonuses(stage.effects);

    // Check if effect already exists
    if (affliction.appliedEffectUuid) {
      return await this.updateEffect(token, actor, affliction, stage, bonuses);
    }

    return await this.createEffect(token, actor, affliction, stage, bonuses);
  }

  /**
   * Create new affliction effect
   */
  static async createEffect(token, actor, affliction, stage, bonuses) {
    try {
      // Build all components using helper methods
      const rules = await this._buildRulesFromStage(affliction, stage, bonuses);
      const stageDesc = this._buildStageDescription(affliction, stage);
      const shouldBeUnidentified = this.shouldBeUnidentified(affliction);
      const badgeConfig = this._buildBadgeConfig(affliction);
      const durationConfig = this._buildDurationConfig(affliction, stage);

      // Get source item image
      let itemImg = 'icons/svg/hazard.svg'; // default
      if (affliction.sourceItemUuid) {
        try {
          // Suppress notifications for missing items
          const notify = ui.notifications.notify;
          ui.notifications.notify = () => { };
          const sourceItem = await fromUuid(affliction.sourceItemUuid);
          ui.notifications.notify = notify;
          if (sourceItem?.img) itemImg = sourceItem.img;
        } catch {
          // Restore notifications on error
          ui.notifications.notify = ui.notifications.notify.bind?.(ui.notifications) || ui.notifications.notify;
        }
      }

      const effectData = {
        type: 'effect',
        name: affliction.name,
        img: itemImg,
        system: {
          description: { value: stageDesc },
          tokenIcon: { show: true },
          duration: durationConfig,
          badge: badgeConfig,
          rules: rules,
          slug: `${affliction.name.toLowerCase().replace(/\s+/g, '-')}-affliction`,
          unidentified: shouldBeUnidentified
        },
        flags: {
          'pf2e-afflictioner': {
            afflictionId: affliction.id,
            isAfflictionEffect: true
          }
        }
      };

      const [created] = await actor.createEmbeddedDocuments('Item', [effectData]);
      return created?.uuid;
    } catch (error) {
      console.error('PF2e Afflictioner | Error creating effect:', error);
      return null;
    }
  }

  /**
   * Update existing affliction effect for new stage
   */
  static async updateEffect(token, _actor, affliction, stage, bonuses) {
    try {
      const effect = await fromUuid(affliction.appliedEffectUuid);
      if (!effect) return null;

      // Build all components using helper methods
      const rules = await this._buildRulesFromStage(affliction, stage, bonuses);
      const stageDesc = this._buildStageDescription(affliction, stage);
      const shouldBeUnidentified = this.shouldBeUnidentified(affliction);
      const badgeConfig = this._buildBadgeConfig(affliction);
      const durationConfig = this._buildDurationConfig(affliction, stage);

      // If transitioning from unidentified to identified, mark the affliction permanently
      if (!shouldBeUnidentified && !affliction.hasBeenIdentified) {
        await AfflictionStore.updateAffliction(token, affliction.id, {
          hasBeenIdentified: true
        });
      }

      // Update effect with new stage data
      await effect.update({
        'system.badge': badgeConfig,
        'system.duration': durationConfig,
        'system.rules': rules,
        'system.description.value': stageDesc,
        'system.unidentified': shouldBeUnidentified
      });

      return effect.uuid;
    } catch (error) {
      console.error('PF2e Afflictioner | Error updating effect:', error);
      return null;
    }
  }

  /**
   * Determine if affliction effect should be unidentified for players
   */
  static shouldBeUnidentified(affliction) {
    // If currently in onset, keep it mysterious
    if (affliction.inOnset) {
      return true;
    }

    // If already identified (flag set), stay identified
    if (affliction.hasBeenIdentified) {
      return false;
    }

    // Check current stage for any visible mechanical effects
    const currentStageIndex = affliction.currentStage - 1;
    if (currentStageIndex < 0 || !affliction.stages || !affliction.stages[currentStageIndex]) {
      return true; // No valid stage, keep unidentified
    }

    const currentStage = affliction.stages[currentStageIndex];
    const hasConditions = currentStage.conditions && currentStage.conditions.length > 0;
    const hasWeakness = currentStage.weakness && currentStage.weakness.length > 0;
    const hasDamage = currentStage.damage && currentStage.damage.length > 0;

    // Only mechanical effects (conditions, weakness, damage) make the affliction identifiable
    const hasVisibleEffects = hasConditions || hasWeakness || hasDamage;

    // If no visible mechanical effects yet, keep unidentified
    return !hasVisibleEffects;
  }

  /**
   * Normalize time unit from singular to plural for PF2e compatibility
   */
  static _normalizeUnit(unit) {
    if (unit === 'round') return 'rounds';
    if (unit === 'minute') return 'minutes';
    if (unit === 'hour') return 'hours';
    if (unit === 'day') return 'days';
    return unit;
  }

  /**
   * Build duration configuration for effect
   */
  static _buildDurationConfig(affliction, stage) {
    if (affliction.inOnset && stage.duration && typeof stage.duration === 'object' && stage.duration.value) {
      // Onset: use onset duration for effect
      return {
        value: stage.duration.value,
        unit: this._normalizeUnit(stage.duration.unit || 'rounds'),
        expiry: 'turn-start',
        sustained: false
      };
    }

    // Stages always have unlimited duration (they end via saves, not time)
    return {
      value: -1,
      unit: 'unlimited',
      expiry: null,
      sustained: false
    };
  }

  /**
   * Build badge configuration for effect
   */
  static _buildBadgeConfig(affliction) {
    if (affliction.inOnset || affliction.currentStage < 1) {
      return null;
    }

    return {
      type: 'counter',
      value: affliction.currentStage,
      min: 1,
      max: affliction.stages?.length || 4
    };
  }

  /**
   * Build stage description for effect
   */
  static _buildStageDescription(affliction, stage) {
    if (affliction.inOnset) {
      return '<p><strong>Onset</strong></p>';
    }

    if (stage?.rawText) {
      return `<p>${stage.rawText}</p>`;
    }

    return `<p>Stage ${affliction.currentStage}</p>`;
  }

  /**
   * Build rules array from stage data
   */
  static async _buildRulesFromStage(affliction, stage, bonuses) {
    const rules = [];

    // Add bonus rules
    rules.push(...bonuses.map(bonus => {
      const rule = {
        key: 'FlatModifier',
        selector: bonus.selector,
        type: bonus.type,
        value: bonus.value,
        label: affliction.name
      };
      if (bonus.predicate) rule.predicate = bonus.predicate;
      return rule;
    }));

    // Add weakness rules
    if (stage.weakness && stage.weakness.length > 0) {
      for (const weak of stage.weakness) {
        rules.push({
          key: 'Weakness',
          type: weak.type,
          value: weak.value,
          label: `${affliction.name} (Weakness)`
        });
      }
    }

    // Add GrantItem rules for conditions
    if (stage.conditions && stage.conditions.length > 0) {
      for (const condition of stage.conditions) {
        const conditionUuid = await this.getConditionUuid(condition.name);
        if (conditionUuid) {
          const grantRule = {
            key: 'GrantItem',
            uuid: conditionUuid,
            allowDuplicate: true,
            inMemoryOnly: true,
            onDeleteActions: { grantee: 'restrict' }
          };

          if (condition.value) {
            grantRule.alterations = [{
              mode: 'override',
              property: 'badge-value',
              value: condition.value
            }];
          }

          rules.push(grantRule);
        }
      }
    }

    return rules;
  }

  /**
   * Extract bonuses/penalties from effect text
   */
  static extractBonuses(effectText) {
    const bonuses = [];

    const bonusMatch = effectText.match(/([+-]\d+)\s+(item|circumstance|status)\s+bonus\s+to\s+([^(]+)/gi);
    if (bonusMatch) {
      for (const match of bonusMatch) {
        const parts = match.match(/([+-]\d+)\s+(\w+)\s+bonus\s+to\s+(.+)/i);
        if (parts) {
          const value = parseInt(parts[1]);
          const type = parts[2].toLowerCase();
          const targetText = parts[3];

          const targets = targetText.split(/,\s*(?:and\s+)?|\s+and\s+/);

          for (const target of targets) {
            const trimmed = target.trim();
            if (!trimmed) continue;

            bonuses.push({
              value: value,
              type: type,
              selector: this.parseSelector(trimmed),
              predicate: this.parsePredicate(trimmed)
            });
          }
        }
      }
    }

    return bonuses;
  }

  /**
   * Parse selector from bonus text
   */
  static parseSelector(text) {
    const lower = text.toLowerCase().trim();

    if (lower.includes('saving throw') || lower.includes('saves')) {
      if (lower.includes('fortitude')) return 'fortitude';
      if (lower.includes('reflex')) return 'reflex';
      if (lower.includes('will')) return 'will';
      return 'saving-throw';
    }

    if (lower.includes('armor class') || /\bac\b/.test(lower)) return 'ac';
    if (lower.includes('attack')) return 'attack-roll';
    if (lower.includes('weapon') || lower.includes('unarmed')) return 'attack-roll';
    if (lower.includes('perception')) return 'perception';
    if (lower.includes('acrobatics')) return 'acrobatics';
    if (lower.includes('athletics')) return 'athletics';
    if (lower.includes('skill') || lower.includes('check')) return 'skill-check';

    return 'attack-roll';
  }

  /**
   * Parse predicate from bonus text
   */
  static parsePredicate(text) {
    const lower = text.toLowerCase().trim();
    const predicates = [];

    if (lower.includes('against mental')) predicates.push('item:trait:mental');
    if (lower.includes('against emotion')) predicates.push('item:trait:emotion');
    if (lower.includes('against fear')) predicates.push('item:trait:fear');
    if (lower.includes('against poison')) predicates.push('item:trait:poison');
    if (lower.includes('against disease')) predicates.push('item:trait:disease');

    return predicates.length > 0 ? predicates : undefined;
  }

  /**
   * Get condition UUID from name for GrantItem rules
   */
  static async getConditionUuid(conditionName) {
    const slug = conditionName.toLowerCase();

    const pack = game.packs.get('pf2e.conditionitems');
    if (!pack) {
      console.warn(`PF2e Afflictioner | Could not find pf2e.conditionitems compendium`);
      return null;
    }

    const index = await pack.getIndex();
    const entry = index.find(i =>
      i.name.toLowerCase() === slug ||
      (i.system?.slug && i.system.slug === slug)
    );

    if (!entry) {
      console.warn(`PF2e Afflictioner | Condition "${conditionName}" not found in compendium`);
      return null;
    }

    return `Compendium.pf2e.conditionitems.Item.${entry._id}`;
  }
}
