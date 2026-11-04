import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { DurableAdapter, entriesToOps } from "../src/durable-adapter.js";
import { applyTranscriptOp, applyTranscriptOps } from "../src/transcript-fold.js";
import { assertTranscriptOp, messageOpen } from "../src/harnesses/transcript-ops.js";
import { ChatLog } from "../src/server/chat-log.js";
import { registerSessionContextRoutes } from "../src/server/routes/session-context.js";
import { submitWithNotes } from "../src/context/notices.js";
import {
  buildLiveAnswerRow,
  buildLiveProjectionIndex,
  buildTurnRows,
} from "../src/client/turn-rows.ts";

const runtimeEntry = (id, kind, message, data = {}) => ({ id, conversationId: 42, kind, data, model: message ? [message] : [] });
const runtimeHistory = () => [
  runtimeEntry(1, "conduit.user", { role: "user", content: "<conduit_note>\nStop &amp; update\n</conduit_note>\n\nInspect", timestamp: 1000 },
    { messageId: "u1", text: "Inspect", timestamp: new Date(1000).toISOString() }),
  runtimeEntry(2, "pi.system", { role: "system", content: "", sections: { cwd: "/work", instructions: "Full prompt", web: "Web context" },
    toolsAdded: [{ name: "read", description: "Read a file\nMore detail" }], timestamp: 1001 }),
  runtimeEntry(3, "pi.assistant", { role: "assistant", content: [{ type: "text", text: "Checking" }], stopReason: "toolUse", timestamp: 1002 }),
  runtimeEntry(4, "pi.system", { role: "system", content: "", sections: { cwd: "/next", web: null },
    toolsRemoved: [{ name: "read" }], toolsAdded: [{ name: "read", description: "Read a file" }], timestamp: 1003 }),
  runtimeEntry(5, "pi.compaction", { role: "user", content: [{ type: "text",
    text: "The conversation history before this point was compacted into the following summary:\n\n<summary>\nKept context\n</summary>" }], timestamp: 1004 }),
];

test("durable event overflow restores the completed call and settles the turn", async () => {
  const call = "script";
  const entries = [
    runtimeEntry(1, "conduit.user", { role: "user", content: "Create event" }, { messageId: "u1", text: "Create event" }),
    runtimeEntry(2, "pi.assistant", { role: "assistant", stopReason: "toolUse", timestamp: 1000,
      content: [{ type: "toolCall", id: call, name: "codemode", arguments: { code: "text(await tools.mcp__executor__call({}));" } }] }),
    runtimeEntry(3, "pi.tool-result", { role: "toolResult", toolCallId: call, toolName: "codemode", isError: false,
      content: [{ type: "text", text: "Created" }], details: { calls: [{ name: "mcp__executor__call", args: "{}", status: "ok" }] } }),
    runtimeEntry(4, "pi.assistant", { role: "assistant", stopReason: "stop", timestamp: 1001, content: [{ type: "text", text: "Done" }] }),
  ];
  const events = [];
  const adapter = Object.create(DurableAdapter.prototype);
  adapter.runtime = { harness: { snapshot: async () => ({ messages: {} }) } };
  adapter.publish = (_record, event) => events.push(event);
  adapter.publishUsage = async () => {};
  const record = { conversationId: 42, generationSeq: 0, active: true, stopping: false, readOnly: true,
    generation: { id: "g1" }, hostUiRequests: [], turn: { generationId: "g1", inputs: [1], prompts: ["u1"],
      last: null, messageId: null, tools: new Map([[call, { name: "codemode", opened: true, output: "" }]]) } };
  await adapter.translate(record, { type: "snapshot", entries, tools: [], usage: {} });
  const restored = events.find((event) => event.type === "transcript_sync");
  assert.equal(restored.tools[0].done, true);
  assert.equal(restored.tools[0].calls[0].done, true);
  assert.equal(restored.tools[0].calls[0].isError, false);
  assert.equal(record.active, false);
  assert.ok(events.some((event) => event.type === "status" && event.phase === "settled"));
  assert.ok(!events.some((event) => event.op === "tool.close" && event.cancelled));
});

