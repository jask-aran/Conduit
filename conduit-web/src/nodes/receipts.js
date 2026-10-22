import crypto from "node:crypto";

const KEEP_DONE_MS = 30 * 60_000;
const MAX_RECEIPTS = 500;
const MAX_EVENT_BYTES = 1024 * 1024;

/**
 * What this node did for each action main asked of it (plan: "How far do we
 * go on knowing whether a cut-off action happened?").
 *
 * A call that changes the device -- a write, a command -- carries an action
 * id. Its work belongs to the node, not to the socket that asked: a dropped
 * socket leaves it running, and main asking the same action again (after a
 * reconnect) is answered from the receipt -- its events from where main's
 * copy ended, then its result -- instead of doing it twice. `boot` names this
 * run of the node: receipts do not survive a restart, so main, seeing another
 * boot, reports the outcome as unknown rather than asking again.
 *
 * Events are numbered; a long command's oldest output is dropped past a
 * bound, and a replay from before it starts at what is left.
 */
export class Receipts {
  constructor() {
    this.boot = `boot_${crypto.randomUUID()}`;
    this.items = new Map();
  }

  /**
   * Answer `action` through `listener` ({ event, result }): start it with
   * `start(context-free emit, signal)` if it is new, else replay from `from`.
   */
  follow(action, from, listener, start) {
    let receipt = this.items.get(action);
    if (!receipt) {
      receipt = { events: [], first: 0, bytes: 0, result: undefined, listener: null, controller: new AbortController(), timer: null };
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
          receipt.result = result;
          receipt.listener?.result(result);
          receipt.listener = null;
          receipt.timer = setTimeout(() => this.items.delete(action), KEEP_DONE_MS);
          receipt.timer.unref?.();
        });
    } else {
      for (const event of receipt.events) if (event.seq >= from) listener.event(event);
    }
    if (receipt.result !== undefined) listener.result(receipt.result);
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
      if (receipt.result === undefined) continue;
      clearTimeout(receipt.timer);
      this.items.delete(action);
      if (this.items.size <= MAX_RECEIPTS) return;
    }
  }
}
