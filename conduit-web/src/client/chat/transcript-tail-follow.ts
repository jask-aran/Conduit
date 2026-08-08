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
