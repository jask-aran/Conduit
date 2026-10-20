

/**
 * desktop or phone: the rules a shell's sections and items are built at. The
 * layout sets it once (the phone layout's media rule in styles/foundations.css, or
 * data-density on an ancestor); a shell inherits it and its sections follow.
 * The prop is an override, for drawing one layout inside another.
 */
export type Density = "desktop" | "phone";

/** A time token read from CSS, in ms. The build writes times as it likes (240ms becomes .24s), so read the unit. */
export function cssTime(element: Element, name: string, fallback: number) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  return value.endsWith("ms") ? amount : value.endsWith("s") ? amount * 1000 : amount;
}

/**
 * The one cursor (DESIGN Interaction): the pointer moves it, as the keyboard
 * does, so only one row of a list is ever washed. A list's container passes
 * this to onPointerOver; a row is a ui-row (data-highlighted) or a ui-choice (data-active).
 */
export function moveCursor(event: PointerEvent & { currentTarget: Element }) {
  const row = (event.target as Element).closest(".ui-row, .ui-choice");
  if (!row || !event.currentTarget.contains(row) || row.hasAttribute("data-disabled")) return;
  const attr = row.classList.contains("ui-choice") ? "data-active" : "data-highlighted";
  if (row.getAttribute(attr) === (attr === "data-active" ? "true" : "")) return;
  event.currentTarget.querySelectorAll(`[${attr}]`).forEach((other) => other.removeAttribute(attr));
  row.setAttribute(attr, attr === "data-active" ? "true" : "");
}

/** A piece's move, drawn by the piece from Foundations · Motion: entering, leaving (back the way it came), removing (fades in place). */
export type Motion = "entering" | "leaving" | "removing";
/** An entrance already under way: `since` ms into it, so a piece that takes another's place goes on with its entrance
 *  rather than starting one of its own (a turn's header arriving under the message just sent). */
export const sinceOf = (since?: number) => since ? { "--entered": `${-Math.round(since)}ms` } : undefined;
export const motionOf = (motion?: Motion) => ({ "data-entering": motion === "entering" ? "" : undefined, "data-leaving": motion === "leaving" ? "" : motion === "removing" ? "remove" : undefined });

/**
 * What a Markdown renderer drawing into an Answer marks: a wrapper of its own holding the answer's blocks (flow,
 * spaced as the Answer's own), a table's scroll box (table), a link it opens itself (link, a button), words just
 * streamed in (word: they fade in, over --answer-word-fade) and a formula's new parts (math: they fade in too, and the
 * renderer takes the class off once they have). A citation (a link whose text is its URL) carries data-citation;
 * formulas are KaTeX's own. A wide block -- a table, or a CodeBlock -- may grow past the column, centred, up to
 * --answer-bleed (tables) and --answer-bleed-code (code), which the pane declares; never past what it needs.
 */
export const ANSWER_MARKDOWN = { flow: "ui-answer-flow", table: "ui-answer-table", link: "ui-answer-link", word: "ui-answer-word", math: "ui-answer-math-in" } as const;

/** What a caller drawing its own lines into a CodeBlock marks: each line (line), which the block numbers. */
export const CODE_BLOCK = { line: "ui-code-line" } as const;
