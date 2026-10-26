import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { isInstalledClient } from "../platform/installed-client.ts";

/**
 * A workspace's files read the shortest way (plan: "files take the shortest way"). The hub grants the read and says
 * where the workspace's node answers: its own machine's loopback, its networks', its tailnet's. The nearest of those
 * that answers as that node is used -- this machine for a workspace on it, the LAN or Tailscale for one nearby -- and
 * anything else, or any failure, goes through the hub as before. A page in a browser can use only a node's https route
 * (its tailnet name, where Tailscale gives it a certificate), and is let in by the origin the grant names.
 */
type Route = { url: string; reach: "loopback" | "private" | "tailnet" };
// `bound`: the node binds its proof to the address it was reached at, and nothing less is taken from it.
export type Grant = { nodeId: string; routes: Route[]; token: string; expiresAt: number; nonce: string; proof: string; bound?: boolean; channel?: string };

const hubPath = (projectId: string, query: string) => `/v0/projects/${encodeURIComponent(projectId)}/file?${query}`;

// Per workspace: the grant in hand. Workspaces on the hub itself have none to have.
const grants = new Map<string, Promise<Grant | null>>();
const notOnNode = new Set<string>();
const renewing = new Set<string>();
const RENEW_MS = 3 * 60_000;
async function grantFor(projectId: string): Promise<Grant | null> {
  if (notOnNode.has(projectId)) return null;
  const held = await grants.get(projectId);
  if (held && held.expiresAt - 60_000 > Date.now()) {
    // Renewed while still good, so no read waits on the hub for it.
    if (held.expiresAt - RENEW_MS < Date.now() && !renewing.has(projectId)) {
      renewing.add(projectId);
      void ask(projectId).then((grant) => { if (grant) grants.set(projectId, Promise.resolve(grant)); }).finally(() => renewing.delete(projectId));
    }
    return held;
  }
  const asked = ask(projectId);
  grants.set(projectId, asked);
  return asked;
}

/** Asked for as a workspace's files are first shown, so its first file opens without asking, its route found too. */
export const prefetchDirect = (projectId: string) => { void grantFor(projectId).then((grant) => grant && directRoute(grant)); };

function ask(projectId: string): Promise<Grant | null> {
  const asked: Promise<Grant | null> = api<Grant>(`/v0/projects/${encodeURIComponent(projectId)}/direct?origin=${encodeURIComponent(location.origin)}`).catch((error: { error?: string }) => {
    // Not on a node at all is for good; the node being away or not answering reads is asked again in a while.
    if (error?.error === "direct_not_on_node") notOnNode.add(projectId);
    else setTimeout(() => { if (grants.get(projectId) === asked) grants.delete(projectId); }, 30_000);
    return null;
  });
  return asked;
}

// Per node and the addresses it gave (a node restarted listens elsewhere): the one that answered as it, or that none
// did, asked again after a while (a laptop moves).
const routes = new Map<string, Promise<string | null>>();
const NO_ROUTE_MS = 2 * 60_000;
const routeKey = (grant: Grant) => `${grant.nodeId} ${grant.routes.map((route) => route.url).join(" ")}`;
export function directRoute(grant: Grant): Promise<string | null> {
  const key = routeKey(grant);
  let found = routes.get(key);
  if (!found) {
    found = nearest(grant);
    routes.set(key, found);
    void found.then((url) => { if (!url) setTimeout(() => { if (routes.get(key) === found) routes.delete(key); }, NO_ROUTE_MS); });
  }
  return found;
}

export function forgetRoute(grant: Grant) {
  routes.delete(routeKey(grant));
}

/**
 * Every address asked at once, the nearest that proves it is this node taken as soon as the nearer ones have not: a
 * challenge only the node can answer with the hub's key for this grant (nodes/direct.js), bound to the address it
 * was reached at -- so something on this machine passing the challenge on to the node from its own port is caught,
 * and the grant is never handed to whatever else answers there.
 */
