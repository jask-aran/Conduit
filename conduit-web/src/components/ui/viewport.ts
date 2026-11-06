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
 *
 * The shell is moved rather than scrolled: `--app-height` sizes `#root` and
 * `.chat-main`, so a shorter window shortens the transcript and carries the
 * composer up with it. Chasing the keyboard by scrolling instead would fight
 * whatever the transcript is doing on its own, which is the same surface
 * being moved by two things at once.
 */
export function followViewport(options: { onReading?: (reading: ViewportReading) => void } = {}): ViewportFollower {
  let keyboardWasShown = false;
  const root = document.documentElement;
  /*
   * CSS pixels the keyboard covers, as the shell reports them, and the height
   * of the window last seen without one.
   *
   * Both numbers are needed because the two accounts must not be added
   * together. Where the WebView is resized, the viewport has already lost the
   * keyboard's height and subtracting it again would leave the window short by
   * a keyboard. Where it is not, the viewport is the full screen and the
   * shell's number is the only one that knows better. Which case this is shows
   * in whether the viewport moved at all, so the resting height is what tells
   * them apart.
   */
  let shellKeyboard = 0;
  /*
   * How much room the navigation bar is owed with no keyboard in the way.
   *
   * The shell sends it under its own name and leaves it alone, so the amount
   * still owed can be worked out here on the frame the keyboard is drawn --
   * `rest - keyboard`, to nothing well before the keyboard is fully up. Read
   * once a travel rather than once a frame: it only changes when the bars do,
   * and reading a computed style inside the drawing costs a recalculation on
   * every frame of it.
   */
  let restBottom = 0;
  let restingHeight = 0;
  let restingWidth = 0;
  let source: ViewportSource = "viewport";
  const phone = () => typeof matchMedia === "function" && matchMedia(PHONE_LAYOUT_QUERY).matches;
  /*
   * The tallest this viewport has been at this width, not the last height seen
   * without a keyboard.
   *
   * They are not the same, and the difference is a screen flash. The shell
   * reports the keyboard *after* the window has begun to change, so a resting
   * height sampled on the way down records a viewport that has already lost
   * part of the keyboard -- and then loses all of it again by subtraction,
   * leaving the composer somewhere near the top of the screen for a frame.
   * A maximum cannot be poisoned that way. Width standing in for orientation,
   * since a turned phone is a different screen and keeps none of this.
   */
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
    /*
     * Which measurement is the truth, when the shell reports the keyboard
     * frame by frame.
     *
     * Nothing resizes the window then -- the keyboard overlays it -- so
     * `innerHeight` stays the whole screen and the keyboard's height is the
     * only thing to take off it. The visual viewport is not usable at all
     * here: Chromium shrinks it by the keyboard's full height on the first
     * frame, so a shell sized from it lands at the end of the travel while
     * the keyboard is still a quarter of the way up, and holds there. That is
     * the composer running ahead with a band of empty screen beneath it, and
     * on the way back it is the viewport springing to full height while the
     * keyboard is still descending -- a move upward before the move down.
     *
     * So where the keyboard's position is known, it is the only input.
     * Everywhere else the viewport is still all there is.
     */
    const owned = source === "insets";
    const measured = owned ? window.innerHeight : viewport;
    noteResting(measured);
    // A shrink of a few pixels is a toolbar, not a keyboard.
    const viewportShrank = !owned && viewport < restingHeight - 48;
    // One of the two, never both: the viewport if something already took the
    // keyboard out of it, otherwise the resting height less what the keyboard
    // is covering.
    const height = Math.max(0, shellKeyboard && !viewportShrank ? restingHeight - shellKeyboard : measured);
    const offsetTop = vv?.offsetTop ?? 0;
    /*
     * Only the height. The transcript holds its own scroll against the
     * scroller shrinking, from a `ResizeObserver` on the scroller itself --
     * one correction, made by the thing being corrected, on the frame it
     * happens. Doing it again from here was a second hand on the same
     * surface, and it cost two forced layouts a frame to be wrong in
     * parallel.
     */
    // The navigation bar's room, given up to the keyboard as the keyboard
    // takes it rather than the moment it is announced. Only where the
    // keyboard's own position is known; everywhere else the stylesheet's
    // resting value stands.
    if (owned) {
      root.style.setProperty("--safe-area-inset-bottom", `${Math.max(0, restBottom - shellKeyboard).toFixed(1)}px`);
    }
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    root.style.setProperty("--vv-offset-top", `${Math.round(offsetTop)}px`);
    root.setAttribute("data-vv-shell", "true");
    /* The keyboard went away with focus still in a field (Android's back
       button does this): say so, since no blur will. */
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
