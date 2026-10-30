import { httpUrl, loginUrl } from "./transport.js";
import { authorizedFetch } from "./native-auth-client.ts";
import { isInstalledClient } from "../platform/installed-client.ts";
import { whenPathMoves } from "../platform/servers.ts";

export interface ApiRequestMetadata {
  method: string;
  path: string;
  status: number;
}

type Read = { status: number; ok: boolean; text: string };

/*
 * A request on a route the client moves off is given up, not waited out: an address with nothing behind it (a hub
 * whose LAN address changed, a phone that left home) holds a request until the OS's connect timeout, and a few of
 * those filled the WebView's connections to that host so everything after them queued. A read is asked again on the
 * new route; a write is not repeated, since it may have arrived.
 */
const readOf = async (url: string, init: RequestInit): Promise<Read> => {
  const read = !init.method || ["GET", "HEAD"].includes(init.method.toUpperCase());
  for (let attempt = 0; ; attempt++) {
    const moved = new AbortController();
    const stop = whenPathMoves(() => moved.abort(new DOMException("The route to the server changed.", "AbortError")));
    try {
      const response = await authorizedFetch(httpUrl(url), { ...init, signal: init.signal ? AbortSignal.any([init.signal, moved.signal]) : moved.signal });
      return { status: response.status, ok: response.ok, text: await response.text() };
    } catch (error) {
      if (!moved.signal.aborted || init.signal?.aborted || !read || attempt > 0) throw error;
    } finally {
      stop();
    }
  }
};

// Reads begun before anything asks for them, each taken by the first ask.
const ahead = new Map<string, Promise<Read>>();
const readKey = (url: string, cache?: RequestCache) => `${cache || ""} ${url}`;

/**
 * Start reads the page is about to make, so they run alongside what comes
 * before them (the chat a first open waits on, then the page drawing it)
 * instead of after it. Each is taken by the first `api()` GET of the same
 * URL with no options but the same cache mode. One nobody takes within five
 * seconds is dropped, and a write drops those of its resource (the path to
 * its third segment: `/v0/chats/<id>`, `/v0/settings`), so none is older
 * than a change it was asked for after.
 */
export function readAhead(urls: string[], cache?: RequestCache) {
  for (const url of urls) {
    const key = readKey(url, cache);
    if (ahead.has(key)) continue;
    const read = readOf(url, cache ? { cache } : {});
    read.catch(() => {});
    ahead.set(key, read);
    setTimeout(() => { if (ahead.get(key) === read) ahead.delete(key); }, 5_000);
  }
}

const resourceOf = (url: string) => (url.split("?")[0] ?? "").split("/").slice(0, 4).join("/");

// Reads several parts of the app make of one document as they mount, by URL.
const shared = new Map<string, { at: number; read: Promise<unknown> }>();

/**
 * One read of `url` for every part of the app that asks within two seconds
 * of it, each given its own copy: the app's look, the terminal's shortcuts
 * and Settings each read /v0/preferences as they mount. A write to its
 * resource drops it, as it drops read-aheads.
 */
export function readShared<T>(url: string): Promise<T> {
  let held = shared.get(url);
  if (!held || Date.now() - held.at > 2_000) {
    const read = apiWhenServed<unknown>(url);
    held = { at: Date.now(), read };
    shared.set(url, held);
    const entry = held;
    read.catch(() => { if (shared.get(url) === entry) shared.delete(url); });
  }
  return held.read.then((value) => structuredClone(value) as T);
}

function takeAhead(url: string, options: RequestInit) {
  if (options.method || Object.keys(options).some((key) => key !== "cache")) return null;
  const key = readKey(url, options.cache);
  const read = ahead.get(key);
  if (read) ahead.delete(key);
  return read || null;
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const requestUrl = httpUrl(url);
  const early = takeAhead(url, options);
  let response: Read;
  if (early) response = await early;
  else {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type") && !(options.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }
    if (options.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) {
      const resource = resourceOf(url);
      for (const key of [...ahead.keys()]) if (resourceOf(key.slice(key.indexOf(" ") + 1)) === resource) ahead.delete(key);
      for (const key of [...shared.keys()]) if (resourceOf(key) === resource) shared.delete(key);
    }
    response = await readOf(url, { ...options, headers });
  }
  if (response.status === 401 && !isInstalledClient()) {
    location.href = loginUrl(location.pathname + location.search);
  }
  const text = response.text;
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
 * half a minute before the failure is let through. Route bootstrap can opt
 * into continued retries so a long outage does not leave the page stuck.
 * Anything else fails at once. For GETs only: a write is never repeated
 * behind the caller's back.
 */
export async function apiWhenServed<T>(url: string, keepRetrying = false): Promise<T> {
  // A restart is down for a second or two: retried often, so the page is
  // back as soon as the server is, for about as long in all as before.
  const delays = [150, 250, 400, 600, 800, ...Array(30).fill(1000)];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api<T>(url);
    } catch (error) {
      const status = (error as { apiRequest?: ApiRequestMetadata }).apiRequest?.status;
      const starting = status === undefined ? error instanceof TypeError : status >= 500;
      if (!starting || (attempt >= delays.length && !keepRetrying)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]));
    }
  }
}

export const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export { pathChatId, pathProjectId, projectMatchesPath, projectPath } from "./routes.ts";