test("runtime context, notes and local flags survive the same fold on reload and live placement", async () => {
  const entries = runtimeHistory();
  const reopened = applyTranscriptOps({}, entriesToOps(entries)).messages;
  const contexts = reopened.filter((message) => message.role === "system");
  assert.deepEqual(contexts.map((message) => [message.id, message.answers, message.context.kind]),
    [["c42-2", "u1", "prompt"], ["c42-4", "u1", "update"], ["c42-5", "u1", "compaction"]]);
  assert.deepEqual(contexts[0].context.sections, [{ name: "instructions", chars: 11 }, { name: "cwd", chars: 5 }, { name: "web", chars: 11 }]);
  assert.deepEqual(contexts[1].context.tools, { added: [], removed: [], changed: ["read"] });
  assert.equal(contexts[1].context.sections[1].chars, 0);
  assert.equal(contexts[2].context.summary.chars, entries[4].model[0].content[0].text.length);
  assert.equal(reopened[0].notes, "Stop &amp; update");
  assert.equal(reopened[0].content, "Inspect");
  assert.equal(contexts.some((message) => message.streaming), false);

  const live = [];
  const adapter = { entries: async () => entries, publish: (_record, op) => live.push(op) };
  const record = { conversation: {}, turn: { generationId: "g1", opened: new Set(["u1"]) } };
  for (const entry of entries.filter((entry) => entry.kind !== "pi.assistant")) await DurableAdapter.prototype.placed.call(adapter, record, entry);
  const liveMessages = applyTranscriptOps({}, live).messages;
  assert.deepEqual(liveMessages.filter((message) => message.role === "system"), contexts);
  const pending = applyTranscriptOp([{ id: "u1", role: "user", content: "Inspect", local: true }], live[0]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].notes, "Stop &amp; update");
  assert.equal(pending[0].local, undefined);
  const merged = applyTranscriptOps({ messages: liveMessages }, entriesToOps(entries)).messages;
  assert.equal(merged.filter((message) => message.role === "system").length, 3);
});

test("settling and overlaying the live log onto a reload keeps context and notes once", async () => {
  const entries = runtimeHistory();
  const identity = { messages: {} };
  const log = new ChatLog();
  const conversation = { commit: async (change) => change({ doc: async () => identity }) };
  const record = { conversation, generationSeq: 0, closedEntries: new Set(), turn: {
    generationId: "g1", opened: new Set(["u1"]), inputs: [1], prompts: ["u1"], answers: "u1", messageId: "streamed-a1", tools: new Map(),
  } };
  const adapter = { entries: async () => entries, publish: (_record, op) => log.stamp(op) };
  log.stamp(messageOpen({ id: "u1", role: "user", content: "Inspect", timestamp: entries[0].data.timestamp }));
  for (const entry of entries) await DurableAdapter.prototype.placed.call(adapter, record, entry);
  log.stamp({ type: "transcript_op", op: "turn.settle", promptId: "u1", outcome: "complete" });
  assert.equal(identity.messages[3], "streamed-a1");
  const reload = applyTranscriptOps({}, entriesToOps(entries, identity.messages));
  const overlay = applyTranscriptOps(reload, log.entries);
  assert.deepEqual(overlay.messages.map((message) => message.id), ["u1", "c42-2", "streamed-a1", "c42-4", "c42-5"]);
  assert.equal(overlay.messages[0].notes, "Stop &amp; update");
  assert.equal(overlay.messages[0].content, "Inspect");
  for (const narration of ["fold", "show"]) {
    const contexts = buildTurnRows(overlay.messages, overlay.tools, { narration }).flatMap((row) => row.type === "trace"
      ? row.value.segments.filter((segment) => segment.kind === "context").map((segment) => segment.id) : []);
    assert.deepEqual(contexts, ["c42-2", "c42-4", "c42-5"]);
  }
});

