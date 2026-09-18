/**
 * What a Codex chat ends up looking like, driven through the real pipeline.
 *
 * The app-server (faked at its JSON-RPC wire), the real adapter, the real chat
 * log, the real command handling, the real neutral-event normalizers and the
 * real client projection. Nothing here describes what the code does; it
 * describes what should be on screen, and every layer between the wire and the
 * rows has to agree for the assertions to hold.
 *
 * The Pi version of this file is `transcript-pipeline.test.js`. The two
 * harnesses reach the transcript by completely different routes -- Pi over its
 * own stdio protocol with Conduit-minted names, Codex over app-server
 * notifications carrying its own -- so the same scenarios are written twice
 * rather than shared. What has to match is the answer, not the path.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CodexAppServerAdapter } from "../src/codex-app-server-adapter.js";
import { ChatLogs } from "../src/server/chat-log.js";
import { createLiveSessionStream } from "../src/server/live-session-stream.js";
import { normalizeLiveEvent } from "../src/client/api/live-events.ts";
import { applyTranscriptOp, mergeToolEvent } from "../src/client/timeline-order.ts";
import { buildTurnRows } from "../src/client/turn-rows.ts";

const lifecycle = { run: (_chatId, operation) => operation(), assertAvailable: () => {} };

/** Codex names its own items, so Conduit's ledger owns nothing here. */
const ledger = () => ({
  owns: () => false,
  load: async () => ({}),
  claim: async () => null,
  bind: async () => null,
  release: async () => {},
  resolver: async () => (id) => id,
  entryIdFor: async (_project, _chat, id) => id,
});

function harness() {
  const chatLogs = new ChatLogs();
  const adapter = new CodexAppServerAdapter({ logs: chatLogs });
  const sent = [];
  // Every request is answered, but a turn/start is held until the test releases
  // it: Codex begins the turn when it reads the request, not when it gets round
  // to acknowledging it, and the transcript has to survive the gap.
  const held = [];
  const record = adapter.sessions.add({
    id: "live-1", chatId: "chat-1", sessionId: "thread-1", status: "running", activity: "idle",
    active: false, stopping: false, generation: null, clients: new Set(), events: [],
    pending: new Map(), approvals: new Map(), steering: [], followUp: [], hostUiRequests: [],
    sequence: 0, eventSequence: 0, messageIds: new Set(),
    child: { stdin: { writable: true, write: (line) => {
      const message = JSON.parse(line);
      sent.push(message);
      if (message.method === "turn/start") { held.push(message); return; }
      queueMicrotask(() => adapter.receive(record, JSON.stringify({ id: message.id, result: {} })));
    } } },
  });
  const chat = { id: "chat-1", title: "Codex", status: "active", backend: { implementation: "codex" } };
  const project = { id: "project-1", kind: "workspace", slug: "p", path: "/tmp/p", workingRoot: "/tmp/p" };

  // The client, as far as the transcript is concerned.
  let messages = [];
  let tools = [];
  const errors = [];
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = (frame) => {
    const raw = JSON.parse(frame);
    if (raw.type === "client_error" || raw.type === "error") { errors.push(raw); return; }
    const wire = normalizeLiveEvent(raw);
    if (wire.type === "transcript_op") messages = applyTranscriptOp(messages, wire);
    if (wire.type.startsWith("tool_execution_")) {
      tools = mergeToolEvent(tools, {
        type: wire.type === "tool_execution_started" ? "tool_execution_start"
          : wire.type === "tool_execution_updated" ? "tool_execution_update" : "tool_execution_end",
        toolCallId: wire.toolCallId, toolName: wire.name, args: wire.arguments, result: wire.result,
      }).tools;
    }
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
  /** A notification from the app-server, over the wire the adapter reads. */
  const codex = (method, params = {}) => adapter.receive(record, JSON.stringify({ method, params }));
  const read = async () => {
    for (let attempt = 0; attempt < 50 && !held.length; attempt += 1) await settle();
    assert.ok(held.length, "Codex was never given the turn");
  };
  /** A request FROM the app-server, which Conduit has to answer. */
  const request = (id, method, params) => adapter.receive(record, JSON.stringify({ id, method, params }));
  const codex_reject = (id, message) => adapter.receive(record, JSON.stringify({ id, error: { message } }));
  // The turn id Codex answered the last turn/start with, which is what its
  // notifications will carry.
  let turnId = null;
  const accept = async () => {
    while (held.length) {
      const message = held.shift();
      turnId = `turn-${message.id}`;
      adapter.receive(record, JSON.stringify({ id: message.id, result: { turn: { id: turnId } } }));
    }
    await settle();
  };
  const send = async (command) => {
    ws.emit("message", JSON.stringify(command));
    if (["prompt", "interrupt_and_send", "follow_up", "steer"].includes(command.type)) {
      if (command.type === "prompt" || command.type === "interrupt_and_send") { await read(); await accept(); }
    }
    await settle();
  };
  const begin = (command) => { ws.emit("message", JSON.stringify(command)); return read(); };
  const dispatch = (command) => { ws.emit("message", JSON.stringify(command)); };

  return {
    codex, codex_reject, request, send, begin, dispatch, read, accept, settle, sent, errors, record,
    turnId: () => turnId,
    rows: () => {
      assert.deepEqual(errors, [], "the server reported an error");
      return buildTurnRows(messages, tools);
    },
    messages: () => messages,
  };
}

/** The app-server's shape for a turn that streams one message and ends. */
function agentMessage(codex, turnId, itemId, text, { phase = "final_answer" } = {}) {
  codex("item/agentMessage/delta", { turnId, itemId, delta: text });
  codex("item/completed", { turnId, item: { id: itemId, type: "agentMessage", text, phase } });
}

const shape = (rows) => rows.map((row) => (row.type === "trace"
  ? `trace(${row.value.status})`
  : `${row.value.role}: ${row.value.content}`));

const order = (messages) => messages.map((message) => `${message.role}:${(message.content || "").slice(0, 16)}`);

test("a plain turn reads as prompt then answer", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Fix the build" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  agentMessage(chat.codex, turn, "a1", "Built.");
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Fix the build",
    "assistant: Built.",
  ]);
});

