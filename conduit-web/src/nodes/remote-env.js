import crypto from "node:crypto";
import { withAbortSignal } from "@earendil-works/chord/context";
import { err, ExecutionError, FileError } from "@earendil-works/pi-durable/env";
import { decode, encode, HANDLE_METHODS, METHOD_GRANTS } from "./protocol.js";

// A read asked again after the device reconnects returns what it would have.
const RETRY_ON_RECONNECT = new Set(Object.entries(METHOD_GRANTS)
  .filter(([method, rule]) => rule.grant === "read" && method !== "watch").map(([method]) => method));
// A write or a command is an action: asked again by its id, the device answers from its receipt.
const ACTIONS = new Set(Object.entries(METHOD_GRANTS)
  .filter(([, rule]) => rule.grant === "write" || rule.grant === "shell").map(([method]) => method));

/**
 * A pi-durable execution environment on another device (plan decision 5).
 *
 * Every method is one call over the device's node socket, run there in `cwd`;
 * the device checks it against what it shares. The coding tools cannot tell
 * this from the local environment. A device that is offline is waited for
 * (the turn shows what it waits on). A call cut off by a disconnect is asked
 * again once the device is back: a read simply, a write or command by its
 * action id, which the device answers from its receipt -- the command having
 * kept running meanwhile, its output resumed where it broke off. Only a
 * device that restarted meanwhile cannot say; the outcome is reported as
 * unknown, never retried blind. A conversation told to go on without the
 * device (`excuse`, decision 21) stops waiting: each call says the device is
 * unavailable until it is back.
 */
export class RemoteExecutionEnv {
  /**
   * `place` is where calls run, `{ root, path }`: a root the device shares,
   * by id, and a path inside it. `cwd` is only how that place reads to people
   * and the model (the device's own path); nothing is sent by it.
   */
  constructor({ hub, nodeId, place, cwd, onWait, excuse = null }) {
    this.hub = hub;
    this.excuse = excuse;
    this.nodeId = nodeId;
    this.place = place;
    this.cwd = cwd;
    this.id = `conduit-node:${nodeId}`;
    this.onWait = onWait;
    for (const method of Object.keys(METHOD_GRANTS)) {
      if (method === "exec" || method === "watch") continue;
      this[method] = (...args) => this.call("env", method, args.slice(0, -1), args.at(-1));
    }
  }

  async call(target, method, args, context, onEvent) {
    const action = target === "env" && ACTIONS.has(method) ? `a_${crypto.randomUUID()}` : null;
    // Which run of the device took the action, and the next event it owes.
    let boot;
    const unavailable = () => {
      // One the device had already taken may have run on there: say so.
      const message = `${this.excuse.name() || "This device"} is unavailable: the user chose to continue without it`
        + `${boot !== undefined ? "; whether this one finished there is unknown" : ""}. `
        + "Do not try it again in this turn; say what is left to do there.";
      return err(method === "exec" ? new ExecutionError("unknown", message) : new FileError("unknown", message));
    };
    if (this.excuse?.excused()) return unavailable();
    // Waiting for the device ends when the user goes on without it, as well as when the turn stops.
    const waiting = this.excuse ? withAbortSignal(this.excuse.signal(), context) : context;
    let from = 0;
    const heard = action ? (event) => {
      if (event.seq < from) return;
      from = event.seq + 1;
      onEvent?.(event);
    } : onEvent;
    for (;;) {
      try {
        const value = await this.hub.call(this.nodeId,
          { target, method, args: encode(args), cwd: this.place, ...(action ? { action, from } : {}) }, waiting,
          { onEvent: heard, onWait: this.onWait, ...(action ? { onSent: (sent) => { boot ??= sent; }, ...(boot !== undefined ? { boot } : {}) } : {}) });
        return decode(value, { FileError, ExecutionError, handle: (ref) => this.handle(ref) });
      } catch (error) {
        if (this.excuse?.excused() && !context.abortSignal?.aborted) return unavailable();
        if (error?.interrupted && target === "env" && RETRY_ON_RECONNECT.has(method) && !context.abortSignal?.aborted) continue;
        // A device that keeps receipts is asked what became of the action; one without them, or restarted, cannot say.
        if (error?.interrupted && action && boot && !context.abortSignal?.aborted) continue;
        if ((error?.interrupted && action) || error?.restarted) {
          const what = method === "exec" ? "command" : "change";
          const message = `The device ${error?.restarted ? "restarted" : "disconnected"} during this ${what}; whether it finished is unknown`;
          return err(method === "exec" ? new ExecutionError("unknown", message) : new FileError("unknown", message));
        }
        if (context.abortSignal?.aborted && action && boot) {
          // Stopped between sockets: the action still runs on the device, so stop it there if it is back.
          const node = this.hub.live.get(this.nodeId);
          if (node?.ready && node.boot === boot) node.send({ type: "abort", action });
        }
        if (context.abortSignal?.aborted) return err(method === "exec" ? new ExecutionError("aborted", "Aborted") : new FileError("aborted", "Aborted"));
        return err(method === "exec" ? new ExecutionError("unknown", error.message) : new FileError("unknown", error.message));
      }
    }
  }

  /** A reader or watcher the device holds open, as an object whose methods are calls on it. */
  handle({ $handle, ...props }) {
    const object = { ...props };
    for (const method of HANDLE_METHODS) object[method] = (...args) => this.call($handle, method, args.slice(0, -1), args.at(-1));
    // Closing what the device already dropped is not an error.
    const close = object.close;
    object.close = async (context) => { await close(context); };
    return object;
  }

  exec(command, options = {}, context) {
    const { onOutput, ...rest } = options || {};
    return this.call("env", "exec", [command, rest], context, (event) => {
      if (event.kind === "output") onOutput?.(event.text, context, decode(event.info, { FileError, ExecutionError }));
    });
  }

  watch(targets, onChange, context) {
    return this.call("env", "watch", [targets], context, (event) => {
      if (event.kind === "change") onChange(decode(event.change, { FileError, ExecutionError }));
    });
  }

  // Not served (see protocol.js): the device's temp directory is outside its roots.
  async createTempDir() { return err(new FileError("not_supported", "Temporary files are not created on a device")); }
  async createTempFile() { return err(new FileError("not_supported", "Temporary files are not created on a device")); }

  async cleanup() {}
}