test("runtime reports and approvals keep their display fields beside notes; beat lines are local", async () => {
  const report = runtimeEntry(6, "conduit.subagent-report", { role: "user", timestamp: 1000,
    content: "<conduit_note>\nTime note\n</conduit_note>\n\nReport\n\n---\nDecide what to do" },
  { messageId: "report", subagentId: "sa-1", conversationId: 99, title: "Run", status: "finished", report: "Report", appended: "Decide what to do" });
  const approval = runtimeEntry(7, "conduit.user", { role: "user", content: "<conduit_note>\nUpdate\n</conduit_note>\n\n[Approval] Allowed: ask-1" },
    { messageId: "approval", text: "[Approval] Allowed: ask-1" });
  const beat = runtimeEntry(8, "conduit.agent-beat", null, { messageId: "beat", subagentId: "sa-1", conversationId: 99, handled: 1 });
  const entries = [report, approval, beat];
  const messages = applyTranscriptOps({}, entriesToOps(entries)).messages;
  assert.equal(messages[0].content, "Report");
  assert.equal(messages[0].notes, "Time note");
  assert.equal(messages[0].appended, "Decide what to do");
  assert.deepEqual(messages[0].agent, { id: "sa-1", conversationId: 99 });
  assert.deepEqual(messages[0].sender, { name: "Run", status: "finished" });
  assert.equal(messages[1].content, "[Approval] Allowed: ask-1");
  assert.equal(messages[1].notes, "Update");
  assert.equal(messages[2].unseen, true);
  const live = [];
  const record = { turn: { generationId: "g1", inputs: [], opened: new Set(["approval"]) } };
  const adapter = { publish: (_record, op) => live.push(op) };
  for (const entry of entries) await DurableAdapter.prototype.placed.call(adapter, record, entry);
  const placed = applyTranscriptOps({}, live).messages;
  const { outcome: _outcome, ...reportMessage } = messages[0];
  assert.deepEqual(placed[0], reportMessage);
  assert.equal(placed[1].notes, "Update");
  assert.equal(placed[1].content, "[Approval] Allowed: ask-1");
  assert.equal(placed[2].unseen, true);
});

test("context keeps preamble ownership and net tool changes by name", async () => {
  const baseline = runtimeEntry(1, "pi.system", { role: "system", sections: { instructions: "Prompt" }, timestamp: 1000 });
  const update = runtimeEntry(2, "pi.system", { role: "system", toolsRemoved: [{ name: "read" }, { name: "old" }],
    toolsAdded: [{ name: "read" }, { name: "new" }], timestamp: 1001 });
  const entries = [baseline, update];
  const ops = entriesToOps(entries);
  assert.equal(ops.length, 2, "context has no message.close");
  assert.deepEqual(ops.map((op) => op.answers), [null, null]);
  assert.deepEqual(ops[1].message.context.tools, { added: ["new"], removed: ["old"] });
  const live = [];
  for (const entry of entries) await DurableAdapter.prototype.placed.call({ entries: async () => entries, publish: (_record, op) => live.push(op) },
    { conversation: {} }, entry);
  assert.deepEqual(live, ops);
});

test("notes on array input keep the body and its leading spaces", () => {
  const entry = runtimeEntry(1, "conduit.user", { role: "user", content: [
    { type: "text", text: "<conduit_note>\n  Update\n\nTime  \n</conduit_note>\n\n" },
    { type: "text", text: "  [Approval] Allowed" },
  ] }, { messageId: "u1" });
  const message = applyTranscriptOps({}, entriesToOps([entry])).messages[0];
  assert.equal(message.notes, "Update\n\nTime");
  assert.equal(message.content, "  [Approval] Allowed");
});

test("notes wait with unopened inputs and arrive when their run starts", async () => {
  const entry = runtimeHistory()[0];
  const record = { unopened: new Map(), modes: new Map(), turn: null };
  const ops = [];
  const adapter = { publish: (_record, op) => ops.push(op), beginTurn: () => (record.turn = {
    generationId: "g1", inputs: [], prompts: [], answers: null,
  }), promptIdsFor: async () => ["u1"] };
  await DurableAdapter.prototype.placed.call(adapter, record, entry);
  assert.equal(ops.length, 0);
  await DurableAdapter.prototype.translate.call(adapter, record, { type: "run_start", inputs: [1] });
  const message = ops.find((op) => op.op === "message.open").message;
  assert.equal(message.notes, "Stop &amp; update");
  assert.equal(message.content, "Inspect");
});

