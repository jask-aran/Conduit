export type MobileSwipeAction = "open-sidebar" | "close-sidebar" | "open-workspace" | "close-workspace";

/*
 * Phone panel swipes. Opening starts at a screen edge -- the sidebar from the
 * left, the workspace from the right -- because a swipe from anywhere opened
 * them under every sideways scroll and flick. Closing an open panel may start
 * anywhere, in the closing direction.
 *
 * Nothing is decided until the finger has moved LOCK_PX. Then the touch is a
 * swipe (mostly sideways, the right way) or a scroll, and that is final: a
 * scroll that drifts sideways later never becomes a swipe. A swipe carries its
 * panel with the finger from where it was decided (progress, 0 shut to 1 open, over the panel's travel)
 * and lands open or shut on letting go: past COMMIT of the way, or flicked
 * there; a flick back the other way returns it, however far it had come.
 */

/** From the edge inward. On Android's gesture navigation the outermost strip
 *  is the system's Back and never reaches the page, so this reaches past it. */
export const EDGE_PX = 64;
const LOCK_PX = 10;
const LOCK_WITHIN_MS = 500;
const SIDEWAYS_RATIO = 1.5;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 24;
const COMMIT = 0.4;
/** The finger's speed is read over its last few moves, not the last one alone, which a touch screen makes noisy. */
const VELOCITY_MS = 80;

/** travel: how far the panel moves between shut and open, in px, when it follows the finger (it lands past COMMIT of
 *  it). Without one the panel only opens or shuts on letting go, after the width's 30% (at most 120px). */
export interface SwipeStart { x: number; y: number; t: number; width: number; sidebarOpen: boolean; workspaceOpen: boolean; travel?: number;
  /** How open the sidebar is where a touch caught it still moving (0 to 1): the swipe carries it on from there, and may
   *  start anywhere, since the page it slides is wherever the motion had got to. */
  from?: number }
export interface SwipePoint { x: number; y: number; t: number }

export interface EdgeSwipe {
  /** False once the touch is a scroll (or never could be a swipe): stop tracking it. */
  move(point: SwipePoint): "pending" | "swiping" | "abandoned";
  /** What the touch would do, once it is a swipe: which panel, and which way. */
  readonly action: MobileSwipeAction;
  /** How open its panel is at this point, 0 shut to 1 open. */
  progress(point: SwipePoint): number;
  /** Whether, let go slowly here, it would land (past COMMIT of the way); a flick may still change that. */
  lands(point: SwipePoint): boolean;
  /** On letting go: the action if it lands that way, null if the panel goes back (or the touch was never a swipe). */
  end(point: SwipePoint): MobileSwipeAction | null;
}

export function beginEdgeSwipe(start: SwipeStart): EdgeSwipe | null {
  // Which action this touch could become, and which way it must go.
  const intent: { action: MobileSwipeAction; sign: 1 | -1 } | null =
    start.sidebarOpen ? { action: "close-sidebar", sign: -1 }
      : start.from !== undefined ? { action: "open-sidebar", sign: 1 }
      : start.workspaceOpen ? { action: "close-workspace", sign: 1 }
        : start.x <= EDGE_PX ? { action: "open-sidebar", sign: 1 }
          : start.x >= start.width - EDGE_PX ? { action: "open-workspace", sign: -1 }
            : null;
  if (!intent) return null;
  let state: "pending" | "swiping" | "abandoned" = "pending";
  const recent: SwipePoint[] = [{ x: start.x, y: start.y, t: start.t }];
  const span = start.travel ?? Math.min(120, start.width * 0.3);
  const opening = intent.action.startsWith("open");
  const travel = (point: SwipePoint) => (point.x - start.x) * intent.sign;
  const base = start.from ?? (opening ? 0 : 1);
  // The panel moves from where the touch became a swipe, not from where it went down: carried from the touch, it would
  // jump the lock's distance (more on a quick start) the frame the swipe is decided. It trails the finger by that much.
  let slop = 0;
  const at = (moved: number) => Math.max(0, Math.min(1, base + (opening ? 1 : -1) * moved / span));
  const progress = (point: SwipePoint) => at(Math.max(0, travel(point) - slop));
  // Where it lands is the finger's whole way, so the lag it is drawn with changes nothing about that.
  const lands = (point: SwipePoint) => opening ? at(travel(point)) >= COMMIT : at(travel(point)) <= 1 - COMMIT;
  const velocity = () => {
    const last = recent[recent.length - 1]!;
    const first = recent.find((point) => last.t - point.t <= VELOCITY_MS) ?? last;
    return last.t > first.t ? ((last.x - first.x) * intent.sign) / (last.t - first.t) : 0;
  };
  const move = (point: SwipePoint) => {
    if (state === "abandoned") return state;
    if (point.t >= recent[recent.length - 1]!.t) recent.push(point);
    while (recent.length > 2 && point.t - recent[0]!.t > VELOCITY_MS * 2) recent.shift();
    if (state === "swiping") return state;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    if (Math.hypot(dx, dy) < LOCK_PX) {
      if (point.t - start.t > LOCK_WITHIN_MS) state = "abandoned";
      return state;
    }
    state = travel(point) > 0 && Math.abs(dx) >= Math.abs(dy) * SIDEWAYS_RATIO ? "swiping" : "abandoned";
    if (state === "swiping") slop = travel(point);
    return state;
  };
  return {
    move,
    action: intent.action,
    progress,
    lands,
    end(point) {
      if (move(point) !== "swiping") return null;
      const distance = travel(point);
      const speed = velocity();
      if (speed <= -FLICK_PX_PER_MS) return null;
      return (start.travel ? lands(point) : distance >= span) || (distance >= FLICK_MIN_PX && speed >= FLICK_PX_PER_MS) ? intent.action : null;
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
