/**
 * What an OpenCode chat ends up looking like, driven through the real pipeline.
 *
 * The OpenCode service is faked where Conduit meets it -- its HTTP routes and
 * its `/api/event` stream, in the shapes OpenCode 2.0.14 was recorded sending --
 * and everything after that is real: the adapter, the chat log, the command
 * handling, the neutral-event normalizers, the live generation fold and the
 * client projection. The Pi and Codex versions of this file are
 * `transcript-pipeline.test.js` and `codex-transcript-pipeline.test.js`.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { OpenCodeAdapter } from "../src/opencode-adapter.js";
import { reduceActiveGeneration } from "../src/active-generation.js";
import { ChatLogs } from "../src/server/chat-log.js";
import { createLiveSessionStream } from "../src/server/live-session-stream.js";
import { applyTranscriptOps } from "../src/transcript-fold.js";
import { isStructuredGenerationEvent, normalizeLiveEvent } from "../src/client/api/live-events.ts";
import { applyToolOp, applyTranscriptOp, isToolOp } from "../src/client/timeline-order.ts";
import { buildTurnRows } from "../src/client/turn-rows.ts";

const lifecycle = { run: (_chatId, operation) => operation(), assertAvailable: () => {} };
const ledger = () => ({
  owns: () => false, load: async () => ({}), claim: async () => null, bind: async () => null,
  release: async () => {}, resolver: async () => (id) => id, entryIdFor: async (_p, _c, id) => id,
});

/** The OpenCode service: what it has saved, and the routes Conduit reads it through. */
function service() {
  const rows = [];
  const route = async (method, path, { body, query = {}, whole = false } = {}) => {
    if (method === "POST" && path.endsWith("/prompt")) {
      rows.push({ id: body.id, type: "user", text: body.text, files: [], agents: [], time: { created: Date.now() } });
      return null;
    }
    if (method === "GET" && /\/message$/.test(path)) {
      const newest = [...rows].reverse().slice(0, Number(query.limit) || 100);
      const result = { data: newest, cursor: {} };
      return whole ? result : result.data;
    }
    const one = path.match(/\/message\/([^/]+)$/);
    if (method === "GET" && one) return rows.find((row) => row.id === decodeURIComponent(one[1])) || null;
    if (method === "GET" && /\/(permission|form)$/.test(path)) return [];
    if (method === "GET") return { id: "ses_1", title: "Story" };
    return null;
  };
  return { rows, route };
}

function harness() {
  const chatLogs = new ChatLogs();
  const adapter = new OpenCodeAdapter({ logs: chatLogs });
  const saved = service();
  adapter.request = saved.route;
  adapter.ensureStream = async () => {};
  const project = { id: "project-1", kind: "workspace", slug: "p", path: "/tmp/p", workingRoot: "/tmp/p" };
  const record = adapter.record({ chatId: "chat-1", project,
    session: { id: "ses_1", location: { directory: "/tmp/p" }, model: { providerID: "opencode", id: "muse" } } });
  const chat = { id: "chat-1", title: "OpenCode", status: "active", backend: { implementation: "opencode" } };

  // The browser: the statements decide what the transcript holds, and the paint
  // is folded into the turn being written, which is what streams on screen.
  let messages = [];
  let tools = [];
  let generation = null;
  const errors = [];
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = (frame) => {
    const raw = JSON.parse(frame);
    if (raw.type === "error") { errors.push(raw); return; }
    const wire = normalizeLiveEvent(raw);
    if (wire.type === "transcript_op") {
      if (isToolOp(wire)) tools = applyToolOp(tools, wire);
      else messages = applyTranscriptOp(messages, wire);
    }
    if (isStructuredGenerationEvent(wire)) generation = reduceActiveGeneration(generation, wire);
  };
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {
      resolveMany: async () => [], pathFor: () => "", recordMessage: async () => {},
      decorateMessages: async (_p, _c, list) => list, discardMessages: async () => {},
    },
    registry: { metadata: () => chat, markUserMessage: async () => {}, update: async () => chat },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    messageIds: ledger(),
    chatLogs,
    backends: { get: () => record, forChat: () => adapter, adapterForRecord: () => adapter },
  });
  stream.handleUpgrade(record.id, {}, {}, null);

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  let messageCount = 0;
  return {
    saved: saved.rows,
    settle,
    /** Send a prompt the way the browser does, under the name it already drew it with. */
    send: async (message) => {
      ws.emit("message", JSON.stringify({ type: "prompt", message, messageId: `m_00000000-0000-4000-8000-00000000000${++messageCount}` }));
      await settle();
    },
    /** An event on OpenCode's `/api/event` stream. */
    oc: (type, data = {}) => adapter.dispatch({ type, created: Date.now(), data: { sessionID: "ses_1", ...data } }),
    /** What is on screen now, including the answer still being written. */
    streaming: (messageId) => generation?.assistantMessages.find((message) => message.id === messageId)?.blocks
      .map((block) => `${block.kind}: ${block.text}`) || [],
    /** The rows on screen now, with the turn being written laid over them. */
    screen: () => buildTurnRows(messages, tools, { activeGeneration: generation }),
    rows: () => {
      assert.deepEqual(errors, [], "the server reported an error");
      return buildTurnRows(messages, tools);
    },
    /** What a reload shows: the saved transcript, with the chat log's tail folded over it, as GET /v0/sessions/:id does. */
    reload: async ({ log = true } = {}) => {
      const projection = await adapter.readTranscript({ liveSessionId: record.id });
      const view = log ? { ...projection, ...applyTranscriptOps(projection, chatLogs.peek("chat-1")?.entries || []) } : projection;
      return buildTurnRows(view.messages, view.tools);
    },
  };
}

