import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PRIVATE_HOST } from "./network-hosts.js";
import { writePrivateFile } from "./private-file.js";

/*
 * The id is not a secret and grants nothing: it lets two addresses be recognised as one server.
 * The signed nonce proves the private key exists somewhere reachable, not that the thing that answered holds it: it
 * says nothing about the address, so something on a hostile network can relay it, and cleartext HTTP has no channel to
 * bind the proof to.
 */

export const PATH_SCOPES = Object.freeze({
  loopback: "loopback",
  private: "private",
  public: "public",
});

export function scopeForHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return PATH_SCOPES.loopback;
  if (PRIVATE_HOST.test(host)) return PATH_SCOPES.private;
  return PATH_SCOPES.public;
}

// Only private ranges plus loopback: a public address on an interface is not usable as a path without knowing what
// sits in front of it. Those arrive by being used (`observe`).
export function localPaths(port, interfaces = os.networkInterfaces()) {
  const origins = [`http://127.0.0.1:${port}`];
  for (const list of Object.values(interfaces || {})) {
    for (const entry of list || []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      // Link-local is almost never a path anything can reach: offered, it would only ever fail to answer.
      if (!PRIVATE_HOST.test(entry.address) || entry.address.startsWith("169.254.")) continue;
      const origin = `http://${entry.address}:${port}`;
      if (!origins.includes(origin)) origins.push(origin);
    }
  }
  return origins;
}

