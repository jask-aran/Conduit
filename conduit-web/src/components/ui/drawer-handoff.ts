/* pressAhead draws the page under the drawer while a touch is held, before the tap lands (a scroll usually shows itself
 * first); shutDrawerOnto slides the drawer back only once the page is drawn, never over it arriving in pieces. */

export const paneDrawn = (pane: ParentNode | null | undefined) => !pane?.querySelector(".ui-chat[data-opening]");

export function pressAhead(options: { press: () => void; release: (cancelled: boolean) => void; when?: () => boolean; hold?: number }) {
  let timer = 0;
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.pointerType !== "touch" || options.when?.() === false) return;
      clearTimeout(timer);
      timer = window.setTimeout(options.press, options.hold ?? 40);
    },
    onPointerUp: () => { clearTimeout(timer); options.release(false); },
    onPointerCancel: () => { clearTimeout(timer); options.release(true); },
  };
}

export function shutDrawerOnto(options: { opening: Promise<unknown>; open: () => boolean; shut: () => void; drawn: () => boolean; at: () => string; cap?: number }) {
  let settled = false, failed = false;
  // Not only on the open's promise: that may also wait on reading the page afresh, long after it is drawn.
  void options.opening.then(() => { settled = true; if (options.open() && options.drawn()) options.shut(); }, () => { failed = true; });
  const from = options.at();
  const started = performance.now();
  const step = () => {
    if (!options.open()) return;
    const moved = settled || options.at() !== from;
    if (failed || (moved && options.drawn()) || performance.now() - started > (options.cap ?? 500)) options.shut();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