test("restating an opened prompt preserves the log tail and context position", () => {
  const log = new ChatLog();
  log.stamp(messageOpen({ id: "u1", role: "user", content: "Inspect" }));
  log.stamp(messageOpen({ id: "a1", role: "assistant", answers: "u1" }));
  log.stamp(messageOpen({ id: "u1", role: "user", content: "Inspect", notes: "Time note" }));
  log.stamp(messageOpen({ id: "c42-4", role: "system", answers: "u1", context: { kind: "update", entryId: 4, sections: [] } }));
  assert.equal(log.entries.at(-1).after, "a1");
  assert.deepEqual(log.stated.messages.map((message) => message.id), ["u1", "a1", "c42-4"]);
});

test("a removed prompt reopened with notes becomes the log tail", () => {
  const log = new ChatLog();
  log.stamp(messageOpen({ id: "u1", role: "user", content: "Inspect" }));
  log.stamp({ type: "transcript_op", op: "message.drop", messageId: "u1", inclusive: true });
  log.stamp(messageOpen({ id: "u1", role: "user", content: "Inspect", notes: "Time note" }));
  log.stamp(messageOpen({ id: "c42-2", role: "system", answers: "u1", context: { kind: "update", entryId: 2, sections: [] } }));
  assert.equal(log.entries.at(-1).after, "u1");
  assert.deepEqual(log.stated.messages.map((message) => message.id), ["u1", "c42-2"]);
});

