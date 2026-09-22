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
let numbers = "";

/*
 * The last handful of things that happened, newest last.
 *
 * The numbers say where the window ended up; they cannot say whether the
 * event that should have moved it ever arrived. Two of the open questions are
 * exactly that shape -- whether `keyboardWillShow` fires on the runs where
 * nothing moves, and whether something takes focus away just before the
 * keyboard closes on a scroll -- and neither is answerable from a height.
 */
const EVENT_LIMIT = 9;
const events: string[] = [];
let firstAt = 0;

let lastKey = "";
let repeats = 0;

export function logKeyboardEvent(name: string, detail: unknown = ""): void {
  if (!keyboardProbeOn()) return;
  const now = Date.now();
  if (!firstAt) firstAt = now;
  const at = String(now - firstAt).padStart(5, " ");
  const key = `${name} ${detail}`;
  // Scrolling alone fires dozens of times a second, and nine of those would
  // push out the one line worth reading. A run collapses to its first entry
  // with a count, so a flood costs one row rather than the whole window.
  if (key === lastKey && events.length) {
    repeats += 1;
    events[events.length - 1] = `${at} ${name}${detail === "" ? "" : ` ${detail}`} x${repeats + 1}`;
    draw();
    return;
  }
  lastKey = key;
  repeats = 0;
  events.push(`${at} ${name}${detail === "" ? "" : ` ${detail}`}`);
  while (events.length > EVENT_LIMIT) events.shift();
  draw();
}

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
  if (next) { events.length = 0; firstAt = 0; lastKey = ""; repeats = 0; }
  return next;
}

function draw(): void {
  if (!keyboardProbeOn()) return;
  if (!panel) {
    panel = document.createElement("div");
    panel.setAttribute("style", styles);
    document.body.appendChild(panel);
  }
  panel.textContent = events.length ? `${numbers}\n--\n${events.join("\n")}` : numbers;
}

export function reportKeyboardProbe(lines: Record<string, unknown>): void {
  if (!keyboardProbeOn()) return;
  numbers = Object.entries(lines)
    .map(([key, value]) => `${key.padEnd(9)} ${String(value)}`)
    .join("\n");
  draw();
}
