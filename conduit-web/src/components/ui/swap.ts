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
