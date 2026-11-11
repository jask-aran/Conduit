export type TailFollowOwner = "app" | "user";

export type TailFollowState = {
  targetScrollTop: number;
  position: number;
  velocity: number;
  lastTimeMs: number | null;
  owner: TailFollowOwner;
  lastTarget: number | null;
  lastWritten: number | null;
  targetDeltaEma: number;
};

export type TailFollowFrame = {
  state: TailFollowState;
  nextScrollTop: number;
  rebased: boolean;
};

export const TYPEWRITER_TAIL_RESPONSE = 14;
// A fraction of the target's movement between frames feeds the spring's velocity, so newly wrapped text does not wait
// behind a stale viewport; the spring still owns the remaining distance and prevents a catch-up snap.
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
    lastTarget: null,
    lastWritten: null,
    targetDeltaEma: 0,
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

/** The DOM scroll position is the authority each frame, so browser anchoring and a user handoff cannot leave the
 *  controller stale. */
export function advanceTailFollow(
  state: TailFollowState,
  targetScrollTop: number,
  nowMs: number,
  actualScrollTop: number,
): TailFollowFrame {
  const target = Math.max(0, targetScrollTop);
  const actual = Math.max(0, actualScrollTop);
  // The target's own movement since the last frame: what it moved, less what the browser moved the scroll by itself.
  const targetDelta = (state.lastTarget == null ? 0 : target - state.lastTarget)
    - (state.lastWritten == null ? 0 : actualScrollTop - state.lastWritten);
  const magnitude = Math.abs(targetDelta);
  const feedForwardPx = state.targetDeltaEma > 0 ? Math.sign(targetDelta) * Math.min(magnitude, state.targetDeltaEma * 2) : 0;
  const targetDeltaEma = magnitude > 0
    ? state.targetDeltaEma > 0 ? state.targetDeltaEma * 0.75 + magnitude * 0.25 : magnitude
    : state.targetDeltaEma;
  const frameIntervalMs = state.lastTimeMs == null ? null : nowMs - state.lastTimeMs;
  const baseState = {
    ...state,
    targetScrollTop: target,
    position: actual,
    lastTimeMs: nowMs,
    lastTarget: target,
    targetDeltaEma,
  };

  if (state.owner === "user" || frameIntervalMs == null || frameIntervalMs > TYPEWRITER_TAIL_MAX_FRAME_GAP_MS || frameIntervalMs < 0) {
    const rebased = frameIntervalMs != null && (frameIntervalMs > TYPEWRITER_TAIL_MAX_FRAME_GAP_MS || frameIntervalMs < 0);
    return { state: { ...baseState, velocity: 0, lastWritten: actual }, nextScrollTop: actual, rebased };
  }

  const dt = Math.min(TYPEWRITER_TAIL_MAX_FRAME_GAP_MS, Math.max(0.5, frameIntervalMs)) / 1000;
  const response = TYPEWRITER_TAIL_RESPONSE;
  const error = actual - target;
  const effectiveVelocity = state.velocity + feedForwardPx * response * TYPEWRITER_TAIL_TARGET_FEED_FORWARD;
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
  // Sub-pixel steps written rounded would not move it, stopping 8px short; a step rounding to nothing takes a whole pixel.
  let nextScrollTop = nextPosition;
  const step = nextScrollTop - actual;
  if (Math.abs(step) > 0.05 && Math.round(nextScrollTop) === Math.round(actual)) {
    nextScrollTop = step > 0 ? Math.min(target, actual + 1) : Math.max(target, actual - 1);
    // Landed on the target, it has arrived; kept moving, its speed would carry it past next frame.
    if (nextScrollTop === target) { nextPosition = target; velocity = 0; }
  }

  return {
    state: { ...baseState, position: nextPosition, velocity, lastWritten: nextScrollTop },
    nextScrollTop,
    rebased: false,
  };
}

export const TAIL_NEAR_LATEST_PX = 80;
/** Far tighter than TAIL_NEAR_LATEST_PX, since being close to the bottom is not consent to be pulled to it. */
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
  settled?: boolean;
}) {
  // A page that barely overflows cannot be scrolled up far enough to ask for more, so once laid out it asks itself.
  if (input.settled && input.maxScrollTop < HISTORY_LOAD_TOP_PX) return true;
  if (input.following || input.maxScrollTop <= 0) return false;
  return input.scrollTop < HISTORY_LOAD_TOP_PX;
}

export function shouldRestoreHistoryAnchor(following: boolean) {
  return !following;
}

export function shouldFollowAfterHistoryRestore(distanceFromBottom: number) {
  return distanceFromBottom <= TAIL_NEAR_LATEST_PX;
}

const TAIL_CLAMP_TOLERANCE_PX = 1;

export type TailScrollInput = {
  scrollTop: number;
  previousScrollTop: number | null;
  maxScrollTop: number;
  previousMaxScrollTop?: number | null;
  userOwned: boolean;
  following: boolean;
};

export type TailScrollDecision = {
  direction: "up" | "down" | "none" | "clamp";
  distanceFromBottom: number;
  nearLatest: boolean;
  atBottom: boolean;
  following: boolean;
  rejoin: boolean;
};

/**
 * An upward move drops following at once and never schedules a rejoin, however close to the bottom it ends: scrolling
 * up passes through the near-latest band. Except the browser's own clamp: content above can get shorter mid-generation
 * (KaTeX replacing a taller placeholder), clamping scrollTop down to the new bottom; a move up no larger than the
 * shrink that lands on the new bottom is that clamp, not a handoff.
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
