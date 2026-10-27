import crypto from "node:crypto";
import fs from "node:fs/promises";
import { encrypt, generateVapidKeys, vapidAuthorization } from "./web-push.js";

function invalid(code) {
  return Object.assign(new Error(code), { status: 400, code });
}

/**
 * The hub's push subscriptions and their delivery. One file holds the hub's VAPID key pair and every subscription, so it
 * is written whole and private. An endpoint is a capability (whoever holds it can push to that device), so `list()`
 * shows only its host; a push service's 404 or 410 means the device is gone and its subscription is dropped.
 */
export class PushService {
  constructor({ file, subject, fetch = globalThis.fetch, now = Date.now }) {
    this.file = file;
    this.subject = subject;
    this.fetch = fetch;
    this.now = now;
    this.state = null;
    this.queue = Promise.resolve();
  }

  serialize(action) {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }

  async save() {
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(this.state), { mode: 0o600, flag: "wx" });
      await fs.rename(temp, this.file);
    } finally {
      await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  load() {
    return this.serialize(async () => {
      try {
        this.state = JSON.parse(await fs.readFile(this.file, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        this.state = { vapid: generateVapidKeys(), subscriptions: [] };
        await this.save();
      }
    });
  }

  publicKey() { return this.state.vapid.publicKey; }

  list() {
    return this.state.subscriptions.map(({ id, kind, label, endpoint, createdAt, lastOkAt, lastError }) =>
      ({ id, kind, label, endpointHost: new URL(endpoint).host, createdAt, lastOkAt, lastError }));
  }

  add(input) {
    return this.serialize(async () => {
      const { endpoint, keys, kind } = input || {};
      let url;
      try { if (typeof endpoint === "string" && endpoint.length <= 2048) url = new URL(endpoint); } catch {}
      if (!url || !["https:", "http:"].includes(url.protocol)) throw invalid("invalid_endpoint");
      if (typeof keys?.p256dh !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.p256dh)) throw invalid("invalid_p256dh");
      const point = Buffer.from(keys.p256dh, "base64url");
      if (point.length !== 65 || point[0] !== 4) throw invalid("invalid_p256dh");
      if (typeof keys?.auth !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.auth) || Buffer.from(keys.auth, "base64url").length !== 16) throw invalid("invalid_auth");
      if (!["unifiedpush", "webpush"].includes(kind)) throw invalid("invalid_kind");
      const label = input.label === undefined ? (kind === "webpush" ? "Web Push" : "UnifiedPush") : input.label;
      if (typeof label !== "string" || label.length > 80) throw invalid("invalid_label");
      let sub = this.state.subscriptions.find((item) => item.endpoint === endpoint);
      if (!sub) {
        sub = { id: crypto.randomUUID(), endpoint, createdAt: new Date(this.now()).toISOString(), lastOkAt: null, lastError: null };
        this.state.subscriptions.push(sub);
      }
      Object.assign(sub, { keys: { p256dh: keys.p256dh, auth: keys.auth }, kind, label });
      await this.save();
      return { id: sub.id };
    });
  }

  remove(id) {
    return this.serialize(async () => {
      const index = this.state.subscriptions.findIndex((sub) => sub.id === id);
      if (index < 0) return false;
      this.state.subscriptions.splice(index, 1);
      await this.save();
      return true;
    });
  }

  send(message, { urgency = "normal", topic, ttl = 86400, only } = {}) {
    return this.serialize(async () => {
      if (!["very-low", "low", "normal", "high"].includes(urgency)) throw invalid("invalid_urgency");
      const subscriptions = this.state.subscriptions.filter((sub) => !only || only.includes(sub.id));
      const results = await Promise.all(subscriptions.map(async (sub) => {
        let status = null;
        try {
          const headers = {
            "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm",
            TTL: String(ttl), Urgency: urgency,
            Authorization: vapidAuthorization({ endpoint: sub.endpoint, subject: this.subject, ...this.state.vapid, expiresAt: Math.floor(this.now() / 1000) + 43200 }),
          };
          if (topic !== undefined) {
            const value = String(topic);
            headers.Topic = /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : crypto.createHash("sha256").update(value).digest("base64url").slice(0, 32);
          }
          const response = await this.fetch(sub.endpoint, { method: "POST", headers, body: encrypt(sub.keys, Buffer.from(JSON.stringify(message))), signal: AbortSignal.timeout(10000), redirect: "manual" });
          status = response.status;
          // Delivery uses the status only; release an unread or stalled body.
          await response.body?.cancel().catch(() => {});
          if (status >= 200 && status < 300) {
            sub.lastOkAt = new Date(this.now()).toISOString();
            sub.lastError = null;
            return { id: sub.id, ok: true, status };
          }
          if (status === 404 || status === 410) return { id: sub.id, ok: false, status, removed: true };
          sub.lastError = `HTTP ${status}`;
        } catch (error) {
          // Error messages from fetch can contain the endpoint capability.
          sub.lastError = String(error?.name || "Error").slice(0, 80);
        }
        return { id: sub.id, ok: false, status };
      }));
      const removed = new Set(results.filter((result) => result.removed).map((result) => result.id));
      this.state.subscriptions = this.state.subscriptions.filter((sub) => !removed.has(sub.id));
      await this.save();
      return results;
    });
  }
}
