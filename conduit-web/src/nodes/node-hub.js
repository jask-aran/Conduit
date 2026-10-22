import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { awaitWithContext, BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { encode, NODE_FEATURES, NODE_PROTOCOL_VERSION } from "./protocol.js";
import { FileError } from "@earendil-works/pi-durable/env";

const hash = (key) => crypto.createHash("sha256").update(key).digest("hex");

/**
 * The devices paired with this main server, and the sockets they hold open.
 *
 * Pairing makes a device record and a key, shown once; main keeps only the
 * key's hash. A node presents the key when it dials in, from loopback or the
 * tailnet (plan decision 4) -- anything else is turned away before the key is
 * looked at. Each connected node's hello says which folders it shares and with
 * which grants; main shows that and calls inside it, and the node enforces it.
 *
 * `call` is how the remote environment reaches a device. A call to a device
 * that is not connected waits for it (decision 8), for as long as the caller's
 * context allows; `waiting` is emitted so the chat can say what it waits for.
 * A call in flight when the socket drops fails as interrupted.
 */
// Relayed environments (decision 25): how many one socket may carry, how long a
// name may be, and how long an open may go without its node's hello.
const RELAYS_PER_SOCKET = 8;
const RELAY_ENV_MAX = 64;
const HELLO_WAIT_MS = 30_000;

export class NodeHub extends EventEmitter {
  constructor({ dataRoot, allowRemote = isTailnetOrLoopback }) {
    super();
    this.file = path.join(dataRoot, "nodes.json");
    this.allowRemote = allowRemote;
    // Nodes (one per paired environment, each with its own key) and the
    // devices that group them: a desktop's Windows host and its WSL distro
    // are two nodes on one device.
    this.records = null;
    this.devices = null;
    this.live = new Map();
    // Device processes main follows, by `${nodeId} ${procId}`: they outlive a
    // socket, so a reconnect resumes each from the last byte it had.
    this.following = new Map();
    // Byte streams to endpoints on devices (remote-tunnel.js), by `${nodeId} ${tunnelId}`.
    this.tunnels = new Map();
    // Every socket of a node, by node id, from connect: unpairing closes them all.
    this.attached = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  }

  async load() {
    if (this.records) return this.records;
    let stored = {};
    try { stored = JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    this.records = stored.nodes || [];
    this.devices = stored.devices || [];
    // Version 1 had no devices: each node becomes the only node of a device of its name.
    for (const record of this.records) {
      if (record.deviceId) continue;
      const device = { id: `device_${crypto.randomUUID()}`, name: record.name, createdAt: record.createdAt };
      this.devices.push(device);
      record.deviceId = device.id;
    }
    return this.records;
  }

  /**
   * Writes go one at a time and replace the file whole (a temporary file
   * renamed over it), so devices reconnecting together cannot interleave a
   * torn nodes.json. A failed write is logged, never thrown at a socket
   * handler: last-seen times are not worth the server.
   */
  save() {
    this.saving = (this.saving || Promise.resolve()).then(async () => {
      const temporary = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify({ version: 2, devices: this.devices, nodes: this.records }, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, this.file);
    });
    const done = this.saving;
    this.saving = done.catch((error) => console.error("Could not save paired devices", error));
    return done;
  }

  /** Pair a node on a device: an existing one by id, else a new one by name. */
  async pair({ name, deviceId = null, deviceName = null } = {}) {
    await this.load();
    let device = deviceId && this.devices.find((item) => item.id === deviceId);
    if (deviceId && !device) throw Object.assign(new Error("No such device"), { status: 404, code: "device_not_found" });
    if (!device) {
      device = { id: `device_${crypto.randomUUID()}`, name: String(deviceName || name || "Device").trim().slice(0, 80) || "Device",
        createdAt: new Date().toISOString() };
      this.devices.push(device);
    }
    const key = `cnk_${crypto.randomBytes(32).toString("base64url")}`;
    const record = { id: `node_${crypto.randomUUID()}`, deviceId: device.id,
      name: String(name || device.name).trim().slice(0, 80) || device.name,
      keyHash: hash(key), createdAt: new Date().toISOString(), lastSeenAt: null, roots: [], platform: null };
    this.records.push(record);
    await this.save();
    return { node: this.view(record), device: this.deviceView(device), key };
  }

  async forget(id) {
    await this.load();
    const gone = this.records.find((record) => record.id === id);
    this.records = this.records.filter((record) => record.id !== id);
    // A device with no nodes left is gone with its last one.
    if (gone && !this.records.some((record) => record.deviceId === gone.deviceId)) {
      this.devices = this.devices.filter((device) => device.id !== gone.deviceId);
    }
    await this.save();
    // Every socket of it, not only the live one: one that has not said hello yet must not live after.
    for (const socket of this.attached.get(id) || []) socket.close(4001, "unpaired");
    this.attached.delete(id);
    // A call waiting for this device will not see it again.
    this.emit(`forgotten:${id}`);
    this.emit("changed");
  }

  view(record) {
    const live = this.live.get(record.id);
    return { id: record.id, deviceId: record.deviceId, name: record.name, platform: live?.platform || record.platform || null,
      online: Boolean(live), roots: live?.roots || record.roots || [], harnesses: live?.harnesses || record.harnesses || [],
      // A terminal in its home: where any folder is shared with commands (decision 27).
      terminal: Boolean(live) && (live.roots || []).some((root) => root.shell), lastSeenAt: live ? new Date().toISOString() : record.lastSeenAt };
  }

  deviceView(device) {
    return { id: device.id, name: device.name,
      nodes: this.records.filter((record) => record.deviceId === device.id).map((record) => this.view(record)) };
  }

  async list() { return (await this.load()).map((record) => this.view(record)); }

  async listDevices() {
    await this.load();
    const head = this.head ? [{ id: this.head.deviceId, name: this.head.name(), local: true, nodes: [await this.headView()] }] : [];
    return [...head, ...this.devices.map((device) => this.deviceView(device))];
  }

  /**
   * The head's own device (decision 24): listed with the others, its node's
   * roots the folders it holds workspaces in. It is not paired and never
   * offline; its calls run in process, so it is not among `live` sockets.
   */
  adoptHead({ deviceId, nodeId, name, roots, harnesses }) { this.head = { deviceId, nodeId, name, roots, harnesses }; }

  async headView() {
    const platform = { win32: "Windows", darwin: "macOS" }[process.platform] || "Linux";
    return { id: this.head.nodeId, deviceId: this.head.deviceId, name: platform, platform: process.platform, local: true,
      // Its own terminal is the "computer" one this server always offers.
      online: true, roots: await this.head.roots(), harnesses: this.head.harnesses(), terminal: true, lastSeenAt: new Date().toISOString() };
  }

  /** A root a node shares, by id, as it last said: `{ id, label, read, write, shell }`. */
  async root(nodeId, rootId) {
    const record = await this.get(nodeId);
    return (this.live.get(nodeId)?.roots || record?.roots || []).find((root) => root.id === rootId) || null;
  }

  async get(id) { return (await this.load()).find((record) => record.id === id) || null; }

  handleUpgrade(request, socket, head) {
    if (!this.allowRemote(clientAddress(request))) return socket.destroy();
    const key = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    void this.byKey(key).then((record) => {
      if (!record) return socket.destroy();
      this.wss.handleUpgrade(request, socket, head, (ws) => this.attach(record, ws));
    }, () => socket.destroy());
  }

  async byKey(key) {
    const records = await this.load();
    return (key && records.find((item) => crypto.timingSafeEqual(Buffer.from(item.keyHash), Buffer.from(hash(key))))) || null;
  }

  /*
   * An environment relayed on another node's socket (node-relay.js, decision
   * 25): it proves itself with its own key, as a direct connection would, and
   * is then attached as one -- a socket of its own, its frames tagged `env` on
   * the relay's. The relay's socket going carries them all with it.
   */
  async relayOpen(outer, relaySocket, { env, key }, relaying) {
    const reply = (message) => { if (relaySocket.readyState === 1) relaySocket.send(JSON.stringify({ ...message, env })); };
    if (typeof env !== "string" || !env || env.length > RELAY_ENV_MAX) return reply({ type: "relay-closed", reason: "bad environment name" });
    // A device carries a few environments, not many: past that, an open is refused.
    if (!outer.relayed.has(env) && outer.relayed.size >= RELAYS_PER_SOCKET) return reply({ type: "relay-closed", reason: "too many relayed environments" });
    const record = await this.byKey(String(key || ""));
    if (!record || relaySocket.readyState !== 1) return reply({ type: "relay-closed", reason: "unknown key" });
    if (record.id === relaying.id) return reply({ type: "relay-closed", reason: "a node cannot relay itself" });
    outer.relayed.get(env)?.end("replaced");
    const socket = new EventEmitter();
    socket.readyState = 1;
    socket.send = (data) => { if (socket.readyState === 1) reply({ type: "relay", d: String(data) }); };
    // Pinged through the relay to the relayed node itself, which answers: a
    // node that hangs while its relay is fine misses pongs and is ended.
    socket.ping = () => reply({ type: "relay-ping" });
    socket.end = (reason) => {
      if (socket.readyState === 3) return;
      socket.readyState = 3;
      if (outer.relayed.get(env) === socket) outer.relayed.delete(env);
      socket.emit("close");
      return reason;
    };
    socket.close = (_code, reason) => { if (socket.readyState === 1) reply({ type: "relay-closed", reason: reason || "closed" }); socket.end(); };
    socket.terminate = socket.close;
    outer.relayed.set(env, socket);
    this.attach(record, socket);
    reply({ type: "relay-opened" });
    // An open that never says hello is not kept.
    setTimeout(() => { if (socket.readyState === 1 && this.live.get(record.id)?.socket !== socket) socket.close(4002, "no hello"); }, HELLO_WAIT_MS).unref?.();
  }

  attach(record, ws) {
    // A call that opened a watcher keeps hearing its changes after it returns,
    // until the watcher it opened is closed: call id -> { handle, onEvent }.
    const node = { socket: ws, calls: new Map(), watchers: new Map(), roots: [], platform: null, ready: false,
      // Environments relayed on this socket: env -> their socket (relayOpen).
      relayed: new Map() };
    let ids = 0;
    node.send = (message) => ws.send(JSON.stringify(message));
    if (!this.attached.has(record.id)) this.attached.set(record.id, new Set());
    this.attached.get(record.id).add(ws);
    node.call = (message, onEvent) => {
      const id = `c${++ids}`;
      const done = new Promise((resolve, reject) => node.calls.set(id, { resolve, reject, onEvent }));
      if (message.target !== "env" && message.method === "close") {
        for (const [callId, watcher] of node.watchers) if (watcher.handle === message.target) node.watchers.delete(callId);
      }
      node.send({ ...message, type: "call", id });
      return { id, done };
    };
    // A frame the socket refuses (too large, malformed) closes it; unheard, the error would end the server.
    ws.on("error", (error) => console.warn(`[nodes] ${record.name}: ${error.message}`));
    // A node that went away without a close (a sleeping laptop, a dropped
    // tunnel) is ended when it misses a pong, so it reads offline and its
    // calls wait for it instead of hanging. The node answers pings itself.
    let alive = true;
    ws.on("pong", () => { alive = true; });
    const beat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 30_000);
    beat.unref?.();
    ws.on("close", () => clearInterval(beat));
    ws.on("message", (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === "relay-open") return void this.relayOpen(node, ws, message, record);
      if (message.type === "relay") return node.relayed.get(message.env)?.emit("message", message.d);
      if (message.type === "relay-close") return node.relayed.get(message.env)?.end();
      if (message.type === "relay-pong") return node.relayed.get(message.env)?.emit("pong");
      if (message.type === "hello") {
        // Unpaired since it connected: it says hello to nobody.
        if (!this.records.includes(record)) return ws.close(4001, "unpaired");
        if (message.version !== NODE_PROTOCOL_VERSION) {
          node.send({ type: "refused", reason: `main speaks node protocol ${NODE_PROTOCOL_VERSION}, this node ${message.version}` });
          return ws.close();
        }
        // A device reconnecting replaces its old socket.
        this.live.get(record.id)?.socket.close(4000, "replaced");
        // `boot` names this run of the node; a node without one keeps no receipts.
        Object.assign(node, { roots: Array.isArray(message.roots) ? message.roots : [], platform: message.platform || null,
          boot: typeof message.boot === "string" ? message.boot : null,
          harnesses: Array.isArray(message.harnesses) ? message.harnesses.filter((id) => typeof id === "string") : [],
          ready: true });
        this.live.set(record.id, node);
        node.send({ type: "welcome", features: NODE_FEATURES });
        Object.assign(record, { roots: node.roots, platform: node.platform, harnesses: node.harnesses, lastSeenAt: new Date().toISOString() });
        if (message.name && record.name === "Device") record.name = String(message.name).slice(0, 80);
        // Roots without ids are from a node older than root ids: it is not addressable.
        node.roots = node.roots.filter((root) => typeof root?.id === "string");
        record.roots = node.roots;
        void this.save().catch(() => {});
        this.emit("changed");
        this.emit(`online:${record.id}`);
        // Processes let go of while it was away are stopped now.
        if (record.pendingKills?.length) {
          const kills = record.pendingKills;
          record.pendingKills = [];
          void this.save().catch(() => {});
          for (const procId of kills) {
            void this.call(record.id, { target: "proc", method: "kill", args: [procId], cwd: null },
              withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)).catch(() => {});
          }
        }
        // A follower whose process the device no longer has (it restarted) ends; never this server.
        for (const follower of this.following.values()) {
          if (follower.nodeId === record.id) void follower.resume().catch((error) => follower.lost(error));
        }
        return;
      }
      if (message.type === "proc") return this.following.get(`${record.id} ${message.proc}`)?.deliver(message);
      if (message.type === "tunnel") return this.tunnels.get(`${record.id} ${message.tunnel}`)?.deliver(message);
      if (message.type === "event" && node.watchers.has(message.id)) return node.watchers.get(message.id).onEvent(message);
      const pending = node.calls.get(message.id);
      if (!pending) return;
      if (message.type === "event") return pending.onEvent?.(message);
      node.calls.delete(message.id);
      const handle = message.type === "result" ? message.value?.value?.$handle : null;
      if (handle && pending.onEvent) node.watchers.set(message.id, { handle, onEvent: pending.onEvent });
      if (message.type === "result") pending.resolve(message.value);
      else pending.reject(new Error(message.message || "The device could not run the call"));
    });
    ws.on("close", () => {
      this.attached.get(record.id)?.delete(ws);
      for (const socket of [...node.relayed.values()]) socket.end();
      for (const [key, tunnel] of this.tunnels) if (key.startsWith(`${record.id} `) && tunnel.nodeSocket === ws) tunnel.drop();
      for (const pending of node.calls.values()) pending.reject(Object.assign(new Error(`${record.name} disconnected during the call`), { interrupted: true }));
      node.calls.clear();
      // A watcher on the device stopped with the socket: say so, as a watcher that stops does (WatchChange `error`).
      for (const watcher of node.watchers.values()) {
        try { watcher.onEvent({ kind: "change", change: encode({ error: new FileError("unknown", `${record.name} disconnected`) }) }); } catch {}
      }
      node.watchers.clear();
      if (this.live.get(record.id) === node) {
        this.live.delete(record.id);
        record.lastSeenAt = new Date().toISOString();
        void this.save().catch(() => {});
        this.emit("changed");
      }
    });
  }

  /** Wait for a device to be connected, for as long as `context` allows. */
  async online(nodeId, context, onWait) {
    for (;;) {
      // Listening before looking: a device that connects while this looks is not missed.
      let wake;
      const woken = new Promise((resolve) => { wake = resolve; });
      this.on(`online:${nodeId}`, wake);
      this.on(`forgotten:${nodeId}`, wake);
      try {
        if (this.live.get(nodeId)?.ready) return this.live.get(nodeId);
        const record = await this.get(nodeId);
        if (!record) throw new Error("That device is no longer paired with Conduit");
        if (!this.live.get(nodeId)?.ready) {
          onWait?.(record);
          this.emit("waiting", { nodeId, name: record.name });
          await awaitWithContext(woken, context);
        }
      } finally {
        this.off(`online:${nodeId}`, wake);
        this.off(`forgotten:${nodeId}`, wake);
      }
    }
  }

  /**
   * One call on a device: `{ target, method, args, cwd }`, and for an action
   * `{ action, from }`; events (output, changes) go to `onEvent`. `onSent`
   * hears which run of the node (its boot) took the call; `boot` refuses to
   * send to any other run -- a restarted node does not know the action.
   */
  async call(nodeId, message, context, { onEvent, onWait, onSent, boot } = {}) {
    const node = await this.online(nodeId, context, onWait);
    if (boot !== undefined && node.boot !== boot) throw Object.assign(new Error("The device restarted"), { restarted: true });
    const { id, done } = node.call(message, onEvent);
    onSent?.(node.boot);
    const abort = () => node.send({ type: "abort", id });
    context.abortSignal?.addEventListener("abort", abort, { once: true });
    try { return await done; } finally { context.abortSignal?.removeEventListener("abort", abort); }
  }

  /**
   * Stop a device process when its device is next connected: one main let go
   * of while the device was away (a terminal closed) must not run on there
   * unowned. Kept in nodes.json, so a restart here does not forget it.
   */
  async killLater(nodeId, procId) {
    const record = await this.get(nodeId);
    if (!record || !procId) return;
    record.pendingKills = [...new Set([...(record.pendingKills || []), procId])];
    await this.save().catch(() => {});
  }

  /** Follow a device process: `deliver` gets its output and exit; `resume` reattaches after a reconnect. */
  follow(follower) { this.following.set(`${follower.nodeId} ${follower.procId}`, follower); }

  unfollow(follower) {
    const key = `${follower.nodeId} ${follower.procId}`;
    if (this.following.get(key) === follower) this.following.delete(key);
  }

  shutdown() {
    for (const node of this.live.values()) node.socket.close(1001, "server stopping");
    this.wss.close();
  }
}

