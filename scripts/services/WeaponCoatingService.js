import { MODULE_ID } from '../constants.js';
import { AfflictionParser } from './AfflictionParser.js';
import * as WeaponCoatingStore from '../stores/WeaponCoatingStore.js';
import { VishkanyaService } from './VishkanyaService.js';
import { FeatsService } from './FeatsService.js';

const K = 'PF2E_AFFLICTIONER.WEAPON_COATING';

export class WeaponCoatingService {
  static async openCoatDialog(itemUuid, speakerActorId, speakerTokenId, targetTokenIds = []) {
    const i = game.i18n;
    const item = await fromUuid(itemUuid);
    if (!item) {
      ui.notifications.error(i.localize(`${K}.ITEM_LOAD_ERROR`));
      return;
    }

    const afflictionData = AfflictionParser.parseFromItem(item);
    if (!afflictionData) {
      ui.notifications.error(i.localize(`${K}.PARSE_ERROR`));
      return;
    }

    const allWeapons = this._collectWeapons(speakerActorId, speakerTokenId, targetTokenIds);
    const weapons = allWeapons.filter(w => w.damageType === 'piercing' || w.damageType === 'slashing');

    if (!weapons.length) {
      ui.notifications.warn(i.localize(`${K}.NO_APPLICABLE_WEAPONS`));
      return;
    }

    // Group weapons by actor, preserving insertion order (speaker first, then targets)
    const groups = [];
    const groupIndex = new Map();
    weapons.forEach((w, idx) => {
      if (!groupIndex.has(w.actorId)) {
        groupIndex.set(w.actorId, groups.length);
        groups.push({ actorName: w.actorName, weapons: [] });
      }
      groups[groupIndex.get(w.actorId)].weapons.push({ ...w, idx });
    });

    const sections = groups.map(g => `
      <div class="wcs-section">
        <h3 class="wcs-section-title">${g.actorName}</h3>
        <div class="wcs-grid">
          ${g.weapons.map(w => `
            <div class="wcs-card" data-index="${w.idx}">
              <img src="${w.img}" alt="${w.weaponName}" />
              <div class="wcs-card-info">
                <span class="wcs-card-name">${w.weaponName}</span>
                <span class="wcs-card-damage">${w.damageType}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    const content = `
      <p class="wcs-label">${i.format(`${K}.DIALOG_SELECT_LABEL`, { poisonName: `<strong>${afflictionData.name}</strong>` })}</p>
      ${sections}
      <p class="wcs-hint">${i.localize(`${K}.DIALOG_HINT`)}</p>
    `;

    const selected = await new Promise((resolve) => {
      let hookId;

      hookId = Hooks.on('renderDialogV2', (_app, element) => {
        if (!element.querySelector('.wcs-grid')) return;
        Hooks.off('renderDialogV2', hookId);

        element.querySelectorAll('.wcs-card').forEach((card) => {
          card.addEventListener('click', async () => {
            const index = parseInt(card.dataset.index);
            element.querySelectorAll('.wcs-card').forEach(c => c.classList.remove('wcs-selected'));
            card.classList.add('wcs-selected');
            resolve(weapons[index]);
            await _app.close();
          });
        });
      });

      foundry.applications.api.DialogV2.wait({
        window: { title: i.localize(`${K}.DIALOG_TITLE`) },
        content,
        buttons: [{ action: 'cancel', label: i.localize('PF2E_AFFLICTIONER.DIALOG.CANCEL'), icon: 'fas fa-times' }],
        rejectClose: false
      }).then(() => {
        Hooks.off('renderDialogV2', hookId);
        resolve(null);
      }).catch(() => {
        Hooks.off('renderDialogV2', hookId);
        resolve(null);
      });
    });

    if (!selected) return;

    const actor = game.actors.get(selected.actorId);
    if (!actor) {
      ui.notifications.error(i.localize(`${K}.ACTOR_NOT_FOUND`));
      return;
    }

    // Remove existing coating (cleans up old effect) before replacing
    const existing = WeaponCoatingStore.getCoating(actor, selected.weaponId);
    if (existing) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        title: i.localize(`${K}.REPLACE_TITLE`),
        content: `<p>${i.format(`${K}.REPLACE_CONTENT`, { weaponName: selected.weaponName, existingPoison: existing.poisonName })}</p>`,
        defaultYes: false
      });
      if (!confirmed) return;
      await WeaponCoatingStore.removeCoating(actor, selected.weaponId);
    }

    // Prompt for coating duration (always shows on GM client)
    const expirationMode = await this.promptCoatingDuration();
    if (expirationMode === null) return;

    // Apply Toxicologist acid swap if applicable
    const finalAfflictionData = this._applyToxicologistSwap(actor, afflictionData);

    const combat = game.combat;
    const poisonImg = item.img || null;

    await WeaponCoatingStore.addCoating(actor, selected.weaponId, {
      poisonItemUuid: itemUuid,
      poisonName: finalAfflictionData.name,
      weaponName: selected.weaponName,
      afflictionData: finalAfflictionData,
      appliedRound: combat?.started ? combat.round : null,
      appliedTimestamp: game.time.worldTime,
      appliedCombatantId: this._findCombatantId(actor),
      expirationMode
    });

    // Create visual coating effect on token
    const coatingEffectUuid = await this.createCoatingEffect(actor, selected.weaponName, finalAfflictionData.name, expirationMode, poisonImg);
    if (coatingEffectUuid) {
      await WeaponCoatingStore.updateCoating(actor, selected.weaponId, { coatingEffectUuid });
    }

    // Consume one dose of the poison item
    const quantity = item.system?.quantity ?? 1;
    if (quantity <= 1) {
      await item.delete();
    } else {
      await item.update({ 'system.quantity': quantity - 1 });
    }

    ui.notifications.info(i.format(`${K}.COATED`, { weaponName: selected.weaponName, poisonName: finalAfflictionData.name }));

    const { AfflictionManager } = await import('../managers/AfflictionManager.js');
    if (AfflictionManager.currentInstance) {
      AfflictionManager.currentInstance.render({ force: true });
    }

    return true;
  }

  /**
   * Opens the coat-weapon dialog using pre-built affliction data (no item to load or consume).
   * Used by the Envenom flow where venom is produced by an ability, not a consumable item.
   *
   * @param {object} afflictionData - Pre-built affliction data from VishkanyaService
   * @param {string} speakerActorId
   * @param {string} speakerTokenId
   * @param {string[]} targetTokenIds
   * @param {{ hasDebilitatingVenom?: boolean }} options
   * @returns {Promise<boolean|undefined>}
   */
  static async openCoatDialogWithData(afflictionData, speakerActorId, speakerTokenId, targetTokenIds = [], options = {}) {
    const i = game.i18n;
    const K = 'PF2E_AFFLICTIONER.WEAPON_COATING';

    let finalAfflictionData = afflictionData;

    if (options.hasDebilitatingVenom) {
      const choice = await this._promptDebilitation();
      if (choice === null) return; // User cancelled
      finalAfflictionData = VishkanyaService.applyDebilitation(afflictionData, choice);
    }

    const allWeapons = this._collectWeapons(speakerActorId, speakerTokenId, targetTokenIds);
    const weapons = allWeapons.filter(w => w.damageType === 'piercing' || w.damageType === 'slashing');

    if (!weapons.length) {
      ui.notifications.warn(i.localize(`${K}.NO_APPLICABLE_WEAPONS`));
      return;
    }

    const groups = [];
    const groupIndex = new Map();
    weapons.forEach((w, idx) => {
      if (!groupIndex.has(w.actorId)) {
        groupIndex.set(w.actorId, groups.length);
        groups.push({ actorName: w.actorName, weapons: [] });
      }
      groups[groupIndex.get(w.actorId)].weapons.push({ ...w, idx });
    });

    const sections = groups.map(g => `
      <div class="wcs-section">
        <h3 class="wcs-section-title">${g.actorName}</h3>
        <div class="wcs-grid">
          ${g.weapons.map(w => `
            <div class="wcs-card" data-index="${w.idx}">
              <img src="${w.img}" alt="${w.weaponName}" />
              <div class="wcs-card-info">
                <span class="wcs-card-name">${w.weaponName}</span>
                <span class="wcs-card-damage">${w.damageType}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    const content = `
      <p class="wcs-label">${i.format(`${K}.DIALOG_SELECT_LABEL`, { poisonName: `<strong>${finalAfflictionData.name}</strong>` })}</p>
      ${sections}
      <p class="wcs-hint">${i.localize(`${K}.DIALOG_HINT`)}</p>
    `;

    const selected = await new Promise((resolve) => {
      let hookId;

      hookId = Hooks.on('renderDialogV2', (_app, element) => {
        if (!element.querySelector('.wcs-grid')) return;
        Hooks.off('renderDialogV2', hookId);

        element.querySelectorAll('.wcs-card').forEach((card) => {
          card.addEventListener('click', async () => {
            const index = parseInt(card.dataset.index);
            element.querySelectorAll('.wcs-card').forEach(c => c.classList.remove('wcs-selected'));
            card.classList.add('wcs-selected');
            resolve(weapons[index]);
            await _app.close();
          });
        });
      });

      foundry.applications.api.DialogV2.wait({
        window: { title: i.localize(`${K}.DIALOG_TITLE`) },
        content,
        buttons: [{ action: 'cancel', label: i.localize('PF2E_AFFLICTIONER.DIALOG.CANCEL'), icon: 'fas fa-times' }],
        rejectClose: false
      }).then(() => {
        Hooks.off('renderDialogV2', hookId);
        resolve(null);
      }).catch(() => {
        Hooks.off('renderDialogV2', hookId);
        resolve(null);
      });
    });

    if (!selected) return;

    const actor = game.actors.get(selected.actorId);
    if (!actor) {
      ui.notifications.error(i.localize(`${K}.ACTOR_NOT_FOUND`));
      return;
    }

    // Remove existing coating (cleans up old effect) before replacing
    const existing = WeaponCoatingStore.getCoating(actor, selected.weaponId);
    if (existing) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        title: i.localize(`${K}.REPLACE_TITLE`),
        content: `<p>${i.format(`${K}.REPLACE_CONTENT`, { weaponName: selected.weaponName, existingPoison: existing.poisonName })}</p>`,
        defaultYes: false
      });
      if (!confirmed) return;
      await WeaponCoatingStore.removeCoating(actor, selected.weaponId);
    }

    // Prompt for coating duration (always shows on GM client)
    const expirationMode = await this.promptCoatingDuration();
    if (expirationMode === null) return;

    // Apply Toxicologist acid swap if applicable
    finalAfflictionData = this._applyToxicologistSwap(actor, finalAfflictionData);

    const combat = game.combat;

    await WeaponCoatingStore.addCoating(actor, selected.weaponId, {
      poisonItemUuid: null,
      poisonName: finalAfflictionData.name,
      weaponName: selected.weaponName,
      afflictionData: finalAfflictionData,
      appliedRound: combat?.started ? combat.round : null,
      appliedTimestamp: game.time.worldTime,
      appliedCombatantId: this._findCombatantId(actor),
      expirationMode
    });

    // Create visual coating effect on token
    const coatingEffectUuid = await this.createCoatingEffect(actor, selected.weaponName, finalAfflictionData.name, expirationMode);
    if (coatingEffectUuid) {
      await WeaponCoatingStore.updateCoating(actor, selected.weaponId, { coatingEffectUuid });
    }

    ui.notifications.info(i.format(`${K}.COATED`, { weaponName: selected.weaponName, poisonName: finalAfflictionData.name }));

    const { AfflictionManager } = await import('../managers/AfflictionManager.js');
    if (AfflictionManager.currentInstance) {
      AfflictionManager.currentInstance.render({ force: true });
    }

    return true;
  }

  /**
   * Routes the coating duration prompt to the GM client via socket.
   * If the current user is GM (or socketlib is unavailable), calls directly.
   * @returns {Promise<string|null>} The chosen mode, or null if cancelled
   */
  static async promptCoatingDuration() {
    if (!game.settings.get(MODULE_ID, 'promptCoatingDuration')) {
      return 'unlimited';
    }
    const { SocketService } = await import('./SocketService.js');
    if (game.user.isGM || !SocketService.socket) {
      return this._promptCoatingDuration();
    }
    return SocketService.requestPromptCoatingDuration();
  }

  /**
   * Prompts the user to choose a coating duration for this specific coating.
   * Uses a card-based UI for preset durations with a custom option.
   * @returns {Promise<string|null>} The chosen mode, or null if cancelled
   */
  static async _promptCoatingDuration() {
    const i = game.i18n;
    const S = 'PF2E_AFFLICTIONER.SETTINGS';

    const options = [
      { value: 'start-next-turn', label: i.localize(`${S}.COATING_DURATION_START_NEXT_TURN`), icon: 'fas fa-hourglass-start', hint: i.localize(`${K}.DURATION_HINT_STRICT`) },
      { value: 'end-next-turn',   label: i.localize(`${S}.COATING_DURATION_END_NEXT_TURN`),   icon: 'fas fa-hourglass-end',   hint: i.localize(`${K}.DURATION_HINT_MODERATE`) },
      { value: '1-minute',        label: i.localize(`${S}.COATING_DURATION_1_MIN`),            icon: 'fas fa-stopwatch',       hint: '10 rounds' },
      { value: '10-minutes',      label: i.localize(`${S}.COATING_DURATION_10_MIN`),           icon: 'fas fa-clock',           hint: '100 rounds' },
      { value: '1-hour',          label: i.localize(`${S}.COATING_DURATION_1_HOUR`),           icon: 'fas fa-history',         hint: '600 rounds' },
      { value: 'unlimited',       label: i.localize(`${S}.COATING_DURATION_UNLIMITED`),        icon: 'fas fa-infinity',        hint: i.localize(`${K}.DURATION_HINT_UNLIMITED`) },
    ];

    const cards = options.map(o => `
      <div class="cd-card" data-value="${o.value}">
        <i class="${o.icon} cd-card-icon"></i>
        <span class="cd-card-label">${o.label}</span>
        <span class="cd-card-hint">${o.hint}</span>
      </div>
    `).join('');

    const content = `
      <p class="cd-prompt">${i.localize(`${K}.DURATION_PROMPT`)}</p>
      <div class="cd-grid">${cards}</div>
      <div class="cd-custom">
        <label class="cd-custom-label">${i.localize(`${K}.DURATION_CUSTOM_LABEL`)}</label>
        <div class="cd-custom-row">
          <input type="number" class="cd-custom-value" min="1" value="5" />
          <select class="cd-custom-unit">
            <option value="rounds">${i.localize(`${K}.DURATION_UNIT_ROUNDS`)}</option>
            <option value="minutes" selected>${i.localize(`${K}.DURATION_UNIT_MINUTES`)}</option>
            <option value="hours">${i.localize(`${K}.DURATION_UNIT_HOURS`)}</option>
          </select>
          <button type="button" class="cd-custom-apply"><i class="fas fa-check"></i></button>
        </div>
      </div>
    `;

    const result = await new Promise((resolve) => {
      let hookId;

      hookId = Hooks.on('renderDialogV2', (_app, element) => {
        if (!element.querySelector('.cd-grid')) return;
        Hooks.off('renderDialogV2', hookId);

        element.querySelectorAll('.cd-card').forEach((card) => {
          card.addEventListener('click', async () => {
            resolve(card.dataset.value);
            await _app.close();
          });
        });

        const applyBtn = element.querySelector('.cd-custom-apply');
        if (applyBtn) {
          applyBtn.addEventListener('click', async () => {
            const val = parseInt(element.querySelector('.cd-custom-value')?.value) || 1;
            const unit = element.querySelector('.cd-custom-unit')?.value || 'minutes';
            resolve(`custom:${val}:${unit}`);
            await _app.close();
          });
        }
      });

      foundry.applications.api.DialogV2.wait({
        window: { title: i.localize(`${K}.DURATION_TITLE`) },
        content,
        buttons: [{ action: 'cancel', label: i.localize('PF2E_AFFLICTIONER.DIALOG.CANCEL'), icon: 'fas fa-times' }],
        rejectClose: false
      }).then(() => {
        Hooks.off('renderDialogV2', hookId);
        resolve(null);
      }).catch(() => {
        Hooks.off('renderDialogV2', hookId);
        resolve(null);
      });
    });

    return result ?? null;
  }

  /**
   * Creates a PF2e effect on the actor to visually indicate a coated weapon.
   * @param {Actor} actor
   * @param {string} weaponName
   * @param {string} poisonName
   * @param {string} expirationMode
   * @param {string|null} [poisonImg] - Image from the poison item
   * @returns {Promise<string|null>} Effect UUID or null
   */
  static async createCoatingEffect(actor, weaponName, poisonName, expirationMode, poisonImg = null) {
    const i = game.i18n;
    const durationConfig = this._getEffectDuration(expirationMode);
    const effectName = i.format(`${K}.EFFECT_NAME`, { poisonName, weaponName });
    const effectDesc = i.format(`${K}.EFFECT_DESCRIPTION`, { poisonName, weaponName });

    const effectData = {
      type: 'effect',
      name: effectName,
      img: poisonImg || 'icons/svg/poison.svg',
      system: {
        description: { value: `<p>${effectDesc}</p>` },
        tokenIcon: { show: true },
        duration: durationConfig,
        badge: null,
        rules: [],
        slug: `coating-${poisonName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        unidentified: false
      },
      flags: {
        [MODULE_ID]: {
          isCoatingEffect: true,
          weaponName,
          poisonName
        }
      }
    };

    try {
      const [created] = await actor.createEmbeddedDocuments('Item', [effectData]);
      return created?.uuid ?? null;
    } catch (error) {
      console.error('PF2e Afflictioner | Error creating coating effect:', error);
      return null;
    }
  }

  static _getEffectDuration(mode) {
    if (mode?.startsWith('custom:')) {
      const [, val, unit] = mode.split(':');
      return { value: parseInt(val) || 1, unit: unit || 'minutes', expiry: null, sustained: false };
    }

    switch (mode) {
      case 'start-next-turn':
        return { value: 1, unit: 'rounds', expiry: 'turn-start', sustained: false };
      case 'end-next-turn':
        return { value: 1, unit: 'rounds', expiry: 'turn-end', sustained: false };
      case '1-minute':
        return { value: 1, unit: 'minutes', expiry: null, sustained: false };
      case '10-minutes':
        return { value: 10, unit: 'minutes', expiry: null, sustained: false };
      case '1-hour':
        return { value: 1, unit: 'hours', expiry: null, sustained: false };
      default: // unlimited
        return { value: -1, unit: 'unlimited', expiry: null, sustained: false };
    }
  }

  /**
   * Finds the combatant ID for the given actor in the current combat.
   * @param {Actor} actor
   * @returns {string|null}
   */
  static _findCombatantId(actor) {
    if (!game.combat?.started) return null;
    const combatant = game.combat.combatants.find(c => c.actorId === actor.id);
    return combatant?.id ?? null;
  }

  /**
   * If the actor has the Toxicologist feat, marks poison damage entries as choices
   * between poison and acid damage types.
   * @param {Actor} actor
   * @param {object} afflictionData
   * @returns {object} Modified affliction data (deep-copied if changed)
   */
  static _applyToxicologistSwap(actor, afflictionData) {
    if (!FeatsService.hasToxicologistFieldVenom(actor)) return afflictionData;

    const modified = JSON.parse(JSON.stringify(afflictionData));
    let applied = false;

    for (const stage of modified.stages) {
      if (!stage.damage) continue;
      stage.damage = stage.damage.map(d => {
        if (d.type === 'poison' && !d.isChoice) {
          applied = true;
          return { ...d, isChoice: true, alternativeType: 'acid' };
        }
        return d;
      });
    }

    if (applied) {
      ui.notifications.info(game.i18n.localize(`${K}.TOXICOLOGIST_APPLIED`));
    }

    return modified;
  }

  /**
   * Prompts the GM to choose a Debilitating Venom debilitation before coating.
   * @returns {Promise<'none'|'hampering'|'stumbling'|null>} null means the dialog was cancelled
   */
  static async _promptDebilitation() {
    const i = game.i18n;
    const V = 'PF2E_AFFLICTIONER.VISHKANYA';

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: i.localize(`${V}.DEBILITATION_TITLE`) },
      content: `<p style="margin-bottom: 0.5em;">${i.localize(`${V}.DEBILITATION_PROMPT`)}</p>`,
      buttons: [
        { action: 'none',      label: i.localize(`${V}.DEBILITATION_NONE`),      icon: 'fas fa-times-circle' },
        { action: 'hampering', label: i.localize(`${V}.DEBILITATION_HAMPERING`), icon: 'fas fa-tachometer-alt' },
        { action: 'stumbling', label: i.localize(`${V}.DEBILITATION_STUMBLING`), icon: 'fas fa-dizzy' },
      ],
      rejectClose: false
    });

    return result ?? null;
  }

  static _collectWeapons(speakerActorId, speakerTokenId, targetTokenIds = []) {
    const weapons = [];
    const seen = new Set();

    const addWeaponsForToken = (token) => {
      if (!token || seen.has(token.id)) return;
      seen.add(token.id);
      const actor = token.actor;
      if (!actor || !actor.isOwner) return;
      for (const weapon of (actor.itemTypes?.weapon || [])) {
        weapons.push({
          actorId: actor.id,
          actorName: actor.name,
          weaponId: weapon.id,
          weaponName: weapon.name,
          damageType: weapon.system?.damage?.damageType || 'unknown',
          img: weapon.img || 'icons/svg/sword.svg'
        });
      }
    };

    // Speaker's token first
    if (speakerTokenId) {
      addWeaponsForToken(canvas.tokens.get(speakerTokenId));
    } else if (speakerActorId) {
      for (const token of canvas.tokens.placeables) {
        if (token.actor?.id === speakerActorId) { addWeaponsForToken(token); break; }
      }
    }

    // Targeted tokens
    for (const tokenId of targetTokenIds) {
      addWeaponsForToken(canvas.tokens.get(tokenId));
    }

    return weapons;
  }
}
