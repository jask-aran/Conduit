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

/**
 * A read made on the way in, when the server may still be starting -- the
 * first load after a restart, often a reload the new build asked for. A
 * starting server answers with no connection, or with a 5xx from itself or
 * the proxy in front of it; those are tried again, backing off, for about
 * half a minute before the failure is let through. Anything else fails at
 * once. For GETs only: a write is never repeated behind the caller's back.
 */
export async function apiWhenServed<T>(url: string): Promise<T> {
  const delays = [250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 5000, 5000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api<T>(url);
    } catch (error) {
      const status = (error as { apiRequest?: ApiRequestMetadata }).apiRequest?.status;
      const starting = status === undefined ? error instanceof TypeError : status >= 500;
      if (!starting || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export { pathChatId, pathProjectId, projectMatchesPath, projectPath } from "./routes.ts";
