export type MobileSwipeAction = "open-sidebar" | "close-sidebar" | "open-workspace" | "close-workspace";

/* Opening starts at a screen edge, since a swipe from anywhere would open a panel under every sideways scroll. */

/** From the edge inward; reaches past Android's gesture-navigation Back strip, which never reaches the page. */
export const EDGE_PX = 64;
const LOCK_PX = 10;
const LOCK_WITHIN_MS = 500;
const SIDEWAYS_RATIO = 1.5;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 24;
const COMMIT = 0.4;
/** The finger's speed is read over its last few moves, not the last one alone, which a touch screen makes noisy. */
const VELOCITY_MS = 80;
export const SWIPE = { lockPx: LOCK_PX, sidewaysRatio: SIDEWAYS_RATIO, flickPxPerMs: FLICK_PX_PER_MS, flickMinPx: FLICK_MIN_PX, commit: COMMIT } as const;

export interface SwipeStart { x: number; y: number; t: number; width: number; sidebarOpen: boolean; workspaceOpen: boolean; travel?: number;
  from?: number }
export interface SwipePoint { x: number; y: number; t: number }

export interface EdgeSwipe {
  move(point: SwipePoint): "pending" | "swiping" | "abandoned";
  readonly action: MobileSwipeAction;
  progress(point: SwipePoint): number;
  lands(point: SwipePoint): boolean;
  end(point: SwipePoint): MobileSwipeAction | null;
}

export function beginEdgeSwipe(start: SwipeStart): EdgeSwipe | null {
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
  // The panel moves from where the touch became a swipe, not where it went down, or it would jump the lock's distance.
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

/** Read live, so a new sideways scroller needs no listing. */
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
