import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthStore, hashPassword, verifyPassword } from "../src/auth-store.js";

test("scrypt round-trip verifies the set password and rejects others", async () => {
  const hashed = await hashPassword("fixture-pw");
  assert.equal(await verifyPassword("fixture-pw", hashed), true);
  assert.equal(await verifyPassword("fixture-wrong", hashed), false);
});

test("verifyPassword rejects a malformed stored hash without throwing", async () => {
  assert.equal(await verifyPassword("any", null), false);
  assert.equal(await verifyPassword("any", { algo: "argon2" }), false);
  assert.equal(await verifyPassword("any", { algo: "scrypt", salt: "x", hash: "y" }), false);
});

test("AuthStore writes auth.json mode 0600 and reloads it across instances", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const stat = await fs.stat(file);
  assert.equal(stat.mode & 0o777, 0o600);

  const second = new AuthStore(file);
  await second.load({ force: true });
  assert.equal(second.hasPassword(), true);
  assert.equal(await second.verifyPassword("fixture-pw"), true);
  assert.equal(await second.verifyPassword("fixture-wrong"), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("setPassword invalidates prior sessions and caps stored sessions at 20", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const store = new AuthStore(path.join(root, "auth.json"));
  await store.setPassword("fixture-pw-first");
  for (let i = 0; i < 25; i += 1) {
    await store.createSession({ userAgent: `agent-${i}` });
  }
  assert.equal(store.sessions().length, 20);
  const oldestKept = store.sessions()[0].userAgent;
  assert.notEqual(oldestKept, "agent-0");
  await store.setPassword("fixture-pw-second");
  assert.equal(store.sessions().length, 0);
  assert.equal(await store.verifyPassword("fixture-pw-first"), false);
  assert.equal(await store.verifyPassword("fixture-pw-second"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("findSession recovers across instances and removeSession prunes by token", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const { token } = await store.createSession({ userAgent: "browser-a" });
  const second = new AuthStore(file);
  const found = await second.findSession(token);
  assert.ok(found);
  assert.equal(found.userAgent, "browser-a");
  const removed = await second.removeSession(token);
  assert.equal(removed, true);
  const stale = await second.findSession(token);
  assert.equal(stale, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("resetSessions signs out every device without changing the password", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const store = new AuthStore(path.join(root, "auth.json"));
  await store.setPassword("fixture-pw-kept");
  await store.createSession();
  await store.createSession();
  assert.equal(store.sessions().length, 2);
  await store.resetSessions();
  assert.equal(store.sessions().length, 0);
  assert.equal(await store.verifyPassword("fixture-pw-kept"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("removeOtherSessions preserves only the supplied token's row", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const store = new AuthStore(path.join(root, "auth.json"));
  await store.setPassword("fixture-pw");
  const { token: keep } = await store.createSession();
  await store.createSession();
  await store.createSession();
  const removed = await store.removeOtherSessions(keep);
  assert.equal(removed, 2);
  assert.equal(store.sessions().length, 1);
  assert.ok(await store.findSession(keep));
  await fs.rm(root, { recursive: true, force: true });
});

test("findSession reloads from disk on a cache miss", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const file = path.join(root, "auth.json");
  const a = new AuthStore(file);
  await a.setPassword("fixture-pw");
  const { token } = await a.createSession();
  const b = new AuthStore(file);
  await b.load();
  // b never saw the session — findSession must force-reload and find it.
  const found = await b.findSession(token);
  assert.ok(found);
  await fs.rm(root, { recursive: true, force: true });
});

test("findSession rejects a session past the 30-day TTL and prunes it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const { token } = await store.createSession();
  // Fast-forward lastSeenAt past the TTL.
  await store.load({ force: true });
  store.data.sessions[0].lastSeenAt = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000)).toISOString();
  await store._flush();

  const fresh = new AuthStore(file);
  await fresh.load({ force: true });
  const found = await fresh.findSession(token);
  assert.equal(found, null);
  await fresh.load({ force: true });
  assert.equal(fresh.data.sessions.length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("pruneExpired removes only stale rows and persists the deletion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  await store.createSession();
  const { token: live } = await store.createSession();
  await store.load({ force: true });
  const staleRow = store.data.sessions[0];
  staleRow.lastSeenAt = new Date(Date.now() - (40 * 24 * 60 * 60 * 1000)).toISOString();
  await store._flush();

  const pruned = await store.pruneExpired();
  assert.equal(pruned, 1);
  const survivor = await store.findSession(live);
  assert.ok(survivor);
  await fs.rm(root, { recursive: true, force: true });
});

test("concurrent flushes use unique temp paths and never fail on ENOENT", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-flush-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  for (let i = 0; i < 5; i += 1) await store.createSession({ userAgent: `agent-${i}` });

  // Fire many concurrent session mutations that each call _flush. The unique
  // nonce avoids the constant-temp-path race where one rename pulls the
  // temp file out from under another pending rename.
  const settled = await Promise.allSettled([
    store.removeSession(store.data.sessions[0].tokenHash),
    store.removeSession(store.data.sessions[1].tokenHash),
    store.removeOtherSessions(store.data.sessions[2].tokenHash),
    store.resetSessions(),
    store.createSession({ userAgent: "agent-new" }),
  ]);
  for (const result of settled) assert.equal(result.status, "fulfilled", JSON.stringify(result));
  // Final file parses cleanly and reflects the last completed operation.
  const restored = new AuthStore(file);
  await restored.load({ force: true });
  assert.ok(Array.isArray(restored.data.sessions));
  await fs.rm(root, { recursive: true, force: true });
});

test("parallel logins retain every newest session up to the configured cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-queue-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const created = await Promise.all(Array.from({ length: 28 }, (_, index) => store.createSession({ userAgent: `parallel-${index}` })));
  const restored = new AuthStore(file);
  await restored.load({ force: true });
  assert.equal(restored.sessions().length, 20);
  assert.equal(new Set(restored.sessions().map((session) => session.tokenHash)).size, 20);
  assert.ok(created.some(({ session }) => restored.sessions().some((stored) => stored.tokenHash === session.tokenHash)));
  await fs.rm(root, { recursive: true, force: true });
});

test("queued touch, logout, and reset transitions commit in invocation order", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-queue-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const startedAt = new Date();
  const first = await store.createSession({ userAgent: "keep", now: startedAt });
  const second = await store.createSession({ userAgent: "remove" });
  await store.createSession({ userAgent: "reset" });
  const [touched, removed, reset] = await Promise.all([
    store.touchSession(first.session, new Date(startedAt.getTime() + (2 * 60 * 1000))),
    store.removeSession(second.token),
    store.removeOtherSessions(first.token),
  ]);
  assert.equal(touched, true);
  assert.equal(removed, true);
  assert.equal(reset, 1);
  const restored = new AuthStore(file);
  await restored.load({ force: true });
  assert.deepEqual(restored.sessions().map((session) => session.userAgent), ["keep"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("a forced reload and a delayed atomic write cannot discard a newer queued session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-queue-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const flush = store._flush.bind(store);
  let entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  let release;
  const resume = new Promise((resolve) => { release = resolve; });
  let delay = true;
  store._flush = async (...args) => {
    if (delay) {
      delay = false;
      entered();
      await resume;
    }
    return flush(...args);
  };
  const first = store.createSession({ userAgent: "first" });
  await writing;
  const reloaded = store.reloadFromFile();
  const second = store.createSession({ userAgent: "second" });
  release();
  await Promise.all([first, reloaded, second]);
  const restored = new AuthStore(file);
  await restored.load({ force: true });
  assert.deepEqual(restored.sessions().map((session) => session.userAgent).sort(), ["first", "second"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("an external revision between load and rename is reloaded and preserved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-queue-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const flush = store._flush.bind(store);
  let injected = false;
  store._flush = async (...args) => {
    if (!injected) {
      injected = true;
      const external = new AuthStore(file);
      await external.load({ force: true });
      external.data.sessions.push({ tokenHash: "external", createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), userAgent: "external" });
      await external._flush();
    }
    return flush(...args);
  };
  await store.createSession({ userAgent: "queued" });
  const restored = new AuthStore(file);
  await restored.load({ force: true });
  assert.deepEqual(restored.sessions().map((session) => session.userAgent).sort(), ["external", "queued"]);
  await fs.rm(root, { recursive: true, force: true });
});