test("an answer that begins before its turn is accepted still sits under its prompt", async () => {
  const chat = harness();
  // Codex starts writing while the turn/start reply is still in flight.
  await chat.begin({ type: "prompt", message: "Fix the build" });
  chat.codex("turn/started", { turn: { id: "turn-early" } });
  agentMessage(chat.codex, "turn-early", "a1", "Built.");
  await chat.settle();
  await chat.accept();
  chat.codex("turn/completed", { turn: { id: "turn-early", status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Fix the build",
    "assistant: Built.",
  ]);
  assert.deepEqual(order(chat.messages()), ["user:Fix the build", "assistant:Built."]);
});

test("commentary and the commands it ran collapse into the turn's trace, and the answer stays out of it", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Fix the build" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "Looking now." });
  chat.codex("item/completed", { turnId: turn, item: { id: "a1", type: "agentMessage", text: "Looking now.", phase: "commentary" } });
  chat.codex("item/started", { turnId: turn, item: { id: "e1", type: "commandExecution", command: "npm run build" } });
  chat.codex("item/completed", { turnId: turn, item: { id: "e1", type: "commandExecution", command: "npm run build", aggregatedOutput: "ok", status: "completed" } });
  agentMessage(chat.codex, turn, "a2", "Built.");
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  const rows = chat.rows();
  assert.deepEqual(shape(rows), [
    "user: Fix the build",
    "trace(complete)",
    "assistant: Built.",
  ]);
  // The commentary and the command it ran belong to the turn that produced
  // them, in that order -- not to a neighbouring turn, and not to the answer.
  assert.deepEqual(rows[1].value.segments.map((segment) => segment.kind), ["narration", "tool"]);
  assert.equal(rows[1].value.segments[0].text, "Looking now.");
});

test("an interrupted answer keeps its text, and the next turn is its own", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "The rain fell upward." });
  await chat.settle();

  chat.dispatch({ type: "stop_generation" });
  await chat.settle();
  // Codex reports what it had written, then ends the turn.
  chat.codex("item/completed", { turnId: turn, item: { id: "a1", type: "agentMessage", text: "The rain fell upward.", phase: "final_answer" } });
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  await chat.send({ type: "prompt", message: "now stop" });
  const second = chat.turnId();
  chat.codex("turn/started", { turn: { id: second } });
  agentMessage(chat.codex, second, "a2", "Got it — stopping.");
  chat.codex("turn/completed", { turn: { id: second, status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    "assistant: The rain fell upward.",
    "user: now stop",
    "assistant: Got it — stopping.",
  ]);
  assert.deepEqual(order(chat.messages()), [
    "user:Tell me a long s", "assistant:The rain fell up", "user:now stop", "assistant:Got it — stoppin",
  ]);
});

test("an answer named and then cut off before its first token leaves no blank row", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  // Named by a delta that carried nothing, then the turn ends with no item.
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "" });
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), ["user: Tell me a long story"]);
});

test("a steered message is a message of its own, and the answer answers it", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "The rain fell upward." });
  chat.codex("item/completed", { turnId: turn, item: { id: "a1", type: "agentMessage", text: "The rain fell upward.", phase: "commentary" } });
  await chat.settle();

  await chat.send({ type: "steer", message: "make it shorter" });
  const steered = chat.sent.find((message) => message.method === "turn/steer");
  assert.ok(steered, "the steer reached Codex");
  // Codex commits the steered message into the running turn under the id it
  // was handed, then answers it.
  chat.codex("item/started", { turnId: turn, item: { id: "u2", clientId: steered.params.clientUserMessageId, type: "userMessage", content: [{ type: "text", text: "make it shorter" }] } });
  agentMessage(chat.codex, turn, "a2", "Rain. Upward.");
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    "trace(complete)",
    "user: make it shorter",
    "assistant: Rain. Upward.",
  ]);
});

