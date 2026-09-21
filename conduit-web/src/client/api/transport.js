import { isInstalledClient } from "../platform/installed-client.ts";
import { activeOrigin, normalizeServerOrigin } from "../platform/servers.ts";
import { authorizedFetch } from "./native-auth-client.ts";

// Re-exported so every caller still asks one module how to reach a server,
// while the list of servers and the rules for an address live together.
export { normalizeServerOrigin };

export function buildHttpUrl(path, origin) {
  return new URL(path, `${origin}/`).toString();
}

export function buildWebSocketUrl(path, origin) {
  const url = new URL(path, `${origin}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function nativeOrigin() {
  const origin = activeOrigin();
  if (!origin) throw new Error("Choose a Conduit server first.");
  return origin;
}

export function httpUrl(path) {
  return isInstalledClient() ? buildHttpUrl(path, nativeOrigin()) : path;
}

export async function webSocketUrl(path) {
  if (!isInstalledClient()) return buildWebSocketUrl(path, location.origin);
  const origin = nativeOrigin();
  const response = await authorizedFetch(buildHttpUrl("/v0/auth/socket-ticket", origin), { method: "POST" });
  if (!response.ok) throw new Error("Could not authorize the live connection.");
  const { ticket } = await response.json();
  const url = new URL(buildWebSocketUrl(path, origin));
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export const eventSourceUrl = httpUrl;
export const loginUrl = (after = "") => httpUrl(`/login${after ? `?after=${encodeURIComponent(after)}` : ""}`);
export const logoutUrl = () => httpUrl("/v0/auth/logout");
export const attachmentUrl = (chatId, attachmentId, suffix = "") => httpUrl(`/v0/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(attachmentId)}${suffix}`);
export const transcriptUrl = (sessionId) => httpUrl(`/v0/sessions/${encodeURIComponent(sessionId)}/transcript`);
export const terminalSocketUrl = (ptyId) => webSocketUrl(`/v0/ptys/${encodeURIComponent(ptyId)}/attach`);
export const dictationSocketUrl = () => webSocketUrl("/v0/dictation/stream");
