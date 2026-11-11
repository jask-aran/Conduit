import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { WebSocket } from "ws";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthStore } from "../src/auth-store.js";

/**
 * Read from the server itself: test files run at the same time, so a port
 * chosen in advance can be taken before the child binds it.
 */
function boundOrigin(child) {
  return new Promise((resolve, reject) => {
    let seen = "";
    const onData = (chunk) => {
      seen += chunk.toString();
      const match = seen.match(/listening on (http:\/\/\S+)/);
      if (!match) return;
      child.stdout.off("data", onData);
      resolve(match[1].replace("0.0.0.0", "127.0.0.1"));
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => reject(new Error(`Conduit server exited before it listened (${code})`)));
  });
}

async function waitForServer(origin, child) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Conduit server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Conduit server did not become ready");
}

async function spawnServer({ password } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-server-"));
  if (password) {
    const store = new AuthStore(path.join(root, "auth.json"));
    await store.setPassword(password);
  }
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const clientDist = path.join(root, "client-dist");
  await fs.mkdir(clientDist);
  // Without a build (a fresh checkout), a stand-in form with the same
  // placeholders keeps the server's auth behaviour testable.
  if (await fs.stat(path.resolve("dist/access/templates.json")).catch(() => null)) {
    await fs.cp(path.resolve("dist/access"), path.join(clientDist, "access"), { recursive: true });
    await fs.symlink(path.resolve("dist/assets"), path.join(clientDist, "assets"), "dir");
  } else {
    const form = (error = "") => `<form method="post" action="/login">${error}<input type="hidden" name="after" value="__CONDUIT_ACCESS_AFTER__"><input type="password" name="password"></form>`;
    await fs.mkdir(path.join(clientDist, "access"));
    await fs.writeFile(path.join(clientDist, "access/templates.json"), JSON.stringify({ css: [], normal: form(), error: form("<p role=\"alert\">__CONDUIT_ACCESS_ERROR__</p>") }));
  }
  await fs.writeFile(path.join(clientDist, "index.html"), "<!doctype html><title>Conduit test SPA</title>");
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CONDUIT_.*(?:ROOT|FILE|DIR|DIST|PATH|TEMPLATE|COMMAND)$/.test(key))),
      HOME: root,
      CONDUIT_DATA_ROOT: root,
      CONDUIT_ADVERTISE_ON_LAN: "false",
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: "0",
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_REMOTES_FILE: path.join(root, "remotes.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_CLIENT_DIST: clientDist,
      CONDUIT_WORKSPACE_ALLOWLIST: root,
    },
  });
  const origin = await boundOrigin(child);
  await waitForServer(origin, child);
  return { child, origin, root };
}

async function stop({ child, root }) {
  if (child.exitCode == null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(root, { recursive: true, force: true });
}

/** POST a password to the browser login, or to the native one with `native`. */
function login(origin, body, { native = false, headers = {} } = {}) {
  return fetch(`${origin}/v0/auth/${native ? "native-login" : "login"}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function socketOpens(url, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.once("open", () => { ws.close(); resolve(true); });
    ws.once("error", () => resolve(false));
    setTimeout(() => resolve(false), 2000);
  });
}

test("unauthenticated routes redirect or return 401; only the allowlist is public", async () => {
  const server = await spawnServer({ password: "fixture-pw" });
  const { origin } = server;
  try {
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
    assert.equal((await fetch(`${origin}/login`)).status, 200);

    // Unauthenticated SPA navigation preserves its original same-origin route
    // so successful form login resumes exactly where the browser arrived.
    const navResponse = await fetch(`${origin}/`, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(navResponse.status, 302);
    assert.equal(navResponse.headers.get("location"), "/login?after=%2F");
    const chatNavigation = await fetch(`${origin}/chat/42a89c7d?view=tools`, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(chatNavigation.headers.get("location"), "/login?after=%2Fchat%2F42a89c7d%3Fview%3Dtools");

    const protectedRoutes = [
      "GET /v0/capabilities", "GET /v0/projects", "GET /v0/templates", "GET /v0/runtime", "GET /v0/runtime/settings",
      "GET /v0/pi-auth", "GET /v0/pi-auth/attempt", "PUT /v0/pi-auth/api-key", "DELETE /v0/pi-auth/openai",
      "PATCH /v0/preferences", "GET /v0/models",
    ];
    for (const route of protectedRoutes) {
      const [method, pathname] = route.split(" ");
      const response = await fetch(`${origin}${pathname}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PATCH" ? "{}" : undefined,
      });
      assert.equal(response.status, 401, `${route} should require auth`);
      assert.equal((await response.json()).error, "unauthorized");
    }
    assert.equal(await socketOpens(`${origin.replace("http", "ws")}/v0/live-sessions/000000000000000000000000/stream`), false);
  } finally {
    await stop(server);
  }
});

