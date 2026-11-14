

export type Density = "desktop" | "phone";

export const hovers = (event: PointerEvent) => event.pointerType !== "touch";

/** The build writes times as it likes (240ms becomes .24s), so read the unit. */
export function cssTime(element: Element, name: string, fallback: number) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  return value.endsWith("ms") ? amount : value.endsWith("s") ? amount * 1000 : amount;
}

/** The pointer moves the cursor as the keyboard does, so only one row is ever washed. Only a hovering pointer moves it:
 *  a tap is a choice, and would leave a wash. */
export function moveCursor(event: PointerEvent & { currentTarget: Element }) {
  if (!hovers(event)) return;
  const row = (event.target as Element).closest(".ui-row");
  if (!row || !event.currentTarget.contains(row) || row.matches("[data-disabled], [data-still], [data-highlighted]")) return;
  event.currentTarget.querySelectorAll("[data-highlighted]").forEach((other) => other.removeAttribute("data-highlighted"));
  row.setAttribute("data-highlighted", "");
}

export type Motion = "entering" | "leaving" | "removing";
/** A piece that takes another's place goes on with its entrance rather than starting one of its own. */
export const sinceOf = (since?: number) => since ? { "--entered": `${-Math.round(since)}ms` } : undefined;
export const motionOf = (motion?: Motion) => ({ "data-entering": motion === "entering" ? "" : undefined, "data-leaving": motion === "leaving" ? "" : motion === "removing" ? "remove" : undefined });

export const ANSWER_MARKDOWN = { flow: "ui-answer-flow", table: "ui-answer-table", link: "ui-answer-link", word: "ui-answer-word", math: "ui-answer-math-in" } as const;

export const CODE_BLOCK = { line: "ui-code-line" } as const;

/** Whether resolved children (`children()`) hold an element with the class `name` at their top level: what a
 * `:has(> .name)` would ask, which no stylesheet may (check-conventions rule 11). */
export const holds = (resolved: unknown, name: string) => [resolved].flat().some((node) => node instanceof Element && node.classList.contains(name));

export function callHandler<E extends Event>(handler: unknown, event: E) {
  if (typeof handler === "function") handler(event);
  else if (Array.isArray(handler) && typeof handler[0] === "function") handler[0](handler[1], event);
}
