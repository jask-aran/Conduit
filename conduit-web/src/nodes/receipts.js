import crypto from "node:crypto";

const KEEP_DONE_MS = 30 * 60_000;
const MAX_RECEIPTS = 500;
const MAX_EVENT_BYTES = 1024 * 1024;

/**
 * An action's work belongs to the node, not to the socket that asked: asked again after a reconnect, it is answered
 * from the receipt instead of done twice. Receipts do not survive a restart, so main, seeing another boot, reports the
 * outcome as unknown rather than asking again.
 */
export class Receipts {
  constructor() {
    this.boot = `boot_${crypto.randomUUID()}`;
    this.items = new Map();
  }

  follow(action, from, listener, start) {
    let receipt = this.items.get(action);
    if (!receipt) {
      receipt = { events: [], first: 0, bytes: 0, done: false, result: undefined, listener: null, controller: new AbortController(), timer: null };
      this.items.set(action, receipt);
      this.trim();
      const emit = (event) => {
        const seq = receipt.first + receipt.events.length;
        const numbered = { ...event, seq };
        receipt.events.push(numbered);
        receipt.bytes += JSON.stringify(numbered).length;
        while (receipt.bytes > MAX_EVENT_BYTES && receipt.events.length > 1) {
          receipt.bytes -= JSON.stringify(receipt.events.shift()).length;
          receipt.first += 1;
        }
        receipt.listener?.event(numbered);
      };
      Promise.resolve()
        .then(() => start(emit, receipt.controller.signal))
        .catch((error) => ({ failure: error?.message || String(error) }))
        .then((result) => {
          receipt.done = true;
          receipt.result = result;
          receipt.listener?.result(result);
          receipt.listener = null;
          receipt.timer = setTimeout(() => this.items.delete(action), KEEP_DONE_MS);
          receipt.timer.unref?.();
        });
    } else {
      for (const event of receipt.events) if (event.seq >= from) listener.event(event);
    }
    if (receipt.done) listener.result(receipt.result);
    else receipt.listener = listener;
    return {
      // The socket went: the work goes on, nobody hears it until asked again.
      drop: () => { if (receipt.listener === listener) receipt.listener = null; },
      abort: () => receipt.controller.abort(),
    };
  }

  abort(action) { this.items.get(action)?.controller.abort(); }

  trim() {
    if (this.items.size <= MAX_RECEIPTS) return;
    for (const [action, receipt] of this.items) {
      if (!receipt.done) continue;
      clearTimeout(receipt.timer);
      this.items.delete(action);
      if (this.items.size <= MAX_RECEIPTS) return;
    }
  }
}
