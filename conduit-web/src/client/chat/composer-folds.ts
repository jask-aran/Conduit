/**
 * The desktop composer row's controls that fold into its + menu when the row
 * runs out of room, least used first: the row never squeezes a control, it
 * hands the next one to the menu (DESIGN.md, Fold, don't squeeze). Attach
 * and the project live in the menu always.
 */
export const COMPOSER_FOLDS = ["permissions", "profile", "context", "model"] as const;
export type ComposerFold = typeof COMPOSER_FOLDS[number];

