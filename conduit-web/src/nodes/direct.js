import crypto from "node:crypto";

/**
 * A grant to read one place on a node without going through the hub (plan: "files take the shortest way"). The hub
 * signs it with an HMAC keyed by the hash of the node's key -- the secret the two already share -- and the node checks
 * it alone. It names the place and how long it holds; what is inside the place is still the node's own rules.
 */
export const DIRECT_TTL_MS = 10 * 60_000;
// A grant to attach to a terminal is spent on its first use, and must be used at once: what it opens is a shell.
export const DIRECT_PTY_TTL_MS = 60_000;

/**
 * How a client knows it has found the node and not whatever answers at an address it was given (another machine on
 * that address now, something on the port after a restart), before it hands over a grant: the hub gives the client a
 * key derived from the node's secret and the grant's nonce, the client sends a challenge, and only the node can answer
 * it with that key. Nothing in the answer is any use to anyone else.
 */
export const proofKey = (secret, nonce) => mac(secret, `direct-proof:${nonce}`);
export const proofOf = (key, challenge) => crypto.createHmac("sha256", key).update(String(challenge)).digest("hex");
/**
 * The same answer bound to where the node was reached, as it saw it (`address:port`, or `name:port` over https): the
 * client checks it against what it dialled, so something passing the challenge on to the node from another address
 * (a process listening on the client's own loopback at the node's port) is caught. `proofOf` alone is still answered
 * for v0.8.7 clients' reads.
 */
export const boundProofOf = (key, challenge, where) => proofOf(key, `${challenge}|${where}`);

// The kinds of address a node offers for reads: never one on the internet, where the grant would cross in the clear.
const PRIVATE = /^(10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|192\.168(\.\d{1,3}){2})$/;
const TAILNET = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2}$/;
/** This machine's addresses a client could read from, nearest kind first: its networks', then its tailnet's. */
// Adapters only this machine can reach (Hyper-V's and WSL's switch, containers' bridges): their private addresses
// often repeat on every machine, so offering them would only send clients to someone else's.
const VIRTUAL = /^(vEthernet|docker|br-|veth|virbr|lxc|cni|podman)/i;
// Tailscale's own adapter (Windows, Linux), or a utun on macOS: 100.64/10 elsewhere is a carrier's shared address
// space, and a stream over it is anyone's on that network.
const TAILSCALE_ADAPTER = /tailscale|^utun/i;
export function directAddresses(interfaces) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) for (const item of VIRTUAL.test(name) ? [] : list || []) {
    if (item.internal || (item.family !== "IPv4" && item.family !== 4)) continue;
    const reach = PRIVATE.test(item.address) ? "private" : TAILNET.test(item.address) && TAILSCALE_ADAPTER.test(name) ? "tailnet" : null;
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

/**
 * The grant a token carries, or null when it is not this node's, is malformed, has run out, or is not of `kind`: a
 * read of a place (`read`), or attaching to one terminal (`pty`). Neither passes for the other.
 */
export function verifyGrant(secret, token, now = Date.now(), kind = "read") {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let grant;
  try { grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!grant || typeof grant !== "object" || !(Number(grant.expires) > now)) return null;
  if (kind === "pty") return typeof grant.pty === "string" && grant.read === undefined && typeof grant.nonce === "string" ? grant : null;
  if (grant.read !== true || grant.pty !== undefined || !grant.place || typeof grant.place.root !== "string") return null;
  return grant;
}
