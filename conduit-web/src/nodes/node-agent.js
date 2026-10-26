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
import { directAddresses, keySecret } from "./direct.js";
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
  // A way that does not answer is given up in seconds, not the system's connect timeout; one found by its
  // advertisement is pinned to the certificate its identity attested (find-hub.js), whatever its name.
  // Deflate, when the hub takes it (a node it reaches over the tailnet), as cheaply as it comes.
  dial = (url, { key: bearer, ca }) => new WebSocket(url, { headers: { authorization: `Bearer ${bearer}` }, handshakeTimeout: 8000,
    perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 1, memLevel: 7 } },
    ...(ca ? { ca, checkServerIdentity: () => undefined } : {}) }),
  // Environments this one carries on its socket (decision 25): relayEnvironment()s.
  relays = [], browse = false, onShare = null,
  // The grants a folder shared by browsing gets: the device's choice for new folders, read when one is shared.
  newFolders = () => ({ write: true, shell: true }),
  // Told when another run of this node took the pairing over (main replaced this connection).
  onReplaced = null,
  // Answer reads for clients holding the hub's grant (node-direct.js), and over https with `certificate()`'s.
  direct = false, certificate = null,
  // The hub's identity `{ id, key }` as it last said it, and where to keep what it says (its routes, its identity);
  // `findHub(hub)` looks for it on this network when no way reaches it (find-hub.js).
  hub = null, onRoutes = null, findHub = null,
  // Whether the way main is reached is one nobody else can read: https, or this machine. A relayed environment's is
  // its relay's, which this side cannot see, so it says no.
  confidential = (url) => url.protocol === "wss:" || (url.protocol === "ws:" && /^(127\.|localhost$|\[::1\]$)/.test(url.hostname)) }) {
  // Every way main can be reached, best first (the address it was paired by, then those it has told this node of):
  // a failed attempt tries the next; the one that worked is tried first again after a drop, and a whole round failing
  // looks for the hub by its advertisement before backing off (it may have moved to another address).
  const ways = [...new Set([mainUrl, ...routes].filter(Boolean))].map((url) => ({ url }));
  let way = 0;
  let tried = 0;
  let pinned = hub;
  let lookedAt = 0;
  const addWay = (found, first = false) => {
    const at = ways.findIndex((item) => item.url === found.url);
    if (at >= 0) ways.splice(at, 1);
    if (first) ways.unshift(found); else ways.push(found);
  };
  const roots = shared.map(view);
  const envs = new Map();
  // Processes outlive any one socket (decision 18): they are the device's.
  const processes = new NodeProcesses({ shellEnv, scope: mainUrl });
  // Writes and commands by action id: they outlive a socket, and are never done twice.
  const receipts = new Receipts();
  // The key direct grants are checked with, made afresh by each run (so a grant from before a restart is nothing) and
  // given to main only over a confidential link: the pairing key may have crossed a LAN in plain HTTP, and what it
  // could sign would then be anyone's. Without it reads use the pairing key's hash as v0.8.7 did, and no terminal is
  // attached here directly.
  const grantKey = crypto.randomBytes(32).toString("base64url");
  let granting = false;
  // Who is typing into each terminal: main, for a client of its own, or a client attached here directly
  // (node-direct.js). One at a time, as main keeps it among its own clients; a newcomer takes over only when asked.
  // Main's hold is per terminal, not per socket: its clients outlive a dropped connection, and follow again after.
  const HUB = "hub";
  const holders = new Map();
  // The connection to main now open: how to tell it something, and what it follows on it.
  let link = null;
  const takeFromHub = (procId) => {
    link?.following.get(procId)?.();
    link?.following.delete(procId);
    link?.send({ type: "proc", proc: procId, kind: "taken" });
  };
  // A terminal that ends while main does not follow it (a client has it directly, or none has it open) is still said.
  processes.onExit = (view) => {
    if (!view.pty || !link || link.following.has(view.id)) return;
    link.send({ type: "proc", proc: view.id, kind: "exit", code: view.exit?.code ?? null, signal: view.exit?.signal ?? null, end: view.end });
  };
  const directShells = {
    /** A client attaching here directly, by the hub's grant: `sink` gets the output, the exit, or being taken over. */
    attach(procId, { takeover = false, cols = 80, rows = 24 } = {}, sink) {
      const view = processes.get(procId);
      if (!view?.pty || view.exit) return { error: "pty_not_running", message: "Terminal is no longer running" };
      const held = holders.get(procId);
      if (held && !takeover) return { error: "pty_in_use", message: "Terminal is attached in another Conduit client" };
      let attached = null;
      const holder = { take: () => { release(); sink({ kind: "taken" }); } };
      const release = () => {
        attached?.detach();
        attached = null;
        if (holders.get(procId) === holder) holders.delete(procId);
      };
      if (held === HUB) takeFromHub(procId); else held?.take();
      holders.set(procId, holder);
      attached = processes.attach(procId, 0, sink);
      processes.resize(procId, cols, rows);
      return { write: (bytes) => processes.write(procId, bytes), resize: (nextCols, nextRows) => processes.resize(procId, nextCols, nextRows), detach: release };
    },
  };
  // Harnesses are offered only with the shell grant somewhere: running one is running code.
  const harnesses = roots.some((root) => root.shell) ? findHarnesses() : {};
  let socket = null;
  let served = null;
  let directPort = null;
  let toldDirect = "";
  const tellDirect = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    toldDirect = JSON.stringify(directInfo());
    socket.send(JSON.stringify({ type: "direct", direct: JSON.parse(toldDirect) }));
  };
  const directInfo = () => ({ port: directPort, addresses: directAddresses(os.networkInterfaces()), pty: "sealed",
    ...(granting ? { grantKey } : {}), ...(served?.secureRoute() ? { tls: served.secureRoute() } : {}) });
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
  async function envCall(method, decoded, cwd, context, emit, { confine = false } = {}) {
    const rule = METHOD_GRANTS[method];
    if (!rule) return err(new FileError("not_supported", `${method} is not served by this node`));
    const home = placeOf(cwd);
    const allowed = (target, grant) => Boolean(target && rootFor(roots, target, grant));
    if (!home) return refuse(method, "that folder");
    for (const at of rule.paths) {
      if (typeof decoded[at] !== "string") continue;
      // On Windows a colon is a drive (another folder entirely) or a file's hidden stream: never part of a path asked for.
      if (process.platform === "win32" && decoded[at].includes(":")) return refuse(method, decoded[at]);
      const target = realish(path.resolve(home, decoded[at]));
      if (!allowed(target, rule.grant)) return refuse(method, decoded[at]);
      // A direct read's grant is for its place, not every folder shared.
      if (confine && target !== home && !target.startsWith(home.endsWith(path.sep) ? home : home + path.sep)) return refuse(method, decoded[at]);
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
    const { url: via, ca } = ways[way % ways.length];
    const url = new URL("/v0/nodes/connect", via);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const secret = confidential(url);
    const ws = dial(url, { key, ca });
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
    const here = { send, following };
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
      tried = 0;
      // Main follows again what its clients still hold; a main that started over holds nothing.
      link = here;
      granting = secret;
      for (const [procId, held] of holders) if (held === HUB) holders.delete(procId);
      // Roots go by id; the path is for people to read, main never sends it back.
      send({ type: "hello", version: NODE_PROTOCOL_VERSION, name, platform: process.platform, boot: receipts.boot,
        harnesses: Object.keys(harnesses), browse: Boolean(browse && onShare), ...(directPort ? { direct: JSON.parse(toldDirect = JSON.stringify(directInfo())) } : {}),
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
      // Every way the hub can be reached now, and who it is: kept, so this node still finds it once the address it
      // was paired by stops answering. Only what a node may dial: https anywhere, plain http on this machine or a LAN.
      if (message.type === "routes") {
        const told = (Array.isArray(message.routes) ? message.routes : []).map(String).slice(0, 8).filter((route) => {
          try {
            const { protocol, hostname, pathname } = new URL(route);
            return pathname === "/" && (protocol === "https:" || (protocol === "http:" && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$)/.test(hostname)));
          } catch { return false; }
        });
        for (const route of told) if (!ways.some((item) => item.url === route)) addWay({ url: route });
        if (typeof message.hub?.id === "string" && typeof message.hub?.key === "string") pinned = { id: message.hub.id, key: message.hub.key };
        onRoutes?.({ routes: told, hub: pinned });
        return;
      }
      if (typeof message.type === "string" && message.type.startsWith("relay")) return relayFor(message.env)?.deliver(message);
      // A name on this network from main, and the certificate for it (lan-names.js).
      if (message.type === "lan-cert") {
        if (served && typeof message.name === "string" && typeof message.cert === "string" && typeof message.key === "string") {
          void served.addCertificate({ name: message.name, cert: message.cert, key: message.key }).catch((error) => log.warn?.(`[conduit-node] ${error.message}`));
        }
        return;
      }
      if (message.type === "refused") {
        log.error?.(`[conduit-node] main refused this node: ${message.reason}`);
        stopped = true;
        // Grants main gave before no longer stand.
        served?.close();
        ws.close();
        // Replaced by a newer run of it: as when main takes the connection over.
        if (message.replaced === true) onReplaced?.();
        return;
      }
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
      // Not reached this way: the next one at once. After a drop, the same way again first.
      if (!opened) {
        way = (way + 1) % ways.length;
        if (++tried < ways.length) { timer = setTimeout(connect, 0); return; }
        tried = 0;
        // None answered: the hub may be on this network at another address. Looked for at most once a minute.
        if (findHub && pinned && Date.now() - lookedAt > 60_000) {
          lookedAt = Date.now();
          void findHub(pinned).catch(() => []).then((found) => {
            if (stopped) return;
            for (const item of [...found].reverse()) addWay(item, true);
            if (found.length) { way = 0; log.info?.(`[conduit-node] found ${mainUrl} at ${found[0].url}`); connect(); }
            else timer = setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
          });
          return;
        }
      }
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
        // Main's client is typing into this terminal from now: refused while a client here holds it, unless taking over.
        if (method === "claim") {
          const held = holders.get(procId);
          if (held && held !== HUB) {
            if (!rest[0]) return err(new ExecutionError("pty_in_use", "Terminal is attached in another Conduit client"));
            held.take();
          }
          holders.set(procId, HUB);
          return { ok: true, value: null };
        }
        if (method === "attach") {
          following.get(procId)?.();
          // A client here took it while main was away: main is told, not followed.
          const held = holders.get(procId);
          if (held && held !== HUB) return { ok: true, value: { ...processes.get(procId), taken: true } };
          const attached = processes.attach(procId, Number(rest[0]) || 0, (event) => send({ type: "proc", proc: procId,
            ...(event.kind === "data" ? { kind: "data", stream: event.stream, offset: event.offset, data: event.bytes.toString("base64") } : event) }));
          following.set(procId, attached.detach);
          if (attached.pty && !held) holders.set(procId, HUB);
          const { detach, ...view } = attached;
          return { ok: true, value: view };
        }
        if (method === "detach") {
          following.get(procId)?.();
          following.delete(procId);
          if (holders.get(procId) === HUB) holders.delete(procId);
          return { ok: true, value: null };
        }
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
    const legacy = keySecret(key);
    served = serveDirect({ secret: () => (granting ? grantKey : legacy), ptySecret: () => (granting ? grantKey : null),
      call: envCall, log, certificate, shells: directShells });
    void served.listening.then((port) => { directPort = port; if (!stopped) connect(); });
    // The https route comes when a certificate does: told to main then, and in every hello after.
    served.onSecureChange(tellDirect);
    // Its addresses change without its connection doing so (a laptop joins another network, Tailscale comes up after
    // the node): looked at every half minute, and told to main when they differ from what it last said.
    const watching = setInterval(() => { if (JSON.stringify(directInfo()) !== toldDirect) tellDirect(); }, 30_000);
    watching.unref?.();
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
