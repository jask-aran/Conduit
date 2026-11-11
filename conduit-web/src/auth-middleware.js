import { PRIVATE_HOST } from "./network-hosts.js";
import fs from "node:fs";
import { installedClientOrigin } from "./native-auth.js";
import { writePrivateFile } from "./private-file.js";

const COOKIE_NAME = "conduit_session";
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_THRESHOLD = 5;
const RATE_LIMIT_BASE_MS = 5_000;
const RATE_LIMIT_CAP_MS = 5 * 60 * 1000;

const UNAUTHENTICATED_API_PREFIXES = ["/v0/"];
const UNAUTHENTICATED_EXACT = new Set([
  "/login",
  "/healthz",
  "/favicon.svg",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/pwa-maskable-512x512.png",
  "/apple-touch-icon.png",
]);
const UNAUTHENTICATED_PWA_PATTERNS = [
  /^\/[^/]+\.webmanifest$/,
  /^\/(?:sw|service-worker)\.js$/,
  /^\/workbox-[^/]+\.js$/,
  /^\/registerSW\.js$/,
  // The service worker, served without a session, precaches every one of these paths, so withholding them only
  // breaks the shell: a cached page whose stylesheet is answered 401 renders unstyled. The bundles carry nobody's data.
  /^\/assets\/(?:file-icons\/)?[^/]+$/,
];

function isLoopback(host) {
  return ["127.0.0.1", "::1", "localhost", "0:0:0:0:0:0:0:1", "localhost.localdomain"].includes(host);
}

export function authStartupViolation(config, authStore) {
  const loopback = isLoopback(config.host);
  if (loopback) return null;
  if (config.allowInsecure) return null;
  if (!authStore.hasPassword()) {
    return new Error(
      "Refusing to bind a non-loopback address without a configured password. "
      + "Run `node scripts/conduit-auth.mjs set-password` from the repo root, "
      + "or export CONDUIT_ALLOW_INSECURE=1 for development only.",
    );
  }
  return null;
}

export function createRateLimiter() {
  let failures = 0;
  let nextAllowedAt = 0;
  return {
    noteFailure(now = Date.now()) {
      failures += 1;
      if (failures < RATE_LIMIT_THRESHOLD) {
        nextAllowedAt = now;
        return 0;
      }
      const backoff = Math.min(RATE_LIMIT_CAP_MS, RATE_LIMIT_BASE_MS * 2 ** (failures - RATE_LIMIT_THRESHOLD));
      nextAllowedAt = now + backoff;
      return backoff;
    },
    noteSuccess() {
      failures = 0;
      nextAllowedAt = 0;
    },
    waitUntilMs() {
      return nextAllowedAt;
    },
    isThrottled(now = Date.now()) {
      return now < nextAllowedAt;
    },
  };
}

/*
 * Failures are counted per client, so one client cannot lock everyone out, under a ceiling across all clients, so
 * attempts spread over many addresses are still slowed. Kept in a file so a restart is no reset.
 */
const GLOBAL_THRESHOLD = 50;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
const KEYS_KEPT = 2000;
const KEY_FORGOTTEN_MS = 24 * 60 * 60 * 1000;
const TRUSTED_FORGOTTEN_MS = 90 * KEY_FORGOTTEN_MS;
const backoffAfter = (failures, threshold) => failures < threshold ? 0
  : Math.min(RATE_LIMIT_CAP_MS, RATE_LIMIT_BASE_MS * 2 ** (failures - threshold));

