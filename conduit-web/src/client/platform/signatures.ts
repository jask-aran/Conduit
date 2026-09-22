/*
 * Check an Ed25519 signature, wherever this client can.
 *
 * Two things rest on this: `proveServer`, which decides whether an address
 * may be moved to, and `verifyLeaf`, which decides whether a certificate may
 * be pinned. Both are the difference between knowing a server is the one this
 * client paired with and taking its word for it.
 *
 * WebCrypto is the obvious place and is not always there. Chromium only
 * shipped Ed25519 in `crypto.subtle` in 137, and an older WebView throws
 * "Unrecognized name" instead -- so on such a device both of those quietly
 * did nothing for as long as they existed. The Android shell can check from
 * API 33, which is a far lower bar, so it is asked when the page cannot.
 *
 * "Cannot check" is a third answer and stays one. A client that has no way to
 * verify must not be able to be mistaken for one that verified, so this
 * returns null there rather than false, and the callers say `unverifiable`
 * rather than `mismatch` -- which is the difference between leaving an address
 * to a person to choose and telling them it is an impostor.
 */
import { installedClientKind } from "./installed-client.ts";

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));

/**
 * Whether WebCrypto here knows the algorithm at all.
 *
 * Asked with a throwaway public key, because there is no feature query for a
 * named curve -- importing one is the query.
 */
let support: Promise<boolean> | null = null;
export function canVerifyInPage(): Promise<boolean> {
  support ??= (async () => {
    try {
      await crypto.subtle.importKey("spki", base64ToBytes(
        "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE",
      ), { name: "Ed25519" }, false, ["verify"]);
      return true;
    } catch {
      return false;
    }
  })();
  return support;
}

async function verifyInShell(publicKey: string, message: string, signature: string): Promise<boolean | null> {
  if (installedClientKind !== "android") return null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin<{
      verify(options: { publicKey: string; message: string; signature: string }): Promise<{ supported: boolean; verified: boolean }>;
    }>("ConduitTls");
    const answer = await plugin.verify({ publicKey, message, signature });
    return answer?.supported ? !!answer.verified : null;
  } catch {
    // A shell too old to have the method is one that cannot check, which is
    // not the same as one that checked and said no.
    return null;
  }
}

/** True, false, or null for a client with no way to tell. */
export async function verifyEd25519(publicKey: string, message: string, signature: string): Promise<boolean | null> {
  if (!publicKey || !signature) return false;
  if (await canVerifyInPage()) {
    try {
      const key = await crypto.subtle.importKey("spki", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
      return await crypto.subtle.verify("Ed25519", key, base64ToBytes(signature), new TextEncoder().encode(message));
    } catch {
      // A key or a signature that will not parse did not verify. Falling
      // through to the shell would only ask a second implementation the same
      // malformed question.
      return false;
    }
  }
  return await verifyInShell(publicKey, message, signature);
}
