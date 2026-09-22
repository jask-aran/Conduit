/*
 * Tell the shell which certificates it may accept.
 *
 * A Conduit server answers over TLS with a certificate it signed itself, so
 * the shell's WebView refuses it by default and should. What makes one
 * acceptable is that the server's own identity key -- the half this client was
 * given at pairing -- signed the hash of that certificate's public key. The
 * page is the only place that check can happen, because the page holds the
 * server records and WebCrypto holds Ed25519; the shell is the only place the
 * answer can be used, because the certificate callback lives there. This
 * carries the one to the other.
 *
 * The whole set goes over every time, never an addition. A server that
 * re-issued its certificate should replace its old pin rather than leave it
 * accepted forever, and a server that was forgotten should take its pin with
 * it -- both of which fall out of sending the set rather than the change.
 *
 * A browser does none of this. It cannot pin a certificate and has no shell to
 * tell, which is why `paths()` will go on offering it plain HTTP origins.
 */
import { installedClientKind } from "./installed-client.ts";

let last = "";

export async function publishCertificatePins(fingerprints: string[]): Promise<void> {
  // Sorted so the same set in another order is the same set, and an identical
  // set costs nothing: this is called whenever the server list changes, which
  // includes changes that have nothing to do with certificates.
  const wanted = [...new Set(fingerprints)].sort();
  const key = wanted.join(",");
  if (key === last) return;
  try {
    if (installedClientKind === "android") {
      const { registerPlugin } = await import("@capacitor/core");
      const plugin = registerPlugin<{ pin(options: { fingerprints: string[] }): Promise<void> }>("ConduitTls");
      await plugin.pin({ fingerprints: wanted });
    } else {
      // The desktop shell has no equivalent yet: WebView2's certificate event
      // is unmeasured, so there is nothing there to tell. Until it is written
      // a desktop client simply never reaches an https origin, which is the
      // same position a browser is in.
      return;
    }
    last = key;
  } catch {
    // A shell too old to have the plugin is a shell that will refuse every
    // self-signed certificate, which is the safe direction to fail in.
    last = "";
  }
}
