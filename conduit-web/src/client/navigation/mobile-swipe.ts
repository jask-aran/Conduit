export type MobileSwipeAction = "open-sidebar" | "close-sidebar" | "open-workspace" | "close-workspace";

/*
 * Phone panel swipes. Opening starts at a screen edge -- the sidebar from the
 * left, the workspace from the right -- because a swipe from anywhere opened
 * them under every sideways scroll and flick. Closing an open panel may start
 * anywhere, in the closing direction.
 *
 * Nothing is decided until the finger has moved LOCK_PX. Then the touch is a
 * swipe (mostly sideways, the right way) or a scroll, and that is final: a
 * scroll that drifts sideways later never becomes a swipe. A swipe completes
 * on enough travel or a quick enough flick.
 */

/** From the edge inward. On Android's gesture navigation the outermost strip
 *  is the system's Back and never reaches the page, so this reaches past it. */
export const EDGE_PX = 48;
const LOCK_PX = 10;
const LOCK_WITHIN_MS = 500;
const SIDEWAYS_RATIO = 1.5;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 24;

export interface SwipeStart { x: number; y: number; t: number; width: number; sidebarOpen: boolean; workspaceOpen: boolean }
export interface SwipePoint { x: number; y: number; t: number }

export interface EdgeSwipe {
  /** False once the touch is a scroll (or never could be a swipe): stop tracking it. */
  move(point: SwipePoint): "pending" | "swiping" | "abandoned";
  end(point: SwipePoint): MobileSwipeAction | null;
}

export function beginEdgeSwipe(start: SwipeStart): EdgeSwipe | null {
  // Which action this touch could become, and which way it must go.
  const intent: { action: MobileSwipeAction; sign: 1 | -1 } | null =
    start.sidebarOpen ? { action: "close-sidebar", sign: -1 }
      : start.workspaceOpen ? { action: "close-workspace", sign: 1 }
        : start.x <= EDGE_PX ? { action: "open-sidebar", sign: 1 }
          : start.x >= start.width - EDGE_PX ? { action: "open-workspace", sign: -1 }
            : null;
  if (!intent) return null;
  let state: "pending" | "swiping" | "abandoned" = "pending";
  let last = { x: start.x, t: start.t };
  let velocity = 0;
  const travel = (point: SwipePoint) => (point.x - start.x) * intent.sign;
  const move = (point: SwipePoint) => {
    if (state === "abandoned") return state;
    const dt = point.t - last.t;
    if (dt > 0) velocity = ((point.x - last.x) * intent.sign) / dt;
    last = { x: point.x, t: point.t };
    if (state === "swiping") return state;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    if (Math.hypot(dx, dy) < LOCK_PX) {
      if (point.t - start.t > LOCK_WITHIN_MS) state = "abandoned";
      return state;
    }
    state = travel(point) > 0 && Math.abs(dx) >= Math.abs(dy) * SIDEWAYS_RATIO ? "swiping" : "abandoned";
    return state;
  };
  return {
    move,
    end(point) {
      if (move(point) !== "swiping") return null;
      const distance = travel(point);
      const enough = Math.min(120, start.width * 0.3);
      return distance >= enough || (distance >= FLICK_MIN_PX && velocity >= FLICK_PX_PER_MS) ? intent.action : null;
    },
  };
}

/**
 * Whether a touch on this element belongs to it rather than to a panel swipe:
 * text and controls, and anything that really scrolls sideways (code blocks,
 * tables, tab strips) -- read live, so a new scroller needs no listing.
 */
export function swipeBlocked(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  if (node?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='slider'], canvas, .ui-composer-slot, .ui-phone-composer, [data-mobile-swipe-ignore]")) return true;
  for (; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}
