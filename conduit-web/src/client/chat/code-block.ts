import type { UiPreferenceChoice } from "../preferences/ui-preferences";

export const CODE_BLOCK_COLLAPSE_DEFAULT_LINES = 15;

export type CodeBlockCollapseMode = UiPreferenceChoice<"codeBlockCollapse">;

/** The transcript listens so it can hold the card still and re-measure the virtualizer at once: left to the idle
 *  scheduler, stale intrinsic sizes show as empty placeholders for seconds. */
export const CODE_BLOCK_TOGGLE_EVENT = "conduit:code-block-toggle";

/** `previousTop` is measured before the state flips: shrinking the card lets browser scroll anchoring adjust
 *  scrollTop, so measuring afterwards only reports where the card already ended up. */
export function publishCodeBlockToggle(card: HTMLElement, previousTop: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CODE_BLOCK_TOGGLE_EVENT, { detail: { card, previousTop } }));
}

export function normalizeCodeLanguage(value: unknown) {
  return String(value || "text").split(/\s+/)[0]!.toLowerCase();
}

export function countCodeLines(text: string) {
  if (!text) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!trimmed) return 0;
  let lines = 1;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === "\n") lines += 1;
  }
  return lines;
}

/** The line count is the whole rule, and it applies while the fence is still open. */
export function shouldCollapseCodeBlock(
  lines: number,
  mode: CodeBlockCollapseMode,
  threshold: number,
) {
  if (mode === "off") return false;
  if (mode === "all") return lines > 1;
  return lines > threshold;
}

export function codeBlockFold(lines: number, mode: CodeBlockCollapseMode, threshold: number) {
  if (!shouldCollapseCodeBlock(lines, mode, threshold)) return undefined;
  return mode === "all" ? Math.min(threshold, lines - 1) : threshold;
}
