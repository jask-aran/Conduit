/*
 * The tab row's frosted strip (DESIGN.md, Two chats): a device setting, off
 * unless chosen. Off, a header holding tabs is exactly as it is without them.
 */
import { createRoot, createSignal } from "solid-js";

const TAB_FROST_KEY = "conduit:tab-frost";
// The setting as it changes, for the header that draws the strip (Header frost).
const [frosted, setFrosted] = createRoot(() => createSignal(false));
export const tabFrostOn = frosted;

export function tabFrost(): boolean {
  try { return localStorage.getItem(TAB_FROST_KEY) === "on"; } catch { return false; }
}

export function applyTabFrost(on = tabFrost()): void {
  document.documentElement.toggleAttribute("data-tab-frost", on);
  setFrosted(on);
}

export function saveTabFrost(on: boolean): boolean {
  try { localStorage.setItem(TAB_FROST_KEY, on ? "on" : "off"); } catch { /* this session only */ }
  applyTabFrost(on);
  return on;
}
