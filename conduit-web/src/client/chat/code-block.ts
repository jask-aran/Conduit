/**
 * The code block's rules shared by both renderers: its language, its lines, when it folds. The block itself is the
 * library's CodeBlock (Incremark) or codeBlockHtml (marked).
 */
import { codeBlockHtml, fillCodeBlocks, setCodeBlockOpen } from "@/components/ui/code";

export const CODE_BLOCK_COLLAPSE_LINE_OPTIONS = [10, 15, 25, 50] as const;
export const CODE_BLOCK_COLLAPSE_DEFAULT_LINES = 15;

export type CodeBlockCollapseMode = "off" | "long" | "all";

/**
 * Fired after a card's collapse state flips.
 *
 * Folding a 50-line block removes about a thousand pixels from the thread in
 * one commit. The transcript listens so it can hold the card still and
 * re-measure the virtualizer immediately -- left to the idle scheduler, the
 * stale intrinsic sizes showed as empty placeholders for seconds.
 */
export const CODE_BLOCK_TOGGLE_EVENT = "conduit:code-block-toggle";

/**
 * @param previousTop the card's viewport-relative top measured *before* the
 * state flipped. Shrinking the card lets browser scroll anchoring pick a node
 * below it and adjust scrollTop, so the position has to be captured up front --
 * measuring afterwards only reports where the card already ended up.
 */
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

/**
 * Whether a block starts collapsed.
 *
 * The line count is the whole rule, and it applies while the fence is still
 * open. Waiting for the closing fence meant a ten-line limit did nothing until
 * the block had run to whatever length it was going to reach, then folded it
 * all at once; folding at the threshold is what the limit says.
 */
export function shouldCollapseCodeBlock(
  lines: number,
  mode: CodeBlockCollapseMode,
  threshold: number,
) {
  if (mode === "off") return false;
  if (mode === "all") return lines > 1;
  return lines > threshold;
}

/**
 * The lines a block folds to under the preference, or none: long folds a block past the threshold to it, all folds
 * every block of more than a line (to the threshold, or a line less than it has).
 */
export function codeBlockFold(lines: number, mode: CodeBlockCollapseMode, threshold: number) {
  if (!shouldCollapseCodeBlock(lines, mode, threshold)) return undefined;
  return mode === "all" ? Math.min(threshold, lines - 1) : threshold;
}

/**
 * Re-apply the collapse preference to the marked renderers' blocks (codeBlockHtml), which cannot track it.
 *
 * Emitters decide collapse at render time, so this only runs when the user
 * changes the setting -- exactly when a live update is wanted, and never on the
 * streaming path. Incremark's blocks track the preference themselves.
 */
export function syncCodeBlockCollapse(root: ParentNode, mode: CodeBlockCollapseMode, threshold: number) {
  for (const block of root.querySelectorAll<HTMLElement>(".ui-code[data-language]:not([data-streaming])")) {
    const lines = Number(block.dataset.lines) || 0;
    const shell = document.createElement("template");
    shell.innerHTML = codeBlockHtml({ lang: block.dataset.language, code: "", lines, fold: codeBlockFold(lines, mode, threshold) });
    const fresh = shell.content.firstElementChild as HTMLElement;
    fillCodeBlocks(fresh.parentNode!);
    block.querySelector(":scope > figcaption")?.replaceWith(fresh.querySelector(":scope > figcaption")!);
    block.querySelector(":scope > .ui-code-more")?.remove();
    const more = fresh.querySelector(":scope > .ui-code-more");
    if (more) block.append(more);
    block.setAttribute("style", fresh.getAttribute("style") ?? "");
    // A block the user opened by hand stays open; the preference sets the default, it does not re-close it.
    block.toggleAttribute("data-folded", fresh.hasAttribute("data-folded"));
    if (more && block.hasAttribute("data-user-open")) setCodeBlockOpen(block, true);
  }
}
