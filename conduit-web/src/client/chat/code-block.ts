/**
 * One contract for the code-block card, shared by every renderer.
 *
 * There are four independent emitters -- two HTML-string paths in the marked
 * renderers, two JSX paths in Incremark -- and they must agree exactly, because
 * collapse and copy are handled by delegated listeners keyed off these
 * attributes rather than by any renderer's own state. Keeping the behaviour in
 * attributes is also what lets it survive Incremark Advanced freezing a settled
 * message: toggling `data-collapsed` never re-enters the renderer.
 */

// Deliberately dependency-free, including this escape. The card contract is
// shared by four renderers and is the thing most worth unit-testing, and the
// project's modules import without file extensions, which the bundler resolves
// but the test runner does not. Duplicating five lines buys direct coverage.
const escape = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

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
 * A block that is still streaming always stays open -- collapsing text as it
 * arrives would hide the very thing the user is watching -- so the decision is
 * re-taken once the fence closes.
 */
export function shouldCollapseCodeBlock(
  lines: number,
  mode: CodeBlockCollapseMode,
  threshold: number,
  streaming: boolean,
) {
  if (streaming || mode === "off") return false;
  if (mode === "all") return lines > 1;
  return lines > threshold;
}

export function codeBlockExpandLabel(lines: number, threshold: number) {
  const hidden = Math.max(0, lines - threshold);
  if (hidden <= 0) return "Show more";
  return `Show ${hidden} more ${hidden === 1 ? "line" : "lines"}`;
}

export function codeBlockCollapseLabel() {
  return "Collapse";
}

/** Attributes shared by both the string and JSX card shells. */
export type CodeBlockState = {
  lines: number;
  collapsible: boolean;
  collapsed: boolean;
  expandLabel: string;
};

export function codeBlockState(
  text: string,
  mode: CodeBlockCollapseMode,
  threshold: number,
  streaming: boolean,
): CodeBlockState {
  const lines = countCodeLines(text);
  const collapsed = shouldCollapseCodeBlock(lines, mode, threshold, streaming);
  return {
    lines,
    collapsible: collapsed || (!streaming && mode !== "off" && lines > threshold),
    collapsed,
    expandLabel: codeBlockExpandLabel(lines, mode === "all" ? 0 : threshold),
  };
}

/** The card markup for the two marked renderers, which emit HTML strings. */
export function codeBlockMarkup(options: {
  language: string;
  text: string;
  streaming?: boolean;
  pending?: boolean;
  state: CodeBlockState;
}) {
  const language = escape(normalizeCodeLanguage(options.language));
  const streaming = Boolean(options.streaming);
  const pendingClass = options.pending && streaming ? " streaming-pending streaming-pending-fence" : "";
  const pendingAttr = options.pending && streaming ? ' data-streaming-pending="fence"' : "";
  const state = options.state;
  const footer = state.collapsible
    ? `<button type="button" class="artifact-expand" data-expand-code data-expand-label>${escape(state.expandLabel)}</button>`
    : "";
  // The header toggle carries the same data-expand-code contract as the footer
  // button, so one delegated handler serves both. Because the header is pinned,
  // it is the only control still reachable part-way down a long block.
  const headerToggle = state.collapsible
    ? `<button type="button" class="artifact-toggle" data-expand-code`
      + ` aria-label="${state.collapsed ? "Expand code" : "Collapse code"}"`
      + ` aria-expanded="${state.collapsed ? "false" : "true"}"></button>`
    : "";
  return `<div class="artifact${pendingClass}" data-language="${language}"`
    + `${pendingAttr} data-lines="${state.lines}"`
    + `${state.collapsible ? ' data-collapsible="true"' : ""}`
    + `${state.collapsed ? ' data-collapsed="true"' : ""}>`
    + `<div class="artifact-header"><span>${language}</span>`
    + `<span class="artifact-actions">`
    + `<button type="button" class="artifact-copy" aria-label="Copy code" data-copy-code>`
    + `<span class="artifact-copy-label">Copy</span></button>${headerToggle}</span></div>`
    + `<pre><code>${escape(options.text)}</code></pre>${footer}</div>`;
}

/**
 * Re-apply the collapse preference to already-rendered cards.
 *
 * Emitters decide collapse at render time, so this only runs when the user
 * changes the setting -- exactly when a live update is wanted, and never on the
 * streaming path.
 */
export function syncCodeBlockCollapse(
  root: ParentNode,
  mode: CodeBlockCollapseMode,
  threshold: number,
) {
  for (const card of root.querySelectorAll<HTMLElement>(".artifact[data-lines]")) {
    if (card.dataset.streamingPending === "fence") continue;
    // Incremark cards are real components that track the preference themselves.
    // Restamping them here would fight their own state on the next render.
    if (card.closest(".incremark")) continue;
    const lines = Number(card.dataset.lines) || 0;
    const collapsible = mode !== "off" && lines > (mode === "all" ? 1 : threshold);
    const expander = card.querySelector<HTMLElement>("[data-expand-label]");
    if (!collapsible) {
      delete card.dataset.collapsible;
      delete card.dataset.collapsed;
      expander?.remove();
      card.querySelector(".artifact-toggle")?.remove();
      continue;
    }
    card.dataset.collapsible = "true";
    // A card the user opened by hand stays open; the preference sets the
    // default, it does not re-close what someone deliberately expanded.
    if (card.dataset.userExpanded !== "true") card.dataset.collapsed = "true";
    const label = codeBlockExpandLabel(lines, mode === "all" ? 0 : threshold);
    if (expander) expander.textContent = label;
    else card.append(buildExpander(label));
    if (!card.querySelector(".artifact-toggle")) {
      card.querySelector(".artifact-actions")?.append(buildHeaderToggle(card.dataset.collapsed === "true"));
    }
    syncCodeBlockToggleLabels(card);
  }
}

function buildExpander(label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "artifact-expand";
  button.setAttribute("data-expand-code", "");
  button.setAttribute("data-expand-label", "");
  button.textContent = label;
  return button;
}

function buildHeaderToggle(collapsed: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "artifact-toggle";
  button.setAttribute("data-expand-code", "");
  button.setAttribute("aria-label", collapsed ? "Expand code" : "Collapse code");
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  return button;
}

/**
 * Bring both controls in line with the card's current state. The header toggle
 * is an icon whose meaning lives in its aria-label; the footer button names how
 * much is still hidden.
 */
export function syncCodeBlockToggleLabels(card: HTMLElement, threshold?: number) {
  const collapsed = card.dataset.collapsed === "true";
  const toggle = card.querySelector<HTMLElement>(".artifact-toggle");
  if (toggle) {
    toggle.setAttribute("aria-label", collapsed ? "Expand code" : "Collapse code");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
  const expander = card.querySelector<HTMLElement>("[data-expand-label]");
  if (!expander) return;
  if (!collapsed) {
    expander.textContent = codeBlockCollapseLabel();
    return;
  }
  const lines = Number(card.dataset.lines) || 0;
  const limit = threshold ?? (Number(getComputedStyle(card).getPropertyValue("--code-collapse-lines")) || 0);
  expander.textContent = codeBlockExpandLabel(lines, limit);
}
