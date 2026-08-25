import { httpUrl, loginUrl } from "./transport";
import { authorizedFetch } from "./native-auth-client";
import { Capacitor } from "@capacitor/core";

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
  if (response.status === 401 && !Capacitor.isNativePlatform()) {
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

export function pathChatId(pathname = location.pathname): string | null {
  return pathname.match(/^\/chat\/([a-zA-Z0-9_-]{8,128})$/)?.[1] || null;
}

export function pathProjectId(pathname = location.pathname): string | null {
  return pathname.match(/^\/(?:project|workspace)\/([a-zA-Z0-9_-]{8,128})$/)?.[1] || null;
}

export function projectPath(project: { id: string; kind?: string; origin?: string }): string {
  const workspace = project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
  return `/${workspace ? "workspace" : "project"}/${encodeURIComponent(project.id)}`;
}
