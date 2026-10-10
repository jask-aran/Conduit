import { createContext, useContext } from "solid-js";

/*
 * Whether the app's pieces draw themselves with the library (index.tsx,
 * library.css) instead of their own material and menu classes. Off by
 * default and off everywhere in the app; only the gallery's Library
 * previews turn it on, around the real screens, so the library is judged in
 * the real app with all its behaviour. Context is read where a piece is
 * created; Solid carries it through portals, so menus see it too.
 */
export const LibraryContext = createContext(false);
export const useLibrary = () => useContext(LibraryContext);


/** What an app trigger adds to be a library piece in the Library previews: a
 *  ghost icon button, or a small ghost button (a picker showing its value).
 *  Spread it, and add `.class` to the trigger's own classes. */
export function libraryPiece(piece: "icon-button" | "select") {
  if (!useLibrary()) return { class: "", data: {} };
  return piece === "select"
    ? { class: "ui-button", data: { "data-variant": "ghost", "data-size": "sm" } }
    : { class: "ui-button", data: { "data-variant": "ghost", "data-size": "icon-sm" } };
}
