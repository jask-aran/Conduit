/**
 * The desktop composer row's controls that fold into its + menu when the row
 * runs out of room, least used first: the row never squeezes a control, it
 * hands the next one to the menu (DESIGN.md, Fold, don't squeeze). Attach
 * lives in the menu always.
 */
export const COMPOSER_FOLDS = ["permissions", "place", "profile", "context", "model"] as const;
export type ComposerFold = typeof COMPOSER_FOLDS[number];

/**
 * Which controls to fold so the row fits: `widths` holds each present
 * control's width as last drawn, `fixed` the rest of the row's need.
 */
export function foldsFor(available: number, fixed: number, widths: ReadonlyMap<ComposerFold, number>, gap: number): Set<ComposerFold> {
  let need = fixed;
  for (const width of widths.values()) need += width + gap;
  const folded = new Set<ComposerFold>();
  for (const key of COMPOSER_FOLDS) {
    if (need <= available) break;
    const width = widths.get(key);
    if (width === undefined) continue;
    folded.add(key);
    need -= width + gap;
  }
  return folded;
}
