import { trustSettled } from "../platform/certificate-pins.ts";
import { isInstalledClient, secureTokenStore } from "../platform/installed-client.ts";
import { activeOrigin, dialOrigin, pathsOf, servers, type ServerEntry } from "../platform/servers.ts";

const TOKEN_PREFIX = "conduit.native.bearer-token";
export const NATIVE_AUTH_REQUIRED_EVENT = "conduit:native-auth-required";

// A credential store is keyed by a flat string, and an origin carries a scheme
// and a colon. Folding those to dashes keeps the entry readable in Windows
// Credential Manager while staying distinct: http and https differ, and so do
// two ports.
const tokenKey = (origin: string) => `${TOKEN_PREFIX}.${origin.replace(/[^a-z0-9.-]+/gi, "-")}`;

const cached = new Map<string, string | null>();

export async function nativeBearerToken(origin = activeOrigin()) {
  if (!isInstalledClient() || !origin) return null;
  const existing = cached.get(origin);
  if (existing !== undefined) return existing;
  const key = tokenKey(origin);
  const token = await secureTokenStore.get(key);
  cached.set(origin, token);
  return token;
}

export async function saveNativeBearerToken(token: string, origin = activeOrigin()) {
  if (!origin) throw new Error("Choose a Conduit server first.");
  await secureTokenStore.set(tokenKey(origin), token);
  cached.set(origin, token);
}

export async function clearNativeBearerToken(origin = activeOrigin()) {
  if (!origin) return;
  cached.set(origin, null);
  if (isInstalledClient()) await secureTokenStore.remove(tokenKey(origin));
}

/** A server answers at more than one address (dialOrigin may make one https), so each server's are matched. */
function targetOrigin(input: RequestInfo | URL) {
  const chosen = activeOrigin();
  let address: string;
  try { address = new URL(input instanceof Request ? input.url : String(input), location.href).origin; } catch { return chosen; }
  const answers = (entry: ServerEntry) => pathsOf(entry).some((path) => path.origin === address || dialOrigin(path.origin, entry) === address);
  const active = servers().find((entry) => entry.origin === chosen);
  if (!active || answers(active)) return chosen;
  return servers().find(answers)?.origin ?? chosen;
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (isInstalledClient()) await trustSettled();
  const headers = new Headers(init.headers);
  // Read from the request's address, not the server chosen now: a request begun before a switch would carry the new
  // server's token to the old one, whose 401 would sign the new one out.
  const origin = targetOrigin(input);
  const token = await nativeBearerToken(origin);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  // Only a refusal of the token still held signs out: a request sent before sign-in finished (no token yet) or with
  // a token since replaced must not wipe the one just saved.
  if (isInstalledClient() && response.status === 401 && token === await nativeBearerToken(origin)) {
    await clearNativeBearerToken(origin);
    if (origin === activeOrigin()) window.dispatchEvent(new Event(NATIVE_AUTH_REQUIRED_EVENT));
  }
  return response;
}

export async function nativeAuthorizationHeader() {
  const token = await nativeBearerToken();
  return token ? `Bearer ${token}` : null;
}