async function nearest(grant: Grant): Promise<string | null> {
  const challenge = newChallenge();
  // A page on https may fetch only https (the node's tailnet name); the apps and a plain-HTTP page, any of them.
  const routes = isInstalledClient() || location.protocol !== "https:" ? grant.routes : grant.routes.filter((route) => route.url.startsWith("https:"));
  const asked = routes.map(async (route) => {
    const expected = await (grant.bound ? boundProof(grant.proof, challenge, route.url) : proofOf(grant.proof, challenge)).catch(() => null);
    if (!expected) return false;
    return fetch(`${route.url}/health?n=${encodeURIComponent(grant.nonce)}&c=${challenge}`, { signal: AbortSignal.timeout(1500), cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ proof?: string; bound?: string }> : null)
      .then((body) => (grant.bound ? body?.bound : body?.proof) === expected, () => false);
  });
  for (const [index, answered] of asked.entries()) if (await answered) return routes[index]!.url;
  return null;
}

const newChallenge = () => [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** The node's answer to `challenge` bound to `url`'s host and port, as it saw them (nodes/direct.js `boundProofOf`). */
function boundProof(key: string, challenge: string, url: string) {
  const { protocol, hostname, port } = new URL(url);
  return proofOf(key, `${challenge}|${hostname.toLowerCase()}:${port || (protocol === "https:" || protocol === "wss:" ? "443" : "80")}`);
}

const proofOf = async (key: string, challenge: string) => {
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(challenge)));
  return [...signed].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const ivFor = (direction: number, count: number) => {
  const iv = new DataView(new ArrayBuffer(12));
  iv.setUint32(0, direction);
  iv.setBigUint64(4, BigInt(count));
  return iv.buffer;
};

async function sealedRead(url: string, grant: Grant, channel: string, query: string, init: RequestInit): Promise<Response | null> {
  const raw = Uint8Array.from(atob(channel.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  if (raw.length !== 32) throw new Error("Invalid read channel");
  const secret = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const utf8 = new TextEncoder();
  const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const keyFor = async (label: string) => crypto.subtle.importKey("raw",
    await crypto.subtle.sign("HMAC", secret, utf8.encode(label)), "AES-GCM", false, ["encrypt", "decrypt"]);
  const id = crypto.getRandomValues(new Uint8Array(16));
  const ifNoneMatch = new Headers(init.headers).get("if-none-match") ?? undefined;
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivFor(1, 0) },
    await keyFor(`read-request:${b64url(id)}`), utf8.encode(JSON.stringify({ grant: grant.token, query, ifNoneMatch }))));
  const nonce = utf8.encode(grant.nonce);
  if (nonce.length > 255 || nonce.some((byte) => byte > 127)) throw new Error("Invalid read nonce");
  const body = new Uint8Array(1 + nonce.length + id.length + sealed.length);
  body[0] = nonce.length;
  body.set(nonce, 1);
  body.set(id, 1 + nonce.length);
  body.set(sealed, 1 + nonce.length + id.length);
  const response = await fetch(`${url}/sealed`, { method: "POST", body, signal: init.signal, cache: "no-store",
    headers: { "content-type": "application/octet-stream" } });
  if (response.status !== 200) return null;
  if (!response.body) throw new Error("Missing sealed read body");
  const reader = response.body.getReader();
  let buffered: Uint8Array = new Uint8Array(0);
  let offset = 0;
  const take = async (length: number) => {
    const bytes = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      init.signal?.throwIfAborted();
      if (offset === buffered.length) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Sealed read ended before end frame");
        buffered = chunk.value;
        offset = 0;
      }
      const size = Math.min(length - filled, buffered.length - offset);
      bytes.set(buffered.subarray(offset, offset + size), filled);
      filled += size;
      offset += size;
    }
    init.signal?.throwIfAborted();
    return bytes;
  };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  try {
    const salt = await take(16);
    const key = await keyFor(`read-response:${b64url(id)}:${b64url(salt)}`);
    let count = 0;
    const frame = async () => {
      const length = new DataView((await take(4)).buffer).getUint32(0);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivFor(2, count++) }, key, await take(length)));
      init.signal?.throwIfAborted();
      return plain;
    };
    const first = await frame();
    if (first[0] !== 0) throw new Error("Missing sealed read head");
    const head: unknown = JSON.parse(new TextDecoder().decode(first.subarray(1)));
    if (!head || typeof head !== "object" || !("status" in head) || typeof head.status !== "number"
      || !Number.isInteger(head.status) || head.status < 200 || head.status > 599
      || !("headers" in head) || !head.headers || typeof head.headers !== "object" || Array.isArray(head.headers)) {
      throw new Error("Invalid sealed read head");
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(head.headers)) {
      if (typeof value !== "string") throw new Error("Invalid sealed read header");
      headers.set(name, value);
    }
    const options = { status: head.status, headers };
    if (head.status === 204 || head.status === 205 || head.status === 304) {
      cancel();
      return new Response(null, options);
    }
    let finished = false;
    let abort: () => void;
    const finish = () => {
      finished = true;
      init.signal?.removeEventListener("abort", abort);
      cancel();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        abort = () => {
          if (finished) return;
          finish();
          controller.error(init.signal?.reason ?? new DOMException("Read aborted", "AbortError"));
        };
        init.signal?.addEventListener("abort", abort, { once: true });
        if (init.signal?.aborted) abort();
      },
      async pull(controller) {
        try {
          const plain = await frame();
          if (finished) return;
          if (plain[0] === 1) controller.enqueue(plain.subarray(1));
          else if (plain[0] === 2 && plain.length === 1) { finish(); controller.close(); }
          else throw new Error("Invalid sealed read frame");
        } catch (error) {
          if (!finished) { finish(); controller.error(error); }
        }
      },
      cancel() { finish(); },
    });
    return new Response(stream, options);
  } catch (error) {
    cancel();
    throw error;
  }
}

