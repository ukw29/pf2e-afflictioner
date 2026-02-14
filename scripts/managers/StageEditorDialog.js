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

    // Ensure arrays exist
    if (!this.stageData.damage) this.stageData.damage = [];
    if (!this.stageData.conditions) this.stageData.conditions = [];
    if (!this.stageData.weakness) this.stageData.weakness = [];
    if (!this.stageData.autoEffects) this.stageData.autoEffects = [];

    // Update window title
    this.options.window.title = game.i18n.format('PF2E_AFFLICTIONER.EDITOR.STAGE_EDITOR_TITLE', {
      number: this.stageData.number
    });
  }

  async _prepareContext(options) {
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
    const damageMatches = effectsText.matchAll(/@Damage\[([^\[]+)\[([^\]]+)\]\]/g);
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
    const match = formula.match(/^(\d+)(d\d+)([\+\-]\d+)?$/);
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

  static async parseEffectsText(event, button) {
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
    const damageMatches = text.matchAll(/(\d+d\d+(?:[+\-]\d+)?)\s+(\w+)/gi);
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
      /weakness\s+to\s+(\w+)\s+(\d+)/gi,           // weakness to cold 5
      /weakness\s+(\d+)\s+to\s+(\w+)/gi,           // weakness 5 to fire
      /(\d+)\s+weakness\s+to\s+(\w+)/gi,           // 5 weakness to cold
      /(\w+)\s+weakness\s+(\d+)/gi                 // cold weakness 5
    ];

    const validTypes = ['acid', 'bleed', 'bludgeoning', 'cold', 'electricity', 'fire', 'force', 'mental', 'piercing', 'poison', 'slashing', 'sonic', 'spirit', 'vitality', 'void', 'physical'];

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

    ui.notifications.info('Effects text parsed and added to stage details');
    await dialog.render({ force: true });
  }

  static async addDamage(event, button) {
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

  static async removeDamage(event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.damage.splice(index, 1);
    await dialog.render({ force: true });
  }

  static async addCondition(event, button) {
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

  static async removeCondition(event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.conditions.splice(index, 1);
    await dialog.render({ force: true });
  }

  static async addWeakness(event, button) {
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

  static async removeWeakness(event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.weakness.splice(index, 1);
    await dialog.render({ force: true });
  }

  static async removeEffect(event, button) {
    const dialog = this;
    const index = parseInt(button.dataset.index);
    dialog.stageData.autoEffects.splice(index, 1);
    ui.notifications.info('Effect removed');
    await dialog.render({ force: true });
  }

  static async removeAllEffects(event, button) {
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
    const formData = new FormDataExtended(this.element).object;

    console.log('StageEditorDialog: updateFromForm - formData:', formData);

    // Update effects
    if (formData.effects !== undefined) {
      this.stageData.effects = formData.effects || '';
    }

    // Update duration
    if (formData.duration) {
      this.stageData.duration = {
        value: parseInt(formData.duration.value) || 1,
        unit: formData.duration.unit || 'day'
      };
    }

    // Update damage - construct formula from parts
    // Only update if form has damage data
    if (formData.damage !== undefined) {
      const damageArray = Array.isArray(formData.damage) ? formData.damage : [formData.damage];
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
    // Only update if form has condition data
    if (formData.condition !== undefined) {
      const conditionArray = Array.isArray(formData.condition) ? formData.condition : [formData.condition];
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
    // Only update if form has weakness data
    if (formData.weakness !== undefined) {
      const weaknessArray = Array.isArray(formData.weakness) ? formData.weakness : [formData.weakness];
      this.stageData.weakness = weaknessArray
        .filter(w => w.type && w.value)
        .map(w => ({
          type: w.type,
          value: parseInt(w.value) || 0
        }));
    }

    console.log('StageEditorDialog: updateFromForm - updated stageData:', this.stageData);
  }

  static async saveStage(event, button) {
    const dialog = this;

    // Update from form values
    await dialog.updateFromForm();

    console.log('StageEditorDialog: Saving stage data', dialog.stageData);

    // Call save callback
    if (dialog.onSave) {
      await dialog.onSave(dialog.stageData);
    }

    ui.notifications.info('Stage changes saved');
    await dialog.close();
  }

  static async cancelStageEdit(event, button) {
    const dialog = this;
    await dialog.close();
  }
}
