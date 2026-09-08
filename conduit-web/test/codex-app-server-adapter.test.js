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
    thinkingLevels: false, modelSwitch: false, toolUse: true, permissions: false,
    usage: false, replay: true,
  });
});

test("Codex prompt writes the installed app-server turn/start shape", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  const writes = [];
  live.child = { stdin: { writable: true, write: (line) => writes.push(JSON.parse(line)) } };
  adapter.records.set(live.id, live);
  const pending = adapter.prompt(live.id, "Test prompt");
  assert.deepEqual(writes[0], { id: 1, method: "turn/start", params: {
    threadId: "thread-1", input: [{ type: "text", text: "Test prompt" }],
  } });
  adapter.receive(live, JSON.stringify({ id: 1, result: { turn: { id: "turn-1" } } }));
  assert.equal(await pending, "turn-1");
});
