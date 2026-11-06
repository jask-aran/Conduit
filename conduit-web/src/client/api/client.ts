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

/**
 * What `api()` takes: a fetch's options, and how long to wait for the answer. A request with no signal of its own is
 * given up after `timeout` ms (reads 15 s, writes 20 s by default) and rejects as a network failure would -- a
 * TypeError -- so the retry and offline paths that already handle a hub that is not there take over, rather than the
 * page waiting on an address nothing answers at. `timeout: false` is for a write that legitimately takes longer than
 * that (a git push, a harness asked to start); an upload (a body that is not a string) and a request with its own
 * signal are never timed out here.
 */
export type ApiOptions = RequestInit & { timeout?: number | false };
export const API_READ_TIMEOUT_MS = 15_000;
export const API_WRITE_TIMEOUT_MS = 20_000;

/*
 * A request on a route the client moves off is given up, not waited out: an address with nothing behind it (a hub
 * whose LAN address changed, a phone that left home) holds a request until the OS's connect timeout, and a few of
 * those filled the WebView's connections to that host so everything after them queued. A read is asked again on the
 * new route (and again if it moves again, up to three times); a write is not repeated, since it may have arrived.
 */
const readOf = async (url: string, { timeout, ...init }: ApiOptions): Promise<Read> => {
  const read = !init.method || ["GET", "HEAD"].includes(init.method.toUpperCase());
  const upload = init.body != null && typeof init.body !== "string";
  const limit = init.signal || upload || timeout === false ? 0 : timeout ?? (read ? API_READ_TIMEOUT_MS : API_WRITE_TIMEOUT_MS);
  for (let attempt = 0; ; attempt++) {
    const moved = new AbortController();
    const stop = whenPathMoves(() => moved.abort(new DOMException("The route to the server changed.", "AbortError")));
    // Each attempt has the whole of the limit: a read asked again on a new route is a new request.
    const expiry = limit ? AbortSignal.timeout(limit) : null;
    const signals = [init.signal, moved.signal, expiry].filter((signal): signal is AbortSignal => Boolean(signal));
    try {
      const response = await authorizedFetch(httpUrl(url), { ...init, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
      return { status: response.status, ok: response.ok, text: await response.text() };
    } catch (error) {
      if (expiry?.aborted && !moved.signal.aborted) throw new TypeError(`The server did not answer within ${Math.round(limit / 1000)} s.`);
      // A start or a wake can move the route more than once (the last route, then the race's winner): a read follows each
      // move, up to a few, rather than failing on the second.
      if (!moved.signal.aborted || init.signal?.aborted || !read || attempt >= 3) throw error;
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

function takeAhead(url: string, options: ApiOptions) {
  if (options.method || Object.keys(options).some((key) => key !== "cache")) return null;
  const key = readKey(url, options.cache);
  const read = ahead.get(key);
  if (read) ahead.delete(key);
  return read || null;
}

export async function api<T>(url: string, options: ApiOptions = {}): Promise<T> {
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

/**
 * A request that never reached the hub, or that it never answered (a timeout): what fetch rejects with when there is no
 * route, as against an answer the server gave (which carries `apiRequest`) or a bug in the page (also a TypeError, but
 * not about a fetch).
 */
export const isUnreachableError = (error: unknown) => error instanceof TypeError
  && !(error as { apiRequest?: unknown }).apiRequest
  && /fetch|network|load failed|did not answer|connection/i.test(error.message);

export const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export { chatPath, JBOT_THREAD_PATH, pathChatId, pathProjectId, projectMatchesPath, projectPath, setJbotHome } from "./routes.ts";
