/**
 * Stage Editor Dialog - UI for editing individual affliction stage details
 */

export class StageEditorDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-afflictioner-stage-editor',
    classes: ['pf2e-afflictioner', 'stage-editor'],
    tag: 'form',
    window: {
      title: 'Edit Stage',
      icon: 'fas fa-edit',
      resizable: true
    },
    position: {
      width: 600,
      height: 'auto'
    },
    actions: {
      parseEffectsText: StageEditorDialog.parseEffectsText,
      addDamage: StageEditorDialog.addDamage,
      removeDamage: StageEditorDialog.removeDamage,
      addCondition: StageEditorDialog.addCondition,
      removeCondition: StageEditorDialog.removeCondition,
      addWeakness: StageEditorDialog.addWeakness,
      removeWeakness: StageEditorDialog.removeWeakness,
      openEffect: StageEditorDialog.openEffect,
      addRuleElement: StageEditorDialog.addRuleElement,
      editRuleElement: StageEditorDialog.editRuleElement,
      removeRuleElement: StageEditorDialog.removeRuleElement,
      removeEffect: StageEditorDialog.removeEffect,
      removeAllEffects: StageEditorDialog.removeAllEffects,
      saveStage: StageEditorDialog.saveStage,
      cancelStageEdit: StageEditorDialog.cancelStageEdit
    }
  };

  static PARTS = {
    form: {
      template: 'modules/pf2e-afflictioner/templates/stage-editor.hbs'
    }
  };

  constructor(stageData, options = {}) {
    super(options);
    this.stageData = foundry.utils.deepClone(stageData);
    this.onSave = options.onSave || null;
    this.afflictionName = options.afflictionName || 'Affliction';
    this.stageNumber = options.stageNumber || this.stageData.number;

    // Ensure arrays exist
    if (!this.stageData.damage) this.stageData.damage = [];
    if (!this.stageData.conditions) this.stageData.conditions = [];
    if (!this.stageData.weakness) this.stageData.weakness = [];
    if (!this.stageData.autoEffects) this.stageData.autoEffects = [];
    if (!this.stageData.ruleElements) this.stageData.ruleElements = [];

    // Update window title
    this.options.window.title = game.i18n.format('PF2E_AFFLICTIONER.EDITOR.STAGE_EDITOR_TITLE', {
      number: this.stageData.number
    });
  }

  async _prepareContext(_options) {
    const effectsText = this.stageData.effects || '';

    // Parse damage formulas into structured parts for display
    const stageWithParsedDamage = {
      ...this.stageData,
      effects: this.stripEnrichers(effectsText), // Show cleaned text in textarea
      damage: this.stageData.damage.map(dmg => {
        // Parse formula like "2d6+3" or "1d8" into parts
        const parsed = this.parseDamageFormula(dmg.formula);
        return {
          ...dmg,
          diceCount: parsed.diceCount,
          diceType: parsed.diceType,
          bonus: parsed.bonus,
          damageType: dmg.type // Rename 'type' to 'damageType' for clarity
        };
      }),
      parsedEnrichers: this.parseEffectEnrichers(effectsText)
    };

    return {
      stage: stageWithParsedDamage
    };
  }

  /**
   * Strip enricher tags from text, leaving only plain text
   * @param {string} text - Text with @UUID, @Damage, etc.
   * @returns {string} - Cleaned text
   */
  stripEnrichers(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove @UUID[uuid]{Label} tags, keeping just the label
    cleaned = cleaned.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1');

    // Remove @Damage[formula[type]] tags completely (shown as separate damage entries)
    cleaned = cleaned.replace(/@Damage\[[^\]]+\]/g, '');

    // Remove @Check[type:dc] tags
    cleaned = cleaned.replace(/@Check\[[^\]]+\]/g, '');

    // Clean up extra whitespace and "and" artifacts
    cleaned = cleaned.replace(/\s+and\s*$/g, '').trim();
    cleaned = cleaned.replace(/\s+/g, ' ');

    return cleaned;
  }

  /**
   * Parse PF2e enrichers from effects text
   * @param {string} effectsText - The effects text with @UUID, @Damage, etc.
   * @returns {Array} - Array of enricher objects with type, label, and icon
   */
  parseEffectEnrichers(effectsText) {
    if (!effectsText) return [];

    const enrichers = [];

    // Parse @UUID[uuid]{Label} tags
    const uuidMatches = effectsText.matchAll(/@UUID\[([^\]]+)\]\{([^}]+)\}/g);
    for (const match of uuidMatches) {
      const uuid = match[1];
      const label = match[2];

      // Determine icon based on UUID content
      let icon = 'fa-link';
      let type = 'uuid';
      if (uuid.includes('conditionitems')) {
        icon = 'fa-heartbeat';
        type = 'condition';
      } else if (uuid.includes('equipment-effects') || uuid.includes('spell-effects')) {
        icon = 'fa-magic';
        type = 'effect';
      }

      enrichers.push({
        type: type,
        label: label,
        icon: icon,
        uuid: uuid
      });
    }

    // Parse @Damage[formula[type]] tags
    const damageMatches = effectsText.matchAll(/@Damage\[([^[]+)\[([^\]]+)\]\]/g);
    for (const match of damageMatches) {
      const formula = match[1];
      const damageType = match[2];

      enrichers.push({
        type: 'damage',
        label: damageType.charAt(0).toUpperCase() + damageType.slice(1),
        icon: 'fa-heart-broken',
        formula: formula
      });
    }

    // Parse @Check[type:dc] tags
    const checkMatches = effectsText.matchAll(/@Check\[([^:]+):(\d+)\]/g);
    for (const match of checkMatches) {
      const checkType = match[1];
      const dc = match[2];

      enrichers.push({
        type: 'check',
        label: `${checkType.charAt(0).toUpperCase() + checkType.slice(1)} DC ${dc}`,
        icon: 'fa-dice-d20'
      });
    }

    return enrichers;
  }

  /**
   * Parse a damage formula into structured parts
   * @param {string} formula - Formula like "2d6+3" or "1d8"
   * @returns {Object} - {diceCount, diceType, bonus}
   */
  parseDamageFormula(formula) {
    if (!formula) return { diceCount: 1, diceType: 'd6', bonus: 0 };

    // Match patterns like "2d6+3", "1d8", "3d4-2"
    const match = formula.match(/^(\d+)(d\d+)([+-]\d+)?$/);
    if (match) {
      return {
        diceCount: parseInt(match[1]) || 1,
        diceType: match[2] || 'd6',
        bonus: match[3] ? parseInt(match[3]) : 0
      };
    }

    // Default if can't parse
    return { diceCount: 1, diceType: 'd6', bonus: 0 };
  }

  static async parseEffectsText(_event, _button) {
    const dialog = this;

    // Get current effects text
    const textarea = dialog.element.querySelector('#stage-effects');
    if (!textarea) return;

    const text = textarea.value;
    if (!text) {
      ui.notifications.warn('No effects text to parse');
      return;
    }

    // Parse damage formulas (e.g., "2d6 fire", "1d8 poison")
    const damageMatches = text.matchAll(/(\d+d\d+(?:[+-]\d+)?)\s+(\w+)/gi);
    for (const match of damageMatches) {
      const formula = match[1];
      const type = match[2].toLowerCase();

      // Check if this damage type is valid
      const validTypes = ['acid', 'bleed', 'bludgeoning', 'cold', 'electricity', 'fire', 'force', 'mental', 'piercing', 'poison', 'slashing', 'sonic', 'spirit', 'vitality', 'void', 'untyped'];
      if (validTypes.includes(type)) {
        // Check if not already added
        if (!dialog.stageData.damage.some(d => d.formula === formula && d.type === type)) {
          dialog.stageData.damage.push({ formula, type });
        }
      }
    }

    // Parse conditions (e.g., "enfeebled 2", "drained 1", "sickened")
    const conditionPattern = /(blinded|clumsy|confused|dazzled|deafened|doomed|drained|dying|enfeebled|fascinated|fatigued|fleeing|frightened|grabbed|immobilized|paralyzed|prone|restrained|sickened|slowed|stunned|stupefied|unconscious|wounded)(?:\s+(\d+))?/gi;
    const conditionMatches = text.matchAll(conditionPattern);
    for (const match of conditionMatches) {
      const name = match[1].toLowerCase();
      const value = match[2] ? parseInt(match[2]) : null;

      // Check if not already added
      if (!dialog.stageData.conditions.some(c => c.name === name)) {
        dialog.stageData.conditions.push({ name, value });
      }
    }

    // Parse weakness - handle multiple formats
    // Patterns: "weakness to cold 5", "weakness 5 to fire", "5 weakness to cold", "cold weakness 5"
    const weaknessPatterns = [
      /weakness\s+to\s+([\w-]+)\s+(\d+)/gi,       // weakness to cold-iron 5
      /weakness\s+(\d+)\s+to\s+([\w-]+)/gi,       // weakness 5 to fire
      /(\d+)\s+weakness\s+to\s+([\w-]+)/gi,       // 5 weakness to cold-iron
      /([\w-]+)\s+weakness\s+(\d+)/gi             // cold-iron weakness 5
    ];

    const validTypes = [
      // Energy & Damage
      'acid', 'cold', 'electricity', 'fire', 'sonic', 'force', 'vitality', 'void',
      // Physical
      'physical', 'bludgeoning', 'piercing', 'slashing',
      // Special
      'bleed', 'mental', 'poison', 'spirit', 'emotion',
      // Materials
      'cold-iron', 'silver', 'adamantine', 'orichalcum', 'abysium', 'dawnsilver',
      'djezet', 'duskwood', 'inubrix', 'noqual', 'peachwood', 'siccatite',
      // Alignment
      'holy', 'unholy',
      // Traditions
      'arcane', 'divine', 'occult', 'primal',
      // Properties
      'magical', 'non-magical', 'ghost-touch', 'alchemical',
      // Specialized
      'area-damage', 'critical-hits', 'precision', 'splash-damage', 'persistent-damage',
      'spells', 'weapons', 'unarmed-attacks',
      // Rare/Special
      'arrow-vulnerability', 'axe-vulnerability', 'vampire-weaknesses', 'vulnerable-to-sunlight',
      'vorpal', 'vorpal-fear', 'weapons-shedding-bright-light',
      // Elemental
      'air', 'earth', 'water', 'salt-water', 'salt',
      // Other
      'all-damage', 'energy', 'glass', 'light', 'metal', 'plant', 'radiation', 'time', 'wood'
    ];

    for (const pattern of weaknessPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        let type, value;

        // Determine which capture groups have the type and value
        if (match[1] && isNaN(match[1])) {
          // Pattern: type value (e.g., "cold weakness 5")
          type = match[1].toLowerCase();
          value = parseInt(match[2]);
        } else if (match[2] && isNaN(match[2])) {
          // Pattern: value type (e.g., "5 weakness to cold")
          value = parseInt(match[1]);
          type = match[2].toLowerCase();
        } else {
          // Pattern: standard (e.g., "weakness to cold 5")
          type = (match[1] && isNaN(match[1])) ? match[1].toLowerCase() : match[2].toLowerCase();
          value = parseInt((match[1] && !isNaN(match[1])) ? match[1] : match[2]);
        }

        // Handle "physical" as special case - add all three physical types
        if (type === 'physical') {
          ['bludgeoning', 'piercing', 'slashing'].forEach(physType => {
            if (!dialog.stageData.weakness.some(w => w.type === physType)) {
              dialog.stageData.weakness.push({ type: physType, value });
            }
          });
        } else if (validTypes.includes(type)) {
          // Check if not already added
          if (!dialog.stageData.weakness.some(w => w.type === type)) {
            dialog.stageData.weakness.push({ type, value });
          }
        }
      }
    }

    // Parse bonuses and create Rule Elements
    // Pattern: "+1 item bonus to saving throws against mental effects"
    // Pattern: "-2 status penalty to AC"
    // Pattern: "+3 circumstance bonus to Stealth checks"
    const bonusPattern = /([+-]\d+)\s+(item|circumstance|status)\s+(bonus|penalty)\s+to\s+([\w\s]+?)(?:\s+against\s+([\w\s]+?))?(?=\.|,|$|\s+and\s+)/gi;
    const bonusMatches = text.matchAll(bonusPattern);

    for (const match of bonusMatches) {
      const value = parseInt(match[1]); // +1, -2, etc.
      const bonusType = match[2].toLowerCase(); // item, circumstance, status
      const bonusPenalty = match[3].toLowerCase(); // bonus or penalty
      const targetRaw = match[4].trim().toLowerCase(); // "saving throws", "AC", "Stealth checks"
      const againstRaw = match[5] ? match[5].trim().toLowerCase() : null; // "mental effects", null

      // Adjust value if it's a penalty
      const adjustedValue = bonusPenalty === 'penalty' ? -Math.abs(value) : value;

      // Determine selector and predicate based on target
      let selector = '';
      const predicate = [];

      // Parse target to determine selector
      // Use regex word boundaries to avoid false matches (e.g., "attacks" matching "ac")
      const hasWord = (word) => new RegExp(`\\b${word}\\b`, 'i').test(targetRaw);

      if (hasWord('saving throw') || hasWord('save')) {
        // Saving throws
        if (hasWord('fortitude')) {
          selector = 'fortitude';
        } else if (hasWord('reflex')) {
          selector = 'reflex';
        } else if (hasWord('will')) {
          selector = 'will';
        } else {
          selector = 'saving-throw'; // All saves
        }
      } else if (targetRaw.includes('attack roll') || hasWord('attack')) {
        // Attack rolls (keep "attack roll" as includes to catch multi-word)
        if (hasWord('spell')) {
          selector = 'spell-attack-roll';
        } else {
          selector = 'attack-roll';
        }
      } else if (hasWord('ac') || targetRaw.includes('armor class')) {
        selector = 'ac';
      } else if (hasWord('perception')) {
        selector = 'perception';
      } else if (hasWord('initiative')) {
        selector = 'initiative';
      } else if (hasWord('damage')) {
        selector = 'damage';
      } else if (hasWord('check')) {
        // Skill checks
        if (hasWord('stealth')) {
          selector = 'stealth';
        } else if (hasWord('athletics')) {
          selector = 'athletics';
        } else if (hasWord('acrobatics')) {
          selector = 'acrobatics';
        } else if (hasWord('medicine')) {
          selector = 'medicine';
        } else if (hasWord('arcana')) {
          selector = 'arcana';
        } else if (hasWord('nature')) {
          selector = 'nature';
        } else if (hasWord('occultism')) {
          selector = 'occultism';
        } else if (hasWord('religion')) {
          selector = 'religion';
        } else if (hasWord('society')) {
          selector = 'society';
        } else if (hasWord('crafting')) {
          selector = 'crafting';
        } else if (hasWord('deception')) {
          selector = 'deception';
        } else if (hasWord('diplomacy')) {
          selector = 'diplomacy';
        } else if (hasWord('intimidation')) {
          selector = 'intimidation';
        } else if (hasWord('performance')) {
          selector = 'performance';
        } else if (hasWord('survival')) {
          selector = 'survival';
        } else if (hasWord('thievery')) {
          selector = 'thievery';
        } else {
          selector = 'skill-check'; // All skills
        }
      }

      // Parse "against X" to create predicate
      if (againstRaw) {
        if (againstRaw.includes('mental')) {
          predicate.push('item:trait:mental');
        } else if (againstRaw.includes('poison')) {
          predicate.push('item:trait:poison');
        } else if (againstRaw.includes('disease')) {
          predicate.push('item:trait:disease');
        } else if (againstRaw.includes('fire')) {
          predicate.push('item:trait:fire');
        } else if (againstRaw.includes('cold')) {
          predicate.push('item:trait:cold');
        } else if (againstRaw.includes('acid')) {
          predicate.push('item:trait:acid');
        } else if (againstRaw.includes('electricity')) {
          predicate.push('item:trait:electricity');
        } else if (againstRaw.includes('sonic')) {
          predicate.push('item:trait:sonic');
        } else if (againstRaw.includes('spell')) {
          predicate.push('item:type:spell');
        }
      }

      // Only create Rule Element if we have a valid selector
      if (selector) {
        // Build label
        const predicateText = predicate.length > 0 ? ` (${againstRaw})` : '';
        const label = `${dialog.afflictionName} - Stage ${dialog.stageNumber}: ${match[1]} ${bonusType} ${bonusPenalty} to ${match[4]}${predicateText}`;

        // Create Rule Element config
        const ruleElement = {
          key: 'FlatModifier',
          type: bonusType,
          selector: selector,
          value: adjustedValue,
          label: label
        };

        // Add predicate if exists
        if (predicate.length > 0) {
          ruleElement.predicate = predicate;
        }

        // Check if this Rule Element already exists (avoid duplicates)
        const exists = dialog.stageData.ruleElements.some(re =>
          re.key === ruleElement.key &&
          re.type === ruleElement.type &&
          re.selector === ruleElement.selector &&
          re.value === ruleElement.value &&
          JSON.stringify(re.predicate || []) === JSON.stringify(ruleElement.predicate || [])
        );

        if (!exists) {
          dialog.stageData.ruleElements.push(ruleElement);
        }
      }
    }

    ui.notifications.info('Effects text parsed and added to stage details');
    await dialog.render({ force: true });
  }

  static async addDamage(_event, _button) {
    const dialog = this;

    // Save current form values first
    await dialog.updateFromForm();

    // Add new damage entry
    dialog.stageData.damage.push({
      formula: '1d6',
      type: 'poison'
    });
    await dialog.render({ force: true });
  }

  static async removeDamage(_event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.damage.splice(index, 1);
    await dialog.render({ force: true });
  }

  static async addCondition(_event, _button) {
    const dialog = this;

    // Save current form values first
    await dialog.updateFromForm();

    // Add new condition entry
    dialog.stageData.conditions.push({
      name: '',
      value: null
    });
    await dialog.render({ force: true });
  }

  static async removeCondition(_event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.conditions.splice(index, 1);
    await dialog.render({ force: true });
  }

  static async addWeakness(_event, _button) {
    const dialog = this;

    // Save current form values first
    await dialog.updateFromForm();

    // Add new weakness entry
    dialog.stageData.weakness.push({
      type: '',
      value: 0
    });
    await dialog.render({ force: true });
  }

  static async removeWeakness(_event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.weakness.splice(index, 1);
    await dialog.render({ force: true });
  }

  static async openEffect(_event, button) {
    const dialog = this;
    const uuid = button.dataset.uuid;
    if (!uuid) return;

    // Check if it's an auto-generated effect (not a real document)
    if (uuid.startsWith('custom-')) {
      // Find the effect data
      const effectData = dialog.stageData.autoEffects.find(e => e.uuid === uuid);
      if (!effectData) return;

      // Format the Rule Element for display
      const ruleElement = effectData.system?.rules?.[0];
      let ruleDetails = '<p><strong>Auto-Generated Effect Preview</strong></p>';
      ruleDetails += '<p><em>This effect will be created dynamically when the stage becomes active.</em></p>';
      ruleDetails += '<hr>';
      ruleDetails += `<p><strong>Effect Name:</strong> ${effectData.name}</p>`;

      if (ruleElement) {
        ruleDetails += '<p><strong>Rule Element:</strong></p>';
        ruleDetails += '<ul style="margin-left: 20px; line-height: 1.8;">';
        ruleDetails += `<li><strong>Type:</strong> ${ruleElement.key}</li>`;
        ruleDetails += `<li><strong>Bonus Type:</strong> ${ruleElement.type}</li>`;
        ruleDetails += `<li><strong>Selector:</strong> ${ruleElement.selector}</li>`;
        ruleDetails += `<li><strong>Value:</strong> ${ruleElement.value > 0 ? '+' : ''}${ruleElement.value}</li>`;
        if (ruleElement.predicate && ruleElement.predicate.length > 0) {
          ruleDetails += `<li><strong>Predicate:</strong> ${ruleElement.predicate.join(', ')}</li>`;
        }
        ruleDetails += '</ul>';
      }

      // Show preview dialog
      new foundry.applications.api.DialogV2({
        window: { title: 'Effect Preview' },
        content: ruleDetails,
        buttons: [{
          action: 'ok',
          label: 'Close',
          default: true
        }],
        modal: true
      }).render(true);

      return;
    }

    try {
      const effect = await fromUuid(uuid);
      if (effect && effect.sheet) {
        effect.sheet.render(true);
      } else {
        ui.notifications.warn('Effect not found or has no sheet');
      }
    } catch (error) {
      console.error('StageEditorDialog: Error opening effect', error);
      ui.notifications.error('Failed to open effect');
    }
  }
  static async addRuleElement(_event, button) {
    const dialog = this;

    // Create form for adding a Rule Element
    const content = `
      <form>
        <div class="form-group">
          <label>Bonus Type</label>
          <select name="type" required>
            <option value="item">Item</option>
            <option value="circumstance">Circumstance</option>
            <option value="status">Status</option>
          </select>
        </div>

        <div class="form-group">
          <label>Value (use negative for penalties)</label>
          <input type="number" name="value" value="1" required />
        </div>

        <div class="form-group">
          <label>Applies To (Selector)</label>
          <select name="selector" required>
            <optgroup label="Saves">
              <option value="saving-throw">All Saves</option>
              <option value="fortitude">Fortitude</option>
              <option value="reflex">Reflex</option>
              <option value="will">Will</option>
            </optgroup>
            <optgroup label="Defense">
              <option value="ac">AC</option>
              <option value="perception">Perception</option>
            </optgroup>
            <optgroup label="Offense">
              <option value="attack-roll">Attack Rolls</option>
              <option value="spell-attack-roll">Spell Attack Rolls</option>
              <option value="damage">Damage</option>
            </optgroup>
            <optgroup label="Skills">
              <option value="skill-check">All Skills</option>
              <option value="acrobatics">Acrobatics</option>
              <option value="arcana">Arcana</option>
              <option value="athletics">Athletics</option>
              <option value="crafting">Crafting</option>
              <option value="deception">Deception</option>
              <option value="diplomacy">Diplomacy</option>
              <option value="intimidation">Intimidation</option>
              <option value="medicine">Medicine</option>
              <option value="nature">Nature</option>
              <option value="occultism">Occultism</option>
              <option value="performance">Performance</option>
              <option value="religion">Religion</option>
              <option value="society">Society</option>
              <option value="stealth">Stealth</option>
              <option value="survival">Survival</option>
              <option value="thievery">Thievery</option>
            </optgroup>
            <optgroup label="Other">
              <option value="initiative">Initiative</option>
            </optgroup>
          </select>
        </div>

        <div class="form-group">
          <label>Condition/Predicate (Optional)</label>
          <select name="predicate">
            <option value="">Always Active</option>
            <optgroup label="Item Damage Traits">
              <option value="item:trait:fire">Against Fire</option>
              <option value="item:trait:cold">Against Cold</option>
              <option value="item:trait:acid">Against Acid</option>
              <option value="item:trait:electricity">Against Electricity</option>
              <option value="item:trait:sonic">Against Sonic</option>
              <option value="item:trait:mental">Against Mental</option>
              <option value="item:trait:poison">Against Poison</option>
            </optgroup>
            <optgroup label="Item Effect Traits">
              <option value="item:trait:disease">Against Disease</option>
              <option value="item:trait:fear">Against Fear</option>
              <option value="item:trait:visual">Against Visual</option>
              <option value="item:trait:auditory">Against Auditory</option>
              <option value="item:trait:linguistic">Against Linguistic</option>
              <option value="item:trait:emotion">Against Emotion</option>
            </optgroup>
            <optgroup label="Item Types">
              <option value="item:type:spell">Against Spells</option>
              <option value="item:type:weapon">Against Weapons</option>
              <option value="item:ranged">Against Ranged</option>
              <option value="item:melee">Against Melee</option>
            </optgroup>
            <optgroup label="Attack Traits">
              <option value="attack:trait:ranged">On Ranged Attacks</option>
              <option value="attack:trait:melee">On Melee Attacks</option>
            </optgroup>
            <optgroup label="Self Conditions">
              <option value="self:condition:frightened">While Frightened</option>
              <option value="self:condition:sickened">While Sickened</option>
              <option value="self:condition:off-guard">While Off-Guard</option>
              <option value="self:condition:hidden">While Hidden</option>
              <option value="self:condition:concealed">While Concealed</option>
            </optgroup>
            <optgroup label="Target Conditions">
              <option value="target:condition:off-guard">Against Off-Guard</option>
              <option value="target:condition:frightened">Against Frightened</option>
              <option value="target:condition:prone">Against Prone</option>
            </optgroup>
            <optgroup label="Target Traits">
              <option value="target:trait:dragon">Against Dragons</option>
              <option value="target:trait:undead">Against Undead</option>
              <option value="target:trait:demon">Against Demons</option>
              <option value="target:trait:devil">Against Devils</option>
            </optgroup>
          </select>
        </div>

        <div class="form-group">
          <label>Custom Predicate (Optional)</label>
          <input type="text" name="customPredicate" placeholder="e.g., attack:trait:ranged or self:condition:hidden" />
          <small style="display: block; margin-top: 4px; color: #888; font-size: 11px;">
            Use custom predicate syntax if the dropdown doesn't have what you need. This will override the dropdown selection.
          </small>
        </div>
      </form>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: 'Add Rule Element' },
      content: content,
      ok: {
        label: 'Add',
        callback: (_event, button) => new FormDataExtended(button.form).object
      },
      rejectClose: false
    });

    if (!result) return;

    // Determine which predicate to use (custom takes precedence)
    const finalPredicate = result.customPredicate?.trim() || result.predicate;

    // Build label - get predicate display text
    let predicateText = '';
    if (finalPredicate) {
      if (result.customPredicate?.trim()) {
        // Use custom predicate as-is for display
        predicateText = ` (${finalPredicate})`;
      } else {
        // Use dropdown text
        const predicateOption = button.querySelector(`select[name="predicate"] option[value="${finalPredicate}"]`);
        predicateText = predicateOption ? ` (${predicateOption.textContent})` : ` (${finalPredicate})`;
      }
    }

    const selectorName = button.querySelector(`select[name="selector"] option[value="${result.selector}"]`)?.textContent || result.selector;
    const bonusPenalty = result.value >= 0 ? 'bonus' : 'penalty';
    const label = `${dialog.afflictionName} - Stage ${dialog.stageNumber}: ${result.value >= 0 ? '+' : ''}${result.value} ${result.type} ${bonusPenalty} to ${selectorName}${predicateText}`;

    // Create Rule Element
    const ruleElement = {
      key: 'FlatModifier',
      type: result.type,
      selector: result.selector,
      value: parseInt(result.value),
      label: label
    };

    // Add predicate if specified
    if (finalPredicate) {
      ruleElement.predicate = [finalPredicate];
    }

    // Add to stage data
    dialog.stageData.ruleElements.push(ruleElement);

    ui.notifications.info('Rule Element added');
    await dialog.render({ force: true });
  }

  /**
   * Helper to determine if predicate is custom or from dropdown
   * @param {Object} ruleElement - The Rule Element to check
   * @returns {string} - The custom predicate value if it's not in dropdown, empty string otherwise
   */
  static getCustomPredicateValue(ruleElement) {
    if (!ruleElement.predicate || ruleElement.predicate.length === 0) return '';

    const predicate = ruleElement.predicate[0];

    // List of predefined dropdown values (expanded based on PF2e documentation)
    const dropdownValues = [
      // Item damage traits
      'item:trait:fire',
      'item:trait:cold',
      'item:trait:acid',
      'item:trait:electricity',
      'item:trait:sonic',
      'item:trait:mental',
      'item:trait:poison',
      // Item effect traits
      'item:trait:disease',
      'item:trait:fear',
      'item:trait:visual',
      'item:trait:auditory',
      'item:trait:linguistic',
      'item:trait:emotion',
      // Item types
      'item:type:spell',
      'item:type:weapon',
      'item:ranged',
      'item:melee',
      // Attack traits
      'attack:trait:ranged',
      'attack:trait:melee',
      // Self conditions
      'self:condition:frightened',
      'self:condition:sickened',
      'self:condition:off-guard',
      'self:condition:hidden',
      'self:condition:concealed',
      // Target conditions
      'target:condition:off-guard',
      'target:condition:frightened',
      'target:condition:prone',
      // Target traits
      'target:trait:dragon',
      'target:trait:undead',
      'target:trait:demon',
      'target:trait:devil'
    ];

    // If predicate is in dropdown, return empty (use dropdown)
    // Otherwise return the predicate as custom
    return dropdownValues.includes(predicate) ? '' : predicate;
  }

  static async editRuleElement(_event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    const ruleElement = dialog.stageData.ruleElements[index];

    if (!ruleElement) return;

    // Create form for editing the Rule Element, pre-populated with current values
    const content = `
      <form>
        <div class="form-group">
          <label>Bonus Type</label>
          <select name="type" required>
            <option value="item" ${ruleElement.type === 'item' ? 'selected' : ''}>Item</option>
            <option value="circumstance" ${ruleElement.type === 'circumstance' ? 'selected' : ''}>Circumstance</option>
            <option value="status" ${ruleElement.type === 'status' ? 'selected' : ''}>Status</option>
          </select>
        </div>

        <div class="form-group">
          <label>Value (use negative for penalties)</label>
          <input type="number" name="value" value="${ruleElement.value}" required />
        </div>

        <div class="form-group">
          <label>Applies To (Selector)</label>
          <select name="selector" required>
            <optgroup label="Saves">
              <option value="saving-throw" ${ruleElement.selector === 'saving-throw' ? 'selected' : ''}>All Saves</option>
              <option value="fortitude" ${ruleElement.selector === 'fortitude' ? 'selected' : ''}>Fortitude</option>
              <option value="reflex" ${ruleElement.selector === 'reflex' ? 'selected' : ''}>Reflex</option>
              <option value="will" ${ruleElement.selector === 'will' ? 'selected' : ''}>Will</option>
            </optgroup>
            <optgroup label="Defense">
              <option value="ac" ${ruleElement.selector === 'ac' ? 'selected' : ''}>AC</option>
              <option value="perception" ${ruleElement.selector === 'perception' ? 'selected' : ''}>Perception</option>
            </optgroup>
            <optgroup label="Offense">
              <option value="attack-roll" ${ruleElement.selector === 'attack-roll' ? 'selected' : ''}>Attack Rolls</option>
              <option value="spell-attack-roll" ${ruleElement.selector === 'spell-attack-roll' ? 'selected' : ''}>Spell Attack Rolls</option>
              <option value="damage" ${ruleElement.selector === 'damage' ? 'selected' : ''}>Damage</option>
            </optgroup>
            <optgroup label="Skills">
              <option value="skill-check" ${ruleElement.selector === 'skill-check' ? 'selected' : ''}>All Skills</option>
              <option value="acrobatics" ${ruleElement.selector === 'acrobatics' ? 'selected' : ''}>Acrobatics</option>
              <option value="arcana" ${ruleElement.selector === 'arcana' ? 'selected' : ''}>Arcana</option>
              <option value="athletics" ${ruleElement.selector === 'athletics' ? 'selected' : ''}>Athletics</option>
              <option value="crafting" ${ruleElement.selector === 'crafting' ? 'selected' : ''}>Crafting</option>
              <option value="deception" ${ruleElement.selector === 'deception' ? 'selected' : ''}>Deception</option>
              <option value="diplomacy" ${ruleElement.selector === 'diplomacy' ? 'selected' : ''}>Diplomacy</option>
              <option value="intimidation" ${ruleElement.selector === 'intimidation' ? 'selected' : ''}>Intimidation</option>
              <option value="medicine" ${ruleElement.selector === 'medicine' ? 'selected' : ''}>Medicine</option>
              <option value="nature" ${ruleElement.selector === 'nature' ? 'selected' : ''}>Nature</option>
              <option value="occultism" ${ruleElement.selector === 'occultism' ? 'selected' : ''}>Occultism</option>
              <option value="performance" ${ruleElement.selector === 'performance' ? 'selected' : ''}>Performance</option>
              <option value="religion" ${ruleElement.selector === 'religion' ? 'selected' : ''}>Religion</option>
              <option value="society" ${ruleElement.selector === 'society' ? 'selected' : ''}>Society</option>
              <option value="stealth" ${ruleElement.selector === 'stealth' ? 'selected' : ''}>Stealth</option>
              <option value="survival" ${ruleElement.selector === 'survival' ? 'selected' : ''}>Survival</option>
              <option value="thievery" ${ruleElement.selector === 'thievery' ? 'selected' : ''}>Thievery</option>
            </optgroup>
            <optgroup label="Other">
              <option value="initiative" ${ruleElement.selector === 'initiative' ? 'selected' : ''}>Initiative</option>
            </optgroup>
          </select>
        </div>

        <div class="form-group">
          <label>Condition/Predicate (Optional)</label>
          <select name="predicate">
            <option value="" ${!ruleElement.predicate || ruleElement.predicate.length === 0 ? 'selected' : ''}>Always Active</option>
            <optgroup label="Item Damage Traits">
              <option value="item:trait:fire" ${ruleElement.predicate?.[0] === 'item:trait:fire' ? 'selected' : ''}>Against Fire</option>
              <option value="item:trait:cold" ${ruleElement.predicate?.[0] === 'item:trait:cold' ? 'selected' : ''}>Against Cold</option>
              <option value="item:trait:acid" ${ruleElement.predicate?.[0] === 'item:trait:acid' ? 'selected' : ''}>Against Acid</option>
              <option value="item:trait:electricity" ${ruleElement.predicate?.[0] === 'item:trait:electricity' ? 'selected' : ''}>Against Electricity</option>
              <option value="item:trait:sonic" ${ruleElement.predicate?.[0] === 'item:trait:sonic' ? 'selected' : ''}>Against Sonic</option>
              <option value="item:trait:mental" ${ruleElement.predicate?.[0] === 'item:trait:mental' ? 'selected' : ''}>Against Mental</option>
              <option value="item:trait:poison" ${ruleElement.predicate?.[0] === 'item:trait:poison' ? 'selected' : ''}>Against Poison</option>
            </optgroup>
            <optgroup label="Item Effect Traits">
              <option value="item:trait:disease" ${ruleElement.predicate?.[0] === 'item:trait:disease' ? 'selected' : ''}>Against Disease</option>
              <option value="item:trait:fear" ${ruleElement.predicate?.[0] === 'item:trait:fear' ? 'selected' : ''}>Against Fear</option>
              <option value="item:trait:visual" ${ruleElement.predicate?.[0] === 'item:trait:visual' ? 'selected' : ''}>Against Visual</option>
              <option value="item:trait:auditory" ${ruleElement.predicate?.[0] === 'item:trait:auditory' ? 'selected' : ''}>Against Auditory</option>
              <option value="item:trait:linguistic" ${ruleElement.predicate?.[0] === 'item:trait:linguistic' ? 'selected' : ''}>Against Linguistic</option>
              <option value="item:trait:emotion" ${ruleElement.predicate?.[0] === 'item:trait:emotion' ? 'selected' : ''}>Against Emotion</option>
            </optgroup>
            <optgroup label="Item Types">
              <option value="item:type:spell" ${ruleElement.predicate?.[0] === 'item:type:spell' ? 'selected' : ''}>Against Spells</option>
              <option value="item:type:weapon" ${ruleElement.predicate?.[0] === 'item:type:weapon' ? 'selected' : ''}>Against Weapons</option>
              <option value="item:ranged" ${ruleElement.predicate?.[0] === 'item:ranged' ? 'selected' : ''}>Against Ranged</option>
              <option value="item:melee" ${ruleElement.predicate?.[0] === 'item:melee' ? 'selected' : ''}>Against Melee</option>
            </optgroup>
            <optgroup label="Attack Traits">
              <option value="attack:trait:ranged" ${ruleElement.predicate?.[0] === 'attack:trait:ranged' ? 'selected' : ''}>On Ranged Attacks</option>
              <option value="attack:trait:melee" ${ruleElement.predicate?.[0] === 'attack:trait:melee' ? 'selected' : ''}>On Melee Attacks</option>
            </optgroup>
            <optgroup label="Self Conditions">
              <option value="self:condition:frightened" ${ruleElement.predicate?.[0] === 'self:condition:frightened' ? 'selected' : ''}>While Frightened</option>
              <option value="self:condition:sickened" ${ruleElement.predicate?.[0] === 'self:condition:sickened' ? 'selected' : ''}>While Sickened</option>
              <option value="self:condition:off-guard" ${ruleElement.predicate?.[0] === 'self:condition:off-guard' ? 'selected' : ''}>While Off-Guard</option>
              <option value="self:condition:hidden" ${ruleElement.predicate?.[0] === 'self:condition:hidden' ? 'selected' : ''}>While Hidden</option>
              <option value="self:condition:concealed" ${ruleElement.predicate?.[0] === 'self:condition:concealed' ? 'selected' : ''}>While Concealed</option>
            </optgroup>
            <optgroup label="Target Conditions">
              <option value="target:condition:off-guard" ${ruleElement.predicate?.[0] === 'target:condition:off-guard' ? 'selected' : ''}>Against Off-Guard</option>
              <option value="target:condition:frightened" ${ruleElement.predicate?.[0] === 'target:condition:frightened' ? 'selected' : ''}>Against Frightened</option>
              <option value="target:condition:prone" ${ruleElement.predicate?.[0] === 'target:condition:prone' ? 'selected' : ''}>Against Prone</option>
            </optgroup>
            <optgroup label="Target Traits">
              <option value="target:trait:dragon" ${ruleElement.predicate?.[0] === 'target:trait:dragon' ? 'selected' : ''}>Against Dragons</option>
              <option value="target:trait:undead" ${ruleElement.predicate?.[0] === 'target:trait:undead' ? 'selected' : ''}>Against Undead</option>
              <option value="target:trait:demon" ${ruleElement.predicate?.[0] === 'target:trait:demon' ? 'selected' : ''}>Against Demons</option>
              <option value="target:trait:devil" ${ruleElement.predicate?.[0] === 'target:trait:devil' ? 'selected' : ''}>Against Devils</option>
            </optgroup>
          </select>
        </div>

        <div class="form-group">
          <label>Custom Predicate (Optional)</label>
          <input type="text" name="customPredicate" value="${StageEditorDialog.getCustomPredicateValue(ruleElement)}" placeholder="e.g., attack:trait:ranged or self:condition:hidden" />
          <small style="display: block; margin-top: 4px; color: #888; font-size: 11px;">
            Use custom predicate syntax if the dropdown doesn't have what you need. This will override the dropdown selection.
          </small>
        </div>
      </form>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: 'Edit Rule Element' },
      content: content,
      ok: {
        label: 'Save',
        callback: (_event, button) => new FormDataExtended(button.form).object
      },
      rejectClose: false
    });

    if (!result) return;

    // Determine which predicate to use (custom takes precedence)
    const finalPredicate = result.customPredicate?.trim() || result.predicate;

    // Build updated label - get predicate display text
    let predicateText = '';
    if (finalPredicate) {
      if (result.customPredicate?.trim()) {
        // Use custom predicate as-is for display
        predicateText = ` (${finalPredicate})`;
      } else {
        // Use dropdown text
        const predicateOption = button.querySelector(`select[name="predicate"] option[value="${finalPredicate}"]`);
        predicateText = predicateOption ? ` (${predicateOption.textContent})` : ` (${finalPredicate})`;
      }
    }

    const selectorName = button.querySelector(`select[name="selector"] option[value="${result.selector}"]`)?.textContent || result.selector;
    const bonusPenalty = result.value >= 0 ? 'bonus' : 'penalty';
    const label = `${dialog.afflictionName} - Stage ${dialog.stageNumber}: ${result.value >= 0 ? '+' : ''}${result.value} ${result.type} ${bonusPenalty} to ${selectorName}${predicateText}`;

    // Update Rule Element
    dialog.stageData.ruleElements[index] = {
      key: 'FlatModifier',
      type: result.type,
      selector: result.selector,
      value: parseInt(result.value),
      label: label
    };

    // Add predicate if specified
    if (finalPredicate) {
      dialog.stageData.ruleElements[index].predicate = [finalPredicate];
    }

    ui.notifications.info('Rule Element updated');
    await dialog.render({ force: true });
  }

  static async removeRuleElement(_event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Remove Rule Element' },
      content: '<p>Remove this rule element?</p>',
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    dialog.stageData.ruleElements.splice(index, 1);
    ui.notifications.info('Rule Element removed');
    await dialog.render({ force: true });
  }

  static async removeEffect(_event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.autoEffects.splice(index, 1);
    ui.notifications.info('Effect removed');
    await dialog.render({ force: true });
  }

  static async removeAllEffects(_event, _button) {
    const dialog = this;

    // Confirm removal
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      title: 'Clear All Effects',
      content: '<p>Remove all auto-applied effects from this stage?</p>',
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    dialog.stageData.autoEffects = [];
    ui.notifications.info('All effects cleared');
    await dialog.render({ force: true });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const element = this.element;
    if (!element) return;

    // Find the effects drop zone - re-attach listeners each render since DOM is recreated
    const dropZone = element.querySelector('.effects-drop-zone');
    if (dropZone) {
      // Remove old listeners if they exist (though they should be auto-removed with DOM recreation)
      dropZone.removeEventListener('drop', this._boundOnDropEffect);
      dropZone.removeEventListener('dragover', this._boundOnDragOver);
      dropZone.removeEventListener('dragleave', this._boundOnDragLeave);

      // Store bound functions for removal later
      this._boundOnDropEffect = this._onDropEffect.bind(this);
      this._boundOnDragOver = this._onDragOver.bind(this);
      this._boundOnDragLeave = this._onDragLeave.bind(this);

      // Add event listeners
      dropZone.addEventListener('drop', this._boundOnDropEffect);
      dropZone.addEventListener('dragover', this._boundOnDragOver);
      dropZone.addEventListener('dragleave', this._boundOnDragLeave);
    }
  }

  _onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    event.currentTarget.classList.add('drag-over');
  }

  _onDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      event.currentTarget.classList.remove('drag-over');
    }
  }

  async _onDropEffect(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }

    // Check if it's an Item
    if (data.type !== 'Item') {
      ui.notifications.warn('Only effect items can be dropped here');
      return;
    }

    // Load the item
    const item = await fromUuid(data.uuid);
    if (!item) {
      ui.notifications.error('Could not load effect');
      return;
    }

    // Check if it's an effect
    if (item.type !== 'effect') {
      ui.notifications.warn('Only effect items can be added');
      return;
    }

    // Check if already added
    if (this.stageData.autoEffects.some(e => e.uuid === item.uuid)) {
      ui.notifications.warn('Effect already added to this stage');
      return;
    }

    // Add to autoEffects
    this.stageData.autoEffects.push({
      uuid: item.uuid,
      name: item.name,
      img: item.img
    });

    ui.notifications.info(`Added ${item.name} to stage`);
    await this.render({ force: true });
  }

  /**
   * Update stageData from current form values (without closing)
   */
  async updateFromForm() {
    const FormDataClass = foundry.applications?.ux?.FormDataExtended || FormDataExtended;
    const formData = new FormDataClass(this.element).object;

    // Update effects
    if (formData.effects !== undefined) {
      this.stageData.effects = formData.effects || '';
    }

    // Update duration - handle both nested and flat structure
    if (formData.duration) {
      this.stageData.duration = {
        value: parseInt(formData.duration.value) || 1,
        unit: formData.duration.unit || 'day'
      };
    } else if (formData['duration.value'] !== undefined || formData['duration.unit'] !== undefined) {
      // Fallback: handle flat structure if FormDataExtended doesn't nest it
      this.stageData.duration = {
        value: parseInt(formData['duration.value']) || 1,
        unit: formData['duration.unit'] || 'day'
      };
    }

    // Update damage - construct formula from parts
    // Extract from flat or nested structure
    const damageArray = [];
    if (formData.damage !== undefined) {
      const arr = Array.isArray(formData.damage) ? formData.damage : [formData.damage];
      damageArray.push(...arr);
    } else {
      // Flat structure: damage.0.diceCount, damage.1.diceCount, etc.
      let index = 0;
      while (formData[`damage.${index}.diceType`] !== undefined) {
        damageArray.push({
          diceCount: formData[`damage.${index}.diceCount`],
          diceType: formData[`damage.${index}.diceType`],
          bonus: formData[`damage.${index}.bonus`],
          damageType: formData[`damage.${index}.damageType`]
        });
        index++;
      }
    }

    if (damageArray.length > 0) {
      this.stageData.damage = damageArray
        .filter(d => d.diceType && d.damageType)
        .map(d => {
          const diceCount = parseInt(d.diceCount) || 1;
          const bonus = parseInt(d.bonus) || 0;
          let formula = `${diceCount}${d.diceType}`;
          if (bonus > 0) {
            formula += `+${bonus}`;
          } else if (bonus < 0) {
            formula += `${bonus}`;
          }

          return {
            formula: formula,
            type: d.damageType
          };
        });
    }

    // Update conditions
    // Extract from flat or nested structure
    const conditionArray = [];
    if (formData.condition !== undefined) {
      // Nested structure (if FormDataExtended creates it)
      const arr = Array.isArray(formData.condition) ? formData.condition : [formData.condition];
      conditionArray.push(...arr);
    } else {
      // Flat structure: condition.0.name, condition.1.name, etc.
      let index = 0;
      while (formData[`condition.${index}.name`] !== undefined) {
        conditionArray.push({
          name: formData[`condition.${index}.name`],
          value: formData[`condition.${index}.value`],
          persistentFormula: formData[`condition.${index}.persistentFormula`],
          persistentType: formData[`condition.${index}.persistentType`]
        });
        index++;
      }
    }

    if (conditionArray.length > 0) {
      this.stageData.conditions = conditionArray
        .filter(c => c.name) // Only keep conditions with a selected name
        .map(c => {
          const condition = {
            name: c.name
          };

          // Handle persistent damage specially
          if (c.name === 'persistent damage') {
            condition.persistentFormula = c.persistentFormula || '1d6';
            condition.persistentType = c.persistentType || 'fire';
            condition.value = null; // Persistent damage doesn't use value
          } else {
            condition.value = c.value !== undefined && c.value !== '' ? parseInt(c.value) : null;
          }

          return condition;
        });
    }

    // Update weakness
    // Extract from flat or nested structure
    const weaknessArray = [];
    if (formData.weakness !== undefined) {
      const arr = Array.isArray(formData.weakness) ? formData.weakness : [formData.weakness];
      weaknessArray.push(...arr);
    } else {
      // Flat structure: weakness.0.type, weakness.1.type, etc.
      let index = 0;
      while (formData[`weakness.${index}.type`] !== undefined) {
        weaknessArray.push({
          type: formData[`weakness.${index}.type`],
          value: formData[`weakness.${index}.value`]
        });
        index++;
      }
    }

    if (weaknessArray.length > 0) {
      this.stageData.weakness = weaknessArray
        .filter(w => w.type && w.value)
        .map(w => ({
          type: w.type,
          value: parseInt(w.value) || 0
        }));
    }
  }

  static async saveStage(_event, _button) {
    const dialog = this;

    // Update from form values
    await dialog.updateFromForm();

    // Call save callback
    if (dialog.onSave) {
      await dialog.onSave(dialog.stageData);
    }

    ui.notifications.info('Stage changes saved');
    await dialog.close();
  }

  static async cancelStageEdit(_event, _button) {
    const dialog = this;
    await dialog.close();
  }
}
