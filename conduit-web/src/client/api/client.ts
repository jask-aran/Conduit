import { httpUrl, loginUrl } from "./transport.js";
import { authorizedFetch } from "./native-auth-client.ts";
import { isInstalledClient } from "../platform/installed-client.ts";
import { createSignal } from "solid-js";
import { activeOrigin, whenPathMoves } from "../platform/servers.ts";

const READ_AHEAD_MS = 5_000;

export interface ApiRequestMetadata {
  method: string;
  path: string;
  status: number;
}

type Read = { status: number; ok: boolean; text: string };

/**
 * timeout: a hub that has not started answering rejects as a network failure (a TypeError), so the retry and offline
 * paths take over. It is patient on purpose: the runtime stream says the hub is unreachable within seconds.
 * `timeout: false` is for a write that legitimately takes longer (a git push, a harness asked to start).
 *
 * replay: false for a write whose waiting would be wrong: one carrying a secret, one stale by the time the hub is back
 * (stopping a process), or one with its own way of keeping what it saves (a draft).
 */
export type ApiOptions = RequestInit & { timeout?: number | false; replay?: false };
export const API_ANSWER_TIMEOUT_MS = 120_000;

/*
 * A request on a route the client moves off is given up: an address with nothing behind it holds a request until the
 * OS's connect timeout, and a few of those fill the WebView's connections to that host. A read is asked again on the
 * new route; a write is not repeated, since it may have arrived.
 */
