import crypto from "node:crypto";

/**
 * A grant to read one place on a node without going through the hub (plan: "files take the shortest way"). The hub
 * signs it with an HMAC keyed by the hash of the node's key -- the secret the two already share -- and the node checks
 * it alone. It names the place and how long it holds; what is inside the place is still the node's own rules.
 */
export const DIRECT_TTL_MS = 10 * 60_000;

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
