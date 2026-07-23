import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authStartupViolation, createRateLimiter, isAllowlistedPath, isSameOriginRequest, readCookie, safeRedirectTarget } from "../src/auth-middleware.js";
import { AuthStore } from "../src/auth-store.js";

function mockConfig(host, allowInsecure = false, allowBootstrap = false) {
  return { host, allowInsecure, allowBootstrap };
}

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

test("authStartupViolation rejects non-loopback + no password unless override is set", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-startup-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.load();
  assert.equal(authStartupViolation(mockConfig("127.0.0.1"), store), null);
  assert.ok(authStartupViolation(mockConfig("0.0.0.0", false), store) instanceof Error);
  assert.equal(authStartupViolation(mockConfig("0.0.0.0", true), store), null);
  assert.equal(authStartupViolation(mockConfig("0.0.0.0", false, true), store), null);
  await store.setPassword("fixture-pw");
  assert.equal(authStartupViolation(mockConfig("0.0.0.0", false), store), null);
  await fs.rm(root, { recursive: true, force: true });
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
