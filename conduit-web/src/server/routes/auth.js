import {
  clearSessionCookie,
  createRateLimiter,
  issueSessionCookie,
  isSecureRequest,
  readCookie,
  safeRedirectTarget,
} from "../../auth-middleware.js";
import { renderLoginPage } from "../../auth-login-page.js";

export function registerAuthRoutes(app, { authStore }) {
  const loginRateLimiter = createRateLimiter();

  app.get("/login", (request, response) => {
    const after = safeRedirectTarget(request.query.after);
    response.type("text/html").send(renderLoginPage({ after }));
  });

  app.post("/v0/auth/login", async (request, response) => {
    const password = String(request.body?.password || "");
    const after = safeRedirectTarget(request.body?.after);
    const acceptsJson = String(request.headers["accept"] || "").includes("application/json")
      || String(request.headers["content-type"] || "").includes("application/json");
    if (loginRateLimiter.isThrottled()) {
      await authStore.verifyPassword(password).catch(() => false);
      if (acceptsJson) return response.status(429).json({ error: "rate_limited", message: "Too many failed attempts. Try again shortly." });
      return response.type("text/html").status(429).send(renderLoginPage({ error: "Too many failed attempts. Try again shortly.", after }));
    }
    const login = await authStore.authenticateAndCreateSession(password, {
      userAgent: String(request.headers["user-agent"] || "").slice(0, 256) || null,
    }).catch(() => null);
    if (!login) {
      loginRateLimiter.noteFailure();
      if (acceptsJson) return response.status(401).json({ error: "invalid_credentials", message: "Incorrect password." });
      return response.type("text/html").status(401).send(renderLoginPage({ error: "Incorrect password.", after }));
    }
    loginRateLimiter.noteSuccess();
    issueSessionCookie(response, login.token, { secure: isSecureRequest(request) });
    if (acceptsJson) return response.json({ ok: true, redirect: after });
    response.redirect(303, after);
  });

  app.post("/v0/auth/logout", async (request, response) => {
    const token = readCookie(request);
    await authStore.removeSession(token).catch(() => false);
    const secure = isSecureRequest(request);
    clearSessionCookie(response, { secure });
    response.json({ ok: true });
  });

  app.get("/v0/auth/status", (request, response) => {
    response.json({
      hasPassword: authStore.hasPassword(),
      authenticated: Boolean(request.conduitAuth),
      sessionCount: authStore.sessions().length,
    });
  });

  app.post("/v0/auth/reset-sessions", async (request, response) => {
    const context = request.conduitAuth;
    if (!context) return response.status(401).json({ error: "unauthorized" });
    await authStore.removeOtherSessions(context.token);
    response.json({ ok: true });
  });
}
