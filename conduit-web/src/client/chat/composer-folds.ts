/** Least used first: the row never squeezes a control, it hands the next one to the + menu. */
export const COMPOSER_FOLDS = ["permissions", "profile", "context", "model"] as const;
export type ComposerFold = typeof COMPOSER_FOLDS[number];

