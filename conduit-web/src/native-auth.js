import crypto from "node:crypto";

/* An installed client has no Origin a server can reason about the way it does
   for a page it served, so Conduit names the ones it ships, exactly. The set is
   matched by identity and the matched member is echoed back: never a reflection
   of what the caller claimed, never a wildcard.

   The Android webview is `https://localhost`. Tauri 2 on Windows serves the
   packaged bundle over `http://tauri.localhost` -- the scheme is part of the
   webview's storage origin, so changing it later signs every installed desktop
   client out. macOS and Linux would add `tauri://localhost` when they ship. */
export const NATIVE_APP_ORIGIN = "https://localhost";
export const DESKTOP_APP_ORIGIN = "http://tauri.localhost";
export const NATIVE_APP_ORIGINS = Object.freeze([NATIVE_APP_ORIGIN, DESKTOP_APP_ORIGIN]);

const INSTALLED_ORIGINS = new Set(NATIVE_APP_ORIGINS);

/** The origin this request came from, if Conduit ships that client. */
export const installedClientOrigin = (origin) => (INSTALLED_ORIGINS.has(origin) ? origin : null);
export const SOCKET_TICKET_TTL_MS = 30_000;

const hashTicket = (ticket) => crypto.createHash("sha256").update(ticket).digest("base64");

export class SocketTicketStore {
  constructor({ ttlMs = SOCKET_TICKET_TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    this.tickets = new Map();
  }

  issue(sessionTokenHash, now = Date.now()) {
    this.prune(now);
    const ticket = crypto.randomBytes(32).toString("base64url");
    this.tickets.set(hashTicket(ticket), { sessionTokenHash, expiresAt: now + this.ttlMs });
    return ticket;
  }

  consume(ticket, now = Date.now()) {
    if (!ticket) return null;
    const key = hashTicket(ticket);
    const record = this.tickets.get(key);
    this.tickets.delete(key);
    if (!record || record.expiresAt <= now) return null;
    return record.sessionTokenHash;
  }

  prune(now = Date.now()) {
    for (const [key, record] of this.tickets) if (record.expiresAt <= now) this.tickets.delete(key);
  }
}
