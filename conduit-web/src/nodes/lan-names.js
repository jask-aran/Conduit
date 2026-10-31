import { cloudflareCli } from "../network/cloudflare.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Names on this network for the hub's nodes, so a browser here reads their files from them over https rather than
 * through the hub (plan: "files take the shortest way"; a home network is trusted). Each node with an address on a
 * private network gets `n-<id>.<domain>`, a DNS-only record pointing there, and the wildcard certificate covering it,
 * which the LAN names service (or scripts/lan-cert/issue.sh) keeps beside the hub's own
 * (~/.conduit/tls/nodes-*.pem). Without a certificate, nodes have no such name and pages read through the hub.
 *
 * Every LAN node holds the one key: a node could present another's name, but not answer that node's challenge, so a
 * client never hands it the other's grant.
 */
export function lanNames({ dir = path.join(os.homedir(), ".conduit", "tls"), cf = process.env.CONDUIT_CF_CLI || "cf", provider = () => null, log = console } = {}) {
  let loaded = { at: 0, value: null };
  async function certificate() {
    if (Date.now() - loaded.at < 3600_000) return loaded.value;
    let value = null;
    try {
      const [cert, key] = await Promise.all([fs.readFile(path.join(dir, "nodes-cert.pem"), "utf8"), fs.readFile(path.join(dir, "nodes-key.pem"), "utf8")]);
      const wildcard = new crypto.X509Certificate(cert).subjectAltName?.split(", ").find((entry) => entry.startsWith("DNS:*."));
      if (wildcard && new Date(new crypto.X509Certificate(cert).validTo) > new Date()) value = { domain: wildcard.slice(6).toLowerCase(), cert, key };
    } catch {}
    loaded = { at: Date.now(), value };
    return value;
  }
  const fallback = cloudflareCli({ command: cf });
  const zones = new Map();
  // What each name was last pointed at, and the change in flight: one record call per change, not per hello.
  const published = new Map();
  async function publish(name, address) {
    const dns = provider() || fallback;
    if (!zones.has(dns)) zones.set(dns, new Map());
    const cache = zones.get(dns);
    if (!cache.has(name)) cache.set(name, await dns.zoneFor(name));
    const zone = cache.get(name);
    if (!zone) { cache.delete(name); throw new Error(`No Cloudflare zone for ${name}`); }
    const rows = await dns.records(zone, { type: "A", name });
    if (rows.some((row) => row.content === address)) return;
    const record = { type: "A", name, content: address, ttl: 60, proxied: false };
    if (rows[0]?.id) await dns.update(zone, rows[0].id, record);
    else await dns.create(zone, record);
  }
  /** Point `name` at `address`, once per change; find its zone through the provider. */
  async function point(name, address) {
    const known = published.get(name);
    if (known?.address === address) return known.pending.then(() => true, () => false);
    const pending = publish(name, address);
    published.set(name, { address, pending });
    try { await pending; return true; } catch (error) {
      published.delete(name);
      log.warn?.(`Conduit could not point ${name} at ${address}: ${error.message}`);
      return false;
    }
  }
  return {
    point,
    reload() { loaded = { at: 0, value: null }; published.clear(); zones.clear(); },
    /** A node's name here and the certificate for it, pointed at `address` first; null when there is none to give. */
    async forNode(nodeId, address) {
      const found = await certificate();
      if (!found) return null;
      const name = `n-${String(nodeId).replace(/^node_/, "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}.${found.domain}`;
      return (await point(name, address)) ? { name, cert: found.cert, key: found.key } : null;
    },
  };
}
