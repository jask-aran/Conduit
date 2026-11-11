/*
 * Tells the shell which paired servers' identity keys may vouch for a self-signed certificate; the shell checks the
 * signature itself. The whole set goes every time, so a forgotten server takes its key with it.
 */
import { installedClientKind } from "./installed-client.ts";

export type TrustedIdentity = { id: string; publicKey: string };

let last = "";
let pending: Promise<void> = Promise.resolve();

/** An https request before this settles meets a shell that refuses the server's leaf. */
export const trustSettled = () => pending;

export function publishTrustedIdentities(identities: TrustedIdentity[]): Promise<void> {
  pending = publish(identities);
  return pending;
}

async function publish(identities: TrustedIdentity[]): Promise<void> {
  // Called on any server list change, so an identical set must cost nothing.
  const wanted = [...new Map(identities.map((identity) => [identity.id, identity])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const key = JSON.stringify(wanted);
  if (key === last) return;
  try {
    if (installedClientKind === "android") {
      const { registerPlugin } = await import("@capacitor/core");
      const plugin = registerPlugin<{ trust(options: { identities: TrustedIdentity[] }): Promise<void> }>("ConduitTls");
      await plugin.trust({ identities: wanted });
    } else if (installedClientKind === "desktop") {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("trust_identities", { identities: wanted });
    } else {
      return;
    }
    last = key;
  } catch {
    // A shell without the plugin refuses every self-signed certificate: the safe direction to fail in.
    last = "";
  }
}
