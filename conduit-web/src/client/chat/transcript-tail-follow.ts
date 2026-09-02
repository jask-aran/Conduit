export type TailFollowOwner = "app" | "user";

export type TailFollowState = {
  targetScrollTop: number;
  position: number;
  velocity: number;
  lastTimeMs: number | null;
  owner: TailFollowOwner;
};

export type TailFollowFrame = {
  state: TailFollowState;
  actualScrollTop: number;
  nextScrollTop: number;
  movementPx: number;
  feedForwardVelocityPxPerSecond: number;
  frameIntervalMs: number | null;
  mode: "tracking" | "settled" | "rebase";
  rebased: boolean;
};

export const TYPEWRITER_TAIL_RESPONSE = 14;
// A layout commit changes the moving bottom target between frames. Add a
// fraction of that target movement to the spring velocity so newly wrapped
// text does not wait behind a completely stale viewport position. The spring
// still controls the remaining distance and prevents a catch-up snap.
export const TYPEWRITER_TAIL_TARGET_FEED_FORWARD = 0.35;
export const TYPEWRITER_TAIL_MAX_FRAME_GAP_MS = 80;
export const TYPEWRITER_TAIL_SETTLE_DISTANCE_PX = 0.25;

export function createTailFollowState(
  position = 0,
  owner: TailFollowOwner = "app",
): TailFollowState {
  return {
    targetScrollTop: Math.max(0, position),
    position: Math.max(0, position),
    velocity: 0,
    lastTimeMs: null,
    owner,
  };
}

export function rebaseTailFollowState(
  state: TailFollowState,
  position: number,
  owner: TailFollowOwner = state.owner,
): TailFollowState {
  const nextPosition = Math.max(0, position);
  return {
    ...state,
    targetScrollTop: nextPosition,
    position: nextPosition,
    velocity: 0,
    lastTimeMs: null,
    owner,
  };
}

/**
 * Advance a critically damped tail-follow trajectory. The actual DOM scroll
 * position is the authority at each frame so browser anchoring and an explicit
 * user handoff cannot leave the controller with stale state.
 */
export function advanceTailFollow(
  state: TailFollowState,
  targetScrollTop: number,
  nowMs: number,
  actualScrollTop: number,
  uncompensatedTargetDeltaPx = 0,
): TailFollowFrame {
  const target = Math.max(0, targetScrollTop);
  const actual = Math.max(0, actualScrollTop);
  const frameIntervalMs = state.lastTimeMs == null ? null : nowMs - state.lastTimeMs;
  const baseState = {
    ...state,
    targetScrollTop: target,
    position: actual,
    lastTimeMs: nowMs,
  };

  if (state.owner === "user" || frameIntervalMs == null || frameIntervalMs > TYPEWRITER_TAIL_MAX_FRAME_GAP_MS || frameIntervalMs < 0) {
    const rebased = frameIntervalMs != null && (frameIntervalMs > TYPEWRITER_TAIL_MAX_FRAME_GAP_MS || frameIntervalMs < 0);
    return {
      state: { ...baseState, velocity: 0 },
      actualScrollTop: actual,
      nextScrollTop: actual,
      movementPx: 0,
      feedForwardVelocityPxPerSecond: 0,
      frameIntervalMs,
      mode: rebased ? "rebase" : "settled",
      rebased,
    };
  }

  const dt = Math.min(TYPEWRITER_TAIL_MAX_FRAME_GAP_MS, Math.max(0.5, frameIntervalMs)) / 1000;
  const response = TYPEWRITER_TAIL_RESPONSE;
  const error = actual - target;
  const feedForwardVelocityPxPerSecond = uncompensatedTargetDeltaPx * response * TYPEWRITER_TAIL_TARGET_FEED_FORWARD;
  const effectiveVelocity = state.velocity + feedForwardVelocityPxPerSecond;
  const decay = Math.exp(-response * dt);
  const nextError = (error + (effectiveVelocity + response * error) * dt) * decay;
  const nextVelocity = (effectiveVelocity - response * (effectiveVelocity + response * error) * dt) * decay;
  let nextPosition = target + nextError;
  let velocity = nextVelocity;

  if (Math.abs(nextPosition - target) <= TYPEWRITER_TAIL_SETTLE_DISTANCE_PX && Math.abs(velocity) <= 1) {
    nextPosition = target;
    velocity = 0;
  } else {
    nextPosition = Math.max(0, nextPosition);
  }

  return {
    state: {
      ...baseState,
      position: nextPosition,
      velocity,
    },
    actualScrollTop: actual,
    nextScrollTop: nextPosition,
    movementPx: nextPosition - actual,
    feedForwardVelocityPxPerSecond,
    frameIntervalMs,
    mode: nextPosition === target ? "settled" : "tracking",
    rebased: false,
  };
}

