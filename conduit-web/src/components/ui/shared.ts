

/** desktop or phone: the rules a shell is built at, set once by the layout (styles/foundations.css, or data-density
 *  on an ancestor); the prop is an override, for drawing one layout inside another. */
export type Density = "desktop" | "phone";

/** Whether a pointer event is from a pointer that hovers (a mouse, a pen above the screen), not a touch. */
export const hovers = (event: PointerEvent) => event.pointerType !== "touch";

/** A time token read from CSS, in ms. The build writes times as it likes (240ms becomes .24s), so read the unit. */
export function cssTime(element: Element, name: string, fallback: number) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  return value.endsWith("ms") ? amount : value.endsWith("s") ? amount * 1000 : amount;
}

/** The one cursor (DESIGN Interaction): the pointer moves it as the keyboard does, so only one row is ever washed; a
 *  list passes this to onPointerOver. Only a hovering pointer moves it: a tap is a choice, and would leave a wash. */
export function moveCursor(event: PointerEvent & { currentTarget: Element }) {
  if (!hovers(event)) return;
  const row = (event.target as Element).closest(".ui-row");
  if (!row || !event.currentTarget.contains(row) || row.matches("[data-disabled], [data-still], [data-highlighted]")) return;
  event.currentTarget.querySelectorAll("[data-highlighted]").forEach((other) => other.removeAttribute("data-highlighted"));
  row.setAttribute("data-highlighted", "");
}

/** A piece's move, drawn by the piece from Foundations · Motion: entering, leaving (back the way it came), removing (fades in place). */
export type Motion = "entering" | "leaving" | "removing";
/** An entrance already under way: `since` ms into it, so a piece that takes another's place goes on with its entrance
 *  rather than starting one of its own (a turn's header arriving under the message just sent). */
export const sinceOf = (since?: number) => since ? { "--entered": `${-Math.round(since)}ms` } : undefined;
export const motionOf = (motion?: Motion) => ({ "data-entering": motion === "entering" ? "" : undefined, "data-leaving": motion === "leaving" ? "" : motion === "removing" ? "remove" : undefined });

/** What a Markdown renderer drawing into an Answer marks: flow, table, link (a button), word (fading in) and math
 *  (fading in; the renderer takes the class off after). A citation carries data-citation. A wide block may grow past
 *  the column up to --answer-bleed / --answer-bleed-code, which the pane declares. */
export const ANSWER_MARKDOWN = { flow: "ui-answer-flow", table: "ui-answer-table", link: "ui-answer-link", word: "ui-answer-word", math: "ui-answer-math-in" } as const;

/** What a caller drawing its own lines into a CodeBlock marks: each line (line), which the block numbers. */
export const CODE_BLOCK = { line: "ui-code-line" } as const;

/** Calls a Solid event handler as given: a function, or a bound [handler, data] pair. */
export function callHandler<E extends Event>(handler: unknown, event: E) {
  if (typeof handler === "function") handler(event);
  else if (Array.isArray(handler) && typeof handler[0] === "function") handler[0](handler[1], event);
}
