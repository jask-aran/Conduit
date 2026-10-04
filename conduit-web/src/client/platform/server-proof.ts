import { buildHttpUrl } from "../api/transport.js";
import { verifyEd25519 } from "./signatures.ts";

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

  // `unverifiable` is left for a caller that handed over no key at all. It
  // used to mean "this webview has no Ed25519" as well, which was most of
  // them, and which is why the verifier is now in the bundle.
  return await verifyEd25519(publicKey, `${id}.${nonce}`, answer.signature)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}
