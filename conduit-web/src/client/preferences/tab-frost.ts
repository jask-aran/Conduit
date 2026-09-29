/*
 * The tab row's frosted strip (DESIGN.md, Two chats): a device setting, off
 * unless chosen. It is an attribute on the root the stylesheet keys on, so
 * turning it off leaves the header exactly as it is without tabs.
 */
const TAB_FROST_KEY = "conduit:tab-frost";

export function tabFrost(): boolean {
  try { return localStorage.getItem(TAB_FROST_KEY) === "on"; } catch { return false; }
}

export function applyTabFrost(on = tabFrost()): void {
  document.documentElement.toggleAttribute("data-tab-frost", on);
}

export function saveTabFrost(on: boolean): boolean {
  try { localStorage.setItem(TAB_FROST_KEY, on ? "on" : "off"); } catch { /* this session only */ }
  applyTabFrost(on);
  return on;
}
