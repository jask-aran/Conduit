import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { err, FileError, ExecutionError } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { encode, decode, HANDLE_METHODS, METHOD_GRANTS, NODE_PROTOCOL_VERSION, rootFor } from "./protocol.js";
import { NodeProcesses } from "./node-processes.js";
import { keptBack, rootDeny } from "./secrets.js";
import { Receipts } from "./receipts.js";
import { keySecret } from "./direct.js";
import { serveDirect } from "./node-direct.js";
import net from "node:net";
import { claudeSession, codexRollout, findHarnesses, opencodeService, tunnelTarget } from "./node-harnesses.js";

const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
// How often the connection is checked; a ping unanswered by the next check ends it.
const HEARTBEAT_MS = 30_000;

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
 *
 * `browse` lets this server see the computer beyond those roots: list any folder
 * this user can, and make one a root by asking. It is
 * set here, on the device, never by main; a folder shared so gets the grants
 * the device gives new folders (`newFolders`), and `onShare` keeps it, as
 * `conduit-node share` would have.
 */
export function startNodeAgent({ mainUrl, routes = [mainUrl], key, name, roots: shared, shellEnv = process.env, log = console,
  // How main is reached: a WebSocket, or a relay's stdin/stdout (node-relay.js).
  dial = (url, { key: bearer }) => new WebSocket(url, { headers: { authorization: `Bearer ${bearer}` } }),
  // Environments this one carries on its socket (decision 25): relayEnvironment()s.
  relays = [], browse = false, onShare = null,
  // The grants a folder shared by browsing gets: the device's choice for new folders, read when one is shared.
  newFolders = () => ({ write: true, shell: true }),
  // Told when another run of this node took the pairing over (main replaced this connection).
  onReplaced = null,
  // Answer reads on loopback for clients holding the hub's grant (node-direct.js): the same device's app.
  direct = false }) {
  // Every way main can be reached, best first (its tailnet name, then a public
  // tunnel): a failed attempt tries the next, and a dropped connection starts again at the best.
  const ways = [...new Set([mainUrl, ...routes].filter(Boolean))];
  let way = 0;
  const roots = shared.map(view);
  const envs = new Map();
  // Processes outlive any one socket (decision 18): they are the device's.
  const processes = new NodeProcesses({ shellEnv, scope: mainUrl });
  // Writes and commands by action id: they outlive a socket, and are never done twice.
  const receipts = new Receipts();
  // Harnesses are offered only with the shell grant somewhere: running one is running code.
  const harnesses = roots.some((root) => root.shell) ? findHarnesses() : {};
  let socket = null;
  let served = null;
  let directPort = null;
  let attempt = 0;
  let stopped = false;
  let timer = null;

  /*
   * Where a call runs: a root by id and a path inside it, `{ root, path }`.
   * Main names places, never paths on this device; a root that is not shared
   * (or a path leaving it) is nowhere.
   */
  const placeOf = (place) => {
    const root = place && typeof place === "object" ? roots.find((item) => item.id === place.root) : null;
    if (!root) return null;
    const segments = String(place.path || "").split(/[\\/]/).filter((part) => part && part !== ".");
    if (segments.includes("..")) return null;
    const home = realish(path.join(root.path, ...segments));
    return home && rootFor([root], home, "read") ? home : null;
  };

  const envFor = (cwd) => {
    if (!envs.has(cwd)) envs.set(cwd, new NodeExecutionEnv({ cwd, shellEnv }));
    return envs.get(cwd);
  };

  /*
   * A call on this device's files or processes at a place, by the grants of the folder it falls in: what main asks over
   * the socket, and what direct reads (node-direct.js) ask here.
   */
  async function envCall(method, decoded, cwd, context, emit) {
    const rule = METHOD_GRANTS[method];
    if (!rule) return err(new FileError("not_supported", `${method} is not served by this node`));
    const home = placeOf(cwd);
    const allowed = (target, grant) => Boolean(target && rootFor(roots, target, grant));
    if (!home) return refuse(method, "that folder");
    for (const at of rule.paths) {
      if (typeof decoded[at] !== "string") continue;
      const target = realish(path.resolve(home, decoded[at]));
      if (!allowed(target, rule.grant)) return refuse(method, decoded[at]);
      if (rule.contents && keptBack(rootFor(roots, target, rule.grant), target)) {
        return err(new FileError("permission_denied", `${decoded[at]} is kept private on this device`, decoded[at]));
      }
    }
    if (method === "exec" && !allowed(realish(path.resolve(home, decoded[1]?.cwd || ".")), "shell")) return refuse(method, decoded[1]?.cwd || "that folder");
    if (method === "watch" && decoded[0].some((item) => !allowed(realish(path.resolve(home, item.path)), "read"))) return refuse(method, "a watched path");
    const env = envFor(home);
    if (method === "exec") {
      const options = { ...(decoded[1] || {}) };
      options.onOutput = (text, _context, info) => emit({ kind: "output", text, info: encode(info) });
      return env.exec(decoded[0], options, context);
    }
    if (method === "watch") {
      return env.watch(decoded[0], (change) => emit({ kind: "change", change: encode(change) }), context);
    }
    if (typeof env[method] !== "function") return err(new FileError("not_supported", `${method} is not available on this device`));
    return env[method](...decoded, context);
  }

  const connect = () => {
    const via = ways[way % ways.length];
    const url = new URL("/v0/nodes/connect", via);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = dial(url, { key });
    socket = ws;
    const calls = new Map();
    // Handle ids are never reused, on this socket or the next: a reader main
    // still holds from before a reconnect names nothing rather than a stranger.
    const handles = new Map();
    // The processes main follows on this socket: process id -> detach.
    const following = new Map();
    // Byte streams main opened to endpoints here (remote-tunnel.js): tunnel id -> socket.
    const tunnels = new Map();
    const send = (message) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
    const relayFor = (env) => relays.find((relay) => relay.env === env);

    let opened = false;
    // A connection that dies without a close (a sleeping laptop, a tunnel
    // dropping it) never says so: one that misses a pong is ended, which
    // reconnects. Main answers pings itself (the ws library does).
    let alive = true;
    let beat = null;
    ws.on("pong", () => { alive = true; });
    ws.on("open", () => {
      opened = true;
      beat = setInterval(() => {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        ws.ping();
      }, HEARTBEAT_MS);
      beat.unref?.();
      attempt = 0;
      way = 0;
      // Roots go by id; the path is for people to read, main never sends it back.
      send({ type: "hello", version: NODE_PROTOCOL_VERSION, name, platform: process.platform, boot: receipts.boot,
        harnesses: Object.keys(harnesses), browse: Boolean(browse && onShare), ...(directPort ? { direct: { port: directPort } } : {}),
        roots: roots.map(({ id, path: label, read, write, shell, allow }) => ({ id, label, read, write, shell, allow })) });
      log.info?.(`[conduit-node] connected to ${mainUrl}${via === mainUrl ? "" : ` via ${via}`}`);
    });
    ws.on("message", async (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === "abort") return message.action ? receipts.abort(message.action) : calls.get(message.id)?.abort();
      if (message.type === "tunnel") {
        const tunnel = tunnels.get(message.tunnel);
        if (message.data) tunnel?.write(Buffer.from(message.data, "base64"));
        if (message.end) tunnel?.end();
        return;
      }
      // What main offers (decision 30): environments are carried only where it relays them.
      if (message.type === "welcome") {
        const features = Array.isArray(message.features) ? message.features : [];
        if (features.includes("relay")) for (const relay of relays) relay.attach(send);
        else if (relays.length) log.warn?.(`[conduit-node] ${mainUrl} does not relay; ${relays.map((relay) => relay.env).join(", ")} not carried`);
        return;
      }
      if (typeof message.type === "string" && message.type.startsWith("relay")) return relayFor(message.env)?.deliver(message);
      if (message.type === "refused") { log.error?.(`[conduit-node] main refused this node: ${message.reason}`); stopped = true; return ws.close(); }
      if (message.type !== "call") return;
      if (typeof message.action === "string" && message.target === "env") {
        let finished = false;
        const followed = receipts.follow(message.action, Number(message.from) || 0, {
          event: (event) => send({ ...event, type: "event", id: message.id }),
          result: (result) => {
            finished = true;
            calls.delete(message.id);
            send(result?.failure !== undefined ? { type: "failure", id: message.id, message: result.failure }
              : { type: "result", id: message.id, value: encode(result) });
          },
        }, (emit, signal) => run(message, withAbortSignal(signal, BACKGROUND_CONTEXT), emit));
        // An action already done was answered from its receipt just now.
        if (!finished) calls.set(message.id, { abort: followed.abort, drop: followed.drop });
        return;
      }
      const controller = new AbortController();
      calls.set(message.id, controller);
      const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
      try {
        const value = await run(message, context, (event) => send({ ...event, type: "event", id: message.id }));
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
    ws.on("close", (code) => {
      clearInterval(beat);
      // Main took another connection of this node over the one in use: another run of it (an app updated or
      // opened twice) has the pairing now. Redialling would only take it back, and back again.
      if (code === 4000 && socket === ws) { stopped = true; log.warn?.(`[conduit-node] another run of this node took over ${mainUrl}; stopping this one`); onReplaced?.(); }
      for (const relay of relays) relay.detach();
      for (const detach of following.values()) detach();
      following.clear();
      for (const tunnel of tunnels.values()) tunnel.destroy();
      tunnels.clear();
      // An action keeps running for main to ask after again; any other call stops.
      for (const call of calls.values()) (call.drop || call.abort).call(call);
      for (const handle of handles.values()) void handle.close?.(BACKGROUND_CONTEXT);
      handles.clear();
      if (socket === ws) socket = null;
      if (stopped) return;
      // Not reached this way: the next one at once, and only a full round backs off.
      if (!opened && ++way % ways.length !== 0) { timer = setTimeout(connect, 0); return; }
      const wait = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
      timer = setTimeout(connect, wait);
    });
    ws.on("error", (error) => { if (attempt === 0) log.warn?.(`[conduit-node] ${error.message}`); });

    function keep(object) {
      const id = `h_${crypto.randomUUID()}`;
      handles.set(id, object);
      return { $handle: id, ...(object.mode ? { mode: object.mode } : {}) };
    }

    /*
     * Processes, for the shell grant: spawn needs it on the directory it runs
     * in; the rest act on a process by the id spawn returned. Output goes out
     * as `proc` messages, not as a call's events, because following outlives
     * the call that started it.
     */
    function runProcess(method, args) {
      try {
        if (method === "spawn") {
          const spec = args[0] || {};
          // A terminal in this user's home, outside any shared folder: offered
          // wherever a folder is shared with commands, which already reach as far.
          if (spec.cwd?.home === true) {
            if (!roots.some((root) => root.shell)) return refuse("exec", "this device's home");
            if (spec.shell !== true || !spec.pty || spec.harness !== undefined) return refuse("exec", "this device's home");
            return { ok: true, value: processes.spawn({ shell: true, pty: spec.pty, cwd: os.homedir() }) };
          }
          const home = placeOf(spec.cwd);
          if (!home || !rootFor(roots, home, "shell")) return refuse("exec", "that folder");
          // A harness is named, not given as a path: the node runs its own install of it.
          if (spec.harness !== undefined) {
            if (!harnesses[spec.harness]) return err(new ExecutionError("not_supported", `${spec.harness} is not installed on this device`));
            const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
            return { ok: true, value: processes.spawn({ argv: [harnesses[spec.harness], ...args], cwd: home,
              env: spec.env && typeof spec.env === "object" ? spec.env : {} }) };
          }
          return { ok: true, value: processes.spawn({ ...spec, cwd: home }) };
        }
        const [procId, ...rest] = args;
        if (method === "attach") {
          following.get(procId)?.();
          const attached = processes.attach(procId, Number(rest[0]) || 0, (event) => send({ type: "proc", proc: procId,
            ...(event.kind === "data" ? { kind: "data", stream: event.stream, offset: event.offset, data: event.bytes.toString("base64") } : event) }));
          following.set(procId, attached.detach);
          const { detach, ...view } = attached;
          return { ok: true, value: view };
        }
        if (method === "detach") { following.get(procId)?.(); following.delete(procId); return { ok: true, value: null }; }
        if (method === "write") { processes.write(procId, rest[0] instanceof Uint8Array ? Buffer.from(rest[0]) : Buffer.from(String(rest[0] ?? ""))); return { ok: true, value: null }; }
        if (method === "closeInput") { processes.closeInput(procId); return { ok: true, value: null }; }
        if (method === "resize") { processes.resize(procId, Number(rest[0]) || 80, Number(rest[1]) || 24); return { ok: true, value: null }; }
        if (method === "kill") { processes.kill(procId, rest[0]); return { ok: true, value: null }; }
        if (method === "list") return { ok: true, value: processes.list() };
        return err(new FileError("not_supported", `${method} is not served by this node`));
      } catch (error) {
        return err(new ExecutionError("unknown", error.message));
      }
    }

    /** A byte stream to an endpoint here, for a harness's own clients; the shell grant is required. */
    function openTunnel(id, endpoint) {
      const target = roots.some((root) => root.shell) && typeof id === "string" && !tunnels.has(id) ? tunnelTarget(endpoint) : null;
      if (!target) return err(new FileError("permission_denied", "That endpoint is not open to Conduit on this device"));
      return new Promise((resolve) => {
        const connection = net.connect(target);
        connection.once("connect", () => {
          tunnels.set(id, connection);
          connection.on("data", (chunk) => send({ type: "tunnel", tunnel: id, data: chunk.toString("base64") }));
          connection.on("close", () => { if (tunnels.delete(id)) send({ type: "tunnel", tunnel: id, end: true }); });
          connection.on("error", () => {});
          resolve({ ok: true, value: { id } });
        });
        connection.once("error", (cause) => {
          if (!tunnels.has(id)) resolve({ ok: true, value: { error: { code: cause.code || "ECONNREFUSED", message: cause.message } } });
        });
      });
    }

    /*
     * The computer beyond its roots, where browsing is allowed: a folder's entries, by name and kind only (contents
     * stay behind the roots' checks), and sharing a folder main chose -- the same root `conduit-node share --write
     * --shell` makes. Anything else, or browsing not allowed, is refused.
     */
    async function computer(method, [at, ...rest]) {
      if (!browse || !onShare) return err(new FileError("permission_denied", "This device does not let Conduit browse it"));
      const folder = at ? realish(String(at)) : os.homedir();
      const stat = folder && fs.statSync(folder, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) return err(new FileError("not_found", `${at || "Home"} is not a folder here`, at || undefined));
      if (method === "list") {
        let dirents;
        try { dirents = await fs.promises.readdir(folder, { withFileTypes: true }); }
        catch (error) { return err(new FileError("permission_denied", `${folder} could not be read: ${error.code || error.message}`, folder)); }
        const entries = dirents.map((item) => ({ name: item.name, path: item.name, type: item.isDirectory() ? "directory" : item.isFile() ? "file" : "other" }));
        const parent = path.dirname(folder);
        return { ok: true, value: { home: os.homedir(), path: folder, parent: parent === folder ? null : parent, separator: path.sep, entries } };
      }
      if (method === "share") {
        // Home or a drive is the whole computer, not a workspace: as main refuses its own.
        if (folder === os.homedir() || path.dirname(folder) === folder) return err(new FileError("permission_denied", `${folder} is too broad to share; choose a folder inside it`, folder));
        const held = roots.find((root) => root.path === folder);
        if (!held) {
          const grants = newFolders();
          const root = { id: `r_${crypto.randomBytes(9).toString("base64url")}`, path: folder, read: true, write: Boolean(grants.write), shell: Boolean(grants.shell), allow: [], deny: [] };
          await onShare(root, rest[0]);
          roots.push(view(root));
        }
        return { ok: true, value: roots.map(({ id, path: label, read, write, shell, allow }) => ({ id, label, read, write, shell, allow })) };
      }
      return err(new FileError("not_supported", `${method} is not served by this node`));
    }

    async function run({ target, method, args = [], cwd }, context, emit) {
      const decoded = decode(args, { FileError, ExecutionError });
      if (target === "proc") return runProcess(method, decoded);
      // What a harness saved here, for the sessions main runs on it.
      if (target === "tunnel" && method === "open") return openTunnel(decoded[0], decoded[1]);
      if (target === "computer") return computer(method, decoded);
      if (target === "harness") {
        if (method === "claudeSession" && harnesses["claude-code"]) return { ok: true, value: await claudeSession(decoded[0]) };
        if (method === "codexRollout" && harnesses.codex) return { ok: true, value: await codexRollout(decoded[0]) };
        if (method === "opencodeService" && harnesses.opencode) return { ok: true, value: await opencodeService() };
        return err(new FileError("not_supported", `${method} is not served by this node`));
      }
      if (target !== "env") {
        const handle = handles.get(target);
        if (!handle || !HANDLE_METHODS.includes(method)) return err(new FileError("invalid", `No open handle ${target}`));
        const value = await handle[method](...decoded, context);
        if (method === "close") handles.delete(target);
        return value;
      }
      return envCall(method, decoded, cwd, context, emit);
    }
  };

  // Listening first, so the first hello can say where.
  if (direct) {
    served = serveDirect({ secret: keySecret(key), call: envCall, log });
    void served.listening.then((port) => { directPort = port; if (!stopped) connect(); });
  } else connect();
  return {
    stop() {
      stopped = true;
      processes.stopAll();
      for (const relay of relays) relay.stop();
      served?.close();
      clearTimeout(timer);
      socket?.close();
    },
  };
}

const view = (root) => ({ id: root.id, path: realish(root.path) || path.resolve(root.path), read: Boolean(root.read), write: Boolean(root.write), shell: Boolean(root.shell),
  allow: root.allow || [], secrets: rootDeny(root) });

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
