

/**
 * desktop or phone: the rules a shell's sections and items are built at. The
 * layout sets it once (the phone layout's media rule in styles/foundations.css, or
 * data-density on an ancestor); a shell inherits it and its sections follow.
 * The prop is an override, for drawing one layout inside another.
 */
export type Density = "desktop" | "phone";

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
