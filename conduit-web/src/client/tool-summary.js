// Pure helpers for the generic tool-call card v2 (`./tool-card.jsx`), kept in
// their own module so they can be unit-tested with node:test without
// importing any JSX.

const MAX_INLINE_VALUE_LENGTH = 24;

export function truncateValue(value, max = MAX_INLINE_VALUE_LENGTH) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Derives a one-line `name(args…)` summary from a merged tool-state object.
 * Generic fallback for tools with no bespoke renderer: shows up to two arg
 * entries, truncated, with an ellipsis marker when more are present.
 */
export function summarizeTool(tool) {
  const name = tool?.name || "tool";
  const args = tool?.args;
  if (args == null) return `${name}()`;
  if (typeof args !== "object" || Array.isArray(args)) return `${name}(${truncateValue(args)})`;
  const entries = Object.entries(args);
  if (entries.length === 0) return `${name}()`;
  const shown = entries.slice(0, 2).map(([key, value]) => `${key}: ${truncateValue(value)}`);
  const suffix = entries.length > shown.length ? ", …" : "";
  return `${name}(${shown.join(", ")}${suffix})`;
}

/** Pretty-prints a value for the expanded args/result sections. */
export function prettyPrintValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
