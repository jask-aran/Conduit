import crypto from "node:crypto";

/**
 * A grant to read one place on a node without going through the hub (plan: "files take the shortest way"). The hub
 * signs it with an HMAC keyed by the hash of the node's key -- the secret the two already share -- and the node checks
 * it alone. It names the place and how long it holds; what is inside the place is still the node's own rules.
 */
export const DIRECT_TTL_MS = 10 * 60_000;

/**
 * What a node answering reads is known by, to a client that has found something at one of its addresses: worked out
 * from the key's hash by both the node and the hub, so the hub can say what to expect and the node can say it is so
 * (nothing else; it is not a secret, and a grant still decides what may be read).
 */
export const directId = (secret) => crypto.createHash("sha256").update(`direct:${secret}`).digest("hex").slice(0, 16);

// The kinds of address a node offers for reads: never one on the internet, where the grant would cross in the clear.
const PRIVATE = /^(10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|192\.168(\.\d{1,3}){2})$/;
const TAILNET = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2}$/;
/** This machine's addresses a client could read from, nearest kind first: its networks', then its tailnet's. */
export function directAddresses(interfaces) {
  const found = [];
  for (const list of Object.values(interfaces)) for (const item of list || []) {
    if (item.internal || (item.family !== "IPv4" && item.family !== 4)) continue;
    const reach = PRIVATE.test(item.address) ? "private" : TAILNET.test(item.address) ? "tailnet" : null;
    if (reach && !found.some((known) => known.address === item.address)) found.push({ address: item.address, reach });
  }
  return found.sort((left, right) => (left.reach === right.reach ? 0 : left.reach === "private" ? -1 : 1));
}

/** The node key's hash: the hub keeps it, the node works it out from its key. */
export const keySecret = (key) => crypto.createHash("sha256").update(key).digest("hex");
const mac = (secret, body) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

export function signGrant(secret, grant) {
  const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

/** The grant a token carries, or null when it is not this node's, is malformed or has run out. */
export function verifyGrant(secret, token, now = Date.now()) {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let grant;
  try { grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!grant || typeof grant !== "object" || !(Number(grant.expires) > now) || grant.read !== true) return null;
  if (!grant.place || typeof grant.place.root !== "string") return null;
  return grant;
}
