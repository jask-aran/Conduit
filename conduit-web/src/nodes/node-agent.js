import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { err, FileError, ExecutionError } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { encode, decode, HANDLE_METHODS, METHOD_GRANTS, NODE_PROTOCOL_VERSION, rootFor } from "./protocol.js";

const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * The node role: this device's shared folders, served to the main server.
 *
 * The node dials main and keeps one socket open, redialling when it drops.
 * Every call names the directory it runs in and is checked here, against the
 * roots and grants the device's owner chose -- read, write, shell -- before
 * the device's own execution environment runs it. File calls never reach past
 * those roots: a path that resolves (symlinks included) outside them, or
 * through a link that resolves nowhere, is refused as `permission_denied`.
 *
 * `shell` is different in kind. A command starts in a shared root but runs as
 * this device's user, with everything that user can reach; nothing here
 * sandboxes it, so granting it is granting that. (It is also what makes the
 * check-then-use gap in file calls moot: only a command can plant a link.)
 *
 * What a call opened (a reader, a watcher) lives as a handle until main closes
 * it or the socket drops. A dropped socket aborts the calls in flight: main
 * reports them interrupted rather than this device running work nobody waits
 * for.
 */
export function startNodeAgent({ mainUrl, key, name, roots: shared, shellEnv = process.env, log = console }) {
  const roots = shared.map(view);
  const envs = new Map();
  let socket = null;
  let attempt = 0;
  let stopped = false;
  let timer = null;

  const envFor = (cwd) => {
    if (!envs.has(cwd)) envs.set(cwd, new NodeExecutionEnv({ cwd, shellEnv }));
    return envs.get(cwd);
  };

  const connect = () => {
    const url = new URL("/v0/nodes/connect", mainUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${key}` } });
    socket = ws;
    const calls = new Map();
    // Handle ids are never reused, on this socket or the next: a reader main
    // still holds from before a reconnect names nothing rather than a stranger.
    const handles = new Map();
    const send = (message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };

    ws.on("open", () => {
      attempt = 0;
      send({ type: "hello", version: NODE_PROTOCOL_VERSION, name, platform: process.platform, roots });
      log.info?.(`[conduit-node] connected to ${mainUrl}`);
    });
    ws.on("message", async (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === "abort") return calls.get(message.id)?.abort();
      if (message.type === "refused") { log.error?.(`[conduit-node] main refused this node: ${message.reason}`); stopped = true; return ws.close(); }
      if (message.type !== "call") return;
      const controller = new AbortController();
      calls.set(message.id, controller);
      const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
      try {
        const value = await run(message, context);
        // Something with methods of its own stays here; main gets its name.
        const result = value?.ok && value.value && typeof value.value.close === "function"
          ? { ok: true, value: keep(value.value) } : value;
        send({ type: "result", id: message.id, value: encode(result) });
      } catch (error) {
        send({ type: "failure", id: message.id, message: error?.message || String(error) });
      } finally {
        calls.delete(message.id);
      }
    });
    ws.on("close", () => {
      for (const controller of calls.values()) controller.abort();
      for (const handle of handles.values()) void handle.close?.(BACKGROUND_CONTEXT);
      handles.clear();
      if (socket === ws) socket = null;
      if (stopped) return;
      const wait = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
      timer = setTimeout(connect, wait);
    });
    ws.on("error", (error) => { if (attempt === 0) log.warn?.(`[conduit-node] ${error.message}`); });

    function keep(object) {
      const id = `h_${crypto.randomUUID()}`;
      handles.set(id, object);
      return { $handle: id, ...(object.mode ? { mode: object.mode } : {}) };
    }

    async function run({ id, target, method, args = [], cwd }, context) {
      const decoded = decode(args, { FileError, ExecutionError });
      if (target !== "env") {
        const handle = handles.get(target);
        if (!handle || !HANDLE_METHODS.includes(method)) return err(new FileError("invalid", `No open handle ${target}`));
        const value = await handle[method](...decoded, context);
        if (method === "close") handles.delete(target);
        return value;
      }
      const rule = METHOD_GRANTS[method];
      if (!rule) return err(new FileError("not_supported", `${method} is not served by this node`));
      const home = typeof cwd === "string" ? realish(cwd) : null;
      const allowed = (target, grant) => Boolean(target && rootFor(roots, target, grant));
      if (!home || !["read", "write", "shell"].some((grant) => allowed(home, grant))) return refuse(method, cwd);
      for (const at of rule.paths) {
        if (typeof decoded[at] !== "string") continue;
        if (!allowed(realish(path.resolve(home, decoded[at])), rule.grant)) return refuse(method, decoded[at]);
      }
      if (method === "exec" && !allowed(realish(path.resolve(home, decoded[1]?.cwd || ".")), "shell")) return refuse(method, decoded[1]?.cwd || cwd);
      if (method === "watch" && decoded[0].some((item) => !allowed(realish(path.resolve(home, item.path)), "read"))) return refuse(method, "a watched path");
      const env = envFor(home);
      if (method === "exec") {
        const options = { ...(decoded[1] || {}) };
        options.onOutput = (text, _context, info) => send({ type: "event", id, kind: "output", text, info: encode(info) });
        return env.exec(decoded[0], options, context);
      }
      if (method === "watch") {
        return env.watch(decoded[0], (change) => send({ type: "event", id, kind: "change", change: encode(change) }), context);
      }
      if (typeof env[method] !== "function") return err(new FileError("not_supported", `${method} is not available on this device`));
      return env[method](...decoded, context);
    }
  };

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}

const view = (root) => ({ path: realish(root.path) || path.resolve(root.path), read: Boolean(root.read), write: Boolean(root.write), shell: Boolean(root.shell) });

/**
 * A path with its symlinks resolved, as far as it exists: a link inside a
 * shared root that points out of it is outside it, and a file about to be
 * created is judged by the directory it would be created in. A link that
 * resolves nowhere is `null` -- refused -- since writing through it would
 * create its target, wherever that is.
 */
function realish(target) {
  const absolute = path.resolve(target);
  let existing = absolute;
  const rest = [];
  // lstat, not exists: a dangling link is something, not nothing.
  while (!fs.lstatSync(existing, { throwIfNoEntry: false })) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  try { return path.join(fs.realpathSync(existing), ...rest); } catch { return null; }
}

const refuse = (method, target) => err(new FileError("permission_denied", `${target} is not shared with Conduit for ${METHOD_GRANTS[method]?.grant || method}`, typeof target === "string" ? target : undefined));
