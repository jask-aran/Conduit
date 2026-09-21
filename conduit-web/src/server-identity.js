import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/*
 * Who this server is, and where it answers.
 *
 * A client reaching the same machine by two addresses had no way to know it
 * was one server, because nothing it could see said so -- and asking an
 * unauthenticated endpoint "who are you" would let anything on the network
 * claim to be somewhere a token is already held. So the answer is given only
 * over an authenticated connection, which is the point of this file.
 *
 * The id is stable across restarts and means nothing on its own: it is not a
 * secret, not a credential, and grants nothing. It exists so two addresses can
 * be recognised as one server rather than kept apart forever.
 *
 * The key pair is what makes an address safe to move to. A client that has
 * signed in once holds the public half; afterwards it can hand any address a
 * random nonce and ask for it back signed, and only this server can answer.
 * That settles "is the thing at 192.168.0.128 the server I paired with" before
 * a token is sent to it rather than after -- which is the whole difficulty,
 * since the usual way to check is to authenticate, and authenticating is the
 * thing that would give a stranger the credential.
 *
 * The private half never leaves the machine and is not a login: possessing it
 * proves identity and grants nothing.
 */

const PRIVATE_ADDRESS = /^(10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|192\.168(\.\d{1,3}){2}|169\.254(\.\d{1,3}){2})$/;

/** What a path costs to establish, and where it can be reached from. */
export const PATH_SCOPES = Object.freeze({
  loopback: "loopback",
  private: "private",
  public: "public",
});

export function scopeForHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return PATH_SCOPES.loopback;
  if (PRIVATE_ADDRESS.test(host)) return PATH_SCOPES.private;
  return PATH_SCOPES.public;
}

/**
 * The addresses this machine holds, as the operating system reports them.
 *
 * Only IPv4, and only the private ranges plus loopback: a public address on an
 * interface is not usable as a path without knowing what sits in front of it,
 * and guessing wrong would hand every client an address that times out. Those
 * arrive the other way, by being used -- see `observe`.
 */
export function localPaths(port, interfaces = os.networkInterfaces()) {
  const origins = [`http://127.0.0.1:${port}`];
  for (const list of Object.values(interfaces || {})) {
    for (const entry of list || []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      // Link-local is what a machine gives itself when nothing handed it an
      // address. It is a private address by the rules above, and almost never
      // a path anything can reach -- offering it would put a row in every
      // client's menu that only ever fails to answer.
      if (!PRIVATE_ADDRESS.test(entry.address) || entry.address.startsWith("169.254.")) continue;
      const origin = `http://${entry.address}:${port}`;
      if (!origins.includes(origin)) origins.push(origin);
    }
  }
  return origins;
}

/** The address a request came in on, as the caller wrote it. */
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

export class ServerIdentity {
  constructor(filePath, { port = 4310, now = Date.now } = {}) {
    this.filePath = filePath;
    this.port = port;
    this.now = now;
    this.id = "";
    /** origin -> last seen, for addresses this server has actually answered on. */
    this.observed = new Map();
    this.writing = null;
  }

  async load() {
    let saved = null;
    try { saved = JSON.parse(await fs.readFile(this.filePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    this.id = typeof saved?.id === "string" && /^[0-9a-f]{32}$/.test(saved.id) ? saved.id : crypto.randomBytes(16).toString("hex");
    for (const entry of Array.isArray(saved?.observed) ? saved.observed : []) {
      if (typeof entry?.origin === "string" && Number.isFinite(entry.seenAt)) this.observed.set(entry.origin, entry.seenAt);
    }
    const restored = typeof saved?.privateKey === "string" ? this.restoreKey(saved.privateKey) : null;
    this.privateKey = restored || crypto.generateKeyPairSync("ed25519").privateKey;
    this.publicKey = crypto.createPublicKey(this.privateKey);
    if (saved?.id !== this.id || !restored) await this.save();
    return this;
  }

  restoreKey(pkcs8) {
    try {
      return crypto.createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
    } catch {
      // A key that cannot be read is replaced rather than fatal. The cost is
      // that every paired client has to be told the new public half, which the
      // next authenticated request does anyway; the alternative is a server
      // that refuses to start over a file it can regenerate.
      return null;
    }
  }

  /** The public half, as a client stores it. */
  publicKeyValue() {
    return this.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  }

  /*
   * Sign a caller's nonce, proving this is the server that issued the public
   * half somebody is holding.
   *
   * Answered without a session, on purpose: the point is to be checkable
   * *before* a credential is sent. That is safe because the reply proves
   * possession of a key and reveals nothing else -- the nonce comes from the
   * caller, so a recorded answer is worthless for the next question, and the
   * id it names is not a secret.
   */
  prove(nonce) {
    const value = String(nonce || "");
    if (!/^[A-Za-z0-9_-]{22,128}$/.test(value)) return null;
    const signature = crypto.sign(null, Buffer.from(`${this.id}.${value}`, "utf8"), this.privateKey);
    return { id: this.id, nonce: value, signature: signature.toString("base64") };
  }

  /*
   * Record an address a client actually reached this server on.
   *
   * This is how the public address arrives. The server cannot work out that it
   * sits behind `localconduit.jask-aran.com` -- nothing on the machine says so
   * -- but a client that got here through it proves the address works by
   * arriving, which is better evidence than configuration would be.
   *
   * Only ever called for an authenticated request. A Host header is written by
   * whoever sends it, so an unauthenticated one would let a passer-by put any
   * name in the list every client then reads. Signed in, the worst case is
   * somebody with the password writing an address that does not work, which is
   * a list they could edit anyway, and which every client probes before using.
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

  /** Every address this server believes it answers on, with what each costs. */
  paths() {
    const seen = new Set();
    const rows = [];
    for (const origin of [...localPaths(this.port), ...this.observed.keys()]) {
      if (seen.has(origin)) continue;
      seen.add(origin);
      rows.push({ origin, scope: scopeForHost(new URL(origin).hostname) });
    }
    return rows;
  }

  describe() {
    return { id: this.id, publicKey: this.publicKeyValue(), paths: this.paths() };
  }

  schedule() {
    if (this.writing) return;
    // Observing happens on request paths, so the write is coalesced rather than
    // paid by whoever happened to arrive.
    this.writing = setTimeout(() => { this.writing = null; void this.save(); }, 1_000);
    this.writing.unref?.();
  }

  async save() {
    const payload = JSON.stringify({
      id: this.id,
      privateKey: this.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      observed: [...this.observed].map(([origin, seenAt]) => ({ origin, seenAt })),
    }, null, 2);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // The private half is in here, so the file is the owner's alone. It is not
    // a login and cannot be used to sign in, but a copy of it would let
    // something else answer "yes, I am that server".
    await fs.writeFile(this.filePath, `${payload}\n`, { mode: 0o600 });
  }
}
