import { createEffect, onCleanup } from "solid-js";

/* Back asks the newest held step first, and the first that takes the step ends it; what nothing takes is the app's
 * own history. */
type Step = () => boolean | void;
const steps: Step[] = [];

/** Holds a step while it stands; returns its release. The step returns false when it had nothing to step out of. */
export function holdBack(step: Step): () => void {
  steps.push(step);
  return () => { const at = steps.lastIndexOf(step); if (at >= 0) steps.splice(at, 1); };
}
export function createBack(when: () => unknown, step: Step) {
  createEffect(() => { if (when()) onCleanup(holdBack(step)); });
}
export function stepBack(): boolean {
  for (let at = steps.length - 1; at >= 0; at--) if (steps[at]!() !== false) return true;
  return false;
}
