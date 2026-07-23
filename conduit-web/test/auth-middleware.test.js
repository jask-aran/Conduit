import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter, isAllowlistedPath, isSameOriginRequest, readCookie, safeRedirectTarget } from "../src/auth-middleware.js";

test("isAllowlistedPath allows the login and healthz routes only", () => {
  assert.equal(isAllowlistedPath("GET", "/login"), true);
  assert.equal(isAllowlistedPath("POST", "/v0/auth/login"), true);
  assert.equal(isAllowlistedPath("GET", "/healthz"), true);
  assert.equal(isAllowlistedPath("POST", "/v0/auth/logout"), false);
  assert.equal(isAllowlistedPath("GET", "/"), false);
  assert.equal(isAllowlistedPath("GET", "/v0/projects"), false);
});

test("readCookie extracts the conduit_session value among cookies", () => {
  const request = { headers: { cookie: "theme=dark; conduit_session=abc123; lang=en" } };
  assert.equal(readCookie(request), "abc123");
  assert.equal(readCookie({ headers: {} }), null);
});

test("bootstrap setup only accepts a same-origin browser POST", () => {
  const request = {
    protocol: "http",
    headers: { host: "conduit.example.test", origin: "http://conduit.example.test" },
  };
  assert.equal(isSameOriginRequest(request), true);
  assert.equal(isSameOriginRequest({ ...request, headers: { ...request.headers, origin: "https://evil.example" } }), false);
  assert.equal(isSameOriginRequest({ ...request, headers: { host: "conduit.example.test" } }), false);
});

test("bootstrap setup accepts the public forwarded origin", () => {
  const request = {
    protocol: "http",
    headers: {
      host: "127.0.0.1:4310",
      origin: "https://quiet-disco-123.app.github.dev",
      "x-forwarded-host": "quiet-disco-123.app.github.dev",
      "x-forwarded-proto": "https",
    },
  };
  assert.equal(isSameOriginRequest(request), true);
  assert.equal(isSameOriginRequest({ ...request, headers: { ...request.headers, origin: "https://evil.example" } }), false);
});

test("rate limiter caps the backoff and resets on success", () => {
  const limiter = createRateLimiter();
  for (let i = 0; i < 4; i += 1) limiter.noteFailure(0);
  assert.equal(limiter.isThrottled(0), false);
  limiter.noteFailure(0);
  assert.equal(limiter.isThrottled(0), true);
  assert.ok(limiter.waitUntilMs() > 0);
  limiter.noteSuccess();
  assert.equal(limiter.isThrottled(0), false);
});

test("safeRedirectTarget only allows same-origin paths", () => {
  assert.equal(safeRedirectTarget("/chat/abc"), "/chat/abc");
  assert.equal(safeRedirectTarget("/"), "/");
  assert.equal(safeRedirectTarget("//evil.com/x"), "/");
  assert.equal(safeRedirectTarget("/\\evil.com"), "/");
  assert.equal(safeRedirectTarget("https://evil.com"), "/");
  assert.equal(safeRedirectTarget("/a\\b"), "/");
  assert.equal(safeRedirectTarget("relative"), "/");
  assert.equal(safeRedirectTarget(null), "/");
  assert.equal(safeRedirectTarget(undefined), "/");
  assert.equal(safeRedirectTarget(123), "/");
});
