import { createContext, useContext } from "solid-js";

/*
 * Whether the app's pieces draw themselves with the library (index.tsx,
 * styles/) instead of their own material and menu classes. Off by
 * default and off in the app, but for the pieces graduated below; the
 * gallery's Library previews turn it on, around the real screens, so the
 * library is judged in the real app with all its behaviour. Context is read where a piece is
 * created; Solid carries it through portals, so menus see it too.
 */
export const LibraryContext = createContext(false);
export const useLibrary = () => useContext(LibraryContext);

/*
 * The pieces the app draws with the library everywhere, not only in the gallery's previews: graduated one at a time.
 * `localStorage conduit:classic` (a comma list, e.g. "trace,composer") draws one the old way again, to compare the two.
 */
export type Graduated = "trace" | "composer" | "transcript";
const GRADUATED = new Set<Graduated>(["trace", "composer", "transcript"]);
const classic = (() => { try { return new Set((localStorage.getItem("conduit:classic") ?? "").split(",").map((piece) => piece.trim())); } catch { return new Set<string>(); } })();
export const useLibraryPiece = (piece: Graduated) => useLibrary() || (GRADUATED.has(piece) && !classic.has(piece));


/** What an app trigger adds to be a library piece in the Library previews: a
 *  ghost icon button, or a small ghost button (a picker showing its value).
 *  Spread it, and add `.class` to the trigger's own classes. */
export function libraryPiece(piece: "icon-button" | "select") {
  if (!useLibrary()) return { class: "", data: {} };
  return piece === "select"
    ? { class: "ui-button", data: { "data-variant": "ghost", "data-size": "sm" } }
    : { class: "ui-button", data: { "data-variant": "ghost", "data-size": "icon-sm" } };
}
