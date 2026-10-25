import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Names on this network for the hub's nodes, so a browser here reads their files from them over https rather than
 * through the hub (plan: "files take the shortest way"; a home network is trusted). Each node with an address on a
 * private network gets `n-<id>.<domain>`, a DNS-only record pointing there, and the wildcard certificate covering it,
 * which scripts/lan-cert/issue.sh keeps beside the hub's own (~/.conduit/tls/nodes-*.pem) through the `cf` CLI that
 * publishes the records too. Without either, nodes have no such name and pages read through the hub.
 *
 * Every LAN node holds the one key: a node could present another's name, but not answer that node's challenge, so a
 * client never hands it the other's grant.
 */
export function lanNames({ dir = path.join(os.homedir(), ".conduit", "tls"), cf = process.env.CONDUIT_CF_CLI || "cf", log = console } = {}) {
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
  const run = (args) => new Promise((resolve, reject) => {
    execFile(cf, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
  // What each name was last pointed at, and the change in flight: one record call per change, not per hello.
  const published = new Map();
  async function publish(name, address, zone) {
    const listed = JSON.parse(await run(["dns", "records", "list", "-z", zone, "--type", "A", "--name", name]) || "[]");
    const rows = Array.isArray(listed) ? listed : listed.result || [];
    if (rows.some((row) => row.content === address)) return;
    const body = JSON.stringify({ type: "A", name, content: address, ttl: 60, proxied: false });
    if (rows[0]?.id) await run(["dns", "records", "edit", rows[0].id, "-q", "-z", zone, "--body", body]);
    else await run(["dns", "records", "create", "-q", "-z", zone, "--body", body]);
  }
  /**
   * Point `name` at `address`, once per change: whether it now does. `zone` is the Cloudflare zone holding it, by
   * default the name less its first label (the hub's `lan.example.com` is in `example.com`).
   */
  async function point(name, address, zone = name.slice(name.indexOf(".") + 1)) {
    const known = published.get(name);
    if (known?.address === address) return known.pending.then(() => true, () => false);
    const pending = publish(name, address, zone);
    published.set(name, { address, pending });
    try { await pending; return true; } catch (error) {
      published.delete(name);
      log.warn?.(`Conduit could not point ${name} at ${address}: ${error.message}`);
      return false;
    }
  }
  return {
    point,
    /** A node's name here and the certificate for it, pointed at `address` first; null when there is none to give. */
    async forNode(nodeId, address) {
      const found = await certificate();
      if (!found) return null;
      const name = `n-${String(nodeId).replace(/^node_/, "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}.${found.domain}`;
      // In the zone the LAN name is in: `n-…lan.example.com` is in `example.com`.
      return (await point(name, address, found.domain.slice(found.domain.indexOf(".") + 1))) ? { name, cert: found.cert, key: found.key } : null;
    },
  };
}
