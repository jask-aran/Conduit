import crypto from "node:crypto";

const COOKIE_NAME = "conduit_session";
const COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;
const RATE_LIMIT_THRESHOLD = 5;
const RATE_LIMIT_BASE_MS = 5_000;
const RATE_LIMIT_CAP_MS = 5 * 60 * 1000;

const UNAUTHENTICATED_API_PREFIXES = ["/v0/"];
const UNAUTHENTICATED_EXACT = new Set(["/login", "/healthz"]);

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

export function isSecureRequest(request) {
  if (request.protocol === "https") return true;
  const forwarded = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  return forwarded.includes("https");
}

function publicRequestOrigin(request) {
  // Reverse proxies (including port-forwarding services) retain the browser's
  // public authority here while replacing Host with their upstream address.
  // Without this, a legitimate first-run form is rejected after forwarding.
  const forwardedHost = String(request.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(request.headers?.host || "").trim();
  if (!host) return null;
  try {
    return new URL(`${isSecureRequest(request) ? "https" : "http"}://${host}`).origin;
  } catch {
    return null;
  }
}

// A browser's form POST has an Origin header. Require it during first-run
// setup so another site cannot silently claim a reachable, unconfigured
// Conduit instance in a visitor's browser. The forwarded public origin is
// used when a tunnel or Codespaces-style proxy terminates the connection.
export function isSameOriginRequest(request) {
  const origin = String(request.headers?.origin || "");
  if (!origin) return false;
  try {
    const requestOrigin = publicRequestOrigin(request);
    return requestOrigin !== null && new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
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
      if (!authStore.hasPassword()) {
        if (isBrowserNavigation(request) && !UNAUTHENTICATED_API_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
          return response.redirect(302, "/login");
        }
        return response.status(401).json({ error: "setup_required" });
      }
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
      return response.redirect(302, "/login");
    }
    return response.status(401).json({ error: "unauthorized" });
  };
}

export { COOKIE_NAME };
