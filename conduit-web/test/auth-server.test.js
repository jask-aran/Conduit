import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { WebSocket } from "ws";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthStore } from "../src/auth-store.js";

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
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

async function fakePi(root) {
  const conduitPi = path.join(root, "conduit-pi");
  await fs.writeFile(conduitPi, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("0.80.6"); process.exit(0); }
if (process.argv.includes("--help")) { console.log("--mode --session --append-system-prompt --skill --approve --no-approve"); process.exit(0); }
process.exit(0);
`);
  await fs.chmod(conduitPi, 0o755);
  const nativePi = path.join(root, "native-pi");
  await fs.writeFile(nativePi, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.80.10; exit 0; fi\nif [ \"$1\" = \"--help\" ]; then echo '--mode --session --append-system-prompt --skill --approve --no-approve'; exit 0; fi\nexit 1\n");
  await fs.chmod(nativePi, 0o755);
  return { conduitPi, nativePi };
}

async function spawnServer(env, { password } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-server-"));
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const { conduitPi, nativePi } = await fakePi(root);
  if (password) {
    const store = new AuthStore(path.join(root, "auth.json"));
    await store.setPassword(password);
  }
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: root,
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_NATIVE_PI_COMMAND: nativePi,
      CONDUIT_NATIVE_PI_AGENT_DIR: path.join(root, "native-agent"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
      ...env,
    },
  });
  await waitForServer(origin, child);
  return { child, origin, root, port };
}

async function stop({ child, root }) {
  if (child.exitCode == null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(root, { recursive: true, force: true });
}

test("unauthenticated routes redirect or return 401; only the allowlist is public", async () => {
  const server = await spawnServer({}, { password: "fixture-pw" });
  const { origin } = server;
  try {
    // Allowlist is reachable without a cookie.
    assert.equal((await fetch(`${origin}/healthz`)).status, 200);
    assert.equal((await fetch(`${origin}/login`)).status, 200);

    // Unauthenticated SPA navigation preserves its original same-origin route
    // so successful form login resumes exactly where the browser arrived.
    const navResponse = await fetch(`${origin}/`, { headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, redirect: "manual" });
    assert.equal(navResponse.status, 302);
    assert.equal(navResponse.headers.get("location"), "/login?after=%2F");
    const chatNavigation = await fetch(`${origin}/chat/42a89c7d-4051-48b8-a5b1-5ac3e2083e56?view=tools`, {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    assert.equal(chatNavigation.headers.get("location"), "/login?after=%2Fchat%2F42a89c7d-4051-48b8-a5b1-5ac3e2083e56%3Fview%3Dtools");

    // Every protected API path returns 401 JSON without a cookie.
    const protectedRoutes = [
      ["GET", "/v0/capabilities"],
      ["GET", "/v0/projects"],
      ["GET", "/v0/templates"],
      ["GET", "/v0/runtime"],
      ["GET", "/v0/runtime/settings"],
      ["GET", "/v0/pi-installations"],
      ["PATCH", "/v0/preferences"],
      ["GET", "/v0/models"],
    ];
    for (const [method, pathname] of protectedRoutes) {
      const response = await fetch(`${origin}${pathname}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PATCH" ? "{}" : undefined,
      });
      assert.equal(response.status, 401, `${method} ${pathname} should require auth`);
      const body = await response.json();
      assert.equal(body.error, "unauthorized");
    }

    // Unauthenticated WebSocket upgrades are destroyed.
    const closed = await new Promise((resolve) => {
      const ws = new WebSocket(`${origin.replace("http", "ws")}/v0/live-sessions/000000000000000000000000/stream`);
      ws.on("error", () => resolve(true));
      ws.on("open", () => resolve(false));
      setTimeout(() => resolve(false), 2000);
    });
    assert.equal(closed, true);

    // Static SPA assets are never served without authentication.
    const assetRequest = await fetch(`${origin}/favicon.svg`);
    assert.equal(assetRequest.status, 401);
  } finally {
    await stop(server);
  }
});

test("login flow issues a cookie; logout clears it; rate limiting kicks in", async () => {
  const server = await spawnServer({}, { password: "fixture-pw" });
  const { origin } = server;
  try {
    const wrong = await fetch(`${origin}/v0/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ password: "fixture-wrong" }),
    });
    assert.equal(wrong.status, 401);

    // Five wrong attempts should leave the rate limiter throttled.
    for (let i = 0; i < 5; i += 1) {
      await fetch(`${origin}/v0/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "fixture-wrong" }),
      });
    }
    const throttled = await fetch(`${origin}/v0/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ password: "fixture-pw" }),
    });
    assert.equal(throttled.status, 429);

    // Wait out the backoff window (5s base) and verify the correct password succeeds.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    const login = await fetch(`${origin}/v0/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ password: "fixture-pw" }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") || "";
    assert.match(setCookie, /conduit_session=/);
    const cookieHeader = setCookie.split(";")[0];

    const projects = await fetch(`${origin}/v0/projects`, { headers: { cookie: cookieHeader } });
    assert.equal(projects.status, 200);

    const status = await fetch(`${origin}/v0/auth/status`, { headers: { cookie: cookieHeader } });
    const statusBody = await status.json();
    assert.equal(statusBody.authenticated, true);
    assert.equal(statusBody.hasPassword, true);
    assert.ok(statusBody.sessionCount >= 1);

    const logout = await fetch(`${origin}/v0/auth/logout`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    });
    assert.equal(logout.status, 200);

    const afterLogout = await fetch(`${origin}/v0/projects`, { headers: { cookie: cookieHeader } });
    assert.equal(afterLogout.status, 401);
  } finally {
    await stop(server);
  }
});

