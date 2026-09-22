/*
 * A readout of every number that decides how tall the window is.
 *
 * The keyboard has now been diagnosed wrong three times from reading the code
 * -- the viewport tag is a request rather than a rule, Capacitor's padding is
 * gated, the plugin's units turned out to be right after all -- and each
 * wrong answer cost a build and a device test. None of those could have
 * survived one look at the actual numbers, so this exists to show them.
 *
 * Off by default and on by name: it is a diagnostic, not a feature, and it
 * covers the corner of the screen it is drawn in. Delete it once the keyboard
 * is settled.
 */
const STORAGE_KEY = "conduit:keyboard-probe";

let panel: HTMLElement | null = null;

const styles = "position:fixed;z-index:2147483647;left:8px;top:8px;max-width:calc(100vw - 16px);"
  + "padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.82);color:#7CFF9E;"
  + "font:11px/1.45 ui-monospace,monospace;white-space:pre;pointer-events:none;";

export function keyboardProbeOn(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

/** Returns the state it left the probe in, so the caller can say so. */
export function toggleKeyboardProbe(): boolean {
  const next = !keyboardProbeOn();
  try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* nothing to remember it with */ }
  if (!next && panel) { panel.remove(); panel = null; }
  return next;
}

export function reportKeyboardProbe(lines: Record<string, unknown>): void {
  if (!keyboardProbeOn()) return;
  if (!panel) {
    panel = document.createElement("div");
    panel.setAttribute("style", styles);
    document.body.appendChild(panel);
  }
  panel.textContent = Object.entries(lines)
    .map(([key, value]) => `${key.padEnd(10)} ${String(value)}`)
    .join("\n");
}
