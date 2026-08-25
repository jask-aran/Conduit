import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const TOKEN_KEY = "conduit.native.bearer-token";
export const NATIVE_AUTH_REQUIRED_EVENT = "conduit:native-auth-required";
let cachedToken: string | null | undefined;

export async function nativeBearerToken() {
  if (!Capacitor.isNativePlatform()) return null;
  if (cachedToken !== undefined) return cachedToken;
  const value = await SecureStorage.get(TOKEN_KEY);
  cachedToken = typeof value === "string" && value ? value : null;
  return cachedToken;
}

export async function saveNativeBearerToken(token: string) {
  await SecureStorage.set(TOKEN_KEY, token);
  cachedToken = token;
}

export async function clearNativeBearerToken() {
  cachedToken = null;
  if (Capacitor.isNativePlatform()) await SecureStorage.remove(TOKEN_KEY);
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = await nativeBearerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (Capacitor.isNativePlatform() && response.status === 401) {
    await clearNativeBearerToken();
    window.dispatchEvent(new Event(NATIVE_AUTH_REQUIRED_EVENT));
  }
  return response;
}

export async function nativeAuthorizationHeader() {
  const token = await nativeBearerToken();
  return token ? `Bearer ${token}` : null;
}
