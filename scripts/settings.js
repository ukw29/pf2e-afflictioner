/**
 * Settings registration
 */

import { MODULE_ID, DEFAULT_SETTINGS } from './constants.js';

export function registerSettings() {
  // Register all settings
  Object.entries(DEFAULT_SETTINGS).forEach(([key, config]) => {
    game.settings.register(MODULE_ID, key, config);
  });

  // Register menu button for Edited Afflictions Manager
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

// Menu button class for Edited Afflictions Manager
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
    // No form data to process
  }

  render() {
    // Immediately open the manager instead of rendering a form
    this.openManager();
    return this;
  }
}
