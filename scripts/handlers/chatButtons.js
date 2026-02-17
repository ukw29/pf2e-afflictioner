/**
 * Chat Button Handler Orchestrator
 * Coordinates all chat message button handlers
 */

import { registerSaveButtonHandlers, injectConfirmationButton } from './saveButtons.js';
import { registerAfflictionButtonHandlers } from './afflictionButtons.js';
import { registerTreatmentButtonHandlers, addTreatmentAfflictionSelection } from './treatmentButtons.js';
import { registerCounteractButtonHandlers, addCounteractAfflictionSelection } from './counteractButtons.js';

/**
 * Handle chat message rendering - add all button handlers
 */
export function onRenderChatMessage(message, html) {
  const root = html?.jquery ? html[0] : html;
  if (!root) return;

  // Inject confirmation button on roll messages (when requireSaveConfirmation enabled)
  injectConfirmationButton(message, root);

  // Register save button handlers
  registerSaveButtonHandlers(root);

  // Register affliction button handlers
  registerAfflictionButtonHandlers(root, message);

  // Register treatment button handlers
  registerTreatmentButtonHandlers(root);

  // Register counteract button handlers
  registerCounteractButtonHandlers(root);

  // Add treatment affliction selection
  addTreatmentAfflictionSelection(message, root);

  // Add counteract affliction selection
  addCounteractAfflictionSelection(message, root);

  // Register max duration removal button handler
  registerMaxDurationRemovalHandler(root);
}

/**
 * Register handler for max duration removal buttons
 */
function registerMaxDurationRemovalHandler(root) {
  const removeBtn = root.querySelector('.pf2e-afflictioner-remove-expired-btn');
  if (!removeBtn) return;

  removeBtn.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const tokenId = button.dataset.tokenId;
    const afflictionId = button.dataset.afflictionId;

    const token = canvas.tokens.get(tokenId);
    if (!token) {
      ui.notifications.error('Token not found');
      return;
    }

    const AfflictionStore = await import('../stores/AfflictionStore.js');
    const affliction = AfflictionStore.getAffliction(token, afflictionId);
    if (!affliction) {
      ui.notifications.error('Affliction not found');
      return;
    }

    // Remove affliction from tracking only
    // Effect and conditions remain on actor per PF2e rules
    await AfflictionStore.removeAffliction(token, afflictionId);

    // Remove visual indicator
    const { VisualService } = await import('../services/VisualService.js');
    await VisualService.removeAfflictionIndicator(token);

    ui.notifications.info(`Removed ${affliction.name} from tracking. Effect and conditions persist on ${token.name} per PF2e rules.`);

    // Disable button
    button.disabled = true;
    button.textContent = '✓ Affliction Removed';
  });
}
