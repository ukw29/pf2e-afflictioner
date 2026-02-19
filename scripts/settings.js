import { MODULE_ID, DEFAULT_SETTINGS } from './constants.js';

export function registerSettings() {
  Object.entries(DEFAULT_SETTINGS).forEach(([key, config]) => {
    game.settings.register(MODULE_ID, key, config);
  });

  game.settings.registerMenu(MODULE_ID, 'editedAfflictionsMenu', {
    name: 'PF2E_AFFLICTIONER.SETTINGS.EDITED_AFFLICTIONS_MENU',
    label: 'PF2E_AFFLICTIONER.SETTINGS.EDITED_AFFLICTIONS_LABEL',
    hint: 'PF2E_AFFLICTIONER.SETTINGS.EDITED_AFFLICTIONS_HINT',
    icon: 'fas fa-edit',
    type: EditedAfflictionsMenuButton,
    restricted: true
  });

  console.log('PF2e Afflictioner | Settings registered');
}

class EditedAfflictionsMenuButton extends FormApplication {
  constructor(object, options) {
    super(object, options);
    this.openManager();
  }

  async openManager() {
    const { EditedAfflictionsManager } = await import('./managers/EditedAfflictionsManager.js');
    new EditedAfflictionsManager().render(true);
    this.close();
  }

  async _updateObject(event, formData) {
  }

  render() {
    this.openManager();
    return this;
  }
}