export function originOfRequest(request) {
  const host = String(request.headers?.host || "").trim();
  if (!host || /[^a-z0-9.:\-[\]]/i.test(host)) return null;
  const forwarded = String(request.headers?.["x-forwarded-proto"] || "").toLowerCase().split(",")[0].trim();
  const protocol = forwarded || request.protocol || "http";
  if (protocol !== "http" && protocol !== "https") return null;
  try {
    const url = new URL(`${protocol}://${host}`);
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const MAX_OBSERVED = 10;
const OBSERVED_KEPT_MS = 14 * 86400_000;
const OBSERVED_CHECK_MS = 3600_000;

export class ServerIdentity {
  constructor(filePath, { port = 4310, network = true, now = Date.now, name = process.env.CONDUIT_SERVER_NAME } = {}) {
    this.filePath = filePath;
    this.configuredName = name;
    this.name = "";
    this.port = port;
    // False when the server is bound to loopback: its private addresses are then not routes anything can take.
    this.network = network;
    this.now = now;
    this.id = "";
    this.observed = new Map();
    this.published = [];
    // False on a hub nobody shares a network with (a VPS): its private addresses and LAN names are not routes.
    this.lan = true;
    this.writing = null;
  }

  async load() {
    let saved = null;
    let text = null;
    try { text = await fs.readFile(this.filePath, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    // A file that will not parse is treated like a missing one: a new identity costs a re-pair, a server that cannot
    // start costs everything.
    try { saved = text == null ? null : JSON.parse(text); } catch { saved = null; }
    // The configured name only seeds it; a saved rename wins.
    this.name = String(saved?.name || this.configuredName || os.hostname() || "Conduit").trim().slice(0, 63) || "Conduit";
    this.id = typeof saved?.id === "string" && /^[0-9a-f]{32}$/.test(saved.id) ? saved.id : crypto.randomBytes(16).toString("hex");
    this.lan = saved?.lan !== false;
    this.published = (Array.isArray(saved?.published) ? saved.published : []).filter((origin) => {
      try { return /^https?:$/.test(new URL(origin).protocol); } catch { return false; }
    });
    for (const entry of Array.isArray(saved?.observed) ? saved.observed : []) {
      if (typeof entry?.origin === "string" && Number.isFinite(entry.seenAt)) this.observed.set(entry.origin, entry.seenAt);
    }
    const restored = typeof saved?.privateKey === "string" ? this.restoreKey(saved.privateKey) : null;
    this.privateKey = restored || crypto.generateKeyPairSync("ed25519").privateKey;
    this.publicKey = crypto.createPublicKey(this.privateKey);
    if (saved?.id !== this.id || saved?.name !== this.name || !restored) await this.save();
    return this;
  }

  restoreKey(pkcs8) {
    try {
      return crypto.createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
    } catch {
      // Replaced rather than fatal: the next authenticated request tells each client the new public half.
      return null;
    }
  }

  async rename(value) {
    const name = String(value ?? "").trim();
    if (!name || name.length > 63 || /[\u0000-\u001f\u007f]/.test(name)) return false;
    this.name = name;
    await this.save();
    return true;
  }

  publicKeyValue() {
    return this.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  }

  /*
   * Answered without a session, on purpose: the point is to be checkable before a credential is sent. The nonce comes
   * from the caller, so a recorded answer is worthless for the next question.
   */
  prove(nonce) {
    const value = String(nonce || "");
    if (!/^[A-Za-z0-9_-]{22,128}$/.test(value)) return null;
    const signature = crypto.sign(null, Buffer.from(`${this.id}.${value}`, "utf8"), this.privateKey);
    return { id: this.id, nonce: value, signature: signature.toString("base64") };
  }

  /*
   * Only ever called for an authenticated request: a Host header is written by whoever sends it, so an
   * unauthenticated one would let a passer-by put any name in the list every client then reads.
   */
  observe(request) {
    const origin = originOfRequest(request);
    if (!origin) return;
    // A loopback or private address is already derived from the interfaces, and
    // one seen here would only be this machine's own view of itself.
    if (scopeForHost(new URL(origin).hostname) !== PATH_SCOPES.public) return;
    this.observed.set(origin, this.now());
    if (this.observed.size > MAX_OBSERVED) {
      const oldest = [...this.observed.entries()].sort((left, right) => left[1] - right[1])[0];
      if (oldest) this.observed.delete(oldest[0]);
    }
    this.schedule();
  }

  // A DNS failure that is not "no such name" (offline, a timeout) forgets nothing.
  async prune() {
    let changed = false;
    for (const [origin, seenAt] of [...this.observed]) {
      if (this.published.includes(origin)) { this.observed.delete(origin); changed = true; continue; }
      let gone = this.now() - seenAt > OBSERVED_KEPT_MS;
      if (!gone) {
        const { hostname } = new URL(origin);
        gone = await dns.lookup(hostname, { all: true }).then(() => false, (error) => ["ENOTFOUND", "ENODATA"].includes(error.code));
      }
      if (gone) { this.observed.delete(origin); changed = true; }
    }
    if (changed) await this.save();
    return changed;
  }

  followObserved() {
    void this.prune().catch(() => {});
    const timer = setInterval(() => void this.prune().catch(() => {}), OBSERVED_CHECK_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  // `published` and `lan` are set by hand in identity.json.
  paths() {
    const seen = new Set();
    const rows = [];
    const local = localPaths(this.port).filter((origin) => (this.network && this.lan) || scopeForHost(new URL(origin).hostname) !== PATH_SCOPES.private);
    // LAN names follow the machine to a new address: a client that saved one still has a way back after the router
    // hands out another.
    const named = this.network && this.lan ? (this.names?.() || []).map((name) => `https://${name}:${this.port}`) : [];
    for (const origin of [...local, ...named, ...this.published, ...this.observed.keys()]) {
      if (seen.has(origin)) continue;
      seen.add(origin);
      rows.push({ origin, scope: scopeForHost(new URL(origin).hostname) });
    }
    return rows;
  }

  describe() {
    return {
      id: this.id,
      name: this.name,
      publicKey: this.publicKeyValue(),
      paths: this.paths(),
      // Every path also answers TLS on the same port, with a leaf this identity attests.
      tls: true,
    };
  }

  schedule() {
    if (this.writing) return;
    // Observing happens on request paths, so the write is coalesced rather than paid by whoever happened to arrive.
    this.writing = setTimeout(() => { this.writing = null; void this.save(); }, 1_000);
    this.writing.unref?.();
  }

  async flush() {
    if (!this.writing) return;
    clearTimeout(this.writing);
    this.writing = null;
    await this.save();
  }

  async save() {
    const payload = JSON.stringify({
      id: this.id,
      name: this.name,
      privateKey: this.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      ...(this.published.length ? { published: this.published } : {}),
      ...(this.lan ? {} : { lan: false }),
      observed: [...this.observed].map(([origin, seenAt]) => ({ origin, seenAt })),
    }, null, 2);
    await writePrivateFile(this.filePath, `${payload}\n`);
  }
}
