import { isInstalledClient } from "../platform/installed-client.ts";
import { authorizedFetch } from "./native-auth-client.ts";

export const SERVER_ORIGIN_STORAGE_KEY = "conduit.native.server-origin";

// A plain-HTTP server on the loopback interface never leaves the machine, so
// there is no network to protect it from; every other address must be HTTPS.
// This is the same line browsers draw when they decide what counts as a secure
// context, and it is what lets a desktop client on the same machine as the
// server address it as 127.0.0.1 instead of needing a certificate for it.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeServerOrigin(value) {
  const input = String(value || "").trim();
  const candidate = input.includes("://") ? input : `https://${input}`;
  let url;
  try { url = new URL(candidate); }
  catch { throw new Error("Enter a complete HTTPS server address."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error("The server address must use HTTPS unless it is on this machine.");
  }
  if (url.username || url.password) throw new Error("The server address cannot contain credentials.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Enter the server origin without a path, query, or fragment.");
  return url.origin;
}

export function configuredServerOrigin(storage = localStorage) {
  const value = storage.getItem(SERVER_ORIGIN_STORAGE_KEY);
  if (!value) return null;
  try { return normalizeServerOrigin(value); }
  catch {
    storage.removeItem(SERVER_ORIGIN_STORAGE_KEY);
    return null;
  }
}

export function saveServerOrigin(value, storage = localStorage) {
  const origin = normalizeServerOrigin(value);
  storage.setItem(SERVER_ORIGIN_STORAGE_KEY, origin);
  return origin;
}

export function clearServerOrigin(storage = localStorage) {
  storage.removeItem(SERVER_ORIGIN_STORAGE_KEY);
}

export function buildHttpUrl(path, origin) {
  return new URL(path, `${origin}/`).toString();
}

export function buildWebSocketUrl(path, origin) {
  const url = new URL(path, `${origin}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function nativeOrigin() {
  const origin = configuredServerOrigin();
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
