import { isInstalledClient, secureTokenStore } from "../platform/installed-client.ts";
import { activeOrigin, LEGACY_ORIGIN_STORAGE_KEY } from "../platform/servers.ts";

const TOKEN_PREFIX = "conduit.native.bearer-token";
/** What a client that could hold only one server stored its token under. */
const LEGACY_TOKEN_KEY = TOKEN_PREFIX;
export const NATIVE_AUTH_REQUIRED_EVENT = "conduit:native-auth-required";

// A credential store is keyed by a flat string, and an origin carries a scheme
// and a colon. Folding those to dashes keeps the entry readable in Windows
// Credential Manager while staying distinct: http and https differ, and so do
// two ports.
const tokenKey = (origin: string) => `${TOKEN_PREFIX}.${origin.replace(/[^a-z0-9.-]+/gi, "-")}`;

const cached = new Map<string, string | null>();

/**
 * Hand the single-server token to the server it was issued for.
 *
 * It is claimed once, by the origin that was configured when this client last
 * knew how to hold only one. Without that the first launch after an update
 * signs every installed client out; with it keyed to anything less specific, a
 * server added after the update would inherit a token minted by another one.
 */
async function adoptLegacyToken(origin: string): Promise<string | null> {
  let configured: string | null = null;
  try { configured = localStorage.getItem(LEGACY_ORIGIN_STORAGE_KEY); } catch { return null; }
  if (!configured) return null;
  try { if (new URL(configured).origin !== origin) return null; } catch { return null; }
  const token = await secureTokenStore.get(LEGACY_TOKEN_KEY);
  if (token) await secureTokenStore.set(tokenKey(origin), token);
  await secureTokenStore.remove(LEGACY_TOKEN_KEY).catch(() => {});
  try { localStorage.removeItem(LEGACY_ORIGIN_STORAGE_KEY); } catch {}
  return token || null;
}

export async function nativeBearerToken(origin = activeOrigin()) {
  if (!isInstalledClient() || !origin) return null;
  const existing = cached.get(origin);
  if (existing !== undefined) return existing;
  const key = tokenKey(origin);
  const token = await secureTokenStore.get(key) ?? await adoptLegacyToken(origin);
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

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = await nativeBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (isInstalledClient() && response.status === 401) {
    await clearNativeBearerToken();
    window.dispatchEvent(new Event(NATIVE_AUTH_REQUIRED_EVENT));
  }
  return response;
}

export async function nativeAuthorizationHeader() {
  const token = await nativeBearerToken();
  return token ? `Bearer ${token}` : null;
}
