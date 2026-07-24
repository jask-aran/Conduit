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
  if (typeof raw.password !== "object" || raw.password === null) return null;
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

function revisionFor(content) {
  return crypto.createHash("sha256").update(content).digest("base64");
}

async function diskRevision(filePath) {
  try {
    return revisionFor(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function conflictError() {
  return Object.assign(new Error("Authentication data changed on disk during an update"), { code: "auth_store_conflict" });
}

export class AuthStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.lastReadMs = 0;
    this.revision = null;
    this.transition = Promise.resolve();
  }

  async load({ force = false } = {}) {
    if (!force && this.data) return this.data;
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const raw = JSON.parse(content);
      this.data = normalizeAuthFile(raw) || { version: 1, password: null, sessions: [] };
      if (!this.data.password) this.data.password = null;
      this.revision = revisionFor(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        this.data = { version: 1, password: null, sessions: [] };
        this.revision = null;
      }
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
    return this._transition(() => this.load({ force: true }));
  }

  async _transition(operation) {
    const previous = this.transition;
    let release;
    this.transition = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async _mutate(operation) {
    return this._transition(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.load({ force: true });
        const { changed, result } = await operation(this.data);
        if (!changed) return result;
        try {
          await this._flush(this.data, this.revision);
          return result;
        } catch (error) {
          if (error?.code !== "auth_store_conflict" || attempt) throw error;
        }
      }
      throw conflictError();
    });
  }

  async _flush(data = this.data, expectedRevision = this.revision) {
    if (!data) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    if (await diskRevision(this.filePath) !== expectedRevision) throw conflictError();
    const nonce = crypto.randomBytes(6).toString("hex");
    const temporary = `${this.filePath}.${process.pid}.${nonce}.tmp`;
    const content = `${JSON.stringify(data, null, 2)}\n`;
    await fs.writeFile(temporary, content, "utf8");
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, this.filePath);
    this.revision = revisionFor(content);
    this.lastReadMs = Date.now();
  }

  async setPassword(password) {
    const hashed = await hashPassword(password);
    await this._mutate((data) => {
      data.password = hashed;
      data.sessions = [];
      return { changed: true };
    });
  }

  async resetSessions() {
    return this._mutate((data) => {
      if (!data.sessions.length) return { changed: false };
      data.sessions = [];
      return { changed: true };
    });
  }

  async verifyPassword(password) {
    const stored = await this._transition(async () => {
      await this.load({ force: true });
      return this.data.password ? { ...this.data.password } : null;
    });
    return verifyPassword(password, stored);
  }

  async createSession({ userAgent = null, now = new Date() } = {}) {
    const token = newSessionToken();
    const session = {
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent,
    };
    return this._mutate((data) => {
      data.sessions = data.sessions.filter((item) => !expiredSession(item));
      data.sessions.push(session);
      if (data.sessions.length > MAX_SESSIONS) {
        data.sessions.sort((a, b) => new Date(a.lastSeenAt) - new Date(b.lastSeenAt));
        data.sessions = data.sessions.slice(data.sessions.length - MAX_SESSIONS);
      }
      return { changed: true, result: { token, session } };
    });
  }

  async findSession(token) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const now = Date.now();
    return this._transition(async () => {
      let force = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.load({ force });
        const found = this.data.sessions.find((session) => timingSafeEqualString(session.tokenHash, tokenHash)) || null;
        if (!found && !force) {
          force = true;
          continue;
        }
        if (!found) return null;
        if (!expiredSession(found, now)) return { ...found };
        this.data.sessions = this.data.sessions.filter((item) => !timingSafeEqualString(item.tokenHash, tokenHash));
        try {
          await this._flush(this.data, this.revision);
          return null;
        } catch (error) {
          if (error?.code !== "auth_store_conflict" || attempt) throw error;
          force = true;
        }
      }
      throw conflictError();
    });
  }

  async touchSession(session, now = new Date()) {
    if (!session?.tokenHash) return false;
    return this._mutate((data) => {
      const current = data.sessions.find((item) => timingSafeEqualString(item.tokenHash, session.tokenHash));
      if (!current) return { changed: false, result: false };
      const previous = current.lastSeenAt ? new Date(current.lastSeenAt).getTime() : 0;
      if (now.getTime() - previous < LAST_SEEN_REFRESH_MS) return { changed: false, result: false };
      current.lastSeenAt = now.toISOString();
      return { changed: true, result: true };
    });
  }

  async removeSession(token) {
    if (!token) return false;
    const tokenHash = hashToken(token);
    return this._mutate((data) => {
      const before = data.sessions.length;
      data.sessions = data.sessions.filter((session) => !timingSafeEqualString(session.tokenHash, tokenHash));
      return { changed: data.sessions.length !== before, result: data.sessions.length !== before };
    });
  }

  async removeOtherSessions(token) {
    if (!token) return 0;
    const tokenHash = hashToken(token);
    return this._mutate((data) => {
      const before = data.sessions.length;
      data.sessions = data.sessions.filter((session) => timingSafeEqualString(session.tokenHash, tokenHash));
      const removed = before - data.sessions.length;
      return { changed: removed > 0, result: removed };
    });
  }

  async pruneExpired(now = Date.now()) {
    return this._mutate((data) => {
      const before = data.sessions.length;
      data.sessions = data.sessions.filter((session) => !expiredSession(session, now));
      const removed = before - data.sessions.length;
      return { changed: removed > 0, result: removed };
    });
  }
}

export function statusSummary(store) {
  const data = store.data || { password: null, sessions: [] };
  return {
    hasPassword: Boolean(data.password),
    sessionCount: data.sessions ? data.sessions.length : 0,
  };
}
