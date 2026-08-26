import crypto from "node:crypto";

export const NATIVE_APP_ORIGIN = "https://localhost";
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