export function createLoginThrottle({ file = null, now = () => Date.now() } = {}) {
  const keys = new Map();
  let recent = [];
  let globalUntil = 0;
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [key, entry] of Object.entries(saved.keys || {})) if (entry && Number.isFinite(entry.lastAt)) keys.set(key, entry);
      recent = Array.isArray(saved.recent) ? saved.recent.filter(Number.isFinite) : [];
      globalUntil = Number(saved.globalUntil) || 0;
    } catch { /* none yet */ }
  }
  let writing = Promise.resolve();
  const save = () => {
    if (!file) return;
    const text = JSON.stringify({ keys: Object.fromEntries(keys), recent, globalUntil });
    writing = writing.then(() => writePrivateFile(file, text)).catch(() => {});
  };
  const prune = (at) => {
    recent = recent.filter((time) => at - time < GLOBAL_WINDOW_MS);
    for (const [key, entry] of keys) if (at - entry.lastAt > (entry.trusted ? TRUSTED_FORGOTTEN_MS : KEY_FORGOTTEN_MS) && at >= entry.nextAllowedAt) keys.delete(key);
    // Strangers go first: a flood of forged addresses must not push out the clients that have signed in.
    for (const [key, entry] of keys) { if (keys.size <= KEYS_KEPT) break; if (!entry.trusted) keys.delete(key); }
    while (keys.size > KEYS_KEPT) keys.delete(keys.keys().next().value);
  };
  return {
    retryAt(key, at = now()) {
      // A client that has signed in before is not held by the ceiling, so forged addresses never lock the owner out.
      const entry = keys.get(key);
      const until = Math.max(entry?.nextAllowedAt || 0, entry?.trusted ? 0 : globalUntil);
      return until > at ? until : 0;
    },
    noteFailure(key, at = now()) {
      prune(at);
      const entry = keys.get(key) || { failures: 0, nextAllowedAt: 0, lastAt: at };
      entry.failures += 1;
      entry.lastAt = at;
      entry.nextAllowedAt = at + backoffAfter(entry.failures, RATE_LIMIT_THRESHOLD);
      keys.delete(key);
      keys.set(key, entry);
      recent.push(at);
      const spread = backoffAfter(recent.length, GLOBAL_THRESHOLD);
      if (spread) globalUntil = Math.max(globalUntil, at + spread);
      save();
    },
    noteSuccess(key, at = now()) {
      keys.delete(key);
      keys.set(key, { failures: 0, nextAllowedAt: 0, lastAt: at, trusted: true });
      save();
    },
    flush: () => writing,
  };
}

/**
 * A name a client could forge only moves its own attempts to another count: the ceiling across all clients still holds.
 */
export function loginThrottleKey(request) {
  const socket = String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  // Only a proxy on this machine (Caddy, a tunnel's connector) is believed: a LAN client could name anyone.
  const proxied = /^(127\.|::1$)/.test(socket);
  if (!proxied) return socket || "unknown";
  const headers = request.headers || {};
  const named = headers["cf-connecting-ip"] || headers["x-real-ip"]
    || String(headers["x-forwarded-for"] || "").split(",").map((item) => item.trim()).filter(Boolean).at(-1);
  return String(named || socket || "unknown").slice(0, 64);
}

function isBrowserNavigation(request) {
  const accept = String(request.headers?.accept || "");
  if (accept.includes("text/html") && !accept.includes("application/json")) return true;
  return false;
}

export function isAllowlistedPath(method, pathname) {
  // `/v0/server/prove` answers without a session so a client can check an address before it sends a token there; it
  // signs a nonce the caller chose and says nothing else.
  // A webhook that wakes the persistent agent is called by other services: its token (32+ random bytes, made by the
  // agent's `watch` tool) is the secret, and the route answers an unknown one as a missing route.
  if (method === "GET" && /^\/v0\/agent\/connectors\/[A-Za-z0-9_-]+\/callback$/.test(pathname)) return true;
  if (method === "POST" && /^\/v0\/agent\/hooks\/[A-Za-z0-9_-]{43,}$/.test(pathname)) return true;
  if (method === "POST" && /^\/v0\/push\/answer\/[A-Za-z0-9_-]{43}$/.test(pathname)) return true;
  // The mailbox Worker carries the mailbox's shared secret and says nothing but "collect".
  if (method === "POST" && pathname === "/v0/agent/email/wake") return true;
  if (method !== "GET") return method === "POST" && ["/v0/auth/login", "/v0/auth/native-login", "/v0/auth/native-pair", "/v0/server/prove"].includes(pathname);
  if (pathname === "/v0/auth/handoff") return true;
  if (UNAUTHENTICATED_EXACT.has(pathname)) return true;
  return UNAUTHENTICATED_PWA_PATTERNS.some((pattern) => pattern.test(pathname));
}

