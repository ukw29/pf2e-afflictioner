import { AfflictionParser } from './AfflictionParser.js';
import * as WeaponCoatingStore from '../stores/WeaponCoatingStore.js';

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

    const existing = WeaponCoatingStore.getCoating(actor, selected.weaponId);
    if (existing) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        title: i.localize(`${K}.REPLACE_TITLE`),
        content: `<p>${i.format(`${K}.REPLACE_CONTENT`, { weaponName: selected.weaponName, existingPoison: existing.poisonName })}</p>`,
        defaultYes: false
      });
      if (!confirmed) return;
    }

    await WeaponCoatingStore.addCoating(actor, selected.weaponId, {
      poisonItemUuid: itemUuid,
      poisonName: afflictionData.name,
      weaponName: selected.weaponName,
      afflictionData
    });

    ui.notifications.info(i.format(`${K}.COATED`, { weaponName: selected.weaponName, poisonName: afflictionData.name }));

    const { AfflictionManager } = await import('../managers/AfflictionManager.js');
    if (AfflictionManager.currentInstance) {
      AfflictionManager.currentInstance.render({ force: true });
    }
  }

  static _collectWeapons(speakerActorId, speakerTokenId, targetTokenIds = []) {
    const weapons = [];
    const seen = new Set();

    const addWeaponsForToken = (token) => {
      if (!token || seen.has(token.id)) return;
      seen.add(token.id);
      const actor = token.actor;
      if (!actor) return;
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