test("a non-loopback bind with no password and no override rejects startup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-startup-"));
  const port = await availablePort();
  const { conduitPi, nativePi } = await fakePi(root);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: root,
      CONDUIT_HOST: "0.0.0.0",
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_NATIVE_PI_COMMAND: nativePi,
      CONDUIT_NATIVE_PI_AGENT_DIR: path.join(root, "native-agent"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
    },
  });
  const chunks = [];
  child.stderr.on("data", (chunk) => chunks.push(chunk.toString()));
  child.stdout.on("data", () => {});
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 1);
  assert.ok(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString().includes("Refusing to bind"));
  await fs.rm(root, { recursive: true, force: true });
});

test("loopback bind without a password starts open and serves the SPA", async () => {
  const server = await spawnServer();
  try {
    await waitForServer(server.origin, server.child);
    const root = await fetch(`${server.origin}/`, { headers: { accept: "text/html" } });
    assert.equal(root.status, 200);
    const projects = await fetch(`${server.origin}/v0/projects`);
    assert.equal(projects.status, 200);
  } finally {
    await stop(server);
  }
});

test("login redirect target rejects protocol-relative and backslash schemes", async () => {
  const server = await spawnServer({}, { password: "fixture-pw" });
  try {
    const bad = ["//evil.com/x", "/\\evil.com", "https://evil.com", "/a\\b"];
    for (const after of bad) {
      const login = await fetch(`${server.origin}/v0/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ password: "fixture-pw", after }),
      });
      assert.equal(login.status, 200);
      const body = await login.json();
      assert.equal(body.redirect, "/", `after=${JSON.stringify(after)} must collapse to "/"`);
    }
    const good = await fetch(`${server.origin}/v0/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ password: "fixture-pw", after: "/chat/abc" }),
    });
    const goodBody = await good.json();
    assert.equal(goodBody.redirect, "/chat/abc");
    // GET /login sanitizes the after before rendering the hidden input.
    const page = await fetch(`${server.origin}/login?after=//evil.com/x`);
    const html = await page.text();
    assert.match(html, /name="after"[^>]*value="\/"/);
    assert.ok(!html.includes("//evil.com"), "rendered page must not embed the off-origin target");
  } finally {
    await stop(server);
  }
});

test("/v0/auth/status reports authenticated without re-validating the cookie", async () => {
  const server = await spawnServer({}, { password: "fixture-pw" });
  try {
    const login = await fetch(`${server.origin}/v0/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ password: "fixture-pw" }),
    });
    const setCookie = login.headers.get("set-cookie") || "";
    const cookieHeader = setCookie.split(";")[0];
    const status = await fetch(`${server.origin}/v0/auth/status`, { headers: { cookie: cookieHeader } });
    const body = await status.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.hasPassword, true);
    assert.ok(body.sessionCount >= 1);
  } finally {
    await stop(server);
  }
});

test("a long-dormant session is pruned at server startup and rejected on use", async () => {
  // First server: log in, capture the cookie, then kill it but keep its data dir.
  const first = await spawnServer({}, { password: "fixture-pw" });
  const root = first.root;
  let cookieHeader;
  try {
    const login = await fetch(`${first.origin}/v0/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ password: "fixture-pw" }),
    });
    cookieHeader = (login.headers.get("set-cookie") || "").split(";")[0];
  } finally {
    if (first.child.exitCode == null) {
      first.child.kill("SIGTERM");
      await new Promise((resolve) => first.child.once("exit", resolve));
    }
  }

  // Age the row 31 days past the TTL while the server is stopped.
  const stale = new AuthStore(path.join(root, "auth.json"));
  await stale.load({ force: true });
  assert.ok(stale.data.sessions[0], "login should have persisted a session row");
  stale.data.sessions[0].lastSeenAt = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000)).toISOString();
  await stale._flush();

  // Boot a fresh server against the same data dir: pruneExpired runs at
  // startup, the row is gone, and the stale cookie is rejected.
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const { conduitPi, nativePi } = await fakePi(root);
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: root,
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_NATIVE_PI_COMMAND: nativePi,
      CONDUIT_NATIVE_PI_AGENT_DIR: path.join(root, "native-agent"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
    },
  });
  try {
    await waitForServer(origin, child);
    const expired = await fetch(`${origin}/v0/projects`, { headers: { cookie: cookieHeader } });
    assert.equal(expired.status, 401);
    // The stale session row was pruned at startup, so auth.json on disk now has no sessions.
    const afterBoot = new AuthStore(path.join(root, "auth.json"));
    await afterBoot.load({ force: true });
    assert.equal(afterBoot.data.sessions.length, 0);
  } finally {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
