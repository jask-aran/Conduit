import { installedClientKind } from "../platform/installed-client.ts";
import { logKeyboardEvent, noteKeyboardFrame, reportKeyboardProbe } from "./keyboard-probe.ts";
import { PHONE_LAYOUT_QUERY } from "../layout-geometry";

/** Shared phone-shell query. Narrow desktop windows keep desktop navigation. */
export const MOBILE_LAYOUT_QUERY = PHONE_LAYOUT_QUERY;

export function isMobileLayout(): boolean {
  return typeof matchMedia === "function" && matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

export type MobileOverlayKind = "sidebar" | "workspace";

/** Marks the document for CSS overscroll locks while a phone overlay is open. */
export function setMobileOverlayKind(kind: MobileOverlayKind | null): void {
  if (typeof document === "undefined") return;
  if (kind) document.documentElement.setAttribute("data-mobile-overlay", kind);
  else document.documentElement.removeAttribute("data-mobile-overlay");
}

/**
 * Pin the app shell to the visual viewport so the composer stays above the
 * software keyboard on phones (iOS pans via offsetTop; Android often resizes).
 * Returns an disposer for onCleanup.
 *
 * The shell is moved rather than scrolled: `--app-height` sizes `#root` and
 * `.chat-main`, so a shorter window shortens the transcript and carries the
 * composer up with it. Chasing the keyboard by scrolling instead would fight
 * whatever the transcript is doing on its own, which is the same surface
 * being moved by two things at once.
 *
 * `visualViewport` alone is not enough on a phone, in either client and for
 * two unrelated reasons. The page asks for
 * `interactive-widget=resizes-content`, which is a request: a browser may
 * leave both viewports alone and let the keyboard overlay the page, and
 * Capacitor's SystemBars pads the WebView's parent only behind two gates (a
 * recent WebView with `viewport-fit=cover`, or Android 15 and up). Off either
 * path nothing resizes, `visualViewport.height` stays the full screen, and
 * the transcript sits behind the keyboard with nothing able to say otherwise.
 *
 * So the keyboard is measured rather than inferred, from whichever layer
 * knows: Chromium's VirtualKeyboard API in a browser, the Capacitor plugin in
 * the Android shell. Where neither exists -- iOS, which pans instead of
 * resizing -- `visualViewport` and `--vv-offset-top` are already the answer.
 */
export function bindVisualViewportShell(): () => void {
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
  let restingHeight = 0;
  let restingWidth = 0;
  let source = "viewport";
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
  const sync = () => {
    if (!isMobileLayout()) {
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
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    root.style.setProperty("--vv-offset-top", `${Math.round(offsetTop)}px`);
    root.setAttribute("data-vv-shell", "true");
    reportKeyboardProbe({
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
  /*
   * Watched only so the probe can say what arrived and in what order. The two
   * questions left are whether the shell's keyboard event fires at all on the
   * runs where nothing moves, and whether focus leaves the composer just
   * before a scroll closes the keyboard -- neither visible in a height.
   */
  const named = (name: string) => () => logKeyboardEvent(name, Math.round(vv?.height ?? window.innerHeight));
  const onVvResize = named("vv-resize");
  const onWinResize = named("win-resize");
  const tagOf = (node: EventTarget | null) => {
    const el = node as HTMLElement | null;
    return el?.tagName ? `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0] || "-"}`.slice(0, 22) : "-";
  };
  const onFocusIn = (event: FocusEvent) => logKeyboardEvent("focusin", tagOf(event.target));
  const onFocusOut = (event: FocusEvent) => logKeyboardEvent("focusout", tagOf(event.target));
  const onAnyScroll = (event: Event) => logKeyboardEvent("scroll", tagOf(event.target));
  vv?.addEventListener("resize", onVvResize);
  window.addEventListener("resize", onWinResize);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("scroll", onAnyScroll, { capture: true, passive: true });

  vv?.addEventListener("resize", sync);
  vv?.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
  const media = typeof matchMedia === "function" ? matchMedia(MOBILE_LAYOUT_QUERY) : null;
  media?.addEventListener("change", sync);

  /*
   * Chromium's own answer, for every client that is not the Android shell.
   *
   * `interactive-widget=resizes-content` in the page's viewport tag asks the
   * browser to shorten the window itself, and it does not always: a phone
   * browser is free to leave both viewports alone and let the keyboard sit on
   * top, which is a transcript that never moves for the same reason as in the
   * WebView, arrived at differently. `overlaysContent` stops asking. It says
   * this app will do its own resizing, and in exchange `geometrychange`
   * reports exactly how much room the keyboard is taking -- the same number
   * the shell hands over on Android, from the layer that actually knows.
   */
  const virtualKeyboard = (navigator as Navigator & {
    virtualKeyboard?: EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };
  }).virtualKeyboard;
  let dropVirtualKeyboard: (() => void) | null = null;
  if (virtualKeyboard && installedClientKind !== "android") {
    virtualKeyboard.overlaysContent = true;
    source = "virtualkeyboard";
    const onGeometry = () => {
      const next = virtualKeyboard.boundingRect.height;
      logKeyboardEvent("geometry", Math.round(next));
      shellKeyboard = next;
      sync();
    };
    virtualKeyboard.addEventListener("geometrychange", onGeometry);
    dropVirtualKeyboard = () => {
      virtualKeyboard.removeEventListener("geometrychange", onGeometry);
      virtualKeyboard.overlaysContent = false;
    };
  }

  /*
   * The Android shell's answer, and the only one that is a curve rather than
   * a stream of positions.
   *
   * `@capacitor/keyboard` reported the keyboard once, after it had finished
   * moving, so a shell sized from it snapped to where the keyboard was about
   * to be and then waited for it. Worse, it took the frames in between away
   * from everyone else: its own animation callback sits on the root view with
   * `DISPATCH_MODE_STOP`, so nothing below could follow the keyboard even
   * knowing how. It is gone, and `ConduitKeyboardPlugin` replaces it.
   *
   * What that plugin sends is the whole travel at its start -- where the
   * keyboard is going, how long it will take, and the system's own
   * interpolator sampled into a table -- rather than a height per frame. A
   * height per frame can only ever be as smooth as the bridge carrying it,
   * and the bridge delivered six of them across a 285ms animation. Drawn from
   * the description instead, the shell produces a height on every frame the
   * display renders, on exactly the curve the keyboard is using, and no frame
   * waits on a message to arrive.
   *
   * The per-frame events still arrive and are still listened to, because the
   * animation is the system's to change or cancel: they correct the drawing
   * if the two ever disagree, and `ime-end` is what settles it.
   */
  let dropKeyboard: (() => void) | null = null;
  let disposed = false;
  if (installedClientKind === "android") {
    source = "insets";
    let drawing = 0;
    /*
     * Whether a travel has been described and not yet reported finished.
     *
     * Separate from whether a frame is scheduled, because the two stop at
     * different times: the drawing reaches the end of its duration while
     * per-frame events are still arriving behind it, late, carrying positions
     * the keyboard has already left. Accepted then, they drag the shell back
     * down the curve it has just finished climbing -- which is a composer that
     * settles, jumps, and settles again. Until the travel is reported over,
     * the drawing is the only account of it that is listened to.
     */
    let travelling = false;
    const stopDrawing = () => {
      if (drawing) cancelAnimationFrame(drawing);
      drawing = 0;
    };
    /** The sampled curve, read between its points. */
    const along = (curve: number[], t: number) => {
      const span = (curve.length - 1) * Math.min(1, Math.max(0, t));
      const step = Math.min(curve.length - 2, Math.floor(span));
      const here = curve[step] ?? 0;
      const next = curve[step + 1] ?? here;
      return here + (next - here) * (span - step);
    };
    void import("@capacitor/core").then(async ({ registerPlugin }) => {
      const plugin = registerPlugin<{
        addListener(
          event: "keyboardGeometry",
          handler: (info: { height: number; animating: boolean }) => void,
        ): Promise<{ remove(): void }>;
        addListener(
          event: "keyboardAnimation",
          handler: (info: { from: number; to: number; durationMs: number; curve: number[] }) => void,
        ): Promise<{ remove(): void }>;
      }>("ConduitKeyboard");
      const animation = await plugin.addListener("keyboardAnimation", (info) => {
        if (!info.durationMs || !Array.isArray(info.curve) || info.curve.length < 2) return;
        logKeyboardEvent("ime-start", `${Math.round(info.from)}->${Math.round(info.to)} ${info.durationMs}ms`);
        stopDrawing();
        travelling = true;
        const began = performance.now();
        const draw = () => {
          const t = (performance.now() - began) / info.durationMs;
          shellKeyboard = info.from + (info.to - info.from) * along(info.curve, t);
          noteKeyboardFrame(t >= 1);
          sync();
          drawing = t >= 1 ? 0 : requestAnimationFrame(draw);
        };
        drawing = requestAnimationFrame(draw);
      });
      const geometry = await plugin.addListener("keyboardGeometry", (info) => {
        // The drawing is the system's curve reproduced, so while it is running
        // it is the better account of where the keyboard is -- it has a value
        // for every frame and these arrive a handful of times. They are the
        // authority only once it has stopped, which is also how a cancelled
        // animation gets put right.
        if (travelling && info.animating) return;
        travelling = false;
        stopDrawing();
        shellKeyboard = info.height;
        noteKeyboardFrame(!info.animating);
        if (!info.animating) logKeyboardEvent("ime-end", Math.round(info.height));
        sync();
      });
      dropKeyboard = () => {
        void animation.remove();
        void geometry.remove();
        stopDrawing();
      };
      if (disposed) dropKeyboard();
    }).catch(() => { /* no shell to ask; visualViewport is the whole answer */ });
  }

  return () => {
    disposed = true;
    dropKeyboard?.();
    dropVirtualKeyboard?.();
    vv?.removeEventListener("resize", onVvResize);
    window.removeEventListener("resize", onWinResize);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("scroll", onAnyScroll, { capture: true } as EventListenerOptions);
    vv?.removeEventListener("resize", sync);
    vv?.removeEventListener("scroll", sync);
    window.removeEventListener("resize", sync);
    media?.removeEventListener("change", sync);
    root.style.removeProperty("--app-height");
    root.style.removeProperty("--vv-offset-top");
    root.removeAttribute("data-vv-shell");
  };
}

export function focusFirst(container: ParentNode | null | undefined): void {
  const target = container?.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  target?.focus();
}

export function restoreFocus(previous: HTMLElement | null | undefined, fallbackSelectors: string[]): void {
  if (previous?.isConnected) {
    previous.focus();
    return;
  }
  for (const selector of fallbackSelectors) {
    const target = document.querySelector<HTMLElement>(selector);
    if (target) {
      target.focus();
      return;
    }
  }
}
