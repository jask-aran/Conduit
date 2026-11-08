import { beginEdgeSwipe, EDGE_PX, swipeBlocked, type EdgeSwipe } from "./edge-swipe";
import { haptic } from "./haptics";
import { duration } from "./motion";
import { feelDrawerAhead } from "./nav";

/** What the phone's drawer swipe reads and sets: the NavPane's drawer and the workspace panel at the other edge. */
export type DrawerSwipeOptions = {
  /** Whether the layout is a phone's now: the swipe is heard only then. */
  phone: () => boolean;
  /** The drawer open, and opened or shut (on letting go, or by a swipe that opens the other panel). */
  open: () => boolean;
  setOpen: (open: boolean) => void;
  /** The panel at the right edge; available: whether there is one to open here. */
  other: { open: () => boolean; setOpen: (open: boolean) => void; available: () => boolean };
};

/** The phone's drawer swipe, heard on the window: the drawer opens from the left edge, the other panel from the right,
 *  either shuts across itself (edge-swipe.ts). Started once; returns its stop. */
export function drawerSwipe(options: DrawerSwipeOptions): () => void {
  const { phone, open: drawerOpen, setOpen: setDrawerOpen, other } = options;
  let swipe: { id: number; gesture: EdgeSwipe } | null = null;
  // Safari outside an installed app takes the left edge for its own Back.
  const browserOwnsEdges = /iP(hone|ad|od)/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;
  const keyboardUp = () => Boolean(window.visualViewport && window.visualViewport.height < window.innerHeight * 0.75);
  // The sidebar follows the finger (nav.css --drawer, written once a frame); let go, it settles from there. The
  // workspace panel only opens or shuts on letting go.
  type DrawerParts = { pane: HTMLElement; body: HTMLElement; shell: HTMLElement; backdrop: HTMLElement };
  const drawerParts = (): DrawerParts | null => {
    const pane = document.querySelector<HTMLElement>(".ui-nav-pane[data-drawer]");
    const body = pane?.querySelector<HTMLElement>(":scope > .ui-nav-pane-body");
    const shell = document.querySelector<HTMLElement>(".ui-shell[data-drawer]");
    const backdrop = document.querySelector<HTMLElement>('.ui-backdrop[data-layer="drawer"][data-fade]');
    return pane && body && shell && backdrop ? { pane, body, shell, backdrop } : null;
  };
  // Carried past where it lands, it is felt there, and again if it comes back; let go, a landing already felt plays
  // nothing more, and one a flick changed plays as a tap's does.
  let drag: { parts: DrawerParts; progress: number; frame: number; from: boolean; felt: boolean } | null = null;
  let settleTimer = 0;
  const carry = (progress: number, lands: boolean) => {
    if (!drag) {
      const parts = drawerParts();
      if (!parts) return;
      window.clearTimeout(settleTimer);
      for (const part of [parts.pane, parts.shell, parts.backdrop]) { part.removeAttribute("data-drawer-settle"); part.setAttribute("data-drawer-drag", ""); }
      drag = { parts, progress, frame: 0, from: drawerOpen(), felt: drawerOpen() };
      // Where it is taken from is drawn at once, in the same frame the settle stops: a frame later it has jumped.
      for (const part of [parts.body, parts.shell, parts.backdrop]) part.style.setProperty("--drawer", String(progress));
    }
    drag.progress = progress;
    const landing = lands ? !drag.from : drag.from;
    if (landing !== drag.felt) { drag.felt = landing; haptic(landing ? "open" : "dismiss"); }
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      if (!drag) return;
      drag.frame = 0;
      for (const part of [drag.parts.body, drag.parts.shell, drag.parts.backdrop]) part.style.setProperty("--drawer", String(drag.progress));
    });
  };
  /** How open the sidebar is drawn while still moving (0 to 1); null at rest. Read from the slide, not the state. */
  const drawerMoving = (): number | null => {
    const parts = drawerParts();
    const width = parts?.pane.offsetWidth;
    if (!parts || !width) return null;
    const at = new DOMMatrixReadOnly(getComputedStyle(parts.shell).transform).m41 / width;
    return Math.abs(at - (drawerOpen() ? 1 : 0)) * width > 2 ? Math.max(0, Math.min(1, at)) : null;
  };
  /** Lets the carried sidebar go: it settles open or shut from where it is (open: whether it lands open). */
  const release = (open: boolean) => {
    if (!drag) return;
    const { parts, frame, felt } = drag;
    drag = null;
    if (frame) cancelAnimationFrame(frame);
    if (open === felt && open !== drawerOpen()) feelDrawerAhead();
    else if (open !== felt && open === drawerOpen()) haptic(open ? "open" : "dismiss");
    for (const part of [parts.body, parts.shell, parts.backdrop]) part.style.removeProperty("--drawer");
    for (const part of [parts.pane, parts.shell, parts.backdrop]) { part.removeAttribute("data-drawer-drag"); part.setAttribute("data-drawer-settle", ""); }
    setDrawerOpen(open);
    // Kept for as long as the settle takes (the Animation speed setting slows it), not a fixed time it can outlast.
    settleTimer = window.setTimeout(() => { for (const part of [parts.pane, parts.shell, parts.backdrop]) part.removeAttribute("data-drawer-settle"); }, duration("--duration-gentle") * 2 + 150);
  };
  // Heard first, on the window in capture: an open popover stops a touch outside it, which left a carried sidebar
  // never let go. Moves and end are also heard where the touch started (once each), since once that target leaves
  // the document they never reach the window.
  let heard: EventTarget | null = null;
  let last: Event | null = null;
  const once = (event: Event) => { if (event === last) return false; last = event; return true; };
  const hear = (target: EventTarget | null) => {
    if (heard === target) return;
    if (heard) {
      heard.removeEventListener("touchmove", move as EventListener);
      heard.removeEventListener("touchend", end as EventListener);
      heard.removeEventListener("touchcancel", cancel);
    }
    heard = target;
    if (!target) return;
    target.addEventListener("touchmove", move as EventListener, { passive: true });
    target.addEventListener("touchend", end as EventListener, { passive: true });
    target.addEventListener("touchcancel", cancel, { passive: true });
  };
  const start = (event: TouchEvent) => {
    swipe = null;
    hear(null);
    if (drag) release(drawerOpen());
    if (!phone() || event.touches.length !== 1 || keyboardUp()) return;
    if (swipeBlocked(event.target) || String(window.getSelection() || "")) return;
    const touch = event.touches[0]!;
    const opening = !drawerOpen() && !other.open();
    // A sidebar still moving is caught and held where it is drawn, carried on or settled from there.
    const caught = other.open() ? null : drawerMoving();
    if (caught !== null) carry(caught, false);
    if (opening && browserOwnsEdges && caught === null) return;
    const sidebar = drawerOpen() || caught !== null || (!other.open() && touch.clientX <= EDGE_PX);
    const travel = sidebar ? document.querySelector<HTMLElement>(".ui-nav-pane[data-drawer]")?.offsetWidth : undefined;
    const gesture = beginEdgeSwipe({ x: touch.clientX, y: touch.clientY, t: event.timeStamp, width: window.innerWidth, sidebarOpen: drawerOpen(), workspaceOpen: other.open(), travel, ...(caught !== null ? { from: caught } : {}) });
    if (gesture) { swipe = { id: touch.identifier, gesture }; hear(event.target); }
    else if (caught !== null) release(drawerOpen());
  };
  const move = (event: TouchEvent) => {
    if (!swipe || !once(event)) return;
    if (event.touches.length !== 1) { swipe = null; release(drawerOpen()); return; }
    const touch = [...event.changedTouches].find((item) => item.identifier === swipe!.id);
    if (!touch) return;
    const point = { x: touch.clientX, y: touch.clientY, t: event.timeStamp };
    const state = swipe.gesture.move(point);
    if (state === "abandoned") { swipe = null; release(drawerOpen()); }
    else if (state === "swiping" && swipe.gesture.action.endsWith("sidebar")) carry(swipe.gesture.progress(point), swipe.gesture.lands(point));
  };
  const end = (event: TouchEvent) => {
    if (!once(event)) return;
    const touch = swipe && [...event.changedTouches].find((item) => item.identifier === swipe!.id);
    if (!swipe || !touch) return;
    const action = swipe.gesture.end({ x: touch.clientX, y: touch.clientY, t: event.timeStamp });
    const sidebar = swipe.gesture.action.endsWith("sidebar");
    swipe = null;
    hear(null);
    if (sidebar) release(action ? action === "open-sidebar" : drawerOpen());
    else if (action === "open-workspace" && other.available()) {
      setDrawerOpen(false);
      other.setOpen(true);
    } else if (action === "close-workspace") other.setOpen(false);
  };
  const cancel = (event?: Event) => { if (event && !once(event)) return; swipe = null; hear(null); release(drawerOpen()); };
  // Leaving the app mid-swipe ends the touch without telling the page.
  const away = () => { if (document.visibilityState === "hidden") cancel(); };
  window.addEventListener("touchstart", start, { passive: true, capture: true });
  window.addEventListener("touchmove", move, { passive: true, capture: true });
  window.addEventListener("touchend", end, { passive: true, capture: true });
  window.addEventListener("touchcancel", cancel, { passive: true, capture: true });
  document.addEventListener("visibilitychange", away);
  return () => {
    hear(null);
    window.removeEventListener("touchstart", start, { capture: true });
    window.removeEventListener("touchmove", move, { capture: true });
    window.removeEventListener("touchend", end, { capture: true });
    window.removeEventListener("touchcancel", cancel, { capture: true });
    document.removeEventListener("visibilitychange", away);
  };
}
