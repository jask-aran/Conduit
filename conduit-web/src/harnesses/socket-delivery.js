/**
 * Paint may be merged and may be dropped, an op may be neither: `message.close` restates the message in full. So paint
 * is merged per frame and given up under pressure, and everything else is sent the moment it is published.
 */

/**
 * A frame at 144Hz: the browser applies a frame synchronously as it lands, so this is the whole of the reader's frame
 * budget. A browser measures its own refresh on connect, and `setFrameInterval` replaces this for that socket.
 */
export const DELIVERY_FLUSH_MS = 8;

/**
 * The floor is a 240Hz panel. The ceiling keeps a throttled or misreporting tab from pacing the stream down to a crawl,
 * and costs little, since the first frame after a quiet moment never waits.
 */
const MIN_FRAME_MS = 4;
const MAX_FRAME_MS = 50;

export const clampFrameMs = (ms) => (Number.isFinite(Number(ms))
  ? Math.min(MAX_FRAME_MS, Math.max(MIN_FRAME_MS, Math.round(Number(ms))))
  : null);
const SOCKET_HIGH_WATER_MARK = 256 * 1024;

const isOpen = (socket) => socket?.readyState === 1;

const bufferedAmount = (socket) => {
  const amount = Number(socket?.bufferedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/** A tool's partial output replaces what came before it, since each update restates the output so far. */
export function deliveryKey(event) {
  if (event?.type === "assistant_content" && event.phase === "delta") {
    return `text:${event.generationId}:${event.messageId}:${event.blockKind}:${event.contentIndex ?? 0}`;
  }
  if (event?.type === "tool_activity" && event.phase === "update") {
    return `tool:${event.generationId}:${event.toolCallId}`;
  }
  return null;
}

/**
 * Merging is only defined for a delta and a tool's partial output, so `deliveryKey` answers a narrower question than
 * "may this be dropped". All paint is restated by `message.close` and `tool.close`, so all of it may be given up.
 */
export const isPaint = (event) => event?.type === "assistant_content" || event?.type === "tool_activity";

export function mergeDelivery(previous, next) {
  // What an earlier delta said beside its text -- a call's name, a text's label -- stays: only the text is joined.
  if (next.type === "assistant_content") return { ...previous, ...next, delta: `${previous.delta || ""}${next.delta || ""}` };
  return next;
}

export class SocketDelivery {
  constructor({ flushMs = DELIVERY_FLUSH_MS, highWaterMark = SOCKET_HIGH_WATER_MARK } = {}) {
    this.flushMs = flushMs;
    this.highWaterMark = highWaterMark;
    this.states = new WeakMap();
    // One event goes to every socket attached to a record, so it is serialized
    // once rather than once per reader.
    this.payloads = new WeakMap();
  }

  serialize(event) {
    if (typeof event !== "object" || event === null) return JSON.stringify(event);
    const cached = this.payloads.get(event);
    if (cached !== undefined) return cached;
    const payload = JSON.stringify(event);
    this.payloads.set(event, payload);
    return payload;
  }

  stateFor(socket) {
    let state = this.states.get(socket);
    if (!state) {
      state = { pending: new Map(), order: [], timer: null, lastFlush: 0, flushMs: this.flushMs };
      this.states.set(socket, state);
    }
    return state;
  }

  detach(socket) {
    const state = this.states.get(socket);
    if (state?.timer) clearTimeout(state.timer);
    this.states.delete(socket);
  }

  send(socket, event) {
    if (!isOpen(socket)) return this.detach(socket);
    const key = deliveryKey(event);
    if (key) {
      const state = this.stateFor(socket);
      const previous = state.pending.get(key);
      if (previous) state.pending.set(key, mergeDelivery(previous, event));
      else { state.pending.set(key, event); state.order.push(key); }
      if (!state.timer) {
        const since = Date.now() - state.lastFlush;
        const flushMs = state.flushMs;
        // The first paint after a quiet moment has nothing to merge with, and at ordinary token rates deltas arrive
        // further apart than a frame: it goes out now, and only a stream arriving faster than a frame waits.
        if (since >= flushMs) { this.flush(socket); return; }
        // A frame after the last send rather than after this arrival, so a burst keeps one cadence.
        state.timer = setTimeout(() => this.flush(socket), flushMs - since);
        state.timer.unref?.();
      }
      return;
    }
    // Paint the socket is already holding goes out first, so an op never
    // overtakes the text it is closing.
    this.flush(socket);
    if (!isOpen(socket)) return;
    // The record is sent whatever the backlog; paint is not.
    if (isPaint(event) && bufferedAmount(socket) > this.highWaterMark) return;
    socket.send(this.serialize(event));
  }

  setFrameInterval(socket, ms) {
    const flushMs = clampFrameMs(ms);
    if (flushMs === null) return null;
    this.stateFor(socket).flushMs = flushMs;
    return flushMs;
  }

  flush(socket) {
    const state = this.states.get(socket);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.lastFlush = Date.now();
    const pending = state.order.map((key) => state.pending.get(key)).filter(Boolean);
    state.pending.clear();
    state.order = [];
    if (!isOpen(socket)) return this.detach(socket);
    // A socket this far behind cannot draw what it already has: the paint is given up, and the message that closes
    // states the whole text, so the reader loses a repaint, not words.
    if (bufferedAmount(socket) > this.highWaterMark) return;
    for (const event of pending) {
      if (!isOpen(socket)) return this.detach(socket);
      socket.send(this.serialize(event));
    }
  }
}
