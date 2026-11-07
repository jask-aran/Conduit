import { createMemo, createSignal, onCleanup } from "solid-js";
import { clearDock } from "./dock-inset";
import { reducedMotion } from "./motion";
import {
  advanceTailFollow,
  createTailFollowState,
  decideTailScroll,
  rebaseTailFollowState,
  TAIL_NEAR_LATEST_PX,
  TAIL_REJOIN_PX,
  usedMaxScrollTop,
  type TailFollowOwner,
  type TailFollowState,
} from "./tail-follow";

/*
 * A transcript's follow (DESIGN Transcript): held at its latest while the reader is there, left where they scrolled to
 * otherwise, the one engine every chat's transcript runs on (the chat's, the jbot chat's).
 *
 * - Who moved the view: a move up is the reader's only with a reader behind it (a wheel, a key, a touch and its fling,
 *   a press held in it, Find); a move up made by the page laying out (a block above shrinking) is not, and the follow
 *   carries on to the foot.
 * - Scroll to latest, and a send: one glide to the foot (glideToLatest), nothing else writing the scroll until it lands.
 * - spring: the typewriter's tail spring (tail-follow.ts) carries the view down with live output (live) instead of
 *   snapping, the reader taking it by scrolling up and handing it back by reaching the foot again.
 * - The keyboard takes height from the bottom, so the transcript gives it back from the top; following, it stays on
 *   its foot wherever that now is.
 * - The composer docked over its foot is cleared by its measured height (dock-inset.ts), the foot held through it.
 *
 * createTranscriptFollow in the component's body; attach once the viewport and its content are there (onMount).
 * holding: something else is moving the content (a panel reflow, a virtualizer refresh): its resizes are not chased.
 * onStep: after each follow step or reader scroll (a chat pages in its history there).
 */
