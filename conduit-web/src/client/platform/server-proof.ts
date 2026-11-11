import { buildHttpUrl } from "../api/transport.js";
import { verifyEd25519 } from "./signatures.ts";

/*
 * Proves an address is the paired server before anything is sent to it: signing in to find out would hand a
 * stranger the credential, and anything can answer `/healthz`.
 */

const PROOF_TIMEOUT_MS = 4000;

const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface ServerProof {
  ok: boolean;
  reason?: "unreachable" | "mismatch" | "unverifiable";
}

/** `publicKey` is the SPKI key handed over at sign-in. */
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

  // A signature over a nonce this client did not choose proves nothing about now.
  if (answer?.nonce !== nonce || answer?.id !== id || typeof answer?.signature !== "string") {
    return { ok: false, reason: "mismatch" };
  }

  return await verifyEd25519(publicKey, `${id}.${nonce}`, answer.signature)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}
