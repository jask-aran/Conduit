/*
 * A phone's drawer handing over to the page it opens:
 * - pressAhead: a held touch draws the page under the drawer a moment before the tap lands (a scroll usually shows
 *   itself first); released or scrolled (cancelled), the app keeps or puts back what it drew.
 * - shutDrawerOnto: the drawer slides back once the page is drawn (paneDrawn), never over it arriving in pieces.
 */

/** A pane is drawn when no ChatView in it is still opening (its lists still drawing what is on screen, or loading). */
export const paneDrawn = (pane: ParentNode | null | undefined) => !pane?.querySelector(".ui-chat[data-opening]");

/** A press's handlers for a row or button that opens a page: press after `hold` ms of a touch (when allowed),
 *  release(cancelled) when it lifts (false) or the browser takes it for a scroll (true). */
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

/** Shut the drawer onto what `opening` opens, once drawn. at: the page's route and chat, waited on to change (the old
 *  page is drawn already) or for the open to settle. cap: the most it waits, ms; a slow load finishes in place. */
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
