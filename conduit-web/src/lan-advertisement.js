import os from "node:os";
import { Bonjour } from "bonjour-service";
import { PATH_SCOPES, localPaths, scopeForHost } from "./server-identity.js";

/*
 * Say "a Conduit server is here" to the local network, so a client that has
 * never been told an address can find one.
 *
 * Everything else in the address story works outwards from a client that
 * already knows where to look: it probes the paths it was given, proves the
 * identity against a key it already holds, and picks the cheapest one that
 * answers. None of that helps the first time, when the person has a server
 * running on a machine at home and a phone that has never heard of it. DNS-SD
 * is the one mechanism every household network already carries that closes
 * that gap without anybody typing an IP address.
 *
 * What goes in the record is deliberately the same two facts `/v0/server`
 * hands out: the identity id and the Ed25519 public half. Neither is a secret
 * -- the id grants nothing and the public key is given to every client that
 * pairs -- and putting them here is what makes the discovery safe rather than
 * merely convenient. A client that finds this record can ask the address to
 * sign a nonce and check the answer against the key *before* it sends a
 * credential, so an impostor advertising the same service name on the same
 * network gets a failed proof rather than a token.
 *
 * The one thing a listener on the LAN learns that it would not otherwise is
 * that this machine runs Conduit, on this port, under this hostname. That is
 * already visible to anything that can connect to the port, which is the same
 * set of machines, so the record discloses timing rather than substance.
 */

export const SERVICE_TYPE = "conduit";
export const SERVICE_PROTOCOL = "tcp";

// No event for this in Node, so it is polled. Long enough that the cost is
// nothing, short enough that joining a network and opening the app in the next
// breath still works.
const INTERFACE_POLL_MS = 15_000;

/** The private addresses this machine holds, as one comparable string. */
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
    // The instance name is what a person picks from a list, so it names the
    // machine rather than the software: every one of these is a Conduit.
    this.instance = String(hostname || "conduit").replace(/\..*$/, "").slice(0, 63) || "conduit";
    this.log = log;
    this.bonjour = null;
    this.service = null;
    this.timer = null;
    this.addresses = [];
  }

  /**
   * Publish, and keep publishing the truth as the machine's addresses change.
   *
   * A machine with no private address has nobody to say this to -- a server
   * reachable only on loopback and through a tunnel cannot be found on a LAN
   * because it is not on one -- so the advertisement simply is not made, and
   * appears if an interface later does.
   */
  start(port) {
    this.port = Number(port) || 0;
    // Nothing to say without a port somebody could connect to.
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
    // Republished rather than mutated: the port and the TXT are the same, but
    // the A records are not, and a responder holding a stale address answers
    // browsers with somewhere that no longer exists.
    this.unpublish();
    if (!addresses.length) return this.log({ type: "conduit.lan-advertisement", state: "withdrawn", reason: "no_private_address" });
    this.bonjour ||= new Bonjour();
    this.service = this.bonjour.publish({
      name: this.instance,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port: this.port,
      txt: {
        // Short keys because a TXT record is a handful of bytes per string,
        // and these are read by machines.
        v: "1",
        id: this.identity.id,
        key: this.identity.publicKeyValue(),
      },
    });
    this.log({ type: "conduit.lan-advertisement", state: "published", instance: this.instance, port: this.port, addresses });
  }

  unpublish() {
    if (!this.service) return;
    try { this.service.stop?.(); } catch { /* the socket is going away regardless */ }
    this.service = null;
  }

  /**
   * Withdraw before the process goes, so a client browsing a second later is
   * not offered a server that has stopped. A goodbye packet is best effort --
   * nothing waits on it, because the alternative is a shutdown that hangs on
   * a multicast send.
   */
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
