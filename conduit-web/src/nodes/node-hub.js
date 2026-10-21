import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { awaitWithContext } from "@earendil-works/chord/context";
import { NODE_PROTOCOL_VERSION } from "./protocol.js";

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
export class NodeHub extends EventEmitter {
  constructor({ dataRoot, allowRemote = isTailnetOrLoopback }) {
    super();
    this.file = path.join(dataRoot, "nodes.json");
    this.allowRemote = allowRemote;
    this.records = null;
    this.live = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  }

  async load() {
    if (this.records) return this.records;
    try { this.records = JSON.parse(await fs.readFile(this.file, "utf8")).nodes || []; }
    catch (error) { if (error.code !== "ENOENT") throw error; this.records = []; }
    return this.records;
  }

  async save() {
    await fs.writeFile(this.file, `${JSON.stringify({ version: 1, nodes: this.records }, null, 2)}\n`, { mode: 0o600 });
  }

  async pair(name) {
    await this.load();
    const key = `cnk_${crypto.randomBytes(32).toString("base64url")}`;
    const record = { id: `node_${crypto.randomUUID()}`, name: String(name || "Device").trim().slice(0, 80) || "Device",
      keyHash: hash(key), createdAt: new Date().toISOString(), lastSeenAt: null, roots: [], platform: null };
    this.records.push(record);
    await this.save();
    return { node: this.view(record), key };
  }

  async forget(id) {
    await this.load();
    this.records = this.records.filter((record) => record.id !== id);
    await this.save();
    this.live.get(id)?.socket.close(4001, "unpaired");
    // A call waiting for this device will not see it again.
    this.emit(`forgotten:${id}`);
    this.emit("changed");
  }

  view(record) {
    const live = this.live.get(record.id);
    return { id: record.id, name: record.name, platform: live?.platform || record.platform || null,
      online: Boolean(live), roots: live?.roots || record.roots || [], lastSeenAt: live ? new Date().toISOString() : record.lastSeenAt };
  }

  async list() { return (await this.load()).map((record) => this.view(record)); }

  async get(id) { return (await this.load()).find((record) => record.id === id) || null; }

  handleUpgrade(request, socket, head) {
    if (!this.allowRemote(request.socket.remoteAddress)) return socket.destroy();
    const key = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    void this.load().then((records) => {
      const record = key && records.find((item) => crypto.timingSafeEqual(Buffer.from(item.keyHash), Buffer.from(hash(key))));
      if (!record) return socket.destroy();
      this.wss.handleUpgrade(request, socket, head, (ws) => this.attach(record, ws));
    }, () => socket.destroy());
  }

  attach(record, ws) {
    // A call that opened a watcher keeps hearing its changes after it returns,
    // until the watcher it opened is closed: call id -> { handle, onEvent }.
    const node = { socket: ws, calls: new Map(), watchers: new Map(), roots: [], platform: null, ready: false };
    let ids = 0;
    node.send = (message) => ws.send(JSON.stringify(message));
    node.call = (message, onEvent) => {
      const id = `c${++ids}`;
      const done = new Promise((resolve, reject) => node.calls.set(id, { resolve, reject, onEvent }));
      if (message.target !== "env" && message.method === "close") {
        for (const [callId, watcher] of node.watchers) if (watcher.handle === message.target) node.watchers.delete(callId);
      }
      node.send({ ...message, type: "call", id });
      return { id, done };
    };
    ws.on("message", (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === "hello") {
        if (message.version !== NODE_PROTOCOL_VERSION) {
          node.send({ type: "refused", reason: `main speaks node protocol ${NODE_PROTOCOL_VERSION}, this node ${message.version}` });
          return ws.close();
        }
        // A device reconnecting replaces its old socket.
        this.live.get(record.id)?.socket.close(4000, "replaced");
        Object.assign(node, { roots: Array.isArray(message.roots) ? message.roots : [], platform: message.platform || null, ready: true });
        this.live.set(record.id, node);
        Object.assign(record, { roots: node.roots, platform: node.platform, lastSeenAt: new Date().toISOString() });
        if (message.name && record.name === "Device") record.name = String(message.name).slice(0, 80);
        void this.save();
        this.emit("changed");
        this.emit(`online:${record.id}`);
        return;
      }
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
      for (const pending of node.calls.values()) pending.reject(Object.assign(new Error(`${record.name} disconnected during the call`), { interrupted: true }));
      node.calls.clear();
      if (this.live.get(record.id) === node) {
        this.live.delete(record.id);
        record.lastSeenAt = new Date().toISOString();
        void this.save();
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

  /** One call on a device: `{ target, method, args, cwd }`; events (output, changes) go to `onEvent`. */
  async call(nodeId, message, context, { onEvent, onWait } = {}) {
    const node = await this.online(nodeId, context, onWait);
    const { id, done } = node.call(message, onEvent);
    const abort = () => node.send({ type: "abort", id });
    context.abortSignal?.addEventListener("abort", abort, { once: true });
    try { return await done; } finally { context.abortSignal?.removeEventListener("abort", abort); }
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
export function isTailnetOrLoopback(address = "") {
  const plain = address.replace(/^::ffff:/, "");
  if (plain === "::1") return true;
  if (net.isIPv4(plain)) return TAILNET_V4.check(plain, "ipv4");
  return plain.toLowerCase().startsWith("fd7a:115c:a1e0:");
}