test("legacy user ops retain the empty-text fallback and old logs replay without new fields", () => {
  const entry = runtimeEntry(1, "conduit.user", { role: "user", content: [{ type: "text", text: "Attached file: /file" }] },
    { messageId: "u1", text: "", timestamp: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(entriesToOps([entry]), [
    { type: "transcript_op", op: "message.open", answers: null, message: { id: "u1", role: "user", content: "Attached file: /file", timestamp: entry.data.timestamp } },
    { type: "transcript_op", op: "turn.settle", promptId: "u1", outcome: "complete" },
  ]);
  const log = new ChatLog();
  const ops = entriesToOps([entry]);
  for (const op of ops) log.stamp(op);
  const replay = applyTranscriptOps({}, log.since(log.id, 0));
  assert.deepEqual(replay, log.stated);
  assert.equal(replay.messages[0].role, "user");
  assert.equal(replay.messages[0].content, "Attached file: /file");
  for (const field of ["context", "notes"]) assert.equal(Object.hasOwn(replay.messages[0], field), false);
});

test("context text route checks the session and resolves tools at the selected entry", async () => {
  const entries = runtimeHistory();
  const reads = [];
  const conversation = {
    entries: async ({ minEntryId, maxEntryId }) => ({ items: entries.filter((entry) => entry.id >= minEntryId && entry.id <= maxEntryId) }),
    context: async (_context, { at }) => { reads.push(at); return { messages: entries.filter((entry) => entry.id <= at).flatMap((entry) => entry.model) }; },
  };
  const foreign = { ...runtimeEntry(777, "pi.system", { role: "system", sections: { instructions: "Other conversation" } }), conversationId: 99 };
  const otherConversation = { entries: async ({ minEntryId, maxEntryId }) => ({ items: foreign.id >= minEntryId && foreign.id <= maxEntryId ? [foreign] : [] }),
    context: async () => ({ messages: foreign.model }) };
  const adapter = Object.create(DurableAdapter.prototype);
  adapter.runtime = { open: async () => ({ conversation: async (id) => id === 42 ? conversation : id === 99 ? otherConversation : null }) };
  const routes = new Map();
  registerSessionContextRoutes({ get: (path, handler) => routes.set(path, handler) }, {
    backends: { forChat: () => adapter }, findChatContext: async (id) => id === "missing" ? null : { chat: { backend: { opaqueSession: id === "run" ? "42" : "99" } } },
  });
  const get = async (id, entryId) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.get("/v0/sessions/:id/context/:entryId")({ params: { id, entryId } }, response, (error) => { throw error; });
    return response;
  };
  const prompt = await get("run", "2");
  assert.equal(prompt.statusCode, 200);
  assert.deepEqual(prompt.body.sections.map((section) => section.text), ["Full prompt", "/work", "Web context"]);
  assert.deepEqual(prompt.body.tools.all, [{ name: "read", description: "Read a file" }]);
  assert.deepEqual(reads, [2]);
  const update = await get("run", "4");
  assert.deepEqual(update.body.tools, { added: [], removed: [], restated: 1 });
  assert.deepEqual(update.body.sections, [{ name: "cwd", text: "/next" }, { name: "web", text: "" }]);
  assert.equal((await get("run", "5")).body.summary, entries[4].model[0].content[0].text);
  entries.push(runtimeEntry(6, "pi.system", { role: "system", toolsAdded: [{ name: "fetch", description: "Fetch a page\nDetails" }] }),
    runtimeEntry(7, "pi.system", { role: "system", sections: { instructions: "Restated prompt" } }));
  assert.deepEqual((await get("run", "7")).body.tools.all, [{ name: "read", description: "Read a file" }, { name: "fetch", description: "Fetch a page" }]);
  const wholePrompt = "Full prompt\n" + "x".repeat(200_000);
  entries.push(runtimeEntry(8, "pi.system", { role: "system", sections: { instructions: wholePrompt } }));
  assert.equal((await get("run", "8")).body.sections[0].text, wholePrompt);
  assert.equal((await get("other", "777")).body.sections[0].text, "Other conversation");
  for (const [id, entryId] of [["missing", "2"], ["other", "2"], ["run", "777"], ["run", "999"], ["run", "1"], ["run", "bad"]]) {
    assert.equal((await get(id, entryId)).statusCode, 404);
  }
});

test("context ops accept system roles and still reject invalid roles and context objects", () => {
  const op = messageOpen({ id: "c42-2", role: "system", context: { kind: "prompt", entryId: 2, sections: [] } });
  assert.equal(assertTranscriptOp(op), op);
  for (const context of [null, [], "prompt"]) assert.throws(() => messageOpen({ id: "c", role: "system", context }), /context must be an object/);
  assert.throws(() => messageOpen({ id: "bad", role: "other" }), /role/);
  assert.throws(() => messageOpen({ id: "bad", role: "assistant", answers: 42 }), /answers/);
});

test("legacy notices establish fixed values silently and name cleared values", async () => {
  const fixed = { person: { name: "Pat", home: "" }, assistant: { name: "Bot" }, timezone: "Australia/Sydney" };
  for (const before of [null, { ...fixed, person: { name: "Pat", home: "Sydney" } }]) {
    const saved = { prompt: null, told: before, time: Date.now(), pending: [], lastEntry: 0 };
    const entries = [], doc = {};
    let admitted;
    const conversation = { id: 42, entries: async () => ({ items: entries }), commit: async (change) => change({ doc: async () => doc }) };
    const runtime = { harness: { snapshot: async () => saved }, agentVars: async () => fixed,
      contextStore: { notice: async (_name, vars) => vars.changes } };
    await submitWithNotes(runtime, conversation, { type: "input", content: "Inspect" }, undefined, { jbot: true, admit: async (input) => {
      admitted = input;
      entries.push(runtimeEntry(1, "conduit.user", { role: "user", content: input.content }, input.entry.data));
      return {};
    } });
    if (before) assert.equal(admitted.content, "<conduit_note>\nthe person's home is no longer set\n</conduit_note>\n\nInspect");
    else assert.equal(admitted.content, "Inspect");
    assert.deepEqual(doc.told, fixed);
  }
});

const axes = {
  persistedRowCount: [1, 8, 32],
  activeMessageCount: [1, 4, 16],
  activeBlockCount: [1, 4, 16],
  activeToolCount: [0, 8, 32],
};

const middle = {
  persistedRowCount: 8,
  activeMessageCount: 4,
  activeBlockCount: 4,
  activeToolCount: 8,
};

function makeProjectionCase({ persistedRowCount, activeMessageCount, activeBlockCount, activeToolCount }) {
  const messages = [];
  for (let index = 0; index < persistedRowCount; index += 1) {
    messages.push({ id: `history-user-${index}`, role: "user", content: `History ${index}` });
    messages.push({ id: `history-assistant-${index}`, role: "assistant", content: `Reply ${index}`, blocks: [],
      answers: `history-user-${index}`, interim: false });
  }
  messages.push({ id: "live-user", role: "user", content: "Inspect this", pending: false });

  const assistantMessages = [];
  for (let messageIndex = 0; messageIndex < activeMessageCount; messageIndex += 1) {
    const blocks = [];
    for (let blockIndex = 0; blockIndex < activeBlockCount; blockIndex += 1) {
      const identity = `g_projection:m${messageIndex}:${blockIndex}`;
      if (messageIndex === 0 && blockIndex === activeBlockCount - 1) {
        blocks.push({ kind: "text", identity, contentIndex: blockIndex, text: "Answer", status: "streaming" });
      } else {
        blocks.push({ kind: "thinking", identity, contentIndex: blockIndex, text: "Plan", status: "complete" });
      }
    }
    assistantMessages.push({ id: `m${messageIndex}`, blocks });
  }

  const tools = Array.from({ length: activeToolCount }, (_, index) => ({
    toolCallId: `tool-${index}`,
    name: "read",
    input: { path: `file-${index}.txt` },
    done: true,
    output: "ok",
    timestamp: new Date(1_000 + index).toISOString(),
  }));
  const generation = {
    id: "g_projection",
    status: "running",
    lastSeq: 1,
    assistantMessages,
    toolExecutions: {},
  };
  return { generation, messages, tools };
}

function summarize(samples) {
  const durations = samples.slice().sort((left, right) => left - right);
  return {
    p50: durations[Math.floor(durations.length * 0.5)],
    p95: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))],
    max: durations.at(-1),
  };
}

