import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerAdapter, CODEX_CAPABILITIES } from "../src/codex-app-server-adapter.js";

function record() {
  return {
    id: "live", chatId: "chat", status: "running", activity: "idle", active: false, stopping: false,
    sessionId: "thread-1", generation: null, clients: new Set(), events: [], pending: new Map(),
    sequence: 0, eventSequence: 0, messageIds: new Set(),
  };
}

test("Codex notifications map to neutral streaming events", () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  adapter.notification(live, "turn/started", { turn: { id: "turn-1" } });
  adapter.notification(live, "item/agentMessage/delta", { turnId: "turn-1", itemId: "message-1", delta: "Hello" });
  adapter.notification(live, "turn/completed", { turn: { id: "turn-1", status: "completed" } });
  assert.deepEqual(live.events.map(({ type }) => type), ["status", "assistant_content", "assistant_content", "status"]);
  assert.equal(live.events[2].delta, "Hello");
  assert.equal(live.events[3].detail, "settled");
  assert.equal(live.active, false);
});

test("Codex adapter advertises only implemented capabilities", () => {
  assert.deepEqual(CODEX_CAPABILITIES, {
    steer: false, followUpQueue: false, cancel: true, compaction: false,
    thinkingLevels: true, modelSwitch: true, toolUse: true, permissions: false,
    usage: false, replay: true,
  });
});

test("Codex prompt writes the installed app-server turn/start shape", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  const writes = [];
  live.child = { stdin: { writable: true, write: (line) => writes.push(JSON.parse(line)) } };
  adapter.records.set(live.id, live);
  await adapter.setModel(live.id, "codex-other");
  await adapter.setThinkingLevel(live.id, "high");
  const pending = adapter.prompt(live.id, "Test prompt");
  assert.deepEqual(writes[0], { id: 1, method: "turn/start", params: {
    threadId: "thread-1", input: [{ type: "text", text: "Test prompt" }],
    model: "codex-other",
    effort: "high",
  } });
  adapter.receive(live, JSON.stringify({ id: 1, result: { turn: { id: "turn-1" } } }));
  assert.equal(await pending, "turn-1");
});

test("Codex discovery uses the metadata database and exact workspace filter", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.id = "discovery";
  adapter.start = async ({ cwd }) => { live.cwd = cwd; return live; };
  adapter.close = async () => true;
  adapter.request = async (_record, method, params) => {
    assert.equal(method, "thread/list");
    assert.deepEqual(params, { cwd: "/workspace", limit: 50, sortKey: "recency_at", sortDirection: "desc", useStateDbOnly: true });
    return { data: [
      { id: "inside", cwd: "/workspace", preview: "Inside", recencyAt: 20, status: { type: "notLoaded" } },
      { id: "outside", cwd: "/other", preview: "Outside", recencyAt: 10 },
    ] };
  };
  assert.deepEqual(await adapter.listSessions({ cwd: "/workspace" }), [{
    id: "inside", title: "Inside", preview: "Inside", cwd: "/workspace", createdAt: null,
    updatedAt: 20, status: "notLoaded", source: "unknown", replayFidelity: "full",
  }]);
});
