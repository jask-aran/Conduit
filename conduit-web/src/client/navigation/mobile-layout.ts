import { installedClientKind } from "../platform/installed-client.ts";
import { logKeyboardEvent, noteKeyboardFrame, reportKeyboardProbe } from "./keyboard-probe.ts";
import { latestAway } from "../chat/latest-away";
import { travelEasing, travelsWithoutLayout, travelWithoutLayout } from "@/components/ui/keyboard-travel";
import { keyboardTravel } from "@/components/ui/motion";
import { followViewport } from "@/components/ui/viewport";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";

export const MOBILE_LAYOUT_QUERY = PHONE_LAYOUT_QUERY;

export function isMobileLayout(): boolean {
  return typeof matchMedia === "function" && matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

export type MobileOverlayKind = "sidebar" | "workspace";

export function setMobileOverlayKind(kind: MobileOverlayKind | null): void {
  if (typeof document === "undefined") return;
  if (kind) document.documentElement.setAttribute("data-mobile-overlay", kind);
  else document.documentElement.removeAttribute("data-mobile-overlay");
}

/*
 * `visualViewport` alone is not enough on a phone: `interactive-widget` is a request a browser may ignore, and
 * Capacitor's SystemBars pads the WebView only behind gates. So the keyboard is measured: VirtualKeyboard in a browser,
 * the plugin in the Android shell; on iOS, which pans instead of resizing, `visualViewport` is already the answer.
 */
export function bindVisualViewportShell(): () => void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  // Watched only so the probe can say what arrived and in what order.
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

  // `overlaysContent` stops asking the browser to resize (it may not); `geometrychange` then reports exactly how much
  // room the keyboard takes.
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
   * The plugin sends the whole travel at its start (target, duration, the system's interpolator sampled) rather than a
   * height per frame, which the bridge delivers only a few times per travel. The per-frame events still correct the
   * drawing, since the animation is the system's to change or cancel, and `ime-end` settles it.
   */
  let dropKeyboard: (() => void) | null = null;
  let disposed = false;
  if (installedClientKind === "android") {
    let drawing = 0;
    // Separate from whether a frame is scheduled: per-frame events arriving late after the drawing ends would drag the
    // shell back down the curve it just finished climbing.
    let travelling = false;
    // `began` is corrected by the per-frame events: the description crosses the bridge late, and each frame carries
    // the system's own progress.
    let began = 0;
    let travelDuration = 0;
    // A hide whose `getDurationMillis` is -1 still slides, so it is drawn with the shape of the last described travel:
    // a show and its hide are the same curve run in opposite directions.
    let lastDurationMs = 250;
    let travel: ReturnType<typeof travelWithoutLayout> | null = null;
    let lastCurve: number[] = [0, 1];
    const stopDrawing = () => {
      if (drawing) cancelAnimationFrame(drawing);
      drawing = 0;
    };
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
        safeArea?(): Promise<{ top: number; right: number; bottom: number; left: number }>;
      }>("ConduitKeyboard");
      // Asked for, not only told: a page that starts after the insets were applied (a cold start, a reclaimed renderer)
      // has none, and the composer would sit under the gesture bar. An older app has no answer.
      void plugin.safeArea?.().then((area) => {
        const style = document.documentElement.style;
        style.setProperty("--safe-area-inset-top", `${area.top}px`);
        style.setProperty("--safe-area-inset-right", `${area.right}px`);
        style.setProperty("--safe-area-inset-bottom-rest", `${area.bottom}px`);
        style.setProperty("--safe-area-inset-left", `${area.left}px`);
        readRestBottom();
        sync();
      }).catch(() => {});
      const animation = await plugin.addListener("keyboardAnimation", (info) => {
        // `getDurationMillis` answers -1 when the platform will not say (Gboard dismissed by back), and dividing by
        // that would run the clock backwards.
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
        // Rooms given meanwhile (the composer's field going) glide on the keyboard's time.
        const travelLeft = durationMs - (info.startedAt ? Math.min(durationMs, Math.max(0, Date.now() - info.startedAt)) : 0);
        // With the native composer up, the travel has no layout in it, and carries the rooms too: it measures before
        // they are told.
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
        // The clock is only wound forward, a few ms a frame, towards where the system says it should be: jumping back
        // down the curve to meet a late frame is a visible stutter.
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
      // The shell rewrites the resting inset whenever the bars change (a gesture/three-button swap, a cold start), not
      // only when a keyboard moves.
      readRestBottom();
      restObserver.observe(root, { attributes: true, attributeFilter: ["style"] });
      // Claimed only now, so a shell whose plugin failed to register falls back to the viewport.
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
