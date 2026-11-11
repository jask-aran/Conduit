import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { awaitWithContext, BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { decode, encode, NODE_FEATURES, NODE_PROTOCOL_VERSION, servedCall } from "./protocol.js";
import { capabilitiesOf, helloCapabilities, keptCapabilities, NODE_TARGETS } from "../device-api.js";
import { channelKey, DIRECT_PTY_TTL_MS, DIRECT_TTL_MS, proofKey, signGrant } from "./direct.js";
import { FileError } from "@earendil-works/pi-durable/env";
import { writePrivateJson } from "../private-file.js";

const hash = (key) => crypto.createHash("sha256").update(key).digest("hex");

/**
 * Main keeps only a pairing key's hash. A node dialling from anywhere but loopback, the tailnet or the private LAN is
 * turned away before the key is looked at. The node enforces the grants its hello declares.
 */
const RELAYS_PER_SOCKET = 8;
const RELAY_ENV_MAX = 64;
const HELLO_WAIT_MS = 30_000;

/** Where a node says it answers reads itself, as far as it can be taken at its word. */
function directOf(direct, lanName = null) {
  if (!Number.isInteger(direct?.port) || direct.port <= 0) return null;
  const addresses = (Array.isArray(direct.addresses) ? direct.addresses : [])
    .filter((item) => typeof item?.address === "string" && /^[\d.]+$/.test(item.address) && ["private", "tailnet"].includes(item.reach)).slice(0, 8);
  // Names it serves https under: its tailnet name, and the one the hub gave it here, nothing else.
  const names = (Array.isArray(direct.tls?.names) ? direct.tls.names : []).map((name) => String(name).toLowerCase())
    .filter((name) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name) && (name.endsWith(".ts.net") || name === lanName)).slice(0, 4);
  const tls = Number.isInteger(direct.tls?.port) && direct.tls.port > 0 && names.length ? { port: direct.tls.port, names } : null;
  // The key this run of it signs grants with is given only over a link nobody else reads.
  const grantKey = typeof direct.grantKey === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(direct.grantKey) ? direct.grantKey : null;
  return { port: direct.port, addresses, tls, bound: Boolean(direct.pty), pty: direct.pty === "sealed", reads: direct.reads === "sealed", grantKey };
}