const readOf = async (url: string, { timeout, replay: _replay, ...init }: ApiOptions): Promise<Read> => {
  const read = !init.method || ["GET", "HEAD"].includes(init.method.toUpperCase());
  const upload = init.body != null && typeof init.body !== "string";
  const limit = init.signal || upload || timeout === false ? 0 : timeout ?? API_ANSWER_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    const moved = new AbortController();
    const stop = whenPathMoves(() => moved.abort(new DOMException("The route to the server changed.", "AbortError")));
    // The limit is on the hub starting to answer, not on the answer arriving: a slow link still brings a big
    // transcript in.
    const expiry = limit ? new AbortController() : null;
    const timer = expiry ? setTimeout(() => expiry.abort(), limit) : undefined;
    const signals = [init.signal, moved.signal, expiry?.signal].filter((signal): signal is AbortSignal => Boolean(signal));
    try {
      const response = await authorizedFetch(httpUrl(url), { ...init, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
      clearTimeout(timer);
      return { status: response.status, ok: response.ok, text: await response.text() };
    } catch (error) {
      clearTimeout(timer);
      if (expiry?.signal.aborted && !moved.signal.aborted) throw new TypeError(`The server did not answer within ${Math.round(limit / 1000)} s.`);
      // A start or a wake can move the route more than once (the last route, then the race's winner): a read follows each
      // move, up to a few, rather than failing on the second.
      if (!moved.signal.aborted || init.signal?.aborted || !read || attempt >= 3) throw error;
    } finally {
      stop();
    }
  }
};

const ahead = new Map<string, Promise<Read>>();
const readKey = (url: string, cache?: RequestCache) => `${cache || ""} ${url}`;

/**
 * Each is taken by the first `api()` GET of the same URL with no options but the same cache mode. A write drops those
 * of its resource (the path to its third segment), so none is older than a change asked for after.
 */
export function readAhead(urls: string[], cache?: RequestCache) {
  for (const url of urls) {
    const key = readKey(url, cache);
    if (ahead.has(key)) continue;
    const read = readOf(url, cache ? { cache } : {});
    read.catch(() => {});
    ahead.set(key, read);
    setTimeout(() => { if (ahead.get(key) === read) ahead.delete(key); }, READ_AHEAD_MS);
  }
}

const resourceOf = (url: string) => (url.split("?")[0] ?? "").split("/").slice(0, 4).join("/");

const shared = new Map<string, { at: number; read: Promise<unknown> }>();

/** Each caller gets its own copy; a write to its resource drops it, as it drops read-aheads. */
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
    const held = heldWrite(url, options, headers);
    // Behind writes already waiting, so they land in the order they were made.
    if (held && heldOf(heldOrigin()).length) response = await holdWrite(held);
    else {
      try { response = await readOf(url, { ...options, headers }); }
      catch (error) {
        if (!held || !isUnreachableError(error)) throw error;
        response = await holdWrite(held);
      }
    }
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
 * A starting server answers with no connection, or a 5xx from itself or its proxy; those are retried. For GETs only:
 * a write is never repeated behind the caller's back.
 */
export async function apiWhenServed<T>(url: string, keepRetrying = false): Promise<T> {
  // A restart is down for a second or two: retried often, so the page is back as soon as the server is.
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

/** A bug in the page is also a TypeError, but carries no fetch; an answer the server gave carries `apiRequest`. */
export const isUnreachableError = (error: unknown) => error instanceof TypeError
  && !(error as { apiRequest?: unknown }).apiRequest
  && /fetch|network|load failed|did not answer|connection/i.test(error.message);

/*
 * Only PUT, PATCH and DELETE are held: they say the same thing however often they arrive, which makes sending one again
 * safe. A POST never is, nor an upload, whose body is not kept.
 */
interface HeldWrite { id: string; url: string; method: string; body?: string; headers: [string, string][]; at: string }

const HELD_PREFIX = "conduit:held-writes:";
const heldOrigin = () => activeOrigin() || "";
const heldStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
};
function heldOf(origin: string): HeldWrite[] {
  try {
    const list = JSON.parse(heldStorage()?.getItem(`${HELD_PREFIX}${origin}`) || "[]");
    return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string" && typeof item.url === "string") : [];
  } catch { return []; }
}
const [heldCount, setHeldCount] = createSignal(0);
export const heldWrites = heldCount;
export const changesWaiting = (count: number) => `${count} ${count === 1 ? "change" : "changes"} waiting to save`;
function writeHeld(origin: string, list: HeldWrite[]) {
  try {
    if (list.length) heldStorage()?.setItem(`${HELD_PREFIX}${origin}`, JSON.stringify(list));
    else heldStorage()?.removeItem(`${HELD_PREFIX}${origin}`);
  } catch { /* quota, or a profile that stores nothing: the write waits in memory only */ }
  if (origin === heldOrigin()) setHeldCount(list.length);
}

function heldWrite(url: string, options: ApiOptions, headers: Headers): HeldWrite | null {
  const method = String(options.method || "GET").toUpperCase();
  if (!["PUT", "PATCH", "DELETE"].includes(method) || options.replay === false || options.signal) return null;
  if (options.body != null && typeof options.body !== "string") return null;
  const kept: [string, string][] = [];
  headers.forEach((value, name) => { if (name.toLowerCase() !== "authorization") kept.push([name, value]); });
  return { id: `w_${crypto.randomUUID()}`, url, method, ...(options.body != null ? { body: options.body } : {}), headers: kept, at: new Date().toISOString() };
}

const heldWaiters = new Map<string, { resolve: (read: Read) => void; reject: (error: unknown) => void }>();

function holdWrite(write: HeldWrite): Promise<Read> {
  const origin = heldOrigin();
  return new Promise<Read>((resolve, reject) => {
    heldWaiters.set(write.id, { resolve, reject });
    writeHeld(origin, [...heldOf(origin), write]);
    if (!retryTimer && !replaying) scheduleReplay();
  });
}

let replaying = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let backoff = 0;
function scheduleReplay() {
  if (retryTimer) return;
  const delay = Math.min(2_000 * 2 ** backoff, 30_000);
  backoff += 1;
  retryTimer = setTimeout(() => { retryTimer = undefined; void drainHeld(); }, delay);
}

function settleHeld(origin: string, write: HeldWrite, outcome: { read: Read } | { error: unknown }) {
  writeHeld(origin, heldOf(origin).filter((item) => item.id !== write.id));
  const waiter = heldWaiters.get(write.id);
  heldWaiters.delete(write.id);
  if (!waiter) return;
  if ("read" in outcome) waiter.resolve(outcome.read);
  else waiter.reject(outcome.error);
}

async function drainHeld() {
  if (replaying) return;
  replaying = true;
  try {
    for (;;) {
      const origin = heldOrigin();
      const write = heldOf(origin)[0];
      if (!write) { backoff = 0; return; }
      let read: Read;
      try {
        read = await readOf(write.url, { method: write.method, headers: write.headers, ...(write.body != null ? { body: write.body } : {}) });
      } catch (error) {
        // Still not there, or the route moved under it: asked again later. Anything else is a request that cannot be
        // made at all, and its caller is told.
        if (isUnreachableError(error) || (error as Error | null)?.name === "AbortError") { scheduleReplay(); return; }
        settleHeld(origin, write, { error });
        continue;
      }
      // A proxy in front of a hub that is still starting answers for it; the hub itself has not.
      if ([502, 503, 504].includes(read.status)) { scheduleReplay(); return; }
      backoff = 0;
      settleHeld(origin, write, { read });
    }
  } finally {
    replaying = false;
  }
}

export function replayHeldWrites() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
  backoff = 0;
  setHeldCount(heldOf(heldOrigin()).length);
  void drainHeld();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", replayHeldWrites);
  // Outside any owner (whenPathMoves, not onPathChange's effect): this lives as long as the page does.
  whenPathMoves(replayHeldWrites);
  // A cold start: whatever an earlier page kept is sent, with nobody waiting on it.
  queueMicrotask(replayHeldWrites);
}

export const asList = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export { chatPath, JBOT_THREAD_PATH, pathChatId, pathProjectId, projectMatchesPath, projectPath, setJbotHome } from "./routes.ts";
