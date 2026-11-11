/**
 * `""` is a model with no levels and is what goes on the wire; the picker's "off" is not a level any harness knows.
 */
export function preferredThinkingLevel(levels: string[], asked?: string, fallback?: string): string {
  if (asked && levels.includes(asked)) return asked;
  if (fallback && levels.includes(fallback)) return fallback;
  if (levels.includes("medium")) return "medium";
  return levels[0] || "";
}