export class NodeHub extends EventEmitter {
  constructor({ dataRoot, allowRemote = isNodeAddress, lanNames = null, identity = null, routes = null }) {
    super();
    this.file = path.join(dataRoot, "nodes.json");
    this.allowRemote = allowRemote;
    this.lanNames = lanNames;
    // Every way a node may reach the hub, told to each node as it connects: a node paired by one address still finds
    // the hub when that one stops answering.
    this.identity = identity;
    this.routes = routes;
    this.lanNameOf = new Map();
    this.records = null;
    this.devices = null;
    // Per node, the runs (by `boot`) a newer run has replaced: refused from then on.
    this.retired = new Map();
    this.live = new Map();
    // Device processes main follows, by `${nodeId} ${procId}`: they outlive a
    // socket, so a reconnect resumes each from the last byte it had.
    this.following = new Map();
    this.tunnels = new Map();
    // Every socket of a node, by node id, from connect: unpairing closes them all.
    this.attached = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
    // A node on the tailnet may be across the internet, where its process
    // output, listings and files (JSON, base64 for bytes) are worth deflating;
    // one on loopback or the LAN is not worth the time.
    this.deflated = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024,
      perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 1, memLevel: 7 } } });
  }

  async load() {
    if (this.records) return this.records;
    let stored = {};
    try { stored = JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    this.records = stored.nodes || [];
    this.devices = stored.devices || [];
    // The hub's device is not a record (it is never paired), so only a name given to it is kept.
    this.hubDevice = stored.hubDevice || stored.headDevice || {};
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
   * Writes go one at a time and replace the file whole, so devices reconnecting together cannot interleave a torn
   * nodes.json. A failed write is logged, never thrown at a socket handler: last-seen times are not worth the server.
   */
  save() {
    this.saving = (this.saving || Promise.resolve()).then(async () => {
      await writePrivateJson(this.file, { version: 2, devices: this.devices, hubDevice: this.hubDevice, nodes: this.records });
    });
    const done = this.saving;
    this.saving = done.catch((error) => console.error("Could not save paired devices", error));
    return done;
  }

  async pair({ name, deviceId = null, deviceName = null } = {}) {
    await this.load();
    // The hub's own device takes nodes too: on a desktop that is the hub, its Windows side pairs into the device its
    // WSL is the hub of.
    const onHub = Boolean(deviceId) && deviceId === this.hub?.deviceId;
    let device = onHub ? { id: deviceId } : deviceId && this.devices.find((item) => item.id === deviceId);
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
    return { node: this.view(record), device: onHub ? (await this.listDevices())[0] : this.deviceView(device), key };
  }

  async renameDevice(id, name) {
    await this.load();
    const value = String(name || "").trim().slice(0, 80);
    if (!value) throw Object.assign(new Error("A device needs a name"), { status: 400, code: "device_name_required" });
    if (id === this.hub?.deviceId) this.hubDevice = { ...this.hubDevice, name: value };
    else {
      const device = this.devices.find((item) => item.id === id);
      if (!device) throw Object.assign(new Error("No such device"), { status: 404, code: "device_not_found" });
      device.name = value;
    }
    await this.save();
    this.emit("changed");
  }

  async forget(id) {
    this.retired.delete(id);
    await this.load();
    const gone = this.records.find((record) => record.id === id);
    this.records = this.records.filter((record) => record.id !== id);
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
      online: Boolean(live), ...capabilitiesOf(live, record), lastSeenAt: live ? new Date().toISOString() : record.lastSeenAt,
      via: live?.socket?.via || null };
  }

  deviceView(device) {
    return { id: device.id, name: device.name,
      nodes: this.records.filter((record) => record.deviceId === device.id).map((record) => this.view(record)) };
  }

  async list() { return (await this.load()).map((record) => this.view(record)); }

  /** The hub's own environment is never offline, so it is not among them. */
  availability() {
    const deviceName = (id) => (this.devices || []).find((device) => device.id === id)?.name
      || (this.hub && id === this.hub.deviceId ? this.hubDevice.name || os.hostname() : null);
    return (this.records || []).map((record) => ({ id: record.id, name: record.name, device: deviceName(record.deviceId),
      online: Boolean(this.live.get(record.id)?.ready), lastSeenAt: record.lastSeenAt || null }));
  }

  async listDevices() {
    const [records, hubNode] = await Promise.all([this.load(), this.hub ? this.hubView() : null]);
    // The hub's device is named as the machine is, until renamed; the hub itself goes by the server's name.
    const hub = this.hub ? [{ id: this.hub.deviceId, name: this.hubDevice.name || os.hostname() || this.hub.name(), local: true, hub: this.hub.name(),
      nodes: [hubNode, ...records.filter((record) => record.deviceId === this.hub.deviceId).map((record) => this.view(record))] }] : [];
    return [...hub, ...this.devices.map((device) => this.deviceView(device))];
  }

  /** The hub's own device is not paired and never offline; its calls run in process, so it is not among `live` sockets. */
  adoptHub({ deviceId, nodeId, name, roots, harnesses }) { this.hub = { deviceId, nodeId, name, roots, harnesses }; }

  async hubView() {
    // A WSL distro is named as one: it shares its device with Windows, which pairs as its own environment.
    // From the kernel, not WSL_DISTRO_NAME: a service started by systemd does not carry it.
    const wsl = process.platform === "linux" && /microsoft/i.test(os.release());
    const [platform, roots] = await Promise.all([
      wsl ? distroName() : { win32: "Windows", darwin: "macOS" }[process.platform] || "Linux",
      this.hub.roots(),
    ]);
    return { id: this.hub.nodeId, deviceId: this.hub.deviceId, name: platform, platform: process.platform, local: true, online: true,
      // Its browser is the hub's own (browser:hub), not one offered through a node; its terminal is the "computer"
      // one this server always offers.
      ...capabilitiesOf({ roots, harnesses: this.hub.harnesses() }), terminal: true, lastSeenAt: new Date().toISOString() };
  }

  async root(nodeId, rootId) {
    const record = await this.get(nodeId);
    return (this.live.get(nodeId)?.roots || record?.roots || []).find((root) => root.id === rootId) || null;
  }

  async get(id) { return (await this.load()).find((record) => record.id === id) || null; }

  async offerLanName(node, record, { renewed = false } = {}) {
    const address = node.direct?.addresses.find((item) => item.reach === "private")?.address;
    if (!this.lanNames || !address) return;
    const lan = await this.lanNames.forNode(record.id, address).catch(() => null);
    if (!lan || !node.ready || this.live.get(record.id) !== node) return;
    this.lanNameOf.set(record.id, lan.name);
    // Already serving it, and the record already points here: nothing to send.
    if (!renewed && node.direct?.tls?.names.includes(lan.name)) return;
    node.send({ type: "lan-cert", name: lan.name, cert: lan.cert, key: lan.key });
  }

  async reofferLanNames() {
    for (const [id, node] of this.live) {
      if (!node.ready) continue;
      const record = await this.get(id);
      if (record) await this.offerLanName(node, record, { renewed: true });
    }
  }

  async directGrant(nodeId, place, label = "", origin = "") {
    if (!place?.root) return null;
    const grant = await this.signDirect(nodeId, { place: { root: place.root, path: place.path || "" }, label, read: true }, DIRECT_TTL_MS, origin);
    const direct = this.live.get(nodeId)?.direct;
    return grant && direct?.reads && direct.grantKey ? { ...grant, channel: channelKey(direct.grantKey, grant.nonce, "read") } : grant;
  }

  /**
   * The channel key is handed to the client over its own connection to the hub and worked out by the node, so any
   * route that reaches the node will do, a LAN in plain HTTP included.
   */
  async directPtyGrant(nodeId, procId, origin = "") {
    const direct = this.live.get(nodeId)?.direct;
    if (!direct?.pty || !direct.grantKey || typeof procId !== "string") return null;
    const grant = await this.signDirect(nodeId, { pty: procId }, DIRECT_PTY_TTL_MS, origin);
    return grant ? { ...grant, channel: channelKey(direct.grantKey, grant.nonce) } : null;
  }

  async signDirect(nodeId, claims, ttl, origin) {
    const node = this.live.get(nodeId);
    const record = await this.get(nodeId);
    if (!node?.ready || !node.direct || !record?.keyHash) return null;
    // The run's own key where it gave one; a node without one checks reads with its pairing key's hash.
    const secret = node.direct.grantKey || record.keyHash;
    const expiresAt = Date.now() + ttl;
    const { port, addresses } = node.direct;
    // Nearest first: its own machine's loopback (only the app beside it can use that), then its networks', its tailnet's.
    const { tls } = node.direct;
    // A page can use only the https ones, under a name a certificate covers: this network's before the tailnet's.
    const secure = (tls?.names || []).map((name) => ({ url: `https://${name}:${tls.port}`, reach: name.endsWith(".ts.net") ? "tailnet" : "private" }))
      .sort((left, right) => (left.reach === right.reach ? 0 : left.reach === "private" ? -1 : 1));
    const routes = [{ url: `http://127.0.0.1:${port}`, reach: "loopback" },
      ...addresses.map(({ address, reach }) => ({ url: `http://${address}:${port}`, reach })), ...secure];
    const nonce = crypto.randomBytes(12).toString("base64url");
    return { nodeId, routes, expiresAt, nonce, proof: proofKey(secret, nonce),
      // Whether its proof is bound to the address it was reached at: a client then takes nothing else.
      bound: node.direct.bound,
      // The page it is for, when one asked: the node lets that origin read the answer.
      token: signGrant(secret, { ...claims, expires: expiresAt, nonce, ...(origin ? { origin } : {}) }) };
  }

  async computer(nodeId, method, at) {
    if (!this.live.get(nodeId)?.ready) throw Object.assign(new Error("That device is offline"), { code: "device_offline", status: 503 });
    const context = withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT);
    const result = decode(await this.call(nodeId, { target: "computer", method, args: encode([at || ""]) }, context), { FileError });
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || "The device refused"), { code: result?.error?.code, status: result?.error?.code === "permission_denied" ? 403 : 400 });
    if (method === "share") {
      const roots = result.value.filter((root) => typeof root?.id === "string");
      const node = this.live.get(nodeId);
      const record = await this.get(nodeId);
      if (node) node.roots = roots;
      if (record) record.roots = roots;
      await this.save().catch(() => {});
      this.emit("changed");
    }
    return result.value;
  }

  handleUpgrade(request, socket, head) {
    const address = clientAddress(request);
    if (!this.allowRemote(address)) return socket.destroy();
    const sockets = isTailnetOrLoopback(address) && !isLoopback(address) ? this.deflated : this.wss;
    const key = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    void this.byKey(key).then((record) => {
      if (!record) return socket.destroy();
      sockets.handleUpgrade(request, socket, head, (ws) => this.attach(record, ws));
    }, () => socket.destroy());
  }

  async byKey(key) {
    const records = await this.load();
    return (key && records.find((item) => crypto.timingSafeEqual(Buffer.from(item.keyHash), Buffer.from(hash(key))))) || null;
  }

  /* A relayed environment proves itself with its own key, as a direct connection would. */
  async relayOpen(outer, relaySocket, { env, key }, relaying) {
    const reply = (message) => { if (relaySocket.readyState === 1) relaySocket.send(JSON.stringify({ ...message, env })); };
    if (typeof env !== "string" || !env || env.length > RELAY_ENV_MAX) return reply({ type: "relay-closed", reason: "bad environment name" });
    const record = await this.byKey(String(key || ""));
    if (!record || relaySocket.readyState !== 1) return reply({ type: "relay-closed", reason: "unknown key" });
    // A device carries a few environments, not many: past that, an open is
    // refused. Counted after the key's lookup, so opens sent together cannot all pass.
    if (!outer.relayed.has(env) && outer.relayed.size >= RELAYS_PER_SOCKET) return reply({ type: "relay-closed", reason: "too many relayed environments" });
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
    socket.via = relaying.id;
    outer.relayed.set(env, socket);
    this.attach(record, socket);
    reply({ type: "relay-opened" });
    setTimeout(() => { if (socket.readyState === 1 && this.live.get(record.id)?.socket !== socket) socket.close(4002, "no hello"); }, HELLO_WAIT_MS).unref?.();
  }

  attach(record, ws) {
    // A call that opened a watcher keeps hearing its changes after it returns,
    // until the watcher it opened is closed: call id -> { handle, onEvent }.
    const node = { socket: ws, calls: new Map(), watchers: new Map(), roots: [], platform: null, ready: false,
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
        // A device reconnecting replaces its old socket. A run replaced by a newer one never takes the pairing back: a
        // node left running by an app that was closed or updated would otherwise trade it with its successor for good.
        const boot = typeof message.boot === "string" ? message.boot : null;
        const retired = this.retired.get(record.id) || new Set();
        if (boot && retired.has(boot)) {
          node.send({ type: "refused", reason: "a newer run of this node has the pairing", replaced: true });
          return ws.close();
        }
        const previous = this.live.get(record.id);
        if (previous?.boot && previous.boot !== boot) {
          retired.add(previous.boot);
          if (retired.size > 16) retired.delete(retired.values().next().value);
          this.retired.set(record.id, retired);
        }
        previous?.socket.close(4000, "replaced");
        Object.assign(node, helloCapabilities(message), { platform: message.platform || null,
          boot: typeof message.boot === "string" ? message.boot : null, ready: true,
          direct: directOf(message.direct, this.lanNameOf.get(record.id)) });
        void this.offerLanName(node, record);
        this.live.set(record.id, node);
        node.send({ type: "welcome", features: NODE_FEATURES });
        if (this.routes || this.identity) {
          void Promise.resolve(this.routes?.()).catch(() => []).then((routes) => {
            if (this.live.get(record.id) === node) node.send({ type: "routes", routes: routes || [], ...(this.identity ? { hub: this.identity } : {}) });
          });
        }
        Object.assign(record, keptCapabilities(node), { platform: node.platform, lastSeenAt: new Date().toISOString() });
        if (message.name && record.name === "Device") record.name = String(message.name).slice(0, 80);
        void this.save().catch(() => {});
        this.emit("changed");
        this.emit(`online:${record.id}`);
        // Keep each kill until the device acknowledges it, so a disconnect cannot lose it.
        if (record.pendingKills?.length) {
          const kills = record.pendingKills;
          for (const procId of kills) {
            void this.call(record.id, { target: "proc", method: "kill", args: [procId], cwd: null },
              withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)).then(async (result) => {
              if (!result.ok) return;
              record.pendingKills = record.pendingKills.filter((id) => id !== procId);
              await this.save();
            }).catch(() => {});
          }
        }
        // A follower whose process the device no longer has (it restarted) ends; never this server.
        for (const follower of this.following.values()) {
          if (follower.nodeId === record.id) void follower.resume().catch((error) => follower.lost(error));
        }
        return;
      }
      if (message.type === "capabilities") {
        if (this.live.get(record.id) !== node) return;
        Object.assign(node, helloCapabilities(message));
        Object.assign(record, keptCapabilities(node));
        void this.save().catch(() => {});
        this.emit("changed");
        return;
      }
      if (message.type === "direct") {
        if (node.ready) { node.direct = directOf(message.direct, this.lanNameOf.get(record.id)); void this.offerLanName(node, record); }
        return;
      }
      if (message.type === "proc") {
        const follower = this.following.get(`${record.id} ${message.proc}`);
        if (follower) return follower.deliver(message);
        // A shell that ended while nothing here followed it (a client attached to it directly, or none): said, so a
        // terminal is not listed as running when it is gone.
        if (message.kind === "exit") this.emit("procExit", { nodeId: record.id, procId: message.proc, code: message.code ?? null, signal: message.signal ?? null });
        return;
      }
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

  /** `boot` refuses to send to any other run of the node: a restarted node does not know the action. */
  async call(nodeId, message, context, { onEvent, onWait, onSent, boot } = {}) {
    // Only what is declared; a handle's methods are the node's to check.
    if (Object.hasOwn(NODE_TARGETS, message.target) && !servedCall(message.target, message.method)) throw new Error(`${message.target}.${message.method} is not a declared node call`);
    const node = await this.online(nodeId, context, onWait);
    if (boot !== undefined && node.boot !== boot) throw Object.assign(new Error("The device restarted"), { restarted: true });
    const { id, done } = node.call(message, onEvent);
    onSent?.(node.boot);
    const abort = () => node.send({ type: "abort", id });
    context.abortSignal?.addEventListener("abort", abort, { once: true });
    try { return await done; } finally { context.abortSignal?.removeEventListener("abort", abort); }
  }

  /**
   * A process main let go of while its device was away must not run on there unowned. Kept in nodes.json, so a restart
   * here does not forget it.
   */
  async killLater(nodeId, procId) {
    const record = await this.get(nodeId);
    if (!record || !procId) return;
    record.pendingKills = [...new Set([...(record.pendingKills || []), procId])];
    await this.save().catch(() => {});
  }

  follow(follower) { this.following.set(`${follower.nodeId} ${follower.procId}`, follower); }

  unfollow(follower) {
    const key = `${follower.nodeId} ${follower.procId}`;
    if (this.following.get(key) === follower) this.following.delete(key);
  }

  shutdown() {
    for (const node of this.live.values()) node.socket.close(1001, "server stopping");
    this.wss.close();
    this.deflated.close();
  }
}

