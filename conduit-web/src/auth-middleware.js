import crypto from "node:crypto";
import { NATIVE_APP_ORIGIN } from "./native-auth.js";

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
]);
const UNAUTHENTICATED_PWA_PATTERNS = [
  /^\/[^/]+\.webmanifest$/,
  /^\/(?:sw|service-worker)\.js$/,
  /^\/workbox-[^/]+\.js$/,
  /^\/registerSW\.js$/,
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

function isBrowserNavigation(request) {
  const accept = String(request.headers?.accept || "");
  if (accept.includes("text/html") && !accept.includes("application/json")) return true;
  return false;
}

export function isAllowlistedPath(method, pathname) {
  if (method !== "GET") return method === "POST" && ["/v0/auth/login", "/v0/auth/native-login"].includes(pathname);
  if (UNAUTHENTICATED_EXACT.has(pathname)) return true;
  return UNAUTHENTICATED_PWA_PATTERNS.some((pattern) => pattern.test(pathname));
}

// Login "after" targets are same-origin paths only: a leading slash covers
// real SPA routes, but protocol-relative values like "//evil.com/x" or
// "/\evil.com" would slip a naive startsWith("/") guard and let an attacker
// redirect a freshly-authenticated user off-origin. Reject them.
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
  return request.headers?.origin === NATIVE_APP_ORIGIN;
}

export async function validateNativeSession(authStore, request) {
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
  response.set("Access-Control-Allow-Origin", NATIVE_APP_ORIGIN);
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
      // Rolling expiry: when touchSession actually advanced lastSeenAt
      // (throttled to once per LAST_SEEN_REFRESH_MS), re-issue the cookie so
      // the browser's 30-day window restarts from this request.
      if (context.touched && !context.native) issueSessionCookie(response, context.token, { secure: isSecureRequest(request) });
      return next();
    }
    if (isBrowserNavigation(request) && !UNAUTHENTICATED_API_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return response.redirect(302, `/login?after=${encodeURIComponent(safeRedirectTarget(request.originalUrl))}`);
    }
    return response.status(401).json({ error: "unauthorized" });
  };
}

export { COOKIE_NAME, isSecureRequest };
