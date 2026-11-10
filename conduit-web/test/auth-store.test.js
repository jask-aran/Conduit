import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthStore } from "../src/auth-store.js";

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

test("an uncoordinated external revision between load and rename is reloaded and preserved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-queue-"));
  const file = path.join(root, "auth.json");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  const flush = store._flush.bind(store);
  let injected = false;
  store._flush = async (...args) => {
    if (!injected) {
      injected = true;
      const external = JSON.parse(await fs.readFile(file, "utf8"));
      external.sessions.push({ tokenHash: "external", createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), userAgent: "external" });
      await fs.writeFile(file, `${JSON.stringify(external, null, 2)}\n`, "utf8");
    }
    return flush(...args);
  };
  await store.createSession({ userAgent: "queued" });
  const restored = new AuthStore(file);
  await restored.load({ force: true });
  assert.deepEqual(restored.sessions().map((session) => session.userAgent).sort(), ["external", "queued"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("a password reset cannot be overwritten by an in-flight login", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-lock-"));
  const file = path.join(root, "auth.json");
  const loginStore = new AuthStore(file);
  await loginStore.setPassword("old-password");
  const resetStore = new AuthStore(file);
  let entered;
  const loginChecked = new Promise((resolve) => { entered = resolve; });
  let release;
  const resumeLogin = new Promise((resolve) => { release = resolve; });
  let blockLogin = true;
  loginStore.afterRevisionCheck = async () => {
    if (!blockLogin) return;
    blockLogin = false;
    entered();
    await resumeLogin;
  };
  let resetChecked = false;
  resetStore.afterRevisionCheck = () => { resetChecked = true; };

  const login = loginStore.authenticateAndCreateSession("old-password", { userAgent: "old-login" });
  await loginChecked;
  const reset = resetStore.setPassword("new-password");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(resetChecked, false, "the reset must wait before its revision check");
  release();
  assert.ok(await login);
  await reset;
  assert.equal(resetChecked, true);
  const restored = new AuthStore(file);
  await restored.load({ force: true });
  assert.equal(restored.sessions().length, 0);
  assert.equal(await restored.verifyPassword("old-password"), false);
  assert.equal(await restored.verifyPassword("new-password"), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("an abandoned auth lock is recovered from owner metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-auth-lock-"));
  const file = path.join(root, "auth.json");
  const lock = `${file}.lock`;
  await fs.mkdir(lock, { recursive: true });
  await fs.writeFile(path.join(lock, "owner.json"), `${JSON.stringify({ pid: 999999, startedAt: Date.now() - (2 * 60 * 1000), id: "abandoned" })}\n`, "utf8");
  const store = new AuthStore(file);
  await store.setPassword("fixture-pw");
  assert.equal(await store.verifyPassword("fixture-pw"), true);
  await assert.rejects(fs.stat(lock), { code: "ENOENT" });
  await fs.rm(root, { recursive: true, force: true });
});
