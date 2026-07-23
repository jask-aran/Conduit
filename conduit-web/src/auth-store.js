import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const MAX_SESSIONS = 20;
const SCRYPT_MAX_MEM = 64 * 1024 * 1024;
const TOKEN_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_SEEN_REFRESH_MS = 60 * 1000;

function base64(buffer) {
  return buffer.toString("base64");
}

function timingSafeEqualString(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function normalizeAuthFile(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!("password" in raw)) return null;
  if (raw.password === null) {
    return {
      version: Number(raw.version) || 1,
      password: null,
      sessions: [],
    };
  }
  if (typeof raw.password !== "object") return null;
  const password = raw.password;
  if (password.algo !== "scrypt") return null;
  if (typeof password.salt !== "string" || typeof password.hash !== "string") return null;
  return {
    version: Number(raw.version) || 1,
    password: {
      algo: "scrypt",
      N: Number(password.N) || SCRYPT_N,
      r: Number(password.r) || SCRYPT_R,
      p: Number(password.p) || SCRYPT_P,
      keylen: Number(password.keylen) || SCRYPT_KEYLEN,
      salt: password.salt,
      hash: password.hash,
    },
    sessions: Array.isArray(raw.sessions) ? raw.sessions
      .filter((session) => session && typeof session.tokenHash === "string")
      .map((session) => ({
        tokenHash: session.tokenHash,
        createdAt: session.createdAt || null,
        lastSeenAt: session.lastSeenAt || null,
        userAgent: typeof session.userAgent === "string" ? session.userAgent : null,
      })) : [],
  };
}

export async function hashPassword(password, options = {}) {
  if (typeof password !== "string" || password.length === 0) {
    throw Object.assign(new Error("Password cannot be empty."), { code: "invalid_password" });
  }
  const salt = crypto.randomBytes(16);
  const N = options.N || SCRYPT_N;
  const r = options.r || SCRYPT_R;
  const p = options.p || SCRYPT_P;
  const keylen = options.keylen || SCRYPT_KEYLEN;
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAX_MEM }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
  return { algo: "scrypt", N, r, p, keylen, salt: base64(salt), hash: base64(hash) };
}

export async function verifyPassword(password, stored) {
  if (!stored || stored.algo !== "scrypt") return false;
  const salt = Buffer.from(stored.salt, "base64");
  const expected = Buffer.from(stored.hash, "base64");
  const N = Number(stored.N) || SCRYPT_N;
  const r = Number(stored.r) || SCRYPT_R;
  const p = Number(stored.p) || SCRYPT_P;
  const keylen = Number(stored.keylen) || expected.length || SCRYPT_KEYLEN;
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAX_MEM }, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function newSessionToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64");
}

function expiredSession(session, now = Date.now()) {
  const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : null;
  const created = session.createdAt ? new Date(session.createdAt).getTime() : null;
  const anchor = lastSeen ?? created;
  if (anchor == null) return false;
  return now - anchor > SESSION_TTL_MS;
}

export class AuthStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.lastReadMs = 0;
    this.initialPasswordClaim = Promise.resolve();
  }

  async load({ force = false } = {}) {
    if (!force && this.data) return this.data;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.data = normalizeAuthFile(raw);
      if (!this.data) {
        throw Object.assign(new Error(`Authentication file is malformed: ${this.filePath}`), {
          code: "auth_file_invalid",
        });
      }
    } catch (error) {
      if (error.code === "ENOENT") this.data = { version: 1, password: null, sessions: [] };
      else throw error;
    }
    this.lastReadMs = Date.now();
    return this.data;
  }

  hasPassword() {
    return Boolean(this.data && this.data.password);
  }

  sessions() {
    return this.data ? [...this.data.sessions] : [];
  }

  async reloadFromFile() {
    return this.load({ force: true });
  }

  async _flush() {
    if (!this.data) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const nonce = crypto.randomBytes(6).toString("hex");
    const temporary = `${this.filePath}.${process.pid}.${nonce}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, this.filePath);
    this.lastReadMs = Date.now();
  }

  async setPassword(password) {
    await this.load();
    const hashed = await hashPassword(password);
    this.data.password = hashed;
    this.data.sessions = [];
    await this._flush();
  }

  // The browser bootstrap path is deliberately first-writer-wins. Serialising
  // claims inside the server stops two simultaneous setup requests from both
  // observing an unconfigured store and overwriting one another.
  async claimInitialPassword(password) {
    const previous = this.initialPasswordClaim;
    let release;
    this.initialPasswordClaim = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      await this.load({ force: true });
      if (this.data.password) return false;
      const hashed = await hashPassword(password);
      // A CLI may have provisioned the password while scrypt was running.
      await this.load({ force: true });
      if (this.data.password) return false;
      this.data.password = hashed;
      this.data.sessions = [];
      await this._flush();
      return true;
    } finally {
      release();
    }
  }

  async resetSessions() {
    await this.load();
    this.data.sessions = [];
    await this._flush();
  }

  async verifyPassword(password) {
    await this.load({ force: true });
    if (!this.data.password) return false;
    return verifyPassword(password, this.data.password);
  }

  async createSession({ userAgent = null, now = new Date() } = {}) {
    await this.load({ force: true });
    await this.pruneExpired();
    const token = newSessionToken();
    const session = {
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent,
    };
    this.data.sessions.push(session);
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions.sort((a, b) => new Date(a.lastSeenAt) - new Date(b.lastSeenAt));
      this.data.sessions = this.data.sessions.slice(this.data.sessions.length - MAX_SESSIONS);
    }
    await this._flush();
    return { token, session };
  }

  async findSession(token) {
    if (!token) return null;
    await this.load();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const lookup = () => this.data.sessions.find((session) => timingSafeEqualString(session.tokenHash, tokenHash)) || null;
    let found = lookup();
    if (!found) {
      await this.load({ force: true });
      found = lookup();
    }
    if (!found) return null;
    if (expiredSession(found, now)) {
      await this.removeSession(token);
      return null;
    }
    return found;
  }

  async touchSession(session, now = new Date()) {
    const previous = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if (now.getTime() - previous < LAST_SEEN_REFRESH_MS) return false;
    session.lastSeenAt = now.toISOString();
    await this._flush();
    return true;
  }

  async removeSession(token) {
    if (!token) return false;
    await this.load();
    const tokenHash = hashToken(token);
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((session) => !timingSafeEqualString(session.tokenHash, tokenHash));
    if (this.data.sessions.length === before) return false;
    await this._flush();
    return true;
  }

  async removeOtherSessions(token) {
    if (!token) return 0;
    await this.load();
    const tokenHash = hashToken(token);
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((session) => timingSafeEqualString(session.tokenHash, tokenHash));
    const removed = before - this.data.sessions.length;
    if (removed > 0) await this._flush();
    return removed;
  }

  async pruneExpired(now = Date.now()) {
    await this.load();
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((session) => !expiredSession(session, now));
    if (this.data.sessions.length !== before) await this._flush();
    return before - this.data.sessions.length;
  }
}

export function statusSummary(store) {
  const data = store.data || { password: null, sessions: [] };
  return {
    hasPassword: Boolean(data.password),
    sessionCount: data.sessions ? data.sessions.length : 0,
  };
}
