import crypto from "node:crypto";

const COOKIE_NAME = "conduit_session";
const COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;
const RATE_LIMIT_THRESHOLD = 5;
const RATE_LIMIT_BASE_MS = 5_000;
const RATE_LIMIT_CAP_MS = 5 * 60 * 1000;

const UNAUTHENTICATED_API_PREFIXES = ["/v0/"];
const UNAUTHENTICATED_EXACT = new Set(["/login", "/healthz"]);

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

export function cookieName() {
  return COOKIE_NAME;
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
  if (UNAUTHENTICATED_EXACT.has(pathname) && method === "GET") return true;
  if (method === "POST" && pathname === "/v0/auth/login") return true;
  return false;
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
  if (!session) return null;
  const touched = await authStore.touchSession(session);
  return { token, session, touched };
}

export function issueSessionCookie(response, token, { secure }) {
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
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
    const context = await validateSession(authStore, request);
    if (context) {
      request.conduitAuth = context;
      // Rolling expiry: when touchSession actually advanced lastSeenAt
      // (throttled to once per LAST_SEEN_REFRESH_MS), re-issue the cookie so
      // the browser's 30-day window restarts from this request.
      if (context.touched) issueSessionCookie(response, context.token, { secure: isSecureRequest(request) });
      return next();
    }
    if (isBrowserNavigation(request) && !UNAUTHENTICATED_API_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return response.redirect(302, `/login?after=${encodeURIComponent(safeRedirectTarget(request.originalUrl))}`);
    }
    return response.status(401).json({ error: "unauthorized" });
  };
}

export { COOKIE_NAME, isSecureRequest };
