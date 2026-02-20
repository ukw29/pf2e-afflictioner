/**
 * Returns true if an affliction should be silently skipped during processing.
 * Callers should do: if (shouldSkipAffliction(affliction)) continue; // or return;
 */
export function shouldSkipAffliction(affliction) {
  if (!affliction) return true;
  if (affliction.skip === true) return true;
  if (!affliction.stages || affliction.stages.length === 0) return true;
  return false;
}
