/**
 * How a record's events reach a browser socket, for every harness.
 *
 * Pi has had this for a long time -- deltas merged per frame, a high-water mark
 * that stops piling onto a socket that is not keeping up -- and it is most of
 * why a Pi turn reads at the speed of a terminal. Every other harness published
 * straight into `socket.send` one event at a time, so a fast Codex turn put a
 * frame's worth of syscalls and a frame's worth of renders where Pi would have
 * put one of each.
 *
 * What makes the simple version correct is the contract's own distinction:
 * paint may be merged and may be dropped, an op may be neither. This is where
 * those two of the four promises are kept -- the other two, "never authoritative"
 * and "never numbered", are kept by `message.close` restating the message in
 * full and by the chat log leaving paint out. They are stated once, beside
 * `AssistantBlock` in `chat-backend-contract.d.ts`. So paint is merged per
 * frame and given up under pressure, and everything else is sent the moment it
 * is published, backlog or not.
 *
 * This is deliberately not Pi's implementation. Pi pauses a slow socket and
 * recovers it by restating the running generation, which it can do because it
 * holds one; a harness that holds no such thing cannot, and would have had to
 * grow one to share the code. The rule above needs neither.
 */

export const DELIVERY_FLUSH_MS = 16;
export const SOCKET_HIGH_WATER_MARK = 256 * 1024;

const isOpen = (socket) => socket?.readyState === 1;

const bufferedAmount = (socket) => {
  const amount = Number(socket?.bufferedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/**
 * The block an event is painting, or null if it is not paint.
 *
 * Text and reasoning deltas merge by concatenation; a tool's partial output
 * replaces what came before it, since each update restates the output so far.
 */
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
 * Whether this event is paint at all, in any phase.
 *
 * Merging is only defined for a delta and a tool's partial output, so
 * `deliveryKey` answers a narrower question than "may this be dropped". The
 * two were the same test for a while, which meant a message starting, a
 * message finishing and every tool starting or ending went straight to
 * `socket.send` however far behind the reader was -- so a tool-heavy turn kept
 * piling onto a socket the rule was written to stop piling onto. All of it is
 * restated by `message.close` and `tool.close`, so all of it may be given up.
 */
export const isPaint = (event) => event?.type === "assistant_content" || event?.type === "tool_activity";

export function mergeDelivery(previous, next) {
  if (next.type === "assistant_content") return { ...next, delta: `${previous.delta || ""}${next.delta || ""}` };
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
      state = { pending: new Map(), order: [], timer: null };
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
        state.timer = setTimeout(() => this.flush(socket), this.flushMs);
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

  flush(socket) {
    const state = this.states.get(socket);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    const pending = state.order.map((key) => state.pending.get(key)).filter(Boolean);
    state.pending.clear();
    state.order = [];
    if (!isOpen(socket)) return this.detach(socket);
    // A socket this far behind cannot draw what it already has, so adding to
    // the queue only makes it later. The paint is given up; the message that
    // closes will state the whole text and the reader loses a repaint, not
    // words.
    if (bufferedAmount(socket) > this.highWaterMark) return;
    for (const event of pending) {
      if (!isOpen(socket)) return this.detach(socket);
      socket.send(this.serialize(event));
    }
  }
}
