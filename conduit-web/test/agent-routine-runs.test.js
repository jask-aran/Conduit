import test from "node:test";
import assert from "node:assert/strict";
import { appendEntry } from "../src/agent/inbox.js";
import { MemoryTools } from "../src/agent/memory.js";
import { parseRoutine, writeRoutine } from "../src/agent/routine-files.js";
import { forkRecord, routineTask, startRoutine } from "../src/agent/routine-task.js";
import { legacyRoutineTask } from "../src/agent/legacy-routine-task.js";
import { AgentDoc } from "../src/agent/agent-doc.js";
import { AgentDoc as PiAgentDoc, configure, createRegistry, createSession, Harness, LiveDoc, MemoryStorage } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai/models";
import { ConduitIds, ConduitWorkspace } from "../src/server/durable-runtime.js";
import { scriptedProvider } from "../src/server/scripted-model.js";
import { AgentExtension } from "../src/agent/extension.js";
import { Subagents } from "../src/server/subagents.js";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { agentFixture } from "./helpers/agent-fixture.js";

const now = Date.UTC(2030, 0, 15, 12);
const text = "---\ntitle: Review arrivals\ntrigger: { every: 30 }\ntasks: [{ id: arrivals, kind: inbox }]\ngate: when-new\noutput: jbot\n---\nReview the gathered facts.";
const routine = () => parseRoutine(text, "heartbeat");
const memoryTool = (agent) => MemoryTools(agent.runtime).tools.find((tool) => tool.name === "memory");

