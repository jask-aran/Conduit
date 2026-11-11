import os from "node:os";
import { Bonjour } from "bonjour-service";
import { PATH_SCOPES, localPaths, scopeForHost } from "./server-identity.js";

/*
 * The record carries the same two facts `/v0/server` hands out, neither secret: a client that finds it can have the
 * address sign a nonce against the key before it sends a credential, so an impostor gets a failed proof, not a token.
 */

const SERVICE_TYPE = "conduit";
const SERVICE_PROTOCOL = "tcp";

// No event for this in Node, so it is polled.
const INTERFACE_POLL_MS = 15_000;

function privateAddresses(port) {
  return localPaths(port)
    .filter((origin) => scopeForHost(new URL(origin).hostname) === PATH_SCOPES.private)
    .map((origin) => new URL(origin).hostname)
    .sort();
}

export class LanAdvertisement {
  constructor({ identity, enabled = true, hostname = os.hostname(), log = () => {} }) {
    this.identity = identity;
    this.port = 0;
    this.enabled = enabled;
    // A person picks the instance from a list, so it names the machine: every one of these is a Conduit.
    this.instance = String(identity.name || hostname || "conduit").slice(0, 63) || "conduit";
    this.log = log;
    this.bonjour = null;
    this.service = null;
    this.timer = null;
    this.addresses = [];
  }

  start(port) {
    this.port = Number(port) || 0;
    if (!this.enabled || this.timer || !this.port) return this;
    this.sync();
    this.timer = setInterval(() => this.sync(), INTERFACE_POLL_MS);
    this.timer.unref?.();
    return this;
  }

  sync() {
    const addresses = privateAddresses(this.port);
    if (addresses.join(",") === this.addresses.join(",")) return;
    this.addresses = addresses;
    // Republished rather than mutated: a responder holding a stale A record answers with an address that is gone.
    this.unpublish();
    if (!addresses.length) return this.log({ type: "conduit.lan-advertisement", state: "withdrawn", reason: "no_private_address" });
    this.bonjour ||= new Bonjour();
    this.service = this.bonjour.publish({
      name: this.instance,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port: this.port,
      // The library would use the bare hostname, which no mDNS lookup asks for (Android resolves `<target>.local`),
      // and the machine's own name.local is its OS's to answer (under WSL, Windows answers for it).
      host: `conduit-${String(this.identity.id || "server").replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() || "server"}.local`,
      // A client only ever takes the private IPv4 address, so IPv6 ones would be published for nothing.
      disableIPv6: true,
      txt: {
        // Short keys: a TXT record is a handful of bytes per string.
        v: "1",
        id: this.identity.id,
        key: this.identity.publicKeyValue(),
      },
    });
    // The responder enumerates the interfaces for its own A records, so a link-local IPv4 that `addresses` excludes
    // still goes out; the client drops it, and the library has no hook to stop it.
    this.log({ type: "conduit.lan-advertisement", state: "published", instance: this.instance, port: this.port, reachableOn: addresses });
  }

  rename(name) {
    this.instance = String(name || "conduit").slice(0, 63) || "conduit";
    if (!this.timer) return;
    this.addresses = [];
    this.sync();
  }

  unpublish() {
    if (!this.service) return;
    try { this.service.stop?.(); } catch { /* the socket is going away regardless */ }
    this.service = null;
  }

  /** The goodbye packet is best effort: nothing waits on it, so shutdown cannot hang on a multicast send. */
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unpublish();
    const bonjour = this.bonjour;
    this.bonjour = null;
    if (!bonjour) return;
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 500);
      done.unref?.();
      try { bonjour.destroy(() => { clearTimeout(done); resolve(); }); }
      catch { clearTimeout(done); resolve(); }
    });
  }
}
