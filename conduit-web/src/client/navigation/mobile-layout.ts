import { installedClientKind } from "../platform/installed-client.ts";
import { logKeyboardEvent, noteKeyboardFrame, reportKeyboardProbe } from "./keyboard-probe.ts";
import { latestAway } from "../chat/latest-away";
import { travelEasing, travelsWithoutLayout, travelWithoutLayout } from "@/components/ui/keyboard-travel";
import { keyboardTravel } from "@/components/ui/motion";
import { followViewport } from "@/components/ui/viewport";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";

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
 * Returns an disposer for onCleanup. The variables themselves are the
 * library's (components/ui/viewport.ts, followViewport); what is here is
 * telling it about the keyboard.
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

  const shell = followViewport({ onReading: reportKeyboardProbe });
  const { sync, readRestBottom } = shell;

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
  /* VirtualKeyboard is secure-context only: on plain http (a LAN address)
     nothing would measure the keyboard under `overlays-content`, so let
     Chromium shrink the visual viewport instead and read that. */
  if (!virtualKeyboard && !window.isSecureContext && installedClientKind !== "android") {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta) meta.content = meta.content.replace("interactive-widget=overlays-content", "interactive-widget=resizes-visual");
  }
  if (virtualKeyboard && installedClientKind !== "android") {
    virtualKeyboard.overlaysContent = true;
    shell.source = "virtualkeyboard";
    const onGeometry = () => {
      const next = virtualKeyboard.boundingRect.height;
      logKeyboardEvent("geometry", Math.round(next));
      shell.keyboard = next;
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
    /*
     * When the travel being drawn is taken to have started, and how long it
     * runs. Held out here because the per-frame events correct the first of
     * them: the description is written in `onStart` and read here whenever the
     * bridge delivers it, so the clock starts late by however long that took
     * and the shell runs that far behind the keyboard for the whole travel.
     * Each frame the shell reports carries the system's own progress through
     * the animation, which says where the clock should have been.
     */
    let began = 0;
    let travelDuration = 0;
    /*
     * The shape of the last travel the platform described in full.
     *
     * A hide still slides down the screen when `getDurationMillis` answers
     * -1, so the travel is drawn with the shape of the one before it rather
     * than handed back to the per-frame events, which arrive about six times
     * across a travel and read as a stutter. A show and the hide that follows
     * it are the same curve run in opposite directions, so the one just seen
     * is the closest description available of the one that will not describe
     * itself.
     */
    let lastDurationMs = 250;
    let travel: ReturnType<typeof travelWithoutLayout> | null = null;
    let lastCurve: number[] = [0, 1];
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
          handler: (info: { height: number; animating: boolean; fraction: number }) => void,
        ): Promise<{ remove(): void }>;
        addListener(
          event: "keyboardAnimation",
          handler: (info: { from: number; to: number; durationMs: number; curve: number[]; startedAt?: number }) => void,
        ): Promise<{ remove(): void }>;
      }>("ConduitKeyboard");
      const animation = await plugin.addListener("keyboardAnimation", (info) => {
        /*
         * `getDurationMillis` answers -1 when the platform will not say how
         * long the travel takes -- Gboard does this when the back button
         * dismisses it, where the emulator's keyboard gives a real duration --
         * and dividing by that runs the clock backwards, pins the curve at its
         * first point and leaves the shell holding the keyboard's old position
         * while the keyboard leaves without it.
         */
        const described = info.durationMs > 0 && Array.isArray(info.curve) && info.curve.length >= 2;
        if (described) {
          lastDurationMs = info.durationMs;
          lastCurve = info.curve;
        }
        const durationMs = described ? info.durationMs : lastDurationMs;
        const curve = described ? info.curve : lastCurve;
        began = performance.now();
        travelDuration = durationMs;
        readRestBottom();
        logKeyboardEvent(described ? "ime-start" : "ime-nodur",
          `${Math.round(info.from)}->${Math.round(info.to)} ${Math.round(durationMs)}ms`);
        stopDrawing();
        travelling = true;
        // Rooms given meanwhile (the composer's field going) glide on the keyboard's time (motion.ts).
        const travelLeft = durationMs - (info.startedAt ? Math.min(durationMs, Math.max(0, Date.now() - info.startedAt)) : 0);
        // With the native composer up, the travel has no layout in it (keyboard-travel.ts), and carries the rooms too:
        // it measures before they are told.
        travel?.cancel();
        travel = null;
        if (travelsWithoutLayout()) {
          travel = travelWithoutLayout({ from: info.from, to: info.to, durationMs, curve, startedAt: info.startedAt, rest: shell.restBottom },
            (height) => { shell.keyboard = height; noteKeyboardFrame(true); sync(); }, { away: latestAway(), log: logKeyboardEvent });
          keyboardTravel(travelLeft, travelEasing(curve));
          return;
        }
        keyboardTravel(travelLeft, travelEasing(curve));
        const draw = () => {
          const t = (performance.now() - began) / durationMs;
          shell.keyboard = info.from + (info.to - info.from) * along(curve, t);
          noteKeyboardFrame(t >= 1);
          sync();
          drawing = t >= 1 ? 0 : requestAnimationFrame(draw);
        };
        drawing = requestAnimationFrame(draw);
      });
      const geometry = await plugin.addListener("keyboardGeometry", (info) => {
        /*
         * The drawing is the system's curve reproduced, so while it is running
         * it is the better account of where the keyboard is -- it has a value
         * for every frame and these arrive a handful of times. They are the
         * authority on where along that curve the keyboard has got to, though,
         * and the clock drawing it started when the description crossed the
         * bridge rather than when the animation did.
         *
         * So the clock is wound back towards where the system says it should
         * be, and only ever forwards through the travel: a shell that jumped
         * back down the curve to meet a late frame is the stutter this whole
         * arrangement exists to remove. A few milliseconds a frame closes a
         * bridge's worth of lag inside a dozen frames without any of them
         * being visible as a step.
         */
        // A travel without layout lands itself; the system's end only says where.
        if (travel?.running) {
          if (!info.animating) { travelling = false; travel.settle(info.height); logKeyboardEvent("ime-end", Math.round(info.height)); }
          return;
        }
        if (travelling && info.animating) {
          const fraction = Math.min(1, Math.max(0, info.fraction));
          if (info.fraction >= 0 && travelDuration > 0) {
            const shouldHaveBegun = performance.now() - fraction * travelDuration;
            if (shouldHaveBegun < began) began -= Math.min(2, began - shouldHaveBegun);
          }
          return;
        }
        travelling = false;
        stopDrawing();
        if (!info.animating) readRestBottom();
        shell.keyboard = info.height;
        noteKeyboardFrame(!info.animating);
        if (!info.animating) logKeyboardEvent("ime-end", Math.round(info.height));
        sync();
      });
      const restObserver = new MutationObserver(() => {
        const held = shell.restBottom;
        readRestBottom();
        if (shell.restBottom !== held) sync();
      });
      dropKeyboard = () => {
        void animation.remove();
        void geometry.remove();
        stopDrawing();
        restObserver.disconnect();
        shell.keyboard = 0;
        // Back to measuring, or the shell goes on subtracting a keyboard
        // nothing is reporting any more from a height nothing is updating.
        shell.source = "viewport";
        sync();
      };
      /*
       * The resting inset is written by the shell whenever the bars change,
       * which is not only when a keyboard moves: the navigation bar itself
       * can be swapped between gestures and three buttons while the app is
       * open, and on a cold start it is written once before any keyboard has
       * ever travelled. Reading it only at the ends of a travel left the
       * composer with no room for the navigation bar until the first time
       * somebody typed. Watching the attribute the shell writes catches both.
       */
      readRestBottom();
      restObserver.observe(root, { attributes: true, attributeFilter: ["style"] });
      // Only now is the keyboard's position actually being reported. Claiming
      // it up front meant a shell whose plugin failed to register went on
      // believing `innerHeight` was the window -- the full screen, keyboard
      // and all, with the composer behind it -- and never fell back to the
      // viewport the comment promised.
      shell.source = "insets";
      sync();
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
    shell.stop();
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
