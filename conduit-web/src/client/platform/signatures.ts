/*
 * Check an Ed25519 signature, on any client.
 *
 * Two things rest on this: `proveServer`, which decides whether an address
 * may be moved to, and `verifyLeaf`, which decides whether a certificate may
 * be pinned. Both are the difference between knowing a server is the one this
 * client paired with and taking its word for it.
 *
 * Neither platform offers the curve reliably, which took two attempts to
 * establish. WebCrypto only learned Ed25519 in Chromium 137, and an older
 * WebView throws "Unrecognized name" -- so on such a device both of those
 * quietly did nothing for as long as they existed. The Android shell looked
 * like the answer and is not: API 33 added the curve to the *keystore*, for
 * keys the device generates and holds, and every provider on a current image
 * refuses a public half that arrived over the network.
 *
 * So the verifier is in the bundle. That is a dependency inside the trust
 * path, which is worth avoiding and was avoided for the certificate encoder
 * -- the difference being that there the alternative was a hundred lines of
 * DER, and here the alternative is that the feature does not exist on most
 * of the devices it was written for. It is asked to verify and nothing else:
 * it holds no key, signs nothing, and decides nothing.
 *
 * WebCrypto is still preferred where it has the curve, because a platform
 * implementation is the better one to trust when there is a choice.
 */
const ATTESTATION_HASH = "SHA-512";

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));

/**
 * The 32 bytes of key inside an SPKI document.
 *
 * Servers hand their public half over as SPKI, which is what WebCrypto
 * imports and what an X.509 certificate carries. The bundled verifier wants
 * the raw point, and for Ed25519 an SPKI is exactly a fixed 12-byte header
 * and the point -- so the header is checked rather than skipped, since a
 * blind slice would turn any 44 bytes into a key.
 */
const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

function rawPublicKey(spki: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (spki.length !== SPKI_PREFIX.length + 32) return null;
  for (let index = 0; index < SPKI_PREFIX.length; index += 1) {
    if (spki[index] !== SPKI_PREFIX[index]) return null;
  }
  return spki.subarray(SPKI_PREFIX.length);
}

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

let bundled: Promise<{ verify(signature: Uint8Array, message: Uint8Array, key: Uint8Array): Promise<boolean> }> | null = null;
function verifier() {
  bundled ??= import("@noble/ed25519").then((ed) => {
    // SHA-512 is a digest, not a curve, and every engine that runs this has
    // one -- which is the whole reason the bundled verifier can be small.
    ed.hashes.sha512Async = async (...parts: Uint8Array[]) =>
      new Uint8Array(await crypto.subtle.digest(ATTESTATION_HASH, ed.etc.concatBytes(...parts)));
    return { verify: (signature, message, key) => ed.verifyAsync(signature, message, key) };
  });
  return bundled;
}

/**
 * Whether the signature is this key's over this message.
 *
 * False for a bad signature and false for a malformed key, because a client
 * that cannot read what it was given has not been shown anything it should
 * act on. There is no third answer any more: with the verifier in the bundle
 * there is no client that cannot check.
 */
export async function verifyEd25519(publicKey: string, message: string, signature: string): Promise<boolean> {
  if (!publicKey || !signature) return false;
  let spki: Uint8Array<ArrayBuffer>;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    spki = base64ToBytes(publicKey);
    bytes = base64ToBytes(signature);
  } catch {
    return false;
  }
  const body = new TextEncoder().encode(message);
  if (await canVerifyInPage()) {
    try {
      const key = await crypto.subtle.importKey("spki", spki, { name: "Ed25519" }, false, ["verify"]);
      return await crypto.subtle.verify("Ed25519", key, bytes, body);
    } catch {
      return false;
    }
  }
  const raw = rawPublicKey(spki);
  if (!raw || bytes.length !== 64) return false;
  try {
    return await (await verifier()).verify(bytes, body, raw);
  } catch {
    return false;
  }
}
