import { installedClientKind } from "../platform/installed-client.ts";
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
  const sync = () => {
    if (!isMobileLayout()) {
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--vv-offset-top");
      root.removeAttribute("data-vv-shell");
      return;
    }
    const vv = window.visualViewport;
    const viewport = vv?.height ?? window.innerHeight;
    if (!shellKeyboard) restingHeight = viewport;
    // A shrink of a few pixels is a toolbar, not a keyboard.
    const viewportShrank = viewport < restingHeight - 48;
    const height = Math.max(0, shellKeyboard && !viewportShrank
      ? restingHeight - shellKeyboard
      : viewport);
    const offsetTop = vv?.offsetTop ?? 0;
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    root.style.setProperty("--vv-offset-top", `${Math.round(offsetTop)}px`);
    root.setAttribute("data-vv-shell", "true");
  };
  sync();
  const vv = window.visualViewport;
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
    const onGeometry = () => {
      shellKeyboard = virtualKeyboard.boundingRect.height;
      sync();
    };
    virtualKeyboard.addEventListener("geometrychange", onGeometry);
    dropVirtualKeyboard = () => {
      virtualKeyboard.removeEventListener("geometrychange", onGeometry);
      virtualKeyboard.overlaysContent = false;
    };
  }

  // Imported for its side effect of existing only in the Android shell: the
  // package is a Capacitor bridge call, and asking for it anywhere else logs
  // a missing-plugin warning for a question nothing was going to answer.
  let dropKeyboard: (() => void) | null = null;
  let disposed = false;
  if (installedClientKind === "android") {
    void import("@capacitor/keyboard").then(async ({ Keyboard }) => {
      const shown = await Keyboard.addListener("keyboardWillShow", (info) => {
        shellKeyboard = info.keyboardHeight;
        sync();
      });
      const hidden = await Keyboard.addListener("keyboardWillHide", () => {
        shellKeyboard = 0;
        sync();
      });
      dropKeyboard = () => { void shown.remove(); void hidden.remove(); };
      if (disposed) dropKeyboard();
    }).catch(() => { /* no shell to ask; visualViewport is the whole answer */ });
  }

  return () => {
    disposed = true;
    dropKeyboard?.();
    dropVirtualKeyboard?.();
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