const TAILNET_V4 = new net.BlockList();
TAILNET_V4.addSubnet("100.64.0.0", 10, "ipv4");
TAILNET_V4.addSubnet("127.0.0.0", 8, "ipv4");

/**
 * A proxy on this machine connects from loopback for anyone, so a request it forwarded is judged by the client it
 * names. A public tunnel is refused: the pairing key alone was never meant to face the internet.
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

// The private LAN ranges: a machine on this network that is not on the tailnet (a laptop's Windows) pairs over it.
const PRIVATE_V4 = new net.BlockList();
PRIVATE_V4.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_V4.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_V4.addSubnet("192.168.0.0", 16, "ipv4");

/** Where a node may dial from: loopback, the tailnet, or the private LAN -- never a public address. Its key still decides. */
export function isNodeAddress(address = "") {
  const plain = address.replace(/^::ffff:/, "");
  if (isTailnetOrLoopback(plain)) return true;
  if (net.isIPv4(plain)) return PRIVATE_V4.check(plain, "ipv4");
  return /^f[cd][0-9a-f]{2}:/i.test(plain);
}

const isLoopback = (address) => /^(::ffff:)?127\./.test(address) || address === "::1";

export function isTailnetOrLoopback(address = "") {
  const plain = address.replace(/^::ffff:/, "");
  if (plain === "::1") return true;
  if (net.isIPv4(plain)) return TAILNET_V4.check(plain, "ipv4");
  return plain.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

let distro;
function distroName() {
  distro ??= fs.readFile("/etc/os-release", "utf8").then((text) => /^NAME="?([^"\n]+)"?$/m.exec(text)?.[1] || "WSL", () => "WSL");
  return distro;
}
