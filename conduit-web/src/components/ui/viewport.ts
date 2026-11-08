import { PHONE_LAYOUT_QUERY } from "./layout";

/** Said on the window when the keyboard goes away with focus still in a field (Android's back button does this). */
export const KEYBOARD_HIDDEN_EVENT = "conduit:keyboard-hidden";

/** Every number a sync decided from, for a diagnostic readout. */
export type ViewportReading = {
  source: string; inner: number; visual: number; base: number; offset: number; resting: number; keyboard: number;
  applied: number; shrank: boolean; dpr: number;
};

/** Which measurement is the truth: the visual viewport, or a layer that reports the keyboard (Chromium's
 *  VirtualKeyboard; "insets": the keyboard's own position, frame by frame, from the Android shell). */
export type ViewportSource = "viewport" | "virtualkeyboard" | "insets";

export type ViewportFollower = {
  /** CSS pixels the keyboard covers, as the layer that knows reports them (0: none). Read at the next sync. */
  keyboard: number;
  source: ViewportSource;
  /** How much room the navigation bar is owed with no keyboard in the way, as last read (readRestBottom). */
  readonly restBottom: number;
  /** Read the navigation bar's resting room (--safe-area-inset-bottom-rest) again. */
  readRestBottom(): void;
  /** Write the variables for what is known now. */
  sync(): void;
  /** Stop following, and take the variables away. */
  stop(): void;
};

/**
 * The phone's viewport variables the library's styles read, kept current: --app-height (the room above the keyboard),
 * --vv-offset-top (where the visual viewport is panned to) and, where the keyboard's own position is known,
 * --safe-area-inset-bottom (the navigation bar's room, given up to the keyboard as it takes it); `data-vv-shell` on
 * <html> while they are set. Only in the phone's layout; elsewhere they are removed and the stylesheets' own values
 * stand. Started once; the caller tells it about a keyboard that a layer reports (`keyboard`, `source`).
 * The shell is moved, not scrolled: `--app-height` sizes `#root` and `.chat-main`, carrying the composer up; chasing
 * the keyboard by scrolling would fight whatever the transcript is doing on its own.
 */
export function followViewport(options: { onReading?: (reading: ViewportReading) => void } = {}): ViewportFollower {
  let keyboardWasShown = false;
  const root = document.documentElement;
  /* CSS pixels the keyboard covers, as the shell reports them. Never added to a viewport that already lost the
     keyboard (a resized WebView) -- that leaves the window a keyboard short; the resting height tells the cases apart. */
  let shellKeyboard = 0;
  /* The navigation bar's room with no keyboard in the way; what is still owed is `rest - keyboard` on each frame.
     Read once a travel, not once a frame: a computed style read inside the drawing costs a recalculation a frame. */
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
    /* Where the shell reports the keyboard frame by frame, the keyboard overlays the window, so `innerHeight` less
       the keyboard is the only input. The visual viewport is unusable there: Chromium shrinks it by the whole keyboard
       on the first frame, so the composer runs ahead of the keyboard (and springs up before going down on the way
       back). Everywhere else the viewport is all there is. */
    const owned = source === "insets";
    const measured = owned ? window.innerHeight : viewport;
    noteResting(measured);
    // A shrink of a few pixels is a toolbar, not a keyboard.
    const viewportShrank = !owned && viewport < restingHeight - 48;
    // One of the two, never both: the viewport if it already lost the keyboard, else resting height less the keyboard.
    const height = Math.max(0, shellKeyboard && !viewportShrank ? restingHeight - shellKeyboard : measured);
    const offsetTop = vv?.offsetTop ?? 0;
    // Only the height: the transcript holds its own scroll from a ResizeObserver on its scroller (a second hand here
    // cost two forced layouts a frame). The navigation bar's room goes to the keyboard as it takes it, only where its
    // position is known; elsewhere the stylesheet's resting value stands.
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
