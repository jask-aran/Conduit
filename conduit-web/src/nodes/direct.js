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

/**
 * A terminal attached directly is sealed end to end (plan: direct terminals): the hub hands the client this key with
 * the grant, the node works it out from the grant's nonce, and nobody on the network between them has it. Every frame
 * is AES-256-GCM under it, its nonce the direction and a count of frames, so a frame cannot be read, changed, replayed
 * or moved. A route need not be private for a shell then, only reachable.
 */
export const channelKey = (secret, nonce, kind = "pty") => crypto.createHmac("sha256", secret).update(`${kind}-channel:${nonce}`).digest("base64url");
export const SEAL_TO_NODE = 1;
export const SEAL_TO_CLIENT = 2;
const ivFor = (direction, count) => {
  const iv = Buffer.alloc(12);
  iv.writeUInt32BE(direction, 0);
  iv.writeBigUInt64BE(BigInt(count), 4);
  return iv;
};
/** One frame sealed: its kind (a byte) and body, AES-256-GCM under `key` with the tag after. */
export function sealFrame(key, direction, count, kind, body) {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, ivFor(direction, count));
  const sealed = Buffer.concat([cipher.update(Buffer.from([kind])), cipher.update(body), cipher.final()]);
  return Buffer.concat([sealed, cipher.getAuthTag()]);
}
/** What was sealed, or null when it was not sealed as `count` that way under `key`. */
export function openSealed(key, direction, count, sealed) {
  if (sealed.length < 17) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivFor(direction, count));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  } catch { return null; }
}
/** A frame opened: its kind and body. */
export function openFrame(key, direction, count, frame) {
  const plain = openSealed(key, direction, count, frame);
  return plain?.length ? { kind: plain[0], body: plain.subarray(1) } : null;
}
/** The node's end of a sealed channel: `seal` a frame for the client, `open` the client's next one (null if it is not). */
export function nodeChannel(key) {
  const raw = Buffer.from(key, "base64url");
  let sent = 0;
  let received = 0;
  return {
    seal: (kind, body) => sealFrame(raw, SEAL_TO_CLIENT, sent++, kind, body),
    open(frame) {
      const opened = openFrame(raw, SEAL_TO_NODE, received, frame);
      if (opened) received += 1;
      return opened;
    },
  };
}

/**
 * A read sealed the same way where its route is a LAN in plain HTTP (plan: sealed reads), under the read grant's own
 * channel key (`channelKey(secret, nonce, "read")`). A read grant serves many reads, so each has keys of its own: the
 * request's from an id the client picks, the answer's from that and a salt the node picks, so no answer is ever
 * sealed twice under one key, a replayed request's included.
 */
const subkey = (channel, label) => crypto.createHmac("sha256", Buffer.from(channel, "base64url")).update(label).digest();
export const readRequestKey = (channel, id) => subkey(channel, `read-request:${id}`);
export const readAnswerKey = (channel, id, salt) => subkey(channel, `read-response:${id}:${salt}`);

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
