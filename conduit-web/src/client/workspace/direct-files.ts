import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { desktopShell } from "../platform/installed-client.ts";

/**
 * A workspace's files read the shortest way (plan: "files take the shortest way"). When the workspace is on this
 * app's own machine -- its node is the companion running beside it -- the hub grants the read and the node answers it
 * on loopback, so the bytes never leave the computer. Anything else, or any failure, goes through the hub as before.
 */
type Grant = { nodeId: string; url: string; token: string; expiresAt: number };

const hubPath = (projectId: string, query: string) => `/v0/projects/${encodeURIComponent(projectId)}/file?${query}`;

// This app's own nodes: the companion's pairings, asked again now and then (a pairing can come or go).
let own: { at: number; ids: Promise<Set<string>> } | null = null;
const ownNodes = () => {
  if (!own || Date.now() - own.at > 60_000) own = { at: Date.now(), ids: desktopShell!.companion.status()
    .then((status) => new Set((status.node?.pairings || []).map((pairing) => pairing.nodeId).filter((id): id is string => Boolean(id))))
    .catch(() => new Set<string>()) };
  return own.ids;
};

// Per workspace: the grant in hand, or that there is none to have (on the hub, or on another machine).
const grants = new Map<string, Promise<Grant | null>>();
const notHere = new Set<string>();
async function grantFor(projectId: string): Promise<Grant | null> {
  if (!desktopShell || notHere.has(projectId)) return null;
  const held = await grants.get(projectId);
  if (held && held.expiresAt - 60_000 > Date.now()) return held;
  const asked = api<Grant>(`/v0/projects/${encodeURIComponent(projectId)}/direct`).then(async (grant) => {
    if ((await ownNodes()).has(grant.nodeId)) return grant;
    notHere.add(projectId);
    return null;
  }, (error: { error?: string }) => {
    // Not on a node at all is for good; the node being away or not answering reads is asked again in a while.
    if (error?.error === "direct_not_on_node") notHere.add(projectId);
    else setTimeout(() => { if (grants.get(projectId) === asked) grants.delete(projectId); }, 30_000);
    return null;
  });
  grants.set(projectId, asked);
  return asked;
}

/** The node's own answer, or null for the hub's way. */
async function fromNode(projectId: string, query: string, init: RequestInit): Promise<Response | null> {
  const grant = await grantFor(projectId);
  if (!grant) return null;
  try {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${grant.token}`);
    const response = await fetch(`${grant.url}/file?${query}`, { ...init, headers });
    if (response.status !== 401) return response;
  } catch (error) {
    if (init.signal?.aborted) throw error;
  }
  grants.delete(projectId);
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
