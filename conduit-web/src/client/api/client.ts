export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type") && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    location.href = `/login?after=${encodeURIComponent(location.pathname + location.search)}`;
  }
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const detail = body && typeof body === "object" ? body as Record<string, unknown> : {};
    throw Object.assign(new Error(String(detail.message || detail.error || "Request failed")), detail);
  }
  return body as T;
}

export const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export function pathChatId(pathname = location.pathname): string | null {
  return pathname.match(/^\/chat\/([a-zA-Z0-9_-]{8,128})$/)?.[1] || null;
}