/** The node's own answer, or null for the hub's way. */
async function fromNode(projectId: string, query: string, init: RequestInit): Promise<Response | null> {
  const grant = await grantFor(projectId);
  const url = grant && await directRoute(grant);
  if (!grant || !url) return null;
  try {
    const reach = grant.routes.find((route) => route.url === url)?.reach;
    if (url.startsWith("http:") && reach === "private" && grant.channel) {
      const response = await sealedRead(url, grant, grant.channel, query, init);
      if (!response) grants.delete(projectId);
      return response;
    }
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${grant.token}`);
    const response = await fetch(`${url}/file?${query}`, { ...init, headers });
    if (response.status !== 401 && response.status < 500) return response;
    // Not let in (a grant it no longer takes), or busy or failing: through the hub this time.
    grants.delete(projectId);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    // Gone from that address (moved, or restarted elsewhere): a fresh grant and its addresses next time.
    forgetRoute(grant);
    grants.delete(projectId);
  }
  return null;
}

/** `GET /v0/projects/:id/file?…` as a Response, the shortest way. */
export async function workspaceFileResponse(projectId: string, query: string, init: RequestInit = {}) {
  return await fromNode(projectId, query, init) ?? authorizedFetch(httpUrl(hubPath(projectId, query)), init);
}

/** The same, as `api` reads it: the body, or the error it names thrown, whichever way answered. */
export async function workspaceFileJson<T>(projectId: string, query: string, init: RequestInit = {}): Promise<T> {
  const response = await fromNode(projectId, query, init);
  if (!response) return api<T>(hubPath(projectId, query), init);
  const text = await response.text();
  let body: unknown = {};
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!response.ok) {
    const detail = body && typeof body === "object" ? body as Record<string, unknown> : {};
    throw Object.assign(new Error(String(detail.message || detail.error || "Request failed")), detail,
      { apiRequest: { method: "GET", path: `/v0/projects/${projectId}/file`, status: response.status } });
  }
  return body as T;
}
