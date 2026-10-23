import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { isInstalledClient } from "../platform/installed-client.ts";

/**
 * A workspace's files read the shortest way (plan: "files take the shortest way"). The hub grants the read and says
 * where the workspace's node answers: its own machine's loopback, its networks', its tailnet's. The nearest of those
 * that answers as that node is used -- this machine for a workspace on it, the LAN or Tailscale for one nearby -- and
 * anything else, or any failure, goes through the hub as before. A page in a browser stays with the hub: it may not
 * fetch plain HTTP from an https page, nor is it let in.
 */
type Route = { url: string; reach: "loopback" | "private" | "tailnet" };
type Grant = { nodeId: string; id: string; routes: Route[]; token: string; expiresAt: number };

const hubPath = (projectId: string, query: string) => `/v0/projects/${encodeURIComponent(projectId)}/file?${query}`;

// Per workspace: the grant in hand. Workspaces on the hub itself have none to have.
const grants = new Map<string, Promise<Grant | null>>();
const notOnNode = new Set<string>();
const renewing = new Set<string>();
const RENEW_MS = 3 * 60_000;
async function grantFor(projectId: string): Promise<Grant | null> {
  if (!isInstalledClient() || notOnNode.has(projectId)) return null;
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
export const prefetchDirect = (projectId: string) => { void grantFor(projectId).then((grant) => grant && routeFor(grant)); };

function ask(projectId: string): Promise<Grant | null> {
  const asked: Promise<Grant | null> = api<Grant>(`/v0/projects/${encodeURIComponent(projectId)}/direct`).catch((error: { error?: string }) => {
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
function routeFor(grant: Grant): Promise<string | null> {
  const key = routeKey(grant);
  let found = routes.get(key);
  if (!found) {
    found = nearest(grant);
    routes.set(key, found);
    void found.then((url) => { if (!url) setTimeout(() => { if (routes.get(key) === found) routes.delete(key); }, NO_ROUTE_MS); });
  }
  return found;
}
/** Every address asked at once, the nearest that answers as this node taken as soon as the nearer ones have not. */
async function nearest(grant: Grant): Promise<string | null> {
  const asked = grant.routes.map((route) => fetch(`${route.url}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" })
    .then((response) => response.ok ? response.json() as Promise<{ id?: string }> : null)
    .then((body) => body?.id === grant.id, () => false));
  for (const [index, answered] of asked.entries()) if (await answered) return grant.routes[index]!.url;
  return null;
}

/** The node's own answer, or null for the hub's way. */
async function fromNode(projectId: string, query: string, init: RequestInit): Promise<Response | null> {
  const grant = await grantFor(projectId);
  const url = grant && await routeFor(grant);
  if (!grant || !url) return null;
  try {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${grant.token}`);
    const response = await fetch(`${url}/file?${query}`, { ...init, headers });
    if (response.status !== 401) return response;
    grants.delete(projectId);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    // Gone from that address (moved, or restarted elsewhere): a fresh grant and its addresses next time.
    routes.delete(routeKey(grant));
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