test("login flow issues a cookie; logout clears it; rate limiting kicks in", async () => {
  const server = await spawnServer({ password: "fixture-pw" });
  const { origin } = server;
  try {
    const signedIn = await login(origin, { password: "fixture-pw" });
    assert.equal(signedIn.status, 200);
    const setCookie = signedIn.headers.get("set-cookie") || "";
    assert.match(setCookie, /conduit_session=/);
    assert.match(setCookie, /Max-Age=2592000/);
    const cookie = setCookie.split(";")[0];

    assert.equal((await fetch(`${origin}/v0/projects`, { headers: { cookie } })).status, 200);
    const piAuth = await fetch(`${origin}/v0/pi-auth`, { headers: { cookie } });
    assert.equal(piAuth.status, 200);
    assert.equal(piAuth.headers.get("cache-control"), "no-store");
    const statusBody = await (await fetch(`${origin}/v0/auth/status`, { headers: { cookie } })).json();
    assert.equal(statusBody.authenticated, true);
    assert.equal(statusBody.hasPassword, true);

    assert.equal((await fetch(`${origin}/v0/auth/logout`, { method: "POST", headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${origin}/v0/projects`, { headers: { cookie } })).status, 401);

    for (let i = 0; i < 6; i += 1) {
      const wrong = await login(origin, { password: "fixture-wrong" });
      assert.ok(wrong.status === 401 || wrong.status === 429);
    }
    assert.equal((await login(origin, { password: "fixture-pw" })).status, 429);
  } finally {
    await stop(server);
  }
});

test("native auth uses exact-origin bearer sessions and single-use socket tickets", async () => {
  const server = await spawnServer({ password: "fixture-pw" });
  const { origin } = server;
  const nativeHeaders = { origin: "https://localhost" };
  const overTls = { ...nativeHeaders, "x-forwarded-proto": "https" };
  const projects = (headers) => fetch(`${origin}/v0/projects`, { headers }).then((response) => response.status);
  try {
    const preflight = await fetch(`${origin}/v0/projects`, {
      method: "OPTIONS",
      headers: { ...nativeHeaders, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://localhost");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    const rejectedPreflight = await fetch(`${origin}/v0/projects`, {
      method: "OPTIONS",
      headers: { ...nativeHeaders, "access-control-request-method": "TRACE", "access-control-request-headers": "x-unsafe" },
    });
    assert.equal(rejectedPreflight.status, 403);

    const native = (password, headers = overTls) => login(origin, { password }, { native: true, headers });
    assert.equal((await native("fixture-pw", { origin: "https://example.com", "x-forwarded-proto": "https" })).status, 403);
    // Plain HTTP that reached the server through a proxy: the socket says
    // loopback, the forwarding header says otherwise, and the header wins.
    assert.equal((await native("fixture-pw", { ...nativeHeaders, "x-forwarded-for": "203.0.113.9" })).status, 400);
    assert.equal((await native("fixture-wrong")).status, 401);

    const signedIn = await native("fixture-pw");
    assert.equal(signedIn.status, 200);
    const { token } = await signedIn.json();
    assert.match(token, /^[A-Za-z0-9_-]{32,}$/);
    const authFile = await fs.readFile(path.join(server.root, "auth.json"), "utf8");
    assert.equal(authFile.includes(token), false);
    assert.match(authFile, /"kind": "native"/);

    const bearer = { ...nativeHeaders, authorization: `Bearer ${token}` };
    assert.equal(await projects(bearer), 200);
    assert.equal(await projects({ authorization: `Bearer ${token}` }), 401);
    assert.equal(await projects({ cookie: `conduit_session=${token}` }), 401);

    const ticketResponse = await fetch(`${origin}/v0/auth/socket-ticket`, { method: "POST", headers: bearer });
    assert.equal(ticketResponse.status, 200);
    const { ticket } = await ticketResponse.json();
    assert.equal(await projects({ ...nativeHeaders, authorization: `Bearer ${ticket}` }), 401);
    const ticketUrl = `${origin.replace("http", "ws")}/v0/dictation/stream?ticket=${ticket}`;
    assert.equal(await socketOpens(ticketUrl, { Origin: "https://localhost" }), true);
    assert.equal(await socketOpens(ticketUrl, { Origin: "https://localhost" }), false);

    assert.equal((await fetch(`${origin}/v0/auth/logout`, { method: "POST", headers: bearer })).status, 200);
    assert.equal(await projects(bearer), 401);

    const secondToken = (await (await native("fixture-pw")).json()).token;
    const browserCookie = (await login(origin, { password: "fixture-pw" })).headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${origin}/v0/auth/reset-sessions`, { method: "POST", headers: { cookie: browserCookie } })).status, 200);
    assert.equal(await projects({ ...nativeHeaders, authorization: `Bearer ${secondToken}` }), 401);
  } finally {
    await stop(server);
  }
});

test("loopback bind without a password starts open and serves the SPA", async () => {
  const server = await spawnServer();
  try {
    const root = await fetch(`${server.origin}/`, { headers: { accept: "text/html" } });
    assert.equal(root.status, 200);
    assert.match(await root.text(), /Conduit test SPA/);
    assert.equal((await fetch(`${server.origin}/v0/projects`)).status, 200);
    const refusals = [
      await fetch(`${server.origin}/v0/pi-auth`),
      await fetch(`${server.origin}/v0/pi-auth/api-key`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "openai", key: "should-not-save" }),
      }),
      await fetch(`${server.origin}/v0/pi-auth/openai`, { method: "DELETE" }),
    ];
    for (const response of refusals) {
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, "pi_auth_login_required");
    }
  } finally {
    await stop(server);
  }
});

test("login redirect target rejects protocol-relative and backslash schemes", async () => {
  const server = await spawnServer({ password: "fixture-pw" });
  try {
    for (const after of ["//evil.com/x", "/\\evil.com", "https://evil.com", "/a\\b"]) {
      const response = await login(server.origin, { password: "fixture-pw", after });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).redirect, "/", `after=${JSON.stringify(after)} must collapse to "/"`);
    }
    assert.equal((await (await login(server.origin, { password: "fixture-pw", after: "/chat/abc" })).json()).redirect, "/chat/abc");
    const html = await (await fetch(`${server.origin}/login?after=//evil.com/x`)).text();
    assert.match(html, /name="after"[^>]*value="\/"/);
    assert.ok(!html.includes("//evil.com"), "rendered page must not embed the off-origin target");
  } finally {
    await stop(server);
  }
});