const TAILNET_V4 = new net.BlockList();
TAILNET_V4.addSubnet("100.64.0.0", 10, "ipv4");
TAILNET_V4.addSubnet("127.0.0.0", 8, "ipv4");

/** Loopback or a Tailscale address (100.64.0.0/10, fd7a:115c:a1e0::/48). */
/**
 * The address a device dialled from. A proxy on this machine connects from
 * loopback for anyone, so a request it forwarded is judged by the client it
 * names: a tailnet address passed by `tailscale serve` is the device; a
 * public tunnel (Cloudflare, Funnel, any other forwarder) is refused, since
 * the pairing key alone was never meant to face the internet.
 */
export function clientAddress(request) {
  const headers = request.headers || {};
  if (["cf-connecting-ip", "tailscale-funnel-request", "forwarded", "x-real-ip"].some((name) => headers[name] !== undefined)) return "";
  const forwarded = headers["x-forwarded-for"];
  if (forwarded === undefined) return request.socket.remoteAddress || "";
  // The nearest proxy's entry is the last; any earlier one is the client's own word.
  const nearest = String(forwarded).split(",").map((item) => item.trim()).filter(Boolean).at(-1) || "";
  const local = request.socket.remoteAddress || "";
  return isTailnetOrLoopback(local) && isTailnetOrLoopback(nearest) && !isLoopback(nearest) ? nearest : "";
}

const isLoopback = (address) => /^(::ffff:)?127\./.test(address) || address === "::1";

export function isTailnetOrLoopback(address = "") {
  const plain = address.replace(/^::ffff:/, "");
  if (plain === "::1") return true;
  if (net.isIPv4(plain)) return TAILNET_V4.check(plain, "ipv4");
  return plain.toLowerCase().startsWith("fd7a:115c:a1e0:");
}
