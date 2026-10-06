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
  idleProcessTtlMs = 120_000,
  nowValue = { t: 1_000 },
} = {}) {
  const children = [];
  const manager = new PiManager({
    agentDir: "/tmp/conduit-process-policy",
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
  workingRoot: `/tmp/${slug}`,
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

test("create reuses the same chat", () => {
  const { manager, children } = makeManager();
  const a = manager.create({ project: project("a"), chatId: "chat-a" });
  children[0].emit("spawn");
  manager.create({ project: project("b"), chatId: "chat-b" });
  children[1].emit("spawn");
  assert.equal(manager.list().length, 2);
  assert.equal(manager.create({ project: project("a"), chatId: "chat-a" }), a);
});

test("an intentional stop absorbs a late Pi stdin error", () => {
  const stdin = new EventEmitter();
  stdin.write = () => true;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = stdin;
  child.kill = () => true;
  const manager = new PiManager({
    agentDir: "/tmp/conduit-stdin-error",
    reaperIntervalMs: 0,
    spawnImpl: () => child,
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const record = manager.create({ project: project("stdin-error"), chatId: "chat-stdin-error" });
  child.emit("spawn");
  assert.equal(manager.stop(record.id), true);
  assert.doesNotThrow(() => stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" })));
});

test("a Pi process exit closes attached clients so they reconnect to its replacement", async () => {
  const { manager, children } = makeManager();
  const record = manager.create({ project: project("socket-handoff"), chatId: "chat-socket-handoff" });
  children[0].emit("spawn");
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.send = () => {};
  socket.close = (code, reason) => {
    socket.closeArgs = { code, reason };
    socket.readyState = 3;
    socket.emit("close");
  };
  manager.attach(record.id, socket);

  await manager.stopAndWait(record.id);

  assert.deepEqual(socket.closeArgs, { code: 1012, reason: "Pi process exited" });
  assert.equal(record.clients.size, 0);
});

test("starting processes are not reclaimable", () => {
  const { manager, children } = makeManager();
  const starting = manager.create({ project: project("boot"), chatId: "chat-boot" });
  assert.equal(starting.status, "starting");
  assert.equal(manager.isBusy(starting), true);
  assert.equal(manager.isReclaimable(starting), false);
  children[0].emit("spawn");
  starting.clients.clear();
  starting.active = false;
  starting.activity = "idle";
  assert.equal(manager.isReclaimable(starting), true);
});

test("get_state does not settle an open generation", () => {
  const { manager, children } = makeManager();
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

test("setSessionName uses the live process RPC and leaves the process running", async () => {
  const { manager, children } = makeManager();
  const writes = [];
  const record = manager.create({ project: project("rename"), chatId: "chat-rename" });
  children[0].emit("spawn");
  children[0].stdin.write = (chunk) => { writes.push(String(chunk)); };
  record.status = "running";
  const pending = manager.setSessionName(record.id, "Renamed chat");
  await Promise.resolve();
  const sent = writes.map((line) => JSON.parse(line.trim()));
  const request = sent.find((item) => item.type === "set_session_name");
  assert.ok(request);
  assert.equal(request.name, "Renamed chat");
  // Resolve the pending RPC like Pi would.
  const pendingRequest = record.pendingRequests.get(request.id);
  assert.ok(pendingRequest);
  pendingRequest.resolve({ type: "response", id: request.id, command: "set_session_name", success: true });
  clearTimeout(pendingRequest.timer);
  record.pendingRequests.delete(request.id);
  await pending;
  assert.equal(record.status, "running");
  assert.equal(manager.list().length, 1);
});

test("reaper stops unattached idle processes after the TTL", async () => {
  const { manager, children, nowValue } = makeManager({ idleProcessTtlMs: 120_000 });
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

test("reaper keeps a busy process and an attached one that is still working", async () => {
  // The default TTL is used deliberately: idleProcessTtlMs is clamped to a
  // 30s floor, so a smaller value here would not be the value under test.
  const { manager, children, nowValue } = makeManager({});
  // Attached, and Pi has done something recently. An open chat is judged on
  // real activity, not on when its socket arrived, so it survives.
  const working = manager.create({ project: project("att"), chatId: "chat-att" });
  children[0].emit("spawn");
  working.clients.add({});
  working.lastClientAt = nowValue.t - 200_000;
  working.active = false;
  working.activity = "idle";

  const busy = manager.create({ project: project("busy"), chatId: "chat-busy" });
  children[1].emit("spawn");
  busy.clients.clear();
  busy.lastClientAt = nowValue.t - 200_000;
  busy.active = true;
  busy.activity = "working";

  nowValue.t += 121_000;
  working.lastTurnAt = nowValue.t;
  assert.equal(await manager.reapIdleProcesses(), 0);
  assert.equal(manager.list().length, 2);
});

test("background chatter from an idle process does not defer the reaper", async () => {
  // The failure this clock exists for: an idle Pi publishes often enough that
  // lastActivityAt never ages past the TTL, so a reaper measuring against it
  // never fires no matter how long the chat sits unused.
  const { manager, children, nowValue } = makeManager({});
  const record = manager.create({ project: project("chatter"), chatId: "chat-chatter" });
  children[0].emit("spawn");
  record.clients.add({});
  record.active = false;
  record.activity = "idle";
  record.lastTurnAt = nowValue.t;

  for (let elapsed = 0; elapsed < 180_000; elapsed += 60_000) {
    nowValue.t += 60_000;
    manager.touchActivity(record); // Pi says something; no turn begins.
  }
  assert.ok(nowValue.t - record.lastActivityAt < 120_000, "activity clock was kept fresh");
  assert.equal(await manager.reapIdleProcesses(), 1, "reaped on the turn clock regardless");
});

test("reaper stops an idle process even while a client is attached", async () => {
  const { manager, children, nowValue } = makeManager({});
  const attached = manager.create({ project: project("att"), chatId: "chat-att" });
  children[0].emit("spawn");
  attached.clients.add({});
  attached.active = false;
  attached.activity = "idle";
  // Attaching does not advance lastClientAt again, so an open chat used to sit
  // here for ever. What matters is when the last turn began.
  attached.lastClientAt = nowValue.t;
  attached.lastTurnAt = nowValue.t;

  nowValue.t += 119_000;
  assert.equal(await manager.reapIdleProcesses(), 0, "still within the idle window");

  nowValue.t += 2_000;
  assert.equal(await manager.reapIdleProcesses(), 1);
  assert.equal(manager.list().length, 0);
});

test("a deliberate stop tells clients not to reconnect", async () => {
  const { manager, children } = makeManager({});
  const record = manager.create({ project: project("stop"), chatId: "chat-stop" });
  children[0].emit("spawn");
  const events = [];
  manager.on("event", ({ event }) => events.push(event));

  const stopped = manager.stopAndWait(record.id);
  children[0].emit("exit", 0, "SIGTERM");
  await stopped;

  const exit = events.find((event) => event.type === "runtime_exit");
  assert.ok(exit, "an exit event is published");
  assert.equal(exit.deliberate, true);
});

test("stopAndWait escalates to SIGKILL when the graceful deadline expires", async () => {
  const signals = [];
  const concurrency = {
    waitFor: async () => { throw new Error("deadline"); },
  };
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { write() {} };
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  const manager = new PiManager({
    agentDir: "/tmp/conduit-stop-escalation",
    concurrency,
    reaperIntervalMs: 0,
    spawnImpl: () => child,
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const record = manager.create({ project: project("stop-escalation"), chatId: "chat-stop-escalation" });
  child.emit("spawn");

  assert.equal(await manager.stopAndWait(record.id), true);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("a crash is not reported as a deliberate stop", async () => {
  const { manager, children } = makeManager({});
  const record = manager.create({ project: project("crash"), chatId: "chat-crash" });
  children[0].emit("spawn");
  const events = [];
  manager.on("event", ({ event }) => events.push(event));

  children[0].emit("exit", 1, null);
  assert.equal(record.status, "stopped");

  const exit = events.find((event) => event.type === "runtime_exit");
  assert.ok(exit, "an exit event is published");
  assert.equal(exit.deliberate, false);
});

test("a process stops being offered the moment its stop is accepted", async () => {
  const { manager, children } = makeManager({});
  const record = manager.create({ project: project("window"), chatId: "chat-window" });
  children[0].emit("spawn");
  assert.equal(manager.getByChatId("chat-window"), record);

  const removed = [];
  manager.on("process_removed", (payload) => removed.push(payload));

  // SIGTERM leaves the record in place until the child actually exits. Nothing
  // may hand that record out in between: a client that attaches to it gets a
  // socket onto a process that is already leaving, comes away with no agent,
  // and has to ask a second time to get one.
  manager.stop(record.id);
  assert.equal(record.status, "running", "the child has not exited yet");
  assert.equal(manager.getByChatId("chat-window"), null);
  assert.deepEqual(manager.list(), []);
  assert.deepEqual(manager.rawRecords(), []);
  assert.deepEqual(removed.map((item) => item.chatId), ["chat-window"]);
});

test("interrupting a turn does not take the process off the books", async () => {
  const { manager, children } = makeManager({});
  const record = manager.create({ project: project("interrupt"), chatId: "chat-interrupt" });
  children[0].emit("spawn");

  // record.stopping means two different things -- this turn is being
  // interrupted, and this process is being killed -- and only the second one
  // ends the process. Conflating them hides a perfectly live agent the moment
  // someone stops a response, and sends the next prompt to a second process.
  record.stopping = true;

  assert.equal(manager.getByChatId("chat-interrupt"), record);
  assert.equal(manager.list().length, 1);
  assert.equal(manager.rawRecords().length, 1);
});
