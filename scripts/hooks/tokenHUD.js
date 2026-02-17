/**
 * Token HUD Hook - Add affliction manager button to token right-click menu
 */

import * as AfflictionStore from '../stores/AfflictionStore.js';

/**
 * Add affliction manager button to token HUD
 */
export function onRenderTokenHUD(app, html) {
  // Only show for GMs
  if (!game.user.isGM) return;

  const token = app.object;
  if (!token) return;

  // html is a jQuery in Foundry; normalize to a DOM element
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  // Find the right column to add the button
  let column = root.querySelector('div.col.right');
  if (!column && html?.find) {
    column = html.find('div.col.right')[0];
  }
  if (!column) {
    console.warn('PF2e Afflictioner: Could not find right column in token HUD');
    return;
  }

  // Remove any existing instance first
  const existing = column.querySelector('[data-action="pf2e-afflictioner-manage"]');
  if (existing) existing.remove();

  // Check if token has afflictions
  const afflictions = AfflictionStore.getAfflictions(token);
  const hasAfflictions = Object.keys(afflictions).length > 0;

  // Create the button element
  const buttonElement = document.createElement('div');
  buttonElement.className = hasAfflictions ? 'control-icon active' : 'control-icon';
  buttonElement.style.display = 'flex';
  buttonElement.setAttribute('data-action', 'pf2e-afflictioner-manage');
  buttonElement.setAttribute('data-tooltip', 'Manage Afflictions');
  buttonElement.innerHTML = '<i class="fas fa-biohazard"></i>';

  // Add click handler
  buttonElement.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      // Import manager
      const { AfflictionManager } = await import('../managers/AfflictionManager.js');

      // Open manager filtered to this token
      if (AfflictionManager.currentInstance) {
        AfflictionManager.currentInstance.close();
      }

      new AfflictionManager({ filterTokenId: token.id }).render(true);
    } catch (error) {
      console.error('PF2e Afflictioner: Error opening manager:', error);
    }
  });

  // Add the button to the column (prepend to put at top)
  column.insertBefore(buttonElement, column.firstChild);
}
