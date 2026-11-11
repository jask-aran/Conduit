import { createSignal } from "solid-js";

// Read off the page, never from a list kept by hand. Typed text (a name, a key, an address) is never read.
export type SeenSetting = { section: string; group: string | null; label: string; value: string };

const STORE = "conduit:settings-values";
const bySection = new Map<string, SeenSetting[]>();
try {
  const kept = JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, SeenSetting[]>;
  for (const [section, seen] of Object.entries(kept)) if (Array.isArray(seen)) bySection.set(section, seen);
} catch { /* nothing kept, or not readable: the sweep fills it */ }
const [revision, setRevision] = createSignal(0);
let keep = 0;
const STORE_DEBOUNCE_MS = 500;

export const seenSettings = () => { revision(); return [...bySection.values()].flat(); };
export let sweptAt = 0;
export const markSwept = () => { sweptAt = Date.now(); };

const own = (element: Element | null | undefined, without: string) => {
  if (!element) return "";
  const copy = element.cloneNode(true) as Element;
  for (const part of copy.querySelectorAll(without)) part.remove();
  return (copy.textContent || "").replace(/\s+/g, " ").trim();
};

export function readSettings(body: Element, section: string): SeenSetting[] {
  const seen: SeenSetting[] = [];
  for (const line of body.querySelectorAll<HTMLElement>(".ui-setting-line")) {
    const label = own(line.firstElementChild, "small, .ui-setting-step, .ui-setting-context, button, input, select");
    if (!label || label.length > 80) continue;
    const control = line.querySelector(".ui-setting-control");
    const values = [
      // A menu's trigger says its choice (a select, the model selector).
      ...[...(control?.querySelectorAll("button[aria-haspopup]") ?? [])].map((part) => [...part.childNodes].map((piece) => piece.textContent || "").join(" ")),
      ...[...(control?.querySelectorAll('.ui-seg [aria-checked="true"]') ?? [])].map((part) => part.textContent || ""),
      ...[...(control?.querySelectorAll('[role="switch"]') ?? [])].map((part) => part.getAttribute("aria-checked") === "true" ? "On" : "Off"),
      ...[...(control?.querySelectorAll(".ui-setting-value, .ui-keycap") ?? [])].map((part) => part.textContent || ""),
      own(line.firstElementChild?.querySelector("small"), "button"),
    ].map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
    const group = own(line.closest(".ui-group")?.querySelector(":scope > .ui-nav-label"), ".ui-nav-away") || null;
    seen.push({ section, group, label, value: [...new Set(values)].join(" · ").slice(0, 160) });
  }
  return seen;
}

/** A page with no lines yet (still loading) keeps what was known. */
export function rememberSettings(section: string, seen: SeenSetting[]) {
  if (!seen.length) return;
  const before = JSON.stringify(bySection.get(section) ?? null);
  if (before === JSON.stringify(seen)) return;
  bySection.set(section, seen);
  setRevision((count) => count + 1);
  clearTimeout(keep);
  keep = window.setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(bySection))); } catch { /* full or blocked: kept for this launch */ } }, STORE_DEBOUNCE_MS);
}