// Execute durable phases with real document commits; replace model submission only.
async function routineFixture(t, changes = {}) {
  const fixture = await agentFixture(t);
  const { agent, session } = fixture;
  const homeId = await session.commit(async (tx) => {
    const home = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, home.id, { model: { provider: "fixture", modelId: "home" }, thinkingLevel: "high", instructions: "Home prompt" });
    Object.assign(await tx.doc(ConduitWorkspace, home.id), { roaming: true });
    (await tx.doc(ConduitIds, home.id)).chatId = "home-chat";
    await tx.appendEntry(home.id, { kind: "conduit.user", data: { text: "Work at 9am" }, model: [{ role: "user", content: "Work at 9am", timestamp: now }] });
    (await tx.doc(AgentDoc)).home.conversationId = home.id;
    return home.id;
  }, BACKGROUND_CONTEXT);
  const plan = { ...routine(), name: "review", mode: "fork", gate: "always", output: "inbox", tasks: [{ id: "notes", kind: "notes" }], ...changes };
  await writeRoutine(agent.folder, plan);
  let taskId;
  await session.commit(async (tx) => {
    const doc = await tx.doc(AgentDoc);
    taskId = await startRoutine(tx, doc, agent, homeId, plan, new Date(now).toISOString());
    doc.routineRuns[taskId].startedAt = now;
  }, BACKGROUND_CONTEXT);
  const task = { id: taskId, input: { homeId, name: plan.name }, state: { checkpoint: { phase: "before", index: 0 } } };
  const memos = new Map();
  const api = { taskId, conversationId: homeId, now: () => now, signal: new AbortController().signal,
    snapshot: (token, id) => token.definition.scope === "session" ? session.snapshot(token, BACKGROUND_CONTEXT) : session.snapshot(token, id, BACKGROUND_CONTEXT),
    commit: async (fn) => { const state = await session.commit(fn, BACKGROUND_CONTEXT); if (state) task.state = state; },
    memo: async (key, value) => { if (value !== BACKGROUND_CONTEXT) memos.set(key, value); return memos.get(key); },
    sleepUntil: async (until, checkpoint) => { task.state = { status: "sleeping", until, checkpoint }; },
    setTimer: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); },
  };
  const fork = { submit: async () => ({ wait: async () => ({ status: "done", answer: 1 }) }),
    entries: async () => ({ items: [{ model: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Summary: Kept the schedule" }] }] }] }), abort: async () => {} };
  agent.runtime.harness = { conversation: async (id) => ({ ...fork, id }), abortTask: async () => {} };
  const phases = routineTask(agent.runtime).definition.phases;
  const step = () => phases[task.state.checkpoint.phase](task, api, BACKGROUND_CONTEXT);
  const reach = async (phase) => { for (let i = 0; task.state.checkpoint?.phase !== phase && i < 10; i++) await step(); assert.equal(task.state.checkpoint?.phase, phase); };
  return { ...fixture, homeId, task, api, step, reach, fork };
}

test("a generic fork inherits current home settings without changing home history, identity or turn lock", async (t) => {
  const { session, agent, homeId, task, reach } = await routineFixture(t);
  const before = await session.commit((tx) => tx.scanEntries({ conversationId: homeId }, 10), BACKGROUND_CONTEXT);
  const homeAgent = await session.snapshot(PiAgentDoc, homeId, BACKGROUND_CONTEXT);
  await reach("run");
  const forkId = (await agent.state()).routineRuns[task.id].conversationId;
  assert.ok(forkId && forkId !== homeId);
  assert.deepEqual(await session.snapshot(PiAgentDoc, forkId, BACKGROUND_CONTEXT), homeAgent);
  assert.deepEqual(await session.snapshot(ConduitWorkspace, forkId, BACKGROUND_CONTEXT), await session.snapshot(ConduitWorkspace, homeId, BACKGROUND_CONTEXT));
  assert.equal(await session.snapshot(LiveDoc, forkId, BACKGROUND_CONTEXT), undefined);
  assert.equal((await session.snapshot(ConduitIds, forkId, BACKGROUND_CONTEXT)).chatId, undefined);
  assert.deepEqual(await session.commit((tx) => tx.scanEntries({ conversationId: homeId }, 10), BACKGROUND_CONTEXT), before);
  assert.equal((await agent.describe(forkId)).role, "run");
});

test("all task cursors commit after success in either mode; failed or truncated replies keep notes pending", async (t) => {
  for (const mode of ["run", "fork"]) await t.test(mode, async (t) => {
    const f = await routineFixture(t, { mode, tasks: [{ id: "notes", kind: "notes" }, { id: "chats", kind: "chats" }] });
    await memoryTool(f.agent).execute({ action: "note", text: "Starts at 9am" }, { ...f.api, callId: "note-call" });
    t.mock.method(f.agent, "spawnRun", async () => ({ reporter: 200 }));
    await f.reach("run");
    const record = (await f.agent.state()).routineRuns[f.task.id];
    if (mode === "run") f.api.waitForTask = async () => ({ state: { outcome: { status: "completed", result: { status: "failed", answer: "failed" } } } });
    else f.fork.entries = async () => ({ items: [{ model: [{ stopReason: "length", content: [{ type: "text", text: "partial" }] }] }] });
    await f.step();
    assert.equal((await f.agent.state()).cursors?.review, undefined);
    assert.match((await f.agent.state()).routineState.review.lastError, /did not finish successfully/);
    await f.agent.update((doc) => { doc.routineRuns[f.task.id] = record; });
    f.task.state = { checkpoint: { phase: "run" } };
    if (mode === "run") f.api.waitForTask = async () => ({ state: { outcome: { status: "completed", result: { status: "finished", answer: "ready" } } } });
    else f.fork.entries = async () => ({ items: [{ model: [{ stopReason: "stop", content: [{ type: "text", text: "ready" }] }] }] });
    await f.step();
    const state = await f.agent.state();
    assert.deepEqual(state.cursors.review, record.outcome.cursors);
    assert.deepEqual(state.cursors.review.notes.calls, ["note-call"]);
    assert.equal(state.routineRuns[f.task.id].conversationId, undefined);
  });
});

test("a real durable scheduler runs a generic fork then a chained background run on the scripted model", { timeout: 5000 }, async (t) => {
  const { agent } = await agentFixture(t);
  const models = createModels(); models.setProvider(scriptedProvider());
  const registry = createRegistry();
  const subagents = Subagents(agent.runtime); registry.install(subagents);
  const extension = AgentExtension(agent.runtime, []); registry.install(extension);
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, BACKGROUND_CONTEXT);
  t.after(() => harness.close(BACKGROUND_CONTEXT));
  agent.runtime.harness = harness; agent.runtime.open = async () => harness;
  const home = await harness.root(BACKGROUND_CONTEXT, { agent: { model: { provider: "conduit-test", modelId: "steady" },
    thinkingLevel: "max", instructions: "Home system prompt", extensions: [extension, subagents] } });
  await agent.update((doc) => { doc.home = { conversationId: home.id, chatId: "home" }; });
  await (await home.submit({ type: "input", requestId: "home", content: "Reply with the single word home." }, BACKGROUND_CONTEXT)).wait(BACKGROUND_CONTEXT);
  const entriesBefore = (await home.entries({}, 100, undefined, BACKGROUND_CONTEXT)).items;
  const plan = { ...routine(), name: "review", mode: "fork", gate: "always", tasks: [], output: "inbox", body: "Reply with the single word ready.", after: [{ routine: "collect" }] };
  await writeRoutine(agent.folder, { ...plan, name: "collect", mode: "run", after: [], body: "Reply with the single word collected." });
  await writeRoutine(agent.folder, plan);
  let id;
  await home.commit(async (tx) => { id = await startRoutine(tx, await tx.doc(AgentDoc), agent, home.id, plan, new Date().toISOString()); }, BACKGROUND_CONTEXT);
  const result = await harness.waitForTask(id, BACKGROUND_CONTEXT);
  assert.equal(result.state.outcome.status, "completed", JSON.stringify(result.state.outcome));
  const state = await agent.state();
  assert.ok(state.routineState.review.finishedAt);
  assert.ok(state.routineState.collect.finishedAt);
  assert.deepEqual(state.routineRuns, {});
  assert.deepEqual((await home.entries({}, 100, undefined, BACKGROUND_CONTEXT)).items.filter((entry) => entry.kind !== "conduit.run-quiet"), entriesBefore);
  assert.ok(Object.values(state.inbox).some((entry) => entry.kind === "review"));
  assert.ok(state.cursors.collect);
});

test("a stalled fork is aborted before its memory guard is revoked", async (t) => {
  const f = await routineFixture(t);
  await f.reach("run");
  const forkId = (await f.agent.state()).routineRuns[f.task.id].conversationId;
  let aborted = false;
  f.fork.submit = async () => ({ wait: () => new Promise(() => {}) });
  f.fork.abort = async () => { assert.ok(forkRecord(await f.agent.state(), forkId), "the guard is still in place"); aborted = true; };
  f.api.setTimer = (callback) => { queueMicrotask(callback); return () => {}; };
  await f.step();
  assert.equal(aborted, true);
  assert.equal((await f.agent.state()).routineRuns[f.task.id], undefined);
  assert.equal((await f.agent.state()).cursors?.review, undefined);
  assert.equal(f.task.state.outcome.status, "aborted");
});

test("a persisted old task is recovered by the scheduler and terminated cleanly", { timeout: 5000 }, async (t) => {
  const { agent } = await agentFixture(t);
  const storage = new MemoryStorage();
  const prior = createSession(storage);
  let id;
  await prior.commit(async (tx) => {
    const home = await tx.createConversation({ ownership: { kind: "ownerless" } });
    id = await tx.createTask(legacyRoutineTask(agent.runtime), { key: "old", homeId: home.id }, { conversationId: home.id, ownership: { kind: "conversation" }, background: true });
    const doc = await tx.doc(AgentDoc);
    doc.reflection = { taskId: id, conversationId: null };
    doc.cursors = { reflect: { notes: { calls: ["kept"] } } };
  }, BACKGROUND_CONTEXT);
  const registry = createRegistry();
  registry.install(AgentExtension(agent.runtime, []));
  const harness = await Harness.open(storage, { models: createModels(), registry }, BACKGROUND_CONTEXT);
  agent.runtime.harness = harness; agent.runtime.open = async () => harness;
  t.after(async () => { await harness.close(BACKGROUND_CONTEXT); await prior.close(BACKGROUND_CONTEXT); });
  const result = await harness.waitForTask(id, BACKGROUND_CONTEXT);
  assert.equal(result.state.outcome.status, "aborted");
  const state = await harness.snapshot(AgentDoc, BACKGROUND_CONTEXT);
  assert.equal(state.reflection, undefined);
  assert.deepEqual(state.cursors.reflect.notes.calls, ["kept"]);
});