function measure(fn) {
  for (let index = 0; index < 2; index += 1) fn();
  const samples = [];
  for (let index = 0; index < 8; index += 1) {
    const startedAt = performance.now();
    fn();
    samples.push(performance.now() - startedAt);
  }
  return summarize(samples);
}

test("narrow projection work stays on the changed live answer row", () => {
  const measurements = [];
  for (const [axis, values] of Object.entries(axes)) {
    for (const value of values) {
      const dimensions = { ...middle, [axis]: value };
      const { generation, messages, tools } = makeProjectionCase(dimensions);
      const index = buildLiveProjectionIndex(generation, messages);
      const target = generation.assistantMessages[0].blocks.at(-1);
      assert.equal(target.kind, "text");
      assert.equal(index.blockLocations.get(target.identity)?.kind, "answer");

      const narrow = measure(() => {
        target.text = `${target.text}!`;
        const row = buildLiveAnswerRow(generation, "m0", index);
        assert.equal(row?.key, "answer:live-user:0");
      });
      const full = measure(() => {
        const rows = buildTurnRows(messages, tools, { activeGeneration: generation });
        assert.ok(rows.length > 0);
      });
      measurements.push({
        axis,
        value,
        persistedRowCount: dimensions.persistedRowCount,
        activeMessageCount: dimensions.activeMessageCount,
        activeBlockCount: dimensions.activeBlockCount,
        activeToolCount: dimensions.activeToolCount,
        fullRowCount: buildTurnRows(messages, tools, { activeGeneration: generation }).length,
        narrowChangedRowCount: 1,
        fullDurationMs: full,
        narrowDurationMs: narrow,
      });
    }
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    fixtureId: "slice3-timeline-projection-benchmark",
    runtime: process.version,
    axes,
    measurements,
  }));
});
