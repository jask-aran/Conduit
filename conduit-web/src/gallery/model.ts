import { type JSX } from "solid-js";

/* Every page has the same sections in the same order, each with one presentation, and a section is either there in
   full or absent. */

/** surfaces: ground and frost by default; frame first for what also sits on the sidebar's; a piece that is its own
 *  surface takes ground alone. phone "only": a phone-only piece, drawn there alone. */
export interface Row { name: string; note: string; render: () => JSX.Element; source?: string; surfaces?: ("frame" | "ground" | "frost")[]; phone?: boolean | "only"; code?: string }
export const row = (name: string, note: string, render: Row["render"], more: Omit<Row, "name" | "note" | "render"> = {}): Row => ({ name, note, render, ...more });

export interface Part { selector: string; name: string; does: string; from?: string | ((el: HTMLElement) => string); side?: "above" | "below" }

export interface Token { name: string; use: string; read: (cell: HTMLElement) => string; sample?: () => JSX.Element }

export interface Anatomy { title?: string; scene: () => JSX.Element; parts: Part[]; phone?: boolean; spacing?: string[] }
export interface Page {
  title: string; summary: string; rail?: "Foundations" | "Blocks";
  preview?: () => JSX.Element;
  usage?: string;
  anatomy?: Anatomy | Anatomy[];
  examples?: Row[];
  motion?: Row[];
  tokens?: { title: string; tokens: Token[]; density?: boolean }[];
  api?: string[];
}
export const token = (name: string, use: string, sample?: Token["sample"]): Token => ({ name, use, read: (cell) => getComputedStyle(cell).getPropertyValue(name).trim(), sample });
