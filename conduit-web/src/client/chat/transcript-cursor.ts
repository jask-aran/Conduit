/*
 * The transcript as a list (docs/plans/keyboard-model.md, gap 5): while its viewport has the keyboard, a cursor walks
 * its rows -- the person's messages, the answers, traces, reports -- drawn as the wash on that one row.
 *
 *   ↑ ↓         the row above, below; clamped at both ends (the first press starts from what is on screen)
 *   Home, End   the first row, the last
 *   Enter       opens or closes the row's fold: a trace, a long message's Show more, a message in or out
 *   Menu key, Shift+F10   the row's menu (its foot's actions)
 *
 * Escape is the app's ladder (main.tsx escapeHome: to the composer). Page Up/Down and Space still scroll.
 *
 * The cursor is one attribute on one row (`data-focus-shown`), never DOM focus on each row: the viewport keeps focus,
 * and nothing restyles more than the row it lands on and the one it leaves. It shows on a keyboard arrival only --
 * Go to transcript lands it on the last row (landTranscriptCursor), an arrow shows it from what is on screen -- and
 * goes with a press in the transcript or focus leaving it (coming back from its menu or the find bar, it is where it
 * was). While the window is in the background it stays where it was.
 */

const ROW = '[data-slot="message-scroller-item"]';
const SHOWN = "data-focus-shown";
/** The folds Enter opens or closes: a row's own, not a code block's inside an answer. */
const FOLD = ":is(.ui-trace, .ui-show-more, .ui-envelope-toggle, .ui-agent-open)[aria-expanded]:not(:disabled)";

export type TranscriptCursorOptions = {
  viewport: HTMLElement;
  thread: HTMLElement;
  /** Scrolls the viewport to this top as the reader's own scroll. */
  scrollTo: (top: number) => void;
  /** Opens the row's menu; false when it has none. */
  openMenu: (row: HTMLElement) => boolean;
};

/* Each mounted transcript's landing, by its viewport, for the app's Go to transcript. */
const landings = new WeakMap<HTMLElement, () => void>();
/** Go to transcript's landing (keyboard model: arriving lands on the region's anchor): the cursor on the last row of
 *  the transcript whose viewport has focus. */
export function landTranscriptCursor(viewport: Element | null | undefined) {
  if (viewport instanceof HTMLElement) landings.get(viewport)?.();
}

/** The band of the viewport the reader sees, in client coordinates: under the header the column runs beneath (the
 *  viewport's scroll-padding-top), above the composer docked over its foot (the column's bottom padding). */
export function visibleBand(viewport: HTMLElement, thread: HTMLElement) {
  const box = viewport.getBoundingClientRect();
  const top = Number.parseFloat(getComputedStyle(viewport).scrollPaddingTop) || 0;
  const bottom = Number.parseFloat(getComputedStyle(thread.parentElement ?? thread).paddingBottom) || 0;
  return { top: box.top + top, bottom: Math.max(box.top + top, box.bottom - bottom) };
}

