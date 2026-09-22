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
 * covers the corner of the screen it is drawn in. It stays, though. A phone is
 * the only place several of these numbers are ever true -- the emulator's
 * WebView honours `interactive-widget=overlays-content` where a current one
 * does not, and no recording of a screen can say what the page believed at the
 * time -- so this is the only instrument that works where the bugs are.
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

/*
 * What the last keyboard travel actually looked like, rather than its last
 * nine rows.
 *
 * A tail of a decelerating curve is the least informative part of it: the
 * values barely change and the frames that matter have already scrolled off.
 * What decides whether the composer looks stuck to the keyboard is the whole
 * run -- how many frames arrived, over how long, and whether any two of them
 * were far enough apart to be seen as a stutter. Three numbers, and they fit
 * on one line.
 */
let runFrames = 0;
let runStart = 0;
let runLast = 0;
let runGap = 0;
let runMoving = false;
let runFirst = 0;
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
  } else {
    runGap = Math.max(runGap, now - runLast);
  }
  runLast = now;
  runFrames += 1;
  if (!final) {
    runMoving = true;
    return;
  }
  /*
   * The shell settles twice: the animation's own end, and the insets that
   * arrive behind it saying the same thing. Without this the second one
   * starts a run of its own, finishes it in the same breath and overwrites
   * the travel that just happened with `1f / 0ms`.
   */
  if (!runMoving) return;
  const span = Math.round(now - runStart);
  const fps = span > 0 ? Math.round((runFrames / span) * 1000) : 0;
  const overshoot = runMin < Math.min(runFirst, runMax) ? ` UNDER ${runMin}` : "";
  runSummary = `${runFrames}f / ${span}ms / ${fps}fps / gap ${Math.round(runGap)}ms`
    + `\n          ${runFirst}->${runMax === runFirst ? runMin : runMax}${overshoot}`;
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
  const run = runSummary ? `\nlast run  ${runSummary}` : "";
  panel.textContent = events.length ? `${numbers}${run}\n--\n${events.join("\n")}` : `${numbers}${run}`;
}

export function keyboardRunSummary(): string {
  return runSummary;
}

export function reportKeyboardProbe(lines: Record<string, unknown>): void {
  if (!keyboardProbeOn()) return;
  /*
   * The height each frame landed on, kept as a range rather than a list.
   * A travel that leaves the window shorter than either end of it went the
   * wrong way first, which is the jump at the start of a close, and a single
   * number says so where nine rows of a ring buffer had already lost it.
   */
  const applied = Number(lines.applied);
  if (runStart && Number.isFinite(applied)) {
    if (!runFirst) { runFirst = applied; runMin = applied; runMax = applied; }
    runMin = Math.min(runMin, applied);
    runMax = Math.max(runMax, applied);
  }
  numbers = Object.entries(lines)
    .map(([key, value]) => `${key.padEnd(9)} ${String(value)}`)
    .join("\n");
  draw();
}
