import crypto from "node:crypto";
import {
  clearSessionCookie,
  createLoginThrottle,
  issueSessionCookie,
  isNativeRequest,
  isSecureRequest,
  isTrustworthyRequest,
  loginThrottleKey,
  readCookie,
  safeRedirectTarget,
} from "../../auth-middleware.js";
import { createLoginPageRenderer } from "../../auth-login-page.js";

export function registerAuthRoutes(app, { authStore, socketTickets, clientDist, throttleFile = null }) {
  const renderLoginPage = createLoginPageRenderer(clientDist);
  // Per client, under a ceiling across all, kept across restarts (auth-middleware.js); a refusal costs no hashing.
  const throttle = createLoginThrottle({ file: throttleFile });
  const refuse = (request, response) => {
    const retryAt = throttle.retryAt(loginThrottleKey(request));
    if (!retryAt) return false;
    response.set("Retry-After", String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))));
    return true;
  };
  const authenticate = async (request, response, { native = false } = {}) => {
    const password = String(request.body?.password || "");
    if (refuse(request, response)) {
      return response.status(429).json({ error: "rate_limited", message: "Too many failed attempts. Try again shortly." });
    }
    const login = await authStore.authenticateAndCreateSession(password, {
      userAgent: String(request.headers["user-agent"] || "").slice(0, 256) || null,
      kind: native ? "native" : "browser",
    }).catch(() => null);
    if (!login) {
      throttle.noteFailure(loginThrottleKey(request));
      return response.status(401).json({ error: "invalid_credentials", message: "Incorrect password." });
    }
    throttle.noteSuccess(loginThrottleKey(request));
    return login;
  };

  app.get("/login", (request, response) => {
    const after = safeRedirectTarget(request.query.after);
    response.type("text/html").send(renderLoginPage({ after }));
  });

  app.post("/v0/auth/login", async (request, response) => {
    const password = String(request.body?.password || "");
    const after = safeRedirectTarget(request.body?.after);
    const acceptsJson = String(request.headers["accept"] || "").includes("application/json")
      || String(request.headers["content-type"] || "").includes("application/json");
    if (refuse(request, response)) {
      if (acceptsJson) return response.status(429).json({ error: "rate_limited", message: "Too many failed attempts. Try again shortly." });
      return response.type("text/html").status(429).send(renderLoginPage({ error: "Too many failed attempts. Try again shortly.", after }));
    }
    const login = await authStore.authenticateAndCreateSession(password, {
      userAgent: String(request.headers["user-agent"] || "").slice(0, 256) || null,
    }).catch(() => null);
    if (!login) {
      throttle.noteFailure(loginThrottleKey(request));
      if (acceptsJson) return response.status(401).json({ error: "invalid_credentials", message: "Incorrect password." });
      return response.type("text/html").status(401).send(renderLoginPage({ error: "Incorrect password.", after }));
    }
    throttle.noteSuccess(loginThrottleKey(request));
    issueSessionCookie(response, login.token, { secure: isSecureRequest(request) });
    if (acceptsJson) return response.json({ ok: true, redirect: after });
    response.redirect(303, after);
  });

  // A one-time code from `conduit-server open` becomes a browser session.
  app.get("/v0/auth/handoff", async (request, response) => {
    const after = safeRedirectTarget(request.query.after);
    if (!await authStore.consumeHandoff(String(request.query.code || "")).catch(() => false)) {
      return response.redirect(303, `/login?after=${encodeURIComponent(after)}`);
    }
    const login = await authStore.createSession({ userAgent: String(request.headers["user-agent"] || "").slice(0, 256) || null });
    issueSessionCookie(response, login.token, { secure: isSecureRequest(request) });
    response.set("Cache-Control", "no-store").redirect(303, after);
  });

  // A signed-in client's "Pair a device": a code for the QR it shows.
  app.post("/v0/auth/pairing", async (_request, response) => {
    const ttlMs = 300_000;
    const code = await authStore.createHandoff({ ttlMs });
    response.set("Cache-Control", "no-store").json({ code, expiresAt: new Date(Date.now() + ttlMs).toISOString() });
  });

  // The app's half of pairing: the code from the QR becomes a token, as a
  // password would at native-login.
  app.post("/v0/auth/native-pair", async (request, response) => {
    if (!isNativeRequest(request)) return response.status(403).json({ error: "native_origin_required" });
    if (!isTrustworthyRequest(request)) return response.status(400).json({ error: "https_required", message: "Pairing requires HTTPS unless the client is on this machine or this network." });
    if (!await authStore.consumeHandoff(String(request.body?.code || "")).catch(() => false)) {
      return response.status(401).json({ error: "pairing_code_invalid", message: "That pairing code has expired or was already used. Run conduit-server pair again." });
    }
    const login = await authStore.createSession({ kind: "native", userAgent: String(request.headers["user-agent"] || "").slice(0, 256) || null });
    response.set("Cache-Control", "no-store").json({ token: login.token });
  });

  app.post("/v0/auth/native-login", async (request, response) => {
    if (!isNativeRequest(request)) return response.status(403).json({ error: "native_origin_required" });
    if (!isTrustworthyRequest(request)) return response.status(400).json({ error: "https_required", message: "Native login requires HTTPS unless the client is on this machine or this network." });
    const login = await authenticate(request, response, { native: true });
    if (!login || response.headersSent) return;
    response.set("Cache-Control", "no-store").json({ token: login.token });
  });

  app.post("/v0/auth/logout", async (request, response) => {
    const token = request.conduitAuth?.token || readCookie(request);
    await authStore.removeSession(token).catch(() => false);
    const secure = isSecureRequest(request);
    clearSessionCookie(response, { secure });
    response.json({ ok: true });
  });

  app.post("/v0/auth/socket-ticket", (request, response) => {
    const context = request.conduitAuth;
    if (!context?.native || context.session?.kind !== "native") return response.status(401).json({ error: "native_auth_required" });
    response.set("Cache-Control", "no-store").json({
      ticket: socketTickets.issue(context.session.tokenHash),
    });
  });

  app.get("/v0/auth/status", (request, response) => {
    response.json({
      hasPassword: authStore.hasPassword(),
      authenticated: Boolean(request.conduitAuth),
      sessionCount: authStore.sessions().length,
    });
  });

  /*
   * The hub's sign-ins (Settings › System › Server): each session by an opaque id (a hash of its token's hash, so the
   * list never carries what authenticates), its kind and client, when it began and was last used, and whether it is
   * the asking client's own. Scripts' sessions are listed apart. Ending one is any signed-in client's to do.
   */
  const sessionId = (session) => crypto.createHash("sha256").update(session.tokenHash).digest("base64url").slice(0, 16);
  app.get("/v0/auth/sessions", (request, response) => {
    const context = request.conduitAuth;
    if (!context) return response.status(401).json({ error: "unauthorized" });
    const own = context.session?.tokenHash;
    response.set("Cache-Control", "no-store").json({ sessions: authStore.sessions().map((session) => ({
      id: sessionId(session), kind: session.kind, userAgent: session.userAgent, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt,
      current: Boolean(own) && session.tokenHash === own,
    })) });
  });
  app.delete("/v0/auth/sessions/:id", async (request, response) => {
    const context = request.conduitAuth;
    if (!context) return response.status(401).json({ error: "unauthorized" });
    const target = authStore.sessions().find((session) => sessionId(session) === String(request.params.id));
    if (!target) return response.status(404).json({ error: "no_session" });
    if (target.tokenHash === context.session?.tokenHash) return response.status(400).json({ error: "own_session", message: "Sign out instead." });
    await authStore.removeSessionsByPrefix(target.tokenHash);
    response.json({ ok: true });
  });
  /** A new password: the current one first (throttled as a sign-in is), then every other session ends. */
  app.post("/v0/auth/password", async (request, response) => {
    const context = request.conduitAuth;
    if (!context) return response.status(401).json({ error: "unauthorized" });
    if (refuse(request, response)) return response.status(429).json({ error: "rate_limited", message: "Too many failed attempts. Try again shortly." });
    const current = String(request.body?.current || "");
    const next = String(request.body?.next || "");
    if (next.length < 8 || next.length > 512) return response.status(400).json({ error: "weak_password", message: "Use at least 8 characters." });
    if (!await authStore.verifyPassword(current).catch(() => false)) {
      throttle.noteFailure(loginThrottleKey(request));
      return response.status(401).json({ error: "invalid_credentials", message: "The current password is not right." });
    }
    throttle.noteSuccess(loginThrottleKey(request));
    await authStore.changePassword(next, context.token);
    response.json({ ok: true });
  });

  app.post("/v0/auth/reset-sessions", async (request, response) => {
    const context = request.conduitAuth;
    if (!context) return response.status(401).json({ error: "unauthorized" });
    await authStore.removeOtherSessions(context.token);
    response.json({ ok: true });
  });
}
