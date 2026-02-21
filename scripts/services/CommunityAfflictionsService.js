import { MODULE_ID } from '../constants.js';
import { AfflictionConflictDetector } from './AfflictionConflictDetector.js';
import { ConflictResolutionDialog } from '../managers/ConflictResolutionDialog.js';

export class CommunityAfflictionsService {

  static async maybeImport() {
    const res = await fetch(`modules/${MODULE_ID}/data/community-afflictions.json`);
    if (!res.ok) {
      console.warn('PF2e Afflictioner | community-afflictions.json not found');
      return;
    }

    const communityData = await res.json();
    if (!communityData.edits || typeof communityData.edits !== 'object') {
      console.warn('PF2e Afflictioner | Invalid community-afflictions.json format');
      return;
    }

    if (Object.keys(communityData.edits).length === 0) return;

    const lastVersion = game.settings.get(MODULE_ID, 'communityDataVersion');
    if (lastVersion === communityData.version) return;

    const currentEdits = game.settings.get(MODULE_ID, 'editedAfflictions');
    const analysis = AfflictionConflictDetector.analyzeImport(communityData.edits, currentEdits);

    for (const [key, def] of Object.entries(currentEdits)) {
      if (!communityData.edits[key]) {
        analysis.autoImport.push({ key, definition: def, isIdentical: true });
      }
    }

    if (analysis.conflicts.length === 0) {
      const merged = { ...currentEdits };
      for (const item of analysis.autoImport) {
        if (item.isIdentical) continue;
        const def = foundry.utils.deepClone(item.definition);
        def.editedAt = Date.now();
        def.editedBy = 'community';
        merged[item.key] = def;
      }

      await game.settings.set(MODULE_ID, 'editedAfflictions', merged);
      await game.settings.set(MODULE_ID, 'communityDataVersion', communityData.version);

      const count = analysis.autoImport.filter(i => !i.isIdentical).length;
      console.log(`PF2e Afflictioner | Community data v${communityData.version} imported (${count} entries)`);
      ui.notifications.info(game.i18n.format('PF2E_AFFLICTIONER.EDITED_MANAGER.COMMUNITY_IMPORTED', { count }));
      return;
    }

    const dialog = new ConflictResolutionDialog(analysis);
    dialog.onFinish = async () => {
      await game.settings.set(MODULE_ID, 'communityDataVersion', communityData.version);
    };
    dialog.render(true);
  }
}
