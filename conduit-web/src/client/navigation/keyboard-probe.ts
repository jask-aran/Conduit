/*
 * Off by default: a diagnostic. A phone is the only place several of these numbers are ever true (the emulator's
 * WebView honours `interactive-widget=overlays-content` where a current one does not), so it stays.
 */
const STORAGE_KEY = "conduit:keyboard-probe";

let panel: HTMLElement | null = null;
let numbers = "";

const EVENT_LIMIT = 9;
const events: string[] = [];
let firstAt = 0;

let lastKey = "";
let repeats = 0;

let runFrames = 0;
let runStart = 0;
let runLast = 0;
let runGap = 0;
let runMoving = false;
let runFirst = 0;
let runEnd = 0;
let runMin = 0;
let runMax = 0;
let runSummary = "";

export function noteKeyboardFrame(final: boolean): void {
  if (!keyboardProbeOn()) return;
  const now = performance.now();
  if (!runStart || now - runLast > 400) {
    runStart = now;
    runFrames = 0;
    runGap = 0;
    runMoving = false;
    runFirst = 0;
    runEnd = 0;
  } else {
    runGap = Math.max(runGap, now - runLast);
  }
  runLast = now;
  runFrames += 1;
  if (!final) {
    runMoving = true;
    return;
  }
  // The shell settles twice (the animation's end, then insets saying the same); without this the second
  // overwrites the travel that just happened with `1f / 0ms`.
  if (!runMoving) return;
  const span = Math.round(now - runStart);
  const fps = span > 0 ? Math.round((runFrames / span) * 1000) : 0;
  // Only a travel that went below both of its own ends went somewhere it should not have: a shortening shell is
  // meant to end below where it started.
  const wrongWay = runMin < Math.min(runFirst, runEnd) - 1 ? ` UNDER ${runMin}` : "";
  const overshot = runMax > Math.max(runFirst, runEnd) + 1 ? ` OVER ${runMax}` : "";
  runSummary = `${runFrames}f / ${span}ms / ${fps}fps / gap ${Math.round(runGap)}ms`
    + `\n          ${runFirst}->${runEnd}${wrongWay}${overshot}`;
  runStart = 0;
  runMoving = false;
  draw();
}

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
  const run = runSummary ? `\nlast run  ${runSummary}` : "";
  panel.textContent = events.length ? `${numbers}${run}\n--\n${events.join("\n")}` : `${numbers}${run}`;
}

export function reportKeyboardProbe(lines: Record<string, unknown>): void {
  if (!keyboardProbeOn()) return;
  const applied = Number(lines.applied);
  if (runStart && Number.isFinite(applied)) {
    if (!runFirst) { runFirst = applied; runMin = applied; runMax = applied; }
    runEnd = applied;
    runMin = Math.min(runMin, applied);
    runMax = Math.max(runMax, applied);
  }
  numbers = Object.entries(lines)
    .map(([key, value]) => `${key.padEnd(9)} ${String(value)}`)
    .join("\n");
  draw();
}
