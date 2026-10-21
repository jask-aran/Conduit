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

/* The page template (page.tsx draws it): every page has the same sections in the same order, each with one
   presentation, and a section is either there in full or absent. Headings are fixed; a page's own words are its
   summary and each row's note. */

/** A row of Examples or Motion: name and note down the side; render drawn once per column. surfaces: the surfaces
 *  it sits on (both by default; a piece that is its own surface, like a card or the composer, takes one). phone: drawn
 *  again at the phone's density, for a piece that differs there ("only": a phone-only piece, drawn there alone). code: how to write this form, if not obvious. */
export interface Row { name: string; note: string; render: () => JSX.Element; surfaces?: ("ground" | "frost")[]; phone?: boolean | "only"; code?: string }
export const row = (name: string, note: string, render: Row["render"], more: Omit<Row, "name" | "note" | "render"> = {}): Row => ({ name, note, render, ...more });

/** A numbered part of an Anatomy: what the selector picks out, what it does, and what it is made of (a fixed text,
 *  or read from the drawn element, as a foundation reads a token's computed value). */
export interface Part { selector: string; name: string; does: string; from?: string | ((el: HTMLElement) => string); side?: "above" | "below" }

/** A token of the Tokens table: its name, its use, its value as computed (read), and an optional sample. */
export interface Token { name: string; use: string; read: (cell: HTMLElement) => string; sample?: () => JSX.Element }

/**
 * A page. summary: one line under the title. preview: the default state, live. usage: an import and a short snippet.
 * anatomy: the preview's parts, numbered with a legend (only for what has parts). examples: every variant, size and
 * state. motion: its moves, replayable (only if it animates). tokens: what it reads, grouped. api: the exported
 * components whose props are listed (generated), its own first; Used in follows from them.
 */
export interface Page {
  title: string; summary: string; rail?: "Foundations" | "Blocks";
  preview?: () => JSX.Element;
  usage?: string;
  anatomy?: { scene: () => JSX.Element; parts: Part[] };
  examples?: Row[];
  motion?: Row[];
  tokens?: { title: string; tokens: Token[] }[];
  api?: string[];
}
/** A token as the cell computes it. */
export const token = (name: string, use: string, sample?: Token["sample"]): Token => ({ name, use, read: (cell) => getComputedStyle(cell).getPropertyValue(name).trim(), sample });