export function mountTranscriptCursor(options: TranscriptCursorOptions) {
  const { viewport, thread } = options;
  let cursor: HTMLElement | null = null;
  let pressedAt = -Infinity;
  // While the row's menu is open the cursor stays drawn, and is shown again when focus comes back from it.
  let menuOpen = false;
  let menuAt = -Infinity;

  const rows = () => [...thread.querySelectorAll<HTMLElement>(`:scope > ${ROW}:not([data-cursor-skip])`)];
  const band = () => visibleBand(viewport, thread);
  // The row brought just inside the band, the least distance: a row taller than the band shows its top.
  const reveal = (row: HTMLElement) => {
    const rect = row.getBoundingClientRect(), seen = band();
    let delta = 0;
    if (rect.top < seen.top || rect.height > seen.bottom - seen.top) delta = rect.top - seen.top;
    else if (rect.bottom > seen.bottom) delta = rect.bottom - seen.bottom;
    if (Math.abs(delta) >= 1) options.scrollTo(viewport.scrollTop + delta);
  };
  const draw = (row: HTMLElement | null) => {
    if (cursor && cursor !== row) cursor.removeAttribute(SHOWN);
    cursor = row;
    if (row && !row.hasAttribute(SHOWN)) row.setAttribute(SHOWN, "");
  };
  const hide = () => { cursor?.removeAttribute(SHOWN); };
  const moveTo = (row: HTMLElement | undefined) => {
    if (!row) return;
    draw(row);
    reveal(row);
  };
  // With no cursor yet, the first press starts from the screen: ↑ from the lowest row showing, ↓ from the highest.
  const onScreen = (list: HTMLElement[], down: boolean) => {
    const seen = band();
    const showing = list.filter((row) => { const rect = row.getBoundingClientRect(); return rect.bottom > seen.top && rect.top < seen.bottom; });
    return (down ? showing[0] : showing.at(-1)) ?? list.at(-1);
  };
  const live = () => Boolean(cursor?.isConnected && cursor.parentElement === thread && cursor.hasAttribute(SHOWN));

  const onKeyDown = (event: KeyboardEvent) => {
    // Keys on a control inside a row (a foot's button reached by Tab) are that control's.
    if (event.target !== viewport || event.defaultPrevented || event.isComposing) return;
    const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
    if (event.altKey || event.ctrlKey || event.metaKey || (event.shiftKey && !menuKey)) return;
    const list = rows();
    if (!list.length) return;
    const at = live() ? list.indexOf(cursor!) : -1;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const down = event.key === "ArrowDown";
      event.preventDefault();
      moveTo(at < 0 ? onScreen(list, down) : list[Math.max(0, Math.min(list.length - 1, at + (down ? 1 : -1)))]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveTo(event.key === "Home" ? list[0] : list.at(-1));
      return;
    }
    if (at < 0) return;
    if (event.key === "Enter") {
      const fold = cursor!.querySelector<HTMLElement>(FOLD);
      if (!fold) return;
      event.preventDefault();
      fold.click();
      requestAnimationFrame(() => { if (cursor?.isConnected) reveal(cursor); });
      return;
    }
    if (menuKey) {
      event.preventDefault();
      menuAt = performance.now();
      if (options.openMenu(cursor!)) menuOpen = true;
    }
  };
  // The Menu key and Shift+F10 also send the page a contextmenu: the browser's own menu is not wanted over ours.
  const onContextMenu = (event: MouseEvent) => {
    if (event.target === viewport && performance.now() - menuAt < 1000) event.preventDefault();
  };
  const onPointerDown = () => {
    pressedAt = performance.now();
    hide();
    cursor = null;
  };
  const onFocus = (event: FocusEvent) => {
    if (event.target !== viewport) return;
    menuOpen = false;
    // A press focuses the viewport too; that is not a keyboard arrival.
    if (performance.now() - pressedAt < 500) return;
    if (live()) return;
    // Back from its menu, the find bar or another window: where it was, without moving the view. Arriving on purpose
    // (Go to transcript) is land().
    if (cursor?.isConnected && cursor.parentElement === thread) draw(cursor);
  };
  const onBlur = (event: FocusEvent) => {
    if (event.target !== viewport || menuOpen) return;
    // The window going to the background keeps the cursor where it was (DESIGN Interaction, Cursor).
    if (!document.hasFocus()) return;
    hide();
  };

  const land = () => { const last = rows().at(-1); if (last) moveTo(last); };
  landings.set(viewport, land);
  viewport.addEventListener("keydown", onKeyDown);
  viewport.addEventListener("contextmenu", onContextMenu);
  viewport.addEventListener("pointerdown", onPointerDown, { passive: true });
  viewport.addEventListener("focus", onFocus);
  viewport.addEventListener("blur", onBlur);
  return {
    /** The row's menu closed with focus going elsewhere (a press outside it): the cursor goes with it. */
    menuClosed() {
      menuOpen = false;
      if (document.activeElement !== viewport) hide();
    },
    destroy() {
      hide();
      landings.delete(viewport);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("contextmenu", onContextMenu);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("focus", onFocus);
      viewport.removeEventListener("blur", onBlur);
    },
  };
}
