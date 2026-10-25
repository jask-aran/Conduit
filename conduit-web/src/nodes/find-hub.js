import crypto from "node:crypto";
import tls from "node:tls";
import { Bonjour } from "bonjour-service";
import { embeddedAttestation, verifyLeafAttestation } from "../server-tls.js";

/**
 * The hub again, on this network, when none of the ways a node knows reaches it (it moved to another address): by
 * its mDNS advertisement (lan-advertisement.js), which anyone could make, so only where it proves to be the hub the
 * node already knows. `hub` is `{ id, key }` -- its identity and Ed25519 public half, as it said them on a connection
 * the node made to it before (node-hub.js "routes"). A candidate counts when the leaf certificate it presents carries
 * that identity's attestation; the node then dials it pinned to exactly that certificate, so its key goes to nobody
 * else. Resolves to `[{ url, ca }]`.
 */
export async function findHub(hub, { ms = 4000 } = {}) {
  if (!hub?.id || !hub?.key) return [];
  const seen = await advertised(hub.id, ms);
  const found = await Promise.all(seen.map(async ({ address, port }) => {
    const ca = await attestedLeaf(address, port, hub);
    return ca ? { url: `https://${address}:${port}`, ca } : null;
  }));
  return found.filter(Boolean);
}

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Where a hub with this identity says it is: its private IPv4 addresses and port, for as long as `ms`. */
function advertised(id, ms) {
  return new Promise((resolve) => {
    const found = new Map();
    let bonjour = null;
    let browser = null;
    const finish = () => {
      clearTimeout(timer);
      try { browser?.stop(); bonjour?.destroy(); } catch { /* going regardless */ }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, ms);
    try {
      bonjour = new Bonjour();
      browser = bonjour.find({ type: "conduit", protocol: "tcp" }, (service) => {
        if (service?.txt?.id !== id) return;
        for (const address of service.addresses || []) {
          if (PRIVATE.test(address)) found.set(`${address}:${service.port}`, { address, port: service.port });
        }
        if (found.size) finish();
      });
    } catch { finish(); }
  });
}

/** The certificate `address:port` presents, as PEM, when the hub's identity attested it; else null. */
export function attestedLeaf(address, port, hub, ms = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const end = (value) => { if (!done) { done = true; socket.destroy(); resolve(value); } };
    // Nothing is sent but the handshake: whether to trust it is decided here, before any key goes anywhere.
    const socket = tls.connect({ host: address, port, rejectUnauthorized: false }, () => {
      try {
        const raw = socket.getPeerCertificate(false)?.raw;
        const leaf = raw && new crypto.X509Certificate(raw);
        const spki = leaf?.publicKey.export({ type: "spki", format: "der" });
        const attestation = raw && embeddedAttestation(raw);
        const key = crypto.createPublicKey({ key: Buffer.from(hub.key, "base64"), format: "der", type: "spki" });
        end(spki && attestation && verifyLeafAttestation(hub.id, spki, attestation, key) ? leaf.toString() : null);
      } catch { end(null); }
    });
    socket.setTimeout(ms, () => end(null));
    socket.on("error", () => end(null));
  });
}
