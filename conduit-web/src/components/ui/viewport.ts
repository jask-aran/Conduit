import { PHONE_LAYOUT_QUERY } from "./layout";

export const KEYBOARD_HIDDEN_EVENT = "conduit:keyboard-hidden";

export type ViewportReading = {
  source: string; inner: number; visual: number; base: number; offset: number; resting: number; keyboard: number;
  applied: number; shrank: boolean; dpr: number;
};

export type ViewportSource = "viewport" | "virtualkeyboard" | "insets";

export type ViewportFollower = {
  keyboard: number;
  source: ViewportSource;
  readonly restBottom: number;
  readRestBottom(): void;
  sync(): void;
  stop(): void;
};

/** The shell is moved, not scrolled: `--app-height` sizes `#root` and `.chat-main`, carrying the composer up; chasing
 *  the keyboard by scrolling would fight whatever the transcript is doing on its own. */
export function followViewport(options: { onReading?: (reading: ViewportReading) => void } = {}): ViewportFollower {
  let keyboardWasShown = false;
  const root = document.documentElement;
  /* CSS pixels the keyboard covers, as the shell reports them. Never added to a viewport that already lost the
     keyboard (a resized WebView) -- that leaves the window a keyboard short; the resting height tells the cases apart. */
  let shellKeyboard = 0;
  /* Read once a travel, not once a frame: a computed style read inside the drawing costs a recalculation a frame. */
  let restBottom = 0;
  let restingHeight = 0;
  let restingWidth = 0;
  let source: ViewportSource = "viewport";
  const phone = () => typeof matchMedia === "function" && matchMedia(PHONE_LAYOUT_QUERY).matches;
  /* The tallest this viewport has been at this width, not the last height seen without a keyboard: the shell reports
     the keyboard after the window starts changing, so a sampled resting height already lost part of it, and
     subtracting again flashes the composer near the top for a frame. A maximum cannot be poisoned that way. Width
     stands in for orientation (a turned phone keeps none of this). */
  const noteResting = (viewport: number) => {
    if (window.innerWidth !== restingWidth) {
      restingWidth = window.innerWidth;
      restingHeight = 0;
    }
    if (!shellKeyboard) restingHeight = Math.max(restingHeight, viewport);
  };
  const readRestBottom = () => {
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--safe-area-inset-bottom-rest"));
    if (Number.isFinite(value)) restBottom = value;
  };
  const sync = () => {
    if (!phone()) {
      root.style.removeProperty("--safe-area-inset-bottom");
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--vv-offset-top");
      root.removeAttribute("data-vv-shell");
      return;
    }
    const vv = window.visualViewport;
    const viewport = vv?.height ?? window.innerHeight;
    /* Where the shell reports the keyboard frame by frame, the visual viewport is unusable: Chromium shrinks it by the
       whole keyboard on the first frame, so the composer would run ahead of the keyboard. */
    const owned = source === "insets";
    const measured = owned ? window.innerHeight : viewport;
    noteResting(measured);
    // A shrink of a few pixels is a toolbar, not a keyboard.
    const viewportShrank = !owned && viewport < restingHeight - 48;
    // One of the two, never both: the viewport if it already lost the keyboard, else resting height less the keyboard.
    const height = Math.max(0, shellKeyboard && !viewportShrank ? restingHeight - shellKeyboard : measured);
    const offsetTop = vv?.offsetTop ?? 0;
    // Only the height: the transcript holds its own scroll from a ResizeObserver on its scroller, and a second hand
    // here costs two forced layouts a frame.
    if (owned) {
      root.style.setProperty("--safe-area-inset-bottom", `${Math.max(0, restBottom - shellKeyboard).toFixed(1)}px`);
    }
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    root.style.setProperty("--vv-offset-top", `${Math.round(offsetTop)}px`);
    root.setAttribute("data-vv-shell", "true");
    // The keyboard went away with focus still in a field: say so, since no blur will.
    const keyboardOpen = shellKeyboard > 120 || viewport < restingHeight - 120;
    if (keyboardWasShown && !keyboardOpen) window.dispatchEvent(new CustomEvent(KEYBOARD_HIDDEN_EVENT));
    keyboardWasShown = keyboardOpen;
    options.onReading?.({
      source,
      inner: window.innerHeight,
      visual: Math.round(viewport),
      base: Math.round(measured),
      offset: Math.round(offsetTop),
      resting: Math.round(restingHeight),
      keyboard: Math.round(shellKeyboard),
      applied: Math.round(height),
      shrank: viewportShrank,
      dpr: window.devicePixelRatio,
    });
  };
  sync();
  const vv = window.visualViewport;
  vv?.addEventListener("resize", sync);
  vv?.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
  const media = typeof matchMedia === "function" ? matchMedia(PHONE_LAYOUT_QUERY) : null;
  media?.addEventListener("change", sync);
  return {
    get keyboard() { return shellKeyboard; },
    set keyboard(height: number) { shellKeyboard = height; },
    get source() { return source; },
    set source(next: ViewportSource) { source = next; },
    get restBottom() { return restBottom; },
    readRestBottom,
    sync,
    stop() {
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      media?.removeEventListener("change", sync);
      root.style.removeProperty("--safe-area-inset-bottom");
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--vv-offset-top");
      root.removeAttribute("data-vv-shell");
    },
  };
}