/** Distance from the bottom within which the scroll-to-latest button hides. */
export const TAIL_NEAR_LATEST_PX = 80;
/**
 * Distance within which the app may take the tail back from the user. It is far
 * tighter than TAIL_NEAR_LATEST_PX on purpose: merely being close to the bottom
 * is not consent to be pulled to it.
 */
export const TAIL_REJOIN_PX = 8;
export const HISTORY_LOAD_TOP_PX = 240;

export function usedMaxScrollTop(input: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) {
  const naive = Math.max(0, input.scrollHeight - input.clientHeight);
  const gap = naive - input.scrollTop;
  return gap > 0 && gap <= 1 ? input.scrollTop : naive;
}

export function shouldLoadEarlierHistory(input: {
  following: boolean;
  maxScrollTop: number;
  scrollTop: number;
}) {
  if (input.following || input.maxScrollTop <= 0) return false;
  return input.scrollTop < HISTORY_LOAD_TOP_PX;
}

export function shouldRestoreHistoryAnchor(following: boolean) {
  return !following;
}

export function shouldFollowAfterHistoryRestore(distanceFromBottom: number) {
  return distanceFromBottom <= TAIL_NEAR_LATEST_PX;
}

/**
 * How close to the new bottom a clamped position has to land before an upward
 * move is read as the content shrinking rather than as a reader scrolling.
 */
export const TAIL_CLAMP_TOLERANCE_PX = 1;

export type TailScrollInput = {
  scrollTop: number;
  previousScrollTop: number | null;
  maxScrollTop: number;
  /** The scrollable distance at the previous scroll observation. */
  previousMaxScrollTop?: number | null;
  /** True once the user, not the spring, owns the scroll position. */
  userOwned: boolean;
  following: boolean;
};

export type TailScrollDecision = {
  direction: "up" | "down" | "none" | "clamp";
  distanceFromBottom: number;
  nearLatest: boolean;
  atBottom: boolean;
  /** Whether `following` should change, and to what. */
  following: boolean;
  /** Schedule the idle handoff back to the spring. */
  rejoin: boolean;
};

/**
 * Decide what a scroll event means for tail following.
 *
 * Direction is the signal the earlier version lacked. Scrolling *up* out of the
 * bottom passes through the near-latest band, and treating that band as "still
 * following" let an idle rejoin -- or the next content resize -- spring the
 * viewport back down while the user was reading. An upward move now drops
 * following immediately and never schedules a rejoin, however close to the
 * bottom it happens to end.
 *
 * Not every upward move is a reader, though. Content above the viewport can get
 * *shorter* mid-generation -- a KaTeX block replacing a taller placeholder is
 * the common one -- and when it does the browser clamps scrollTop down to the
 * new bottom on its own. That arrives as an unrequested upward move and used to
 * hand the tail to a reader who never touched anything, which is a follow that
 * detaches for good. A move up that is no larger than the shrink and lands on
 * the new bottom is that clamp, and is not a handoff.
 */
export function decideTailScroll(input: TailScrollInput): TailScrollDecision {
  const distanceFromBottom = Math.max(0, input.maxScrollTop - input.scrollTop);
  const nearLatest = distanceFromBottom < TAIL_NEAR_LATEST_PX;
  const atBottom = distanceFromBottom <= TAIL_REJOIN_PX;
  const delta = input.previousScrollTop == null ? 0 : input.scrollTop - input.previousScrollTop;
  const shrinkPx = input.previousMaxScrollTop == null
    ? 0
    : Math.max(0, input.previousMaxScrollTop - input.maxScrollTop);
  const clamped = delta < -0.5
    && shrinkPx > 0
    && -delta <= shrinkPx + TAIL_CLAMP_TOLERANCE_PX
    && distanceFromBottom <= TAIL_CLAMP_TOLERANCE_PX;
  const direction = clamped ? "clamp" : delta < -0.5 ? "up" : delta > 0.5 ? "down" : "none";
  if (direction === "up") {
    return { direction, distanceFromBottom, nearLatest, atBottom, following: false, rejoin: false };
  }
  return {
    direction,
    distanceFromBottom,
    nearLatest,
    atBottom,
    following: input.following ? nearLatest : atBottom,
    rejoin: input.userOwned && atBottom,
  };
}
