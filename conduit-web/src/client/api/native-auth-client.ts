import { isInstalledClient, secureTokenStore } from "../platform/installed-client.ts";

const TOKEN_KEY = "conduit.native.bearer-token";
export const NATIVE_AUTH_REQUIRED_EVENT = "conduit:native-auth-required";
let cachedToken: string | null | undefined;

export async function nativeBearerToken() {
  if (!isInstalledClient()) return null;
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = await secureTokenStore.get(TOKEN_KEY);
  return cachedToken;
}

export async function saveNativeBearerToken(token: string) {
  await secureTokenStore.set(TOKEN_KEY, token);
  cachedToken = token;
}

export async function clearNativeBearerToken() {
  cachedToken = null;
  if (isInstalledClient()) await secureTokenStore.remove(TOKEN_KEY);
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
