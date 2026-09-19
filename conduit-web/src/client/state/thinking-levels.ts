/**
 * Which thinking level to ask a model for, given the ones it offers.
 *
 * `""` is a model with none, and is what goes on the wire for one -- the
 * picker draws that absence as "off", which is a word for the reader and not a
 * level any harness knows. Sending it as one was rejected as invalid, and no
 * harness had hit it before because every model until now offered at least one
 * level, so the last branch had never run.
 *
 * Preference order: what was asked for, then the model's own default, then
 * `medium` as the conventional middle, then whatever it lists first.
 */
export function preferredThinkingLevel(levels: string[], asked?: string, fallback?: string): string {
  if (asked && levels.includes(asked)) return asked;
  if (fallback && levels.includes(fallback)) return fallback;
  if (levels.includes("medium")) return "medium";
  return levels[0] || "";
}
