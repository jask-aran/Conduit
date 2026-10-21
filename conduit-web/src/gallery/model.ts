import { type JSX } from "solid-js";

/* The page template (page.tsx draws it): every page has the same sections in the same order, each with one
   presentation, and a section is either there in full or absent. Headings are fixed; a page's own words are its
   summary and each row's note. */

/** A row of Examples or Motion: name and note down the side; render drawn once per column. surfaces: the surfaces it
 *  sits on (ground and frost by default; frame first for what also sits on the sidebar's; a piece that is its own
 *  surface, like a card or the composer, takes ground alone). phone: drawn again at the phone's density, for a piece
 *  that differs there ("only": a phone-only piece, drawn there alone). code: how to write this form, if not obvious. */
export interface Row { name: string; note: string; render: () => JSX.Element; surfaces?: ("frame" | "ground" | "frost")[]; phone?: boolean | "only"; code?: string }
export const row = (name: string, note: string, render: Row["render"], more: Omit<Row, "name" | "note" | "render"> = {}): Row => ({ name, note, render, ...more });

/** A numbered part of an Anatomy: what the selector picks out, what it does, and what it is made of (a fixed text,
 *  or read from the drawn element, as a foundation reads a token's computed value). */
export interface Part { selector: string; name: string; does: string; from?: string | ((el: HTMLElement) => string); side?: "above" | "below" }

/** A token of the Tokens table: its name, its use, its value as computed (read), and an optional sample. */
export interface Token { name: string; use: string; read: (cell: HTMLElement) => string; sample?: () => JSX.Element }

/**
 * A page. summary: one line under the title. preview: the default state, live. usage: an import and a short snippet.
 * anatomy: the preview's parts, numbered with a legend (only for what has parts). examples: every variant, size and
 * state. motion: its moves, replayable (only if it animates). tokens: what it reads, grouped (density: a group whose
 * values differ by density shows Desktop and Phone columns). api: the exported
 * components whose props are listed (generated), its own first; Used in follows from them.
 */
export interface Page {
  title: string; summary: string; rail?: "Foundations" | "Blocks";
  preview?: () => JSX.Element;
  usage?: string;
  anatomy?: { scene: () => JSX.Element; parts: Part[] };
  examples?: Row[];
  motion?: Row[];
  tokens?: { title: string; tokens: Token[]; density?: boolean }[];
  api?: string[];
}
/** A token as the cell computes it. */
export const token = (name: string, use: string, sample?: Token["sample"]): Token => ({ name, use, read: (cell) => getComputedStyle(cell).getPropertyValue(name).trim(), sample });