test("a follow-up sent while the turn runs waits, and then becomes its own turn", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Fix the build" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  await chat.send({ type: "follow_up", message: "and run the tests" });
  // Still queued: nothing of it is in the transcript yet.
  assert.deepEqual(shape(chat.rows()), ["user: Fix the build"]);

  agentMessage(chat.codex, turn, "a1", "Built.");
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.read();
  await chat.accept();
  await chat.settle();
  const second = chat.turnId();
  chat.codex("turn/started", { turn: { id: second } });
  agentMessage(chat.codex, second, "a2", "All green.");
  chat.codex("turn/completed", { turn: { id: second, status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Fix the build",
    "assistant: Built.",
    "user: and run the tests",
    "assistant: All green.",
  ]);
});

test("a turn that only runs commands carries them without inventing an answer", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Run the tests" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  chat.codex("item/started", { turnId: turn, item: { id: "e1", type: "commandExecution", command: "npm test" } });
  chat.codex("item/completed", { turnId: turn, item: { id: "e1", type: "commandExecution", command: "npm test", aggregatedOutput: "864 passing", status: "completed" } });
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), ["user: Run the tests", "trace(complete)"]);
});

test("a prompt Codex refuses takes back the row it stated", async () => {
  const chat = harness();
  chat.dispatch({ type: "prompt", message: "Fix the build" });
  await chat.read();
  const request = chat.sent.find((message) => message.method === "turn/start");
  chat.codex_reject(request.id, "refused");
  await chat.settle();

  // The failure is reported, and the prompt is not left sitting in a
  // transcript that no turn will ever answer.
  assert.deepEqual(chat.errors.map((event) => event.message), ["refused"]);
  assert.deepEqual(buildTurnRows(chat.messages(), []), []);
});

test("a turn pauses for an approval and carries on into its answer", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Clean the tree" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "Removing build." });
  chat.codex("item/completed", { turnId: turn, item: { id: "a1", type: "agentMessage", text: "Removing build.", phase: "commentary" } });
  // The app-server asks before running the command, over the same wire.
  chat.request(7, "item/commandExecution/requestApproval",
    { approvalId: "ap-1", turnId: turn, command: "rm -rf build", reason: "Cleaning the tree" });
  await chat.settle();
  assert.equal(chat.record.activity, "waiting_for_user");

  chat.dispatch({ type: "host_ui_response", id: "ap-1", value: "Approve" });
  await chat.settle();
  assert.equal(chat.record.activity, "working", "the turn resumes once the prompt clears");

  chat.codex("item/started", { turnId: turn, item: { id: "e1", type: "commandExecution", command: "rm -rf build" } });
  chat.codex("item/completed", { turnId: turn, item: { id: "e1", type: "commandExecution", command: "rm -rf build", aggregatedOutput: "", status: "completed" } });
  agentMessage(chat.codex, turn, "a2", "Tree is clean.");
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Clean the tree",
    "trace(complete)",
    "assistant: Tree is clean.",
  ]);
});

test("reasoning is the turn thinking, not an answer of its own", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Fix the build" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  chat.codex("item/reasoning/summaryTextDelta", { turnId: turn, itemId: "r1", summaryIndex: 0, delta: "Checking the log." });
  chat.codex("item/completed", { turnId: turn, item: { id: "r1", type: "reasoning", summary: [{ type: "summary_text", text: "Checking the log." }] } });
  agentMessage(chat.codex, turn, "a1", "Built.");
  chat.codex("turn/completed", { turn: { id: turn, status: "completed" } });
  await chat.settle();

  const rows = chat.rows();
  assert.deepEqual(shape(rows), ["user: Fix the build", "trace(complete)", "assistant: Built."]);
  assert.deepEqual(rows[1].value.segments.map((segment) => segment.kind), ["thinking"]);
});

test("a turn Codex reports as failed leaves what it wrote in place", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Fix the build" });
  const turn = chat.turnId();
  chat.codex("turn/started", { turn: { id: turn } });
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "Half an ans" });
  chat.codex("turn/completed", { turn: { id: turn, status: "failed", error: { message: "upstream refused" } } });
  await chat.settle();

  assert.deepEqual(chat.errors.map((event) => event.error?.message), ["upstream refused"]);
  // Nothing was written into the row it named, so no blank answer is left.
  assert.deepEqual(buildTurnRows(chat.messages(), []).map((row) => row.type), ["message"]);
});
