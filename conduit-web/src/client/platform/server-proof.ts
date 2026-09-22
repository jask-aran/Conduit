import { buildHttpUrl } from "../api/transport.js";

/*
 * Check that the thing answering at an address is the server we paired with,
 * before anything is sent to it.
 *
 * The problem this solves is circular on its face. A client cannot tell
 * `192.168.0.128` the Conduit server from `192.168.0.128` something else that
 * answered first, and the obvious way to find out -- sign in and see -- is
 * exactly the move that would hand a stranger the credential. Probing
 * `/healthz` does not help either: anything can return `{ok:true}`.
 *
 * So the server signs. At pairing it hands over the public half of a key it
 * keeps; afterwards any address claiming to be that server is given a random
 * nonce and asked for it back signed. Only the server can answer, the answer
 * is worthless for the next nonce, and nothing the client holds is revealed by
 * asking.
 */

const PROOF_TIMEOUT_MS = 4000;

const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));

/**
 * Whether this client can check a signature at all.
 *
 * Ed25519 arrived in WebCrypto later than the rest of it, so a shell on an old
 * webview may not have it. That is reported rather than worked around: a
 * client that cannot verify must not pretend it did, and the caller's job is
 * then to leave the address to a person to choose rather than move to it on
 * its own.
 */
let support: Promise<boolean> | null = null;
export function canVerify(): Promise<boolean> {
  support ??= (async () => {
    try {
      await crypto.subtle.importKey("spki", base64ToBytes(
        // A throwaway public key, used only to ask whether the algorithm exists.
        "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE",
      ), { name: "Ed25519" }, false, ["verify"]);
      return true;
    } catch {
      return false;
    }
  })();
  return support;
}

export interface ServerProof {
  /** The address answered, and it is the server this public key belongs to. */
  ok: boolean;
  /** Why not, when it is not: for saying something truthful to the person. */
  reason?: "unreachable" | "mismatch" | "unverifiable";
}

/**
 * Ask one address to prove it is the server identified by `id`.
 *
 * `publicKey` is the SPKI half handed over when this client signed in, which
 * is the only moment the answer could be trusted for free -- the person typed
 * the address and the password, over a connection already good enough to carry
 * them.
 */
export async function proveServer(origin: string, id: string, publicKey: string): Promise<ServerProof> {
  if (!id || !publicKey) return { ok: false, reason: "unverifiable" };
  if (!await canVerify()) return { ok: false, reason: "unverifiable" };

  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROOF_TIMEOUT_MS);
  let answer: { id?: unknown; nonce?: unknown; signature?: unknown };
  try {
    const response = await fetch(buildHttpUrl("/v0/server/prove", origin), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "unreachable" };
    answer = await response.json();
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }

  // The nonce has to come back as it went out, or the signature is over
  // something this client did not choose and proves nothing about now.
  if (answer?.nonce !== nonce || answer?.id !== id || typeof answer?.signature !== "string") {
    return { ok: false, reason: "mismatch" };
  }

  try {
    const key = await crypto.subtle.importKey("spki", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${id}.${nonce}`);
    const verified = await crypto.subtle.verify("Ed25519", key, base64ToBytes(answer.signature), signed);
    return verified ? { ok: true } : { ok: false, reason: "mismatch" };
  } catch {
    return { ok: false, reason: "mismatch" };
  }
}

/** Domain separation, matching `server-tls.js`: an attestation is only that. */
const ATTESTATION_PREFIX = "conduit-leaf-spki-sha256.v1";

/** What a server says about the certificate it answers on over TLS. */
export interface SecureClaim {
  port: number;
  fingerprint: string;
  attestation: string;
}

/** The same claim, once this client has checked it against the key it holds. */
export interface VerifiedLeaf {
  port: number;
  fingerprint: string;
}

/**
 * Check a server's word that a certificate is its own.
 *
 * This is the step that makes pinning mean anything. The server answers over
 * TLS with a certificate it signed itself, which by itself proves nothing --
 * so does an impostor's. What distinguishes them is that the identity key this
 * client was given at pairing signed the hash of the real certificate's public
 * key, and nothing else holds that identity key.
 *
 * So a fingerprint arrives here as a claim and leaves as a pin, or does not
 * leave at all. Everything is refused rather than assumed: an unverifiable
 * client, a malformed claim, a signature over another server's id. Saving an
 * unchecked fingerprint would be worse than saving none, because the shell
 * would then accept that certificate on every network it ever meets it on.
 */
export async function verifyLeaf(id: string, publicKey: string, claim: unknown): Promise<VerifiedLeaf | null> {
  const secure = claim as Partial<SecureClaim> | undefined;
  if (!id || !publicKey || !secure) return null;
  const port = Number(secure.port);
  const fingerprint = typeof secure.fingerprint === "string" ? secure.fingerprint : "";
  const attestation = typeof secure.attestation === "string" ? secure.attestation : "";
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !fingerprint || !attestation) return null;
  if (!await canVerify()) return null;
  try {
    const key = await crypto.subtle.importKey("spki", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${ATTESTATION_PREFIX}.${id}.${fingerprint}`);
    const verified = await crypto.subtle.verify("Ed25519", key, base64ToBytes(attestation), signed);
    return verified ? { port, fingerprint } : null;
  } catch {
    return null;
  }
}
