/*
 * The verifier is bundled because WebCrypto has Ed25519 only from Chromium 137, and Android's keystore refuses a
 * public key that arrived over the network. WebCrypto is still preferred where it has the curve.
 */
const ATTESTATION_HASH = "SHA-512";

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));

/** An Ed25519 SPKI is this fixed header and the raw point; the header is checked, since a blind slice would turn any 44 bytes into a key. */
const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

function rawPublicKey(spki: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (spki.length !== SPKI_PREFIX.length + 32) return null;
  for (let index = 0; index < SPKI_PREFIX.length; index += 1) {
    if (spki[index] !== SPKI_PREFIX[index]) return null;
  }
  return spki.subarray(SPKI_PREFIX.length);
}

/** There is no feature query for a named curve; importing a throwaway key is the query. */
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
    ed.hashes.sha512Async = async (...parts: Uint8Array[]) =>
      new Uint8Array(await crypto.subtle.digest(ATTESTATION_HASH, ed.etc.concatBytes(...parts)));
    return { verify: (signature, message, key) => ed.verifyAsync(signature, message, key) };
  });
  return bundled;
}

/** A malformed key or signature is false, like a bad signature. */
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
