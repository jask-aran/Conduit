/*
 * Tell the shell which server identities may vouch for a certificate.
 *
 * A Conduit server answers over TLS with a certificate it signed itself, so
 * the shell's WebView refuses it by default and should. What makes one
 * acceptable is that it carries the server's own identity signature over its
 * public key (`src/server-tls.js`). The shell checks that signature itself in
 * its certificate callback; what it needs from the page is which identity keys
 * belong to servers this client has paired with.
 *
 * The whole set goes over every time, never an addition, so a server that was
 * forgotten takes its key with it.
 *
 * A browser does none of this. It cannot pin a certificate and has no shell to
 * tell, which is why `paths()` will go on offering it plain HTTP origins.
 */
import { installedClientKind } from "./installed-client.ts";

export type TrustedIdentity = { id: string; publicKey: string };

let last = "";

export async function publishTrustedIdentities(identities: TrustedIdentity[]): Promise<void> {
  // Sorted so the same set in another order is the same set, and an identical
  // set costs nothing: this is called whenever the server list changes, which
  // includes changes that have nothing to do with certificates.
  const wanted = [...new Map(identities.map((identity) => [identity.id, identity])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const key = JSON.stringify(wanted);
  if (key === last) return;
  try {
    if (installedClientKind === "android") {
      const { registerPlugin } = await import("@capacitor/core");
      const plugin = registerPlugin<{ trust(options: { identities: TrustedIdentity[] }): Promise<void> }>("ConduitTls");
      await plugin.trust({ identities: wanted });
    } else {
      // The desktop shell has no equivalent yet. Until it is written a
      // desktop client never reaches an https origin, which is the same
      // position a browser is in.
      return;
    }
    last = key;
  } catch {
    // A shell too old to have the plugin is a shell that will refuse every
    // self-signed certificate, which is the safe direction to fail in.
    last = "";
  }
}
