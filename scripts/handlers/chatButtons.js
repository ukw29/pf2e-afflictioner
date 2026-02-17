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
}
