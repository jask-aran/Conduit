import { type JSX } from "solid-js";

/*
 * The unified library, as a tree: Frost is the material; Popover, Card, Pill
 * and Message are what it makes. Each is a section of the gallery: the base
 * piece, then its constituents, then the app's own pieces assembled from them.
 */
export type Scope = "both" | "desktop" | "phone";
/** A cell: kind is the layer of the library it shows; source, where it lives in the code. */
export interface Atom { id: string; name: string; scope: Scope; kind: string; source: string; render: () => JSX.Element; wide?: boolean | "row" }
/** The tag: where the piece is used, and which layer of the library it is. wide: spans two cells; "row": the whole row.
 *  An assembled piece is named as the app's code names it (component, then the part within it). */
export const lib = (id: string, name: string, scope: Scope, layer: string, source: string, render: Atom["render"], wide?: Atom["wide"]): Atom => ({ id: `ui-${id}`, name, scope, kind: layer, source, render, wide });
/** A run of cells; layout: fixed at that layout (no per-cell toggle); staged: drawn on the page's surface at its density, or "density": at its density only (the cell draws its own surfaces). */
export interface Group { title?: string; note?: string; atoms: Atom[]; layout?: "desktop" | "phone"; staged?: boolean | "density" }
/** A page. rail: Foundations (tokens, palettes, icons, materials), Components (one base component and its parts; the
 *  default) or Blocks (what is composed from components); stage: the page picks one surface and density for its staged
 *  groups; usage: an import and a short snippet, shown before the examples; api: the exported components whose props
 *  the page lists (generated, page.tsx), the page's own first. */
export interface Family { title: string; note: string; rail?: "Foundations" | "Blocks"; stage?: boolean; usage?: string; api?: string[]; groups: Group[] }
