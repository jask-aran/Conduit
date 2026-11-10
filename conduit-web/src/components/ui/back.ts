import { createEffect, onCleanup } from "solid-js";

/*
 * Back, as a phone's back button or gesture means it: one step out of whatever was opened last. Each thing that can be
 * stepped out of says so while it can (a dialog while it is open, a page reached from a list, a search with text in
 * it), newest last; back asks the newest first, and the first that takes the step ends it. What nothing here takes is
 * the app's own history.
 */
type Step = () => boolean | void;
const steps: Step[] = [];

/** Holds a step while it stands; returns its release. The step returns false when it had nothing to step out of. */
export function holdBack(step: Step): () => void {
  steps.push(step);
  return () => { const at = steps.lastIndexOf(step); if (at >= 0) steps.splice(at, 1); };
}
/** Holds the step while `when` is true. */
export function createBack(when: () => unknown, step: Step) {
  createEffect(() => { if (when()) onCleanup(holdBack(step)); });
}
/** Takes one step back; false when nothing took it. */
export function stepBack(): boolean {
  for (let at = steps.length - 1; at >= 0; at--) if (steps[at]!() !== false) return true;
  return false;
}