// Protocol-relative values like "//evil.com/x" or "/\evil.com" pass a naive startsWith("/") guard and would redirect
// a freshly signed-in user off-origin.
export function safeRedirectTarget(value) {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

export function readCookie(request) {
  const header = String(request.headers?.cookie || "");
  const pairs = header.split(";");
  for (const pair of pairs) {
    const [name, ...value] = pair.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=").trim();
  }
  return null;
}

export async function validateSession(authStore, request) {
  const token = readCookie(request);
  if (!token) return null;
  const session = await authStore.findSession(token);
  if (!session || session.kind === "native") return null;
  const touched = await authStore.touchSession(session);
  return { token, session, touched };
}

export function isNativeRequest(request) {
  return installedClientOrigin(request.headers?.origin) !== null;
}

async function validateNativeSession(authStore, request) {
  if (!isNativeRequest(request)) return null;
  const match = String(request.headers?.authorization || "").match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  if (!match) return null;
  const token = match[1];
  const session = await authStore.findSession(token);
  if (!session || session.kind !== "native") return null;
  const touched = await authStore.touchSession(session);
  return { token, session, touched, native: true };
}

const NATIVE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const NATIVE_HEADERS = new Set(["authorization", "content-type"]);

export function nativeCors(request, response, next) {
  if (!isNativeRequest(request)) return next();
  // The matched member of the set, not the header as sent.
  response.set("Access-Control-Allow-Origin", installedClientOrigin(request.headers.origin));
  response.set("Vary", "Origin");
  if (request.method !== "OPTIONS") return next();
  const method = String(request.headers["access-control-request-method"] || "").toUpperCase();
  const headers = String(request.headers["access-control-request-headers"] || "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!NATIVE_METHODS.has(method) || headers.some((header) => !NATIVE_HEADERS.has(header))) {
    return response.status(403).json({ error: "native_cors_rejected" });
  }
  response.set("Access-Control-Allow-Methods", [...NATIVE_METHODS].join(", "));
  response.set("Access-Control-Allow-Headers", [...NATIVE_HEADERS].join(", "));
  response.set("Access-Control-Max-Age", "600");
  return response.status(204).end();
}

export function issueSessionCookie(response, token, { secure }) {
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_MS,
    secure,
  });
}

export function clearSessionCookie(response, { secure }) {
  response.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
  });
}

function isSecureRequest(request) {
  if (request.protocol === "https") return true;
  const forwarded = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  return forwarded.includes("https");
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Any forwarding header means a proxy is in front and the socket address is the proxy's, so the exemption does not
 * apply.
 */
function isLoopbackRequest(request) {
  if (request.headers["x-forwarded-for"] || request.headers["x-forwarded-proto"]) return false;
  return LOOPBACK_ADDRESSES.has(String(request.socket?.remoteAddress || ""));
}

// Node reports a v4 peer on a dual-stack socket as IPv4-mapped IPv6, so the prefix is stripped before matching.

/**
 * No public authority issues a certificate for a LAN address, so requiring TLS here would leave a LAN server impossible
 * to sign in to. The client's `normalizeServerOrigin` draws the same line, and the two have to agree.
 */
function isPrivateNetworkRequest(request) {
  if (request.headers["x-forwarded-for"] || request.headers["x-forwarded-proto"]) return false;
  const address = String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return PRIVATE_HOST.test(address);
}

function isTrustworthyRequest(request) {
  return isSecureRequest(request) || isLoopbackRequest(request) || isPrivateNetworkRequest(request);
}

const NO_PASSWORD_NEGATIVE_CACHE_MS = 5_000;

export function prepareAuthMiddleware(authStore) {
  let noPasswordCheckedAt = 0;
  return async function requireAuth(request, response, next) {
    if (isAllowlistedPath(request.method, request.path)) return next();
    if (!authStore.hasPassword()) {
      const now = Date.now();
      if (now - noPasswordCheckedAt > NO_PASSWORD_NEGATIVE_CACHE_MS) {
        await authStore.reloadFromFile();
        noPasswordCheckedAt = now;
      }
      if (!authStore.hasPassword()) return next();
    }
    const context = await validateNativeSession(authStore, request) || await validateSession(authStore, request);
    if (context) {
      request.conduitAuth = context;
      // Rolling expiry: re-issued whenever touchSession advanced lastSeenAt, so the 30-day window restarts.
      if (context.touched && !context.native) issueSessionCookie(response, context.token, { secure: isSecureRequest(request) });
      return next();
    }
    if (isBrowserNavigation(request) && !UNAUTHENTICATED_API_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return response.redirect(302, `/login?after=${encodeURIComponent(safeRedirectTarget(request.originalUrl))}`);
    }
    return response.status(401).json({ error: "unauthorized" });
  };
}

export { isSecureRequest, isTrustworthyRequest };
