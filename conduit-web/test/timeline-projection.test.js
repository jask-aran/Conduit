import assert from "node:assert/strict";
import test from "node:test";
import { DurableAdapter, entriesToOps } from "../src/durable-adapter.js";
import { applyTranscriptOp, applyTranscriptOps } from "../src/transcript-fold.js";
import { messageOpen } from "../src/harnesses/transcript-ops.js";
import { ChatLog } from "../src/server/chat-log.js";
import { registerSessionContextRoutes } from "../src/server/routes/session-context.js";
import { buildTurnRows } from "../src/client/turn-rows.ts";

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
  assert.deepEqual(update.body.sections, [{ name: "cwd", text: "/next" }, { name: "web", text: "", removed: true }]);
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