export function createTranscriptFollow(options: {
  spring?: () => boolean;
  live?: () => boolean;
  empty?: () => boolean;
  holding?: () => boolean;
  onStep?: () => void;
  viewport?: () => HTMLElement | undefined;
} = {}) {
  const spring = () => options.spring?.() ?? false;
  const empty = () => options.empty?.() ?? false;
  const step = () => options.onStep?.();
  // The viewport, as the host has it (a ref set while it renders): effects of the host's may follow before attach.
  let attached: HTMLElement | undefined;
  const vp = () => options.viewport?.() ?? attached!;
  const [following, setFollowing] = createSignal(true);
  const [latestDistance, setLatestDistance] = createSignal(0);
  /** Scrolled back from the latest by more than a glance: Scroll to latest shows. */
  const latestAway = createMemo(() => !following() && latestDistance() >= TAIL_NEAR_LATEST_PX);

  let scrollFrame: number | null = null;
  let springFrame: number | null = null;
  let springState: TailFollowState = createTailFollowState();
  let rejoinTimer: number | null = null;
  let programmaticScrollTop: number | null = null;
  let previousScrollTop: number | null = null;
  // Paired with previousScrollTop: an upward move is only a reader if the scrollable distance did not shrink out from
  // under it.
  let previousMaxScrollTop: number | null = null;
  let latestGlide: number | null = null;

  const scrollTop = () => vp()?.scrollTop ?? 0;
  const maxScrollTop = () => usedMaxScrollTop({ scrollHeight: vp().scrollHeight, clientHeight: vp().clientHeight, scrollTop: vp().scrollTop });
  // Normal tail movement uses whole pixels. Panel reflow anchoring must retain fractional scroll positions or each
  // resize frame accumulates visible drift.
  const setScrollTop = (next: number, round = true, glide = false) => {
    // The glide to the latest owns the viewport until it lands (glideToLatest).
    if (latestGlide != null && !glide) return;
    vp().scrollTop = round ? Math.round(next) : next;
    programmaticScrollTop = vp().scrollTop;
    previousScrollTop = vp().scrollTop;
    previousMaxScrollTop = maxScrollTop();
  };
  const syncLatestDistance = () => { if (vp()) setLatestDistance(Math.max(0, maxScrollTop() - vp().scrollTop)); };

  const cancelSpringFrame = () => { if (springFrame != null) cancelAnimationFrame(springFrame); springFrame = null; };
  const cancelRejoin = () => { if (rejoinTimer != null) clearTimeout(rejoinTimer); rejoinTimer = null; };
  /** Who owns the tail spring: the app (it follows) or the reader (it waits); rebase: from where the view is now. */
  const setOwner = (owner: TailFollowOwner, rebase = false) => {
    springState = rebase
      ? rebaseTailFollowState(springState, scrollTop(), owner)
      : { ...springState, owner, velocity: owner === "user" ? 0 : springState.velocity };
    if (owner === "user") cancelSpringFrame();
  };
  // Handing the tail back is only ever allowed after a downward scroll that actually reached the bottom.
  // decideTailScroll gates the call site; this timer just waits for the gesture to go quiet before the spring resumes.
  const scheduleRejoin = () => {
    cancelRejoin();
    if (!spring() || !following()) return;
    rejoinTimer = window.setTimeout(() => {
      rejoinTimer = null;
      if (!spring() || !following()) return;
      setOwner("app", true);
      requestSpring();
    }, 120);
  };

  const cancelGlide = () => { if (latestGlide != null) cancelAnimationFrame(latestGlide); latestGlide = null; };
  // One ease to the foot, aimed at the foot as it is on each frame (a send's message may be built a frame late, an
  // answer may be growing). Nothing else writes the scroll until it lands or is taken.
  const glideToLatest = (then: () => void) => {
    cancelGlide();
    const from = vp().scrollTop;
    const target = () => vp().scrollHeight - vp().clientHeight;
    const first = target();
    if (reducedMotion() || Math.abs(first - from) < 2) { setScrollTop(first, true, true); then(); return; }
    // About the pace of the browser's own smooth scroll: longer for further, eased at both ends.
    const duration = Math.min(700, 280 + Math.sqrt(Math.abs(first - from)) * 6);
    const started = performance.now();
    const frame = () => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      latestGlide = progress < 1 ? requestAnimationFrame(frame) : null;
      setScrollTop(from + (target() - from) * eased, true, true);
      if (latestGlide == null) then();
    };
    latestGlide = requestAnimationFrame(frame);
  };
  const scrollBottomNow = () => {
    if (scrollFrame != null) { cancelAnimationFrame(scrollFrame); scrollFrame = null; }
    setScrollTop(vp().scrollHeight);
    step();
  };
  const scrollBottom = () => {
    if (scrollFrame != null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (following()) scrollBottomNow();
    });
  };
  const requestSpring = () => {
    if (!spring() || !following() || springState.owner !== "app") return;
    const live = options.live?.() ?? false;
    if (!live) {
      const target = maxScrollTop();
      setScrollTop(target);
      springState = rebaseTailFollowState(springState, target, "app");
    }
    if (springFrame != null) return;
    if (scrollFrame != null) { cancelAnimationFrame(scrollFrame); scrollFrame = null; }
    springFrame = requestAnimationFrame((now) => {
      springFrame = null;
      if (!spring() || !following() || springState.owner !== "app") return;
      const target = maxScrollTop();
      // A persisted transcript is already complete: its tail is kept pinned while lazy Markdown resolves. The spring
      // is for live output, where the target moves continuously and a snap would fight the display cadence.
      if (!(options.live?.() ?? false)) {
        setScrollTop(target);
        springState = rebaseTailFollowState(springState, target, "app");
      }
      const current = vp().scrollTop;
      const frame = advanceTailFollow(springState, target, now, current);
      springState = frame.state;
      if (!frame.rebased && Math.abs(frame.nextScrollTop - current) > 0.05) setScrollTop(frame.nextScrollTop);
      step();
      const stillMoving = Math.abs(target - frame.nextScrollTop) > 0.25 || Math.abs(springState.velocity) > 1;
      if (following() && spring() && springState.owner === "app" && stillMoving) requestSpring();
    });
  };
  /** Follow the foot as it is now: the spring's step, or a snap at the next frame. */
  const request = () => { if (spring()) requestSpring(); else scrollBottom(); };
  /** Back to following from where the view is (a chat opened, the renderer changed). */
  const resume = () => {
    setFollowing(true);
    if (!spring()) return void scrollBottom();
    cancelRejoin();
    springState = createTailFollowState(scrollTop(), "app");
    requestSpring();
  };
  /** Settle on the foot once laid out (fonts in, Markdown resolved): following only. */
  const settle = () => {
    if (!following()) return;
    if (spring()) requestSpring(); else scrollBottomNow();
  };
  // Sending and Scroll to latest are both a request to watch the answer arrive: the view follows from the press, and
  // the tail follow takes it from where the glide lands.
  const followLatest = () => {
    setFollowing(true);
    glideToLatest(() => { setFollowing(true); resume(); });
  };
  /** The reader lets go of the tail (a disclosure opened, history paged in above): it stays where it is. */
  const release = () => { cancelRejoin(); if (spring()) setOwner("user", true); setFollowing(false); };

  let readerScroll = (top: number) => { vp().scrollTop = top; };

  /** Clear the composer docked over its foot (dock) by its measured height (dock-inset.ts) on root, following through
   *  each change; onDock after each (a Scroll to latest riding above it re-anchored). Returns its undo. */
  const clearUnder = (root: HTMLElement, dock: HTMLElement, onDock?: () => void) => clearDock(root, dock, () => {
    // Reserve and follow in the same resize delivery, before paint.
    if (following()) setScrollTop(maxScrollTop(), false);
    onDock?.();
  });

  /** Mount it on the viewport and what it scrolls (the transcript's content box): call in onMount. root and dock: the
   *  host and its composer dock, the composer cleared by its height (onDock after each change, as a Scroll to latest
   *  riding above it is re-anchored). */
  const attach = (target: { viewport: HTMLElement; thread: HTMLElement; root?: HTMLElement; dock?: HTMLElement | null; onDock?: () => void }) => {
    attached = target.viewport;
    const viewport = target.viewport;
    const thread = target.thread;
    const stopClearingDock = target.root && target.dock ? clearUnder(target.root, target.dock, target.onDock) : null;

    /*
     * The keyboard takes height from the bottom, so the transcript gives it back from the top -- driven by the
     * scroller's own height (a ResizeObserver, once a frame, already measured), never the visual viewport, which is
     * the keyboard's destination and lurches it the whole distance at once. The position asked for is held unclamped
     * (the browser clamps scrollTop as the scroller grows, and the clamp ate ten pixels every travel), and as a
     * distance from the bottom, the one quantity a shrinking scroller and its shrinking content both leave alone.
     * The content's own change follows the scroller's inside the same travel only (TRAVEL_MS): content arriving at
     * the bottom outside one must not be chased.
     */
    const TRAVEL_MS = 500;
    let lastScrollerHeight = 0, lastContentHeight = 0, travellingUntil = 0;
    let intendedScrollTop = -1, heldGap = -1;
    const holdAgainstKeyboard = (height: number) => {
      const content = viewport.scrollHeight;
      const boxMoved = Math.abs(height - lastScrollerHeight) >= 1;
      const contentMoved = Math.abs(content - lastContentHeight) >= 1;
      lastScrollerHeight = height;
      lastContentHeight = content;
      if (boxMoved) travellingUntil = performance.now() + TRAVEL_MS;
      if (!boxMoved && !(contentMoved && performance.now() < travellingUntil)) return;
      if (following()) { setScrollTop(maxScrollTop(), false); intendedScrollTop = -1; heldGap = -1; return; }
      // Scrolled up (Scroll to latest showing): the keyboard comes up over the transcript and it does not move
      // (components/ui/keyboard-travel.ts).
      if (latestAway() || viewport.hasAttribute("data-keyboard-away")) { intendedScrollTop = -1; heldGap = -1; return; }
      const max = Math.max(0, content - height);
      const clamped = Math.max(0, Math.min(maxScrollTop(), intendedScrollTop));
      if (heldGap < 0 || intendedScrollTop < 0 || Math.abs(viewport.scrollTop - clamped) > 1) heldGap = max - viewport.scrollTop;
      intendedScrollTop = max - heldGap;
      setScrollTop(Math.max(0, Math.min(maxScrollTop(), intendedScrollTop)), false);
    };
    const scrollerSizes = new ResizeObserver(() => { holdAgainstKeyboard(viewport.clientHeight); syncLatestDistance(); });
    scrollerSizes.observe(viewport);
    scrollerSizes.observe(thread);

    // When the reader last did something that can move the view: a wheel (a trackpad's momentum keeps sending them),
    // any key, a touch and the fling after it, a press held in it (a scrollbar drag, a selection dragged past the
    // edge), focus moving in it, and Find from when it opens until the page has focus again. A move up inside that is
    // theirs.
    let readerUntil = 0, finding = false;
    // Whether it laid out again since the last scroll: a move up the page made itself follows a layout change.
    let laidOut = false;
    const reading = (ms: number) => { readerUntil = Math.max(readerUntil, performance.now() + ms); };
    const byReader = () => finding || performance.now() <= readerUntil;
    const claimUserScroll = () => {
      if (empty() || !spring()) return;
      programmaticScrollTop = null;
      cancelRejoin();
      setOwner("user", true);
    };
    readerScroll = (top) => { cancelGlide(); reading(800); claimUserScroll(); viewport.scrollTop = Math.round(top); };
    const onWheel = (event: WheelEvent) => {
      reading(300);
      claimUserScroll();
      // Wheeling down at the bottom moves nothing, so no scroll event would hand the tail back: hand it back here.
      if (event.deltaY > 0 && maxScrollTop() - viewport.scrollTop <= TAIL_REJOIN_PX) { setFollowing(true); scheduleRejoin(); }
    };
    const onScroll = () => {
      const max = maxScrollTop();
      setLatestDistance(Math.max(0, max - viewport.scrollTop));
      if (empty()) { setFollowing(true); previousScrollTop = viewport.scrollTop; previousMaxScrollTop = max; return; }
      // The glide to the latest is not the reader scrolling: its frames neither drop nor decide the follow.
      if (latestGlide != null || (programmaticScrollTop != null && Math.abs(viewport.scrollTop - programmaticScrollTop) < 1)) {
        programmaticScrollTop = null; previousScrollTop = viewport.scrollTop; previousMaxScrollTop = max; return;
      }
      const wasProgrammatic = programmaticScrollTop != null;
      programmaticScrollTop = null;
      const decision = decideTailScroll({ scrollTop: viewport.scrollTop, previousScrollTop, maxScrollTop: max, previousMaxScrollTop, userOwned: springState.owner === "user", following: following() });
      previousScrollTop = viewport.scrollTop;
      previousMaxScrollTop = max;
      // A move up with no reader behind it is the page, not them (the browser keeping a block in place as one above
      // it shrank): following, the tail just carries on to the bottom.
      const relaid = laidOut;
      laidOut = false;
      if (decision.direction === "up" && following() && relaid && !byReader()) { request(); step(); return; }
      if (decision.direction === "up") { cancelRejoin(); if (!wasProgrammatic) claimUserScroll(); }
      if (!spring() || springState.owner === "user" || !following()) setFollowing(decision.following);
      else if (decision.direction === "up") setFollowing(false);
      if (spring() && decision.rejoin) scheduleRejoin();
      step();
    };
    let touching = false;
    const onTouchStart = () => { touching = true; reading(60_000); claimUserScroll(); cancelGlide(); };
    // A fling carries on after the finger lifts.
    const onTouchEnd = () => { if (!touching) return; touching = false; readerUntil = performance.now() + 2000; };
    let dragging = false;
    const onPointerDown = (event: PointerEvent) => {
      finding = false; dragging = true; reading(60_000);
      // A scrollbar drag lands on the viewport itself, outside any content box.
      if (event.target === viewport) claimUserScroll();
    };
    const onPointerUp = () => { if (!dragging) return; dragging = false; readerUntil = performance.now() + 300; };
    const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
    const onKeyDown = (event: KeyboardEvent) => {
      // Find is the page's wherever it is pressed; any other key only from the transcript itself (or nothing focused),
      // not from typing in the composer.
      if ((event.key === "f" || event.key === "g") && (event.ctrlKey || event.metaKey) || event.key === "F3") { finding = true; return; }
      const from = event.target as Node | null;
      if (from !== document.body && !(from && viewport.contains(from))) return;
      reading(800);
      if (SCROLL_KEYS.has(event.key)) claimUserScroll();
    };
    const onFocusIn = () => reading(500);
    const onPageFocus = () => { finding = false; };
    const onWheelGlide = () => cancelGlide();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("wheel", onWheelGlide, { passive: true });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    viewport.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown, { passive: true, capture: true });
    viewport.addEventListener("focusin", onFocusIn, { passive: true });
    window.addEventListener("focus", onPageFocus);
    // Following, what it holds growing takes the view down with it -- unless something else is moving it (holding):
    // chasing a virtualizer's own resizes is a feedback loop, and a panel reflow keeps its own anchor.
    const contentSizes = new ResizeObserver(() => {
      laidOut = true;
      if (!following() || options.holding?.()) return;
      request();
    });
    contentSizes.observe(thread);
    onCleanup(() => {
      contentSizes.disconnect();
      scrollerSizes.disconnect();
      stopClearingDock?.();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("wheel", onWheelGlide);
      viewport.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      viewport.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focus", onPageFocus);
      if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
      cancelSpringFrame();
      cancelRejoin();
      cancelGlide();
    });
  };

  return {
    following, setFollowing, latestDistance, latestAway, syncLatestDistance,
    scrollTop, maxScrollTop, setScrollTop, scrollBottom, scrollBottomNow,
    request, resume, settle, followLatest, release, setOwner, cancelRejoin, cancelSpringFrame, cancelGlide,
    /** Move the view as the reader's own scroll (a cursor, Find): the follow lets go if it is up. */
    readerScroll: (top: number) => readerScroll(top),
    attach, clearUnder,
  };
}
export type TranscriptFollow = ReturnType<typeof createTranscriptFollow>;
