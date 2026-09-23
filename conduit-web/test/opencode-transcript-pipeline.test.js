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
  const permissions = [];
  const forms = [];
  const replies = [];
  const refuse = (message) => Object.assign(new Error(message), { code: "backend_unavailable", status: 400 });
  const route = async (method, path, { body, query = {}, whole = false } = {}) => {
    // Checked as OpenCode checks it: a `per_` id that is still pending, and a decision it knows.
    const reply = path.match(/\/permission\/([^/]+)\/reply$/);
    if (method === "POST" && reply) {
      const id = decodeURIComponent(reply[1]);
      if (!id.startsWith("per")) throw refuse('Expected a string starting with "per" at ["requestID"]');
      if (!["once", "always", "reject"].includes(body?.decision)) throw refuse('Missing key at ["decision"]');
      const index = permissions.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error("PermissionNotFoundError"), { code: "backend_session_not_found", status: 404 });
      permissions.splice(index, 1);
      replies.push({ id, decision: body.decision });
      return null;
    }
    if (method === "GET" && path.endsWith("/permission")) return [...permissions];
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
    const form = path.match(/\/form\/([^/]+)\/reply$/);
    if (method === "POST" && form) {
      const id = decodeURIComponent(form[1]);
      const index = forms.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error("FormNotFoundError"), { code: "backend_session_not_found", status: 404 });
      if (!body?.answer || typeof body.answer !== "object") throw refuse('Missing key at ["answer"]');
      forms.splice(index, 1);
      replies.push({ id, answer: body.answer });
      return null;
    }
    if (method === "GET" && path.endsWith("/form")) return [...forms];
    if (method === "GET") return { id: "ses_1", title: "Story" };
    return null;
  };
  return { rows, permissions, forms, replies, route };
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
  let asked = [];
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
    if (wire.type === "permission_request" && wire.request) asked = [...asked, wire.request];
    if (wire.type === "permission_resolved") asked = asked.filter((request) => request.id !== raw.requestId);
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
    service: saved,
    adapter,
    record,
    settle,
    errors,
    /** The prompts on screen, as the card is handed them. */
    asked: () => asked,
    /** Click one of a prompt's options, or submit a question card's answers, the way the card does. */
    answer: async (request, option) => {
      const response = typeof option === "string" ? { value: option } : option;
      ws.emit("message", JSON.stringify({ type: "extension_ui_response", id: request.id, ...response }));
      await settle();
    },
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
    /** The History pane's steps, oldest first, without the hidden ones. */
    history: async () => {
      const lines = [];
      for (let node = (await adapter.readHistory({ liveSessionId: record.id })).tree[0]; node; node = node.children[0]) {
        if (!node.entry.hidden) lines.push(node.entry.display);
      }
      return lines;
    },
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

test("History lists each tool call as a step of its own, as it does for Pi", async () => {
  const chat = harness();
  await toolTurn(chat);
  assert.deepEqual(await chat.history(), ["user: read haiku.txt", "[read: haiku.txt]", "assistant: Haikus."]);
});

/** Recorded from OpenCode 2.0.14: an edit held for approval, and the question tool's form. */
const EDIT_PERMISSION = { id: "per_1", sessionID: "ses_1", action: "edit", resources: ["perm2.txt"], save: ["*"],
  metadata: {}, source: { type: "tool", messageID: "msg_x", id: "call_x" } };
const QUESTION_FORM = { id: "frm_1", sessionID: "ses_1", title: "Questions", metadata: { kind: "question" },
  fields: [{ key: "q0", title: "Drink Preference", description: "Do you prefer tea or coffee?", type: "string", custom: true,
    options: [{ value: "Tea", label: "Tea", description: "Hot brewed tea" }, { value: "Coffee", label: "Coffee", description: "Hot brewed coffee" }] }] };
// A second question, stated as OpenCode's Form.MultiselectField schema states one.
const SNACK_FIELD = { key: "q1", title: "Snacks", description: "Which snacks?", type: "multiselect", custom: true,
  options: [{ value: "Biscuits", label: "Biscuits" }, { value: "Cake", label: "Cake" }] };

async function waiting(chat) {
  await chat.send("make the edit");
  chat.oc("session.execution.started");
}

test("an edit held for approval offers words, and the choice reaches OpenCode", async () => {
  const chat = harness();
  await waiting(chat);
  chat.service.permissions.push(EDIT_PERMISSION);
  chat.oc("permission.asked", { id: "per_1" });
  await chat.settle();
  const [request] = chat.asked();
  assert.deepEqual(request.options, ["Allow once", "Always allow", "Reject"]);
  await chat.answer(request, "Always allow");
  assert.deepEqual(chat.service.replies, [{ id: "per_1", decision: "always" }]);
  assert.deepEqual(chat.asked(), []);
  assert.deepEqual(chat.errors, []);
});

test("a form is asked as questions, and each answer reaches OpenCode under its field's key", async () => {
  const chat = harness();
  await waiting(chat);
  chat.service.forms.push({ ...QUESTION_FORM, fields: [...QUESTION_FORM.fields, SNACK_FIELD] });
  chat.oc("form.created", { id: "frm_1" });
  await chat.settle();
  const [request] = chat.asked();
  assert.equal(request.kind, "question");
  assert.deepEqual(request.questions.map((question) => [question.id, question.prompt, question.multiSelect,
    question.options.map((option) => option.label), Boolean(question.freeform)]), [
    ["q0", "Do you prefer tea or coffee?", false, ["Tea", "Coffee"], true],
    ["q1", "Which snacks?", true, ["Biscuits", "Cake"], true]]);
  await chat.answer(request, { answers: [{ questionId: "q0", optionIds: ["1"] },
    { questionId: "q1", optionIds: ["0"], freeform: "Scones" }] });
  assert.deepEqual(chat.service.replies, [{ id: "frm_1", answer: { q0: "Coffee", q1: ["Biscuits", "Scones"] } }]);
  assert.deepEqual(chat.errors, []);
});

test("a reply OpenCode refuses is reported to the browser, and the server keeps running", async () => {
  const chat = harness();
  await waiting(chat);
  chat.service.permissions.push(EDIT_PERMISSION);
  chat.oc("permission.asked", { id: "per_1" });
  await chat.settle();
  const [request] = chat.asked();
  // Answered elsewhere -- OpenCode's own TUI -- before this reply arrived.
  chat.service.permissions.length = 0;
  await chat.answer(request, "Allow once");
  assert.equal(chat.errors.length, 1);
});

test("auto accept answers each edit once, as OpenCode's TUI does, and still asks questions", async () => {
  const chat = harness();
  const modes = await chat.adapter.listAvailablePermissionModes();
  assert.deepEqual(modes.map((mode) => mode.id), ["prompt", "autoaccept"]);
  await chat.adapter.setPermissionMode(chat.record.id, modes[1]);
  await waiting(chat);
  chat.service.permissions.push(EDIT_PERMISSION);
  chat.service.forms.push(QUESTION_FORM);
  chat.oc("permission.asked", { id: "per_1" });
  await chat.settle();
  assert.deepEqual(chat.service.replies, [{ id: "per_1", decision: "once" }]);
  assert.deepEqual(chat.asked().map((request) => request.id), ["frm_1"]);
});
