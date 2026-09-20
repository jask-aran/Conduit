import { httpUrl, loginUrl } from "./transport.js";
import { authorizedFetch } from "./native-auth-client.ts";
import { isInstalledClient } from "../platform/installed-client.ts";

export interface ApiRequestMetadata {
  method: string;
  path: string;
  status: number;
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type") && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const requestUrl = httpUrl(url);
  const response = await authorizedFetch(requestUrl, { ...options, headers });
  if (response.status === 401 && !isInstalledClient()) {
    location.href = loginUrl(location.pathname + location.search);
  }
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const detail = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const request = new URL(requestUrl, location.href);
    throw Object.assign(new Error(String(detail.message || detail.error || "Request failed")), detail, {
      apiRequest: {
        method: String(options.method || "GET").toUpperCase(),
        path: request.pathname,
        status: response.status,
      } satisfies ApiRequestMetadata,
    });
  }
  return body as T;
}

export const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export { pathChatId, pathProjectId, projectMatchesPath, projectPath } from "./routes.ts";