const shape = (rows) => rows.map((row) => (row.type === "trace"
  ? `trace(${row.value.status})`
  : `${row.value.role}: ${row.value.content}`));

/** OpenCode saves a step when it ends; the test states what it saved. */
function saveStep(chat, id, content, finish) {
  chat.saved.push({ id, type: "assistant", content, finish,
    model: { providerID: "opencode", id: "muse" }, time: { created: Date.now(), completed: Date.now() } });
}

/** The recorded sequence of a turn that thinks, then answers in one step. */
async function storyTurn(chat) {
  await chat.send("Tell me a short story");
  chat.oc("session.execution.started");
  chat.oc("session.step.started", { assistantMessageID: "msg_a1" });
  chat.oc("session.reasoning.started", { assistantMessageID: "msg_a1", ordinal: 0 });
  chat.oc("session.reasoning.delta", { assistantMessageID: "msg_a1", ordinal: 0, delta: "A relay." });
  chat.oc("session.reasoning.ended", { assistantMessageID: "msg_a1", ordinal: 0, text: "A relay." });
  chat.oc("session.text.started", { assistantMessageID: "msg_a1", ordinal: 0 });
  chat.oc("session.text.delta", { assistantMessageID: "msg_a1", ordinal: 0, delta: "The relay " });
  await chat.settle();
  const midway = chat.streaming("msg_a1");
  chat.oc("session.text.delta", { assistantMessageID: "msg_a1", ordinal: 0, delta: "hummed." });
  chat.oc("session.text.ended", { assistantMessageID: "msg_a1", ordinal: 0, text: "The relay hummed." });
  saveStep(chat, "msg_a1", [{ type: "reasoning", text: "A relay." }, { type: "text", text: "The relay hummed." }], "stop");
  chat.oc("session.step.ended", { assistantMessageID: "msg_a1", finish: "stop" });
  chat.oc("session.execution.succeeded");
  await chat.settle();
  return midway;
}

/** A turn that reads a file in one step and answers in the next. */
async function toolTurn(chat) {
  await chat.send("read haiku.txt");
  chat.oc("session.execution.started");
  chat.oc("session.step.started", { assistantMessageID: "msg_b1" });
  chat.oc("session.tool.input.started", { assistantMessageID: "msg_b1", id: "call_1", name: "read" });
  chat.oc("session.tool.called", { assistantMessageID: "msg_b1", id: "call_1", input: { path: "haiku.txt" } });
  chat.oc("session.tool.success", { assistantMessageID: "msg_b1", id: "call_1", content: [{ type: "text", text: "1: Moonlight" }] });
  saveStep(chat, "msg_b1", [{ type: "tool", id: "call_1", name: "read",
    state: { status: "completed", input: { path: "haiku.txt" }, content: [{ type: "text", text: "1: Moonlight" }] } }], "tool-calls");
  chat.oc("session.step.ended", { assistantMessageID: "msg_b1", finish: "tool-calls" });
  chat.oc("session.step.started", { assistantMessageID: "msg_b2" });
  chat.oc("session.text.started", { assistantMessageID: "msg_b2", ordinal: 0 });
  chat.oc("session.text.delta", { assistantMessageID: "msg_b2", ordinal: 0, delta: "Haikus." });
  saveStep(chat, "msg_b2", [{ type: "text", text: "Haikus." }], "stop");
  chat.oc("session.step.ended", { assistantMessageID: "msg_b2", finish: "stop" });
  chat.oc("session.execution.succeeded");
  await chat.settle();
}

const TWO_TURNS = [
  "user: Tell me a short story",
  "trace(complete)",
  "assistant: The relay hummed.",
  "user: read haiku.txt",
  "trace(complete)",
  "assistant: Haikus.",
];

test("the thinking and the answer stream as OpenCode writes them", async () => {
  const chat = harness();
  const midway = await storyTurn(chat);
  assert.deepEqual(midway, ["thinking: A relay.", "text: The relay "]);
});

test("a live chat reads each prompt once, above its answer", async () => {
  const chat = harness();
  await storyTurn(chat);
  await toolTurn(chat);
  assert.deepEqual(shape(chat.rows()), TWO_TURNS);
});

test("a reload reads each prompt once, above its answer", async () => {
  const chat = harness();
  await storyTurn(chat);
  await toolTurn(chat);
  assert.deepEqual(shape(await chat.reload()), TWO_TURNS);
});

test("OpenCode's saved copy alone keeps every prompt's words, after the chat log is gone", async () => {
  const chat = harness();
  await storyTurn(chat);
  await toolTurn(chat);
  assert.deepEqual(shape(await chat.reload({ log: false })), TWO_TURNS);
});

test("a tool shows in the turn's trace while it runs", async () => {
  const chat = harness();
  await chat.send("run a foregrounded sleep for 20 seconds");
  chat.oc("session.execution.started");
  chat.oc("session.step.started", { assistantMessageID: "msg_c1" });
  chat.oc("session.tool.input.started", { assistantMessageID: "msg_c1", id: "call_sleep", name: "bash" });
  chat.oc("session.tool.called", { assistantMessageID: "msg_c1", id: "call_sleep", input: { command: "sleep 20" } });
  await chat.settle();
  const trace = chat.screen().find((row) => row.type === "trace");
  assert.ok(trace, "no trace on screen while the tool runs");
  assert.deepEqual(trace.value.segments.map((segment) => `${segment.kind}: ${segment.tool?.name || ""}`), ["tool: bash"]);
});
