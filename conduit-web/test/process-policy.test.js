import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { PiManager } from "../src/pi-manager.js";
import { normalizeRuntimeSettings } from "../src/runtime-settings.js";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { write() {} };
  child.kill = (signal) => {
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  return child;
}

function makeManager({
  maxLiveProcesses = 2,
  maxGeneratingProcesses = 2,
  idleProcessTtlMs = 120_000,
  nowValue = { t: 1_000 },
} = {}) {
  const children = [];
  const manager = new PiManager({
    agentDir: "/tmp/conduit-process-policy",
    maxLiveProcesses,
    maxGeneratingProcesses,
    idleProcessTtlMs,
    reaperIntervalMs: 0,
    now: () => nowValue.t,
    spawnImpl: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  return { manager, children, nowValue };
}

const project = (slug) => ({
  id: `project_${slug}`,
  slug,
  path: `/tmp/${slug}`,
  sessionsDir: `/tmp/${slug}/sessions`,
});

test("normalizeRuntimeSettings clamps warm pool, generating cap, and idle TTL", () => {
  assert.deepEqual(normalizeRuntimeSettings({
    maxLiveProcesses: 99,
    maxGeneratingProcesses: 99,
    idleProcessTtlMs: 1000,
  }), {
    maxLiveProcesses: 32,
    maxGeneratingProcesses: 8,
    idleProcessTtlMs: 30_000,
  });
  assert.equal(normalizeRuntimeSettings({}).maxLiveProcesses, 12);
  assert.equal(normalizeRuntimeSettings({}).maxGeneratingProcesses, 2);
});

test("create reuses the same chat and enforces max live processes", async () => {
  const { manager, children, nowValue } = makeManager({ maxLiveProcesses: 2 });
  const a = manager.create({ project: project("a"), chatId: "chat-a" });
  children[0].emit("spawn");
  const b = manager.create({ project: project("b"), chatId: "chat-b" });
  children[1].emit("spawn");
  assert.equal(manager.list().length, 2);
  assert.equal(manager.create({ project: project("a"), chatId: "chat-a" }), a);

  // Busy / attached processes cannot be reclaimed for a new chat.
  a.clients.add({});
  b.active = true;
  b.activity = "working";
  await assert.rejects(
    () => manager.ensureCapacity({ excludeChatId: "chat-c" }),
    (error) => error.code === "live_process_limit",
  );

  // Detach and idle so ensureCapacity can reclaim the oldest.
  a.clients.clear();
  b.active = false;
  b.activity = "idle";
  a.active = false;
  a.activity = "idle";
  a.lastClientAt = nowValue.t - 10;
  b.lastClientAt = nowValue.t - 5;

  await manager.ensureCapacity({ excludeChatId: "chat-c" });
  assert.equal(manager.list().length, 1);
  const c = manager.create({ project: project("c"), chatId: "chat-c" });
  assert.equal(c.chatId, "chat-c");
  assert.equal(manager.list().length, 2);
});

test("starting processes are not reclaimable", async () => {
  const { manager, children } = makeManager({ maxLiveProcesses: 1 });
  const starting = manager.create({ project: project("boot"), chatId: "chat-boot" });
  assert.equal(starting.status, "starting");
  assert.equal(manager.isBusy(starting), true);
  assert.equal(manager.isReclaimable(starting), false);
  await assert.rejects(
    () => manager.ensureCapacity({ excludeChatId: "chat-other" }),
    (error) => error.code === "live_process_limit",
  );
  children[0].emit("spawn");
  starting.clients.clear();
  starting.active = false;
  starting.activity = "idle";
  assert.equal(manager.isReclaimable(starting), true);
});

test("createWithCapacity serializes concurrent creates under the cap", async () => {
  const { manager, children } = makeManager({ maxLiveProcesses: 1 });
  const results = await Promise.allSettled([
    manager.createWithCapacity({ project: project("a"), chatId: "chat-a" }),
    manager.createWithCapacity({ project: project("b"), chatId: "chat-b" }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  // First create wins; second hits the cap while the first is still starting (non-reclaimable).
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "live_process_limit");
  assert.equal(manager.list().length, 1);
  children[0]?.emit("spawn");
});

test("get_state does not settle an open generation", () => {
  const { manager, children } = makeManager({ maxLiveProcesses: 2 });
  const record = manager.create({ project: project("g"), chatId: "chat-g" });
  children[0].emit("spawn");
  record.generation = { id: "g1", closed: false, settled: false };
  record.active = true;
  manager.ingestResponseData(record, {
    command: "get_state",
    data: { isStreaming: false, isCompacting: false },
  });
  assert.equal(record.active, false);
  assert.equal(record.generation.settled, false);
  assert.equal(record.activity, "working");
});

test("assertCanStartGeneration limits concurrent agent loops without reclaiming warms", () => {
  const { manager, children } = makeManager({ maxLiveProcesses: 8, maxGeneratingProcesses: 2 });
  const a = manager.create({ project: project("a"), chatId: "chat-a" });
  const b = manager.create({ project: project("b"), chatId: "chat-b" });
  const c = manager.create({ project: project("c"), chatId: "chat-c" });
  for (const child of children) child.emit("spawn");
  a.generation = { id: "ga", closed: false, settled: false };
  a.active = true;
  b.generation = { id: "gb", closed: false, settled: false };
  b.active = true;
  c.active = false;
  c.activity = "idle";
  assert.equal(manager.generatingRecords().length, 2);
  assert.equal(manager.list().length, 3);
  assert.throws(
    () => manager.assertCanStartGeneration(c),
    (error) => error.code === "generation_limit",
  );
  // Already-generating chats keep their slot (steer/retry).
  assert.doesNotThrow(() => manager.assertCanStartGeneration(a));
  // Warm pool is independent: no processes reclaimed by the generation bounce.
  assert.equal(manager.list().length, 3);
});

test("prompt rejects when the generating cap is full", () => {
  const { manager, children } = makeManager({ maxLiveProcesses: 4, maxGeneratingProcesses: 1 });
  const busy = manager.create({ project: project("busy"), chatId: "chat-busy" });
  const idle = manager.create({ project: project("idle"), chatId: "chat-idle" });
  children[0].emit("spawn");
  children[1].emit("spawn");
  busy.generation = { id: "g1", closed: false, settled: false };
  busy.active = true;
  assert.throws(
    () => manager.prompt(idle.id, "hello"),
    (error) => error.code === "generation_limit",
  );
  assert.equal(idle.generation, null);
});

test("reaper stops unattached idle processes after the TTL", async () => {
  const { manager, children, nowValue } = makeManager({ maxLiveProcesses: 4, idleProcessTtlMs: 120_000 });
  const record = manager.create({ project: project("idle"), chatId: "chat-idle" });
  children[0].emit("spawn");
  record.clients.clear();
  record.active = false;
  record.activity = "idle";
  record.lastClientAt = nowValue.t;
  nowValue.t += 119_000;
  assert.equal(await manager.reapIdleProcesses(), 0);
  nowValue.t += 2_000;
  assert.equal(await manager.reapIdleProcesses(), 1);
  assert.equal(manager.list().length, 0);
});

test("reaper keeps processes with attached clients or active generations", async () => {
  const { manager, children, nowValue } = makeManager({ idleProcessTtlMs: 1_000 });
  const attached = manager.create({ project: project("att"), chatId: "chat-att" });
  children[0].emit("spawn");
  attached.clients.add({});
  attached.lastClientAt = nowValue.t - 10_000;
  attached.active = false;
  attached.activity = "idle";

  const busy = manager.create({ project: project("busy"), chatId: "chat-busy" });
  children[1].emit("spawn");
  busy.clients.clear();
  busy.lastClientAt = nowValue.t - 10_000;
  busy.active = true;
  busy.activity = "working";

  nowValue.t += 20_000;
  assert.equal(await manager.reapIdleProcesses(), 0);
  assert.equal(manager.list().length, 2);
});

test("enforceLimit stops excess idle processes after max is lowered", async () => {
  const { manager, children, nowValue } = makeManager({ maxLiveProcesses: 4 });
  for (let index = 0; index < 4; index += 1) {
    const record = manager.create({ project: project(`p${index}`), chatId: `chat-${index}` });
    children[index].emit("spawn");
    record.clients.clear();
    record.active = false;
    record.activity = "idle";
    record.lastClientAt = nowValue.t - (100 - index);
  }
  assert.equal(manager.list().length, 4);
  manager.configure({ maxLiveProcesses: 2 });
  assert.equal(await manager.enforceLimit(), 2);
  assert.equal(manager.list().length, 2);
  assert.equal(manager.policy().maxLiveProcesses, 2);
});
