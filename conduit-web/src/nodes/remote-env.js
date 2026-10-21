import { err, ExecutionError, FileError } from "@earendil-works/pi-durable/env";
import { decode, encode, HANDLE_METHODS, METHOD_GRANTS } from "./protocol.js";

// A read asked again after the device reconnects returns what it would have.
const RETRY_ON_RECONNECT = new Set(Object.entries(METHOD_GRANTS)
  .filter(([method, rule]) => rule.grant === "read" && method !== "watch").map(([method]) => method));

/**
 * A pi-durable execution environment on another device (plan decision 5).
 *
 * Every method is one call over the device's node socket, run there in `cwd`;
 * the device checks it against what it shares. The coding tools cannot tell
 * this from the local environment. A device that is offline is waited for
 * (the turn shows what it waits on); a call cut off by a disconnect is a read
 * asked again, or for anything that changes the device, an error that says
 * so, since whether it ran is unknown.
 */
export class RemoteExecutionEnv {
  constructor({ hub, nodeId, cwd, onWait }) {
    this.hub = hub;
    this.nodeId = nodeId;
    this.cwd = cwd;
    this.id = `conduit-node:${nodeId}`;
    this.onWait = onWait;
    for (const method of Object.keys(METHOD_GRANTS)) {
      if (method === "exec" || method === "watch") continue;
      this[method] = (...args) => this.call("env", method, args.slice(0, -1), args.at(-1));
    }
  }

  async call(target, method, args, context, onEvent) {
    for (;;) {
      try {
        const value = await this.hub.call(this.nodeId, { target, method, args: encode(args), cwd: this.cwd }, context,
          { onEvent, onWait: this.onWait });
        return decode(value, { FileError, ExecutionError, handle: (ref) => this.handle(ref) });
      } catch (error) {
        if (error?.interrupted && target === "env" && RETRY_ON_RECONNECT.has(method) && !context.abortSignal?.aborted) continue;
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

  async cleanup() {}
}
