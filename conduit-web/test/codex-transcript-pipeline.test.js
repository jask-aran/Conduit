/** What a Codex chat ends up looking like, driven through the real pipeline. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CodexAppServerAdapter } from "../src/codex-app-server-adapter.js";
import { ChatLogs } from "../src/server/chat-log.js";
import { createLiveSessionStream } from "../src/server/live-session-stream.js";
import { normalizeLiveEvent } from "../src/client/api/live-events.ts";
import { applyToolOp, applyTranscriptOp, isToolOp, mergeToolEvent } from "../src/client/timeline-order.ts";
import { buildTurnRows } from "../src/client/turn-rows.ts";

const lifecycle = { run: (_chatId, operation) => operation(), assertAvailable: () => {} };

/** Codex names its own items, so Conduit's ledger owns nothing here. */
const ledger = () => ({
  owns: () => false, load: async () => ({}), claim: async () => null, bind: async () => null, release: async () => {},
  resolver: async () => (id) => id, entryIdFor: async (_project, _chat, id) => id,
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
    active: false, stopping: false, generation: null, clients: new Set(), events: [], pending: new Map(),
    steering: [], followUp: [], rpcRequestId: 0, generationSeq: 0, messageIds: new Set(),
    child: { stdin: { writable: true, write: (line) => {
      const message = JSON.parse(line);
      sent.push(message);
      if (message.method === "turn/start") { held.push(message); return; }
      queueMicrotask(() => adapter.receive(record, JSON.stringify({ id: message.id, result: {} })));
    } } },
  });
  const chat = { id: "chat-1", title: "Codex", status: "active", backend: { implementation: "codex" } };
  const project = { id: "project-1", kind: "workspace", slug: "p", path: "/tmp/p", workingRoot: "/tmp/p" };

  let messages = [];
  let tools = [];
  const errors = [];
  const ws = Object.assign(new EventEmitter(), { readyState: 1 });
  ws.send = (frame) => {
    const raw = JSON.parse(frame);
    if (raw.type === "error") { errors.push(raw); return; }
    const wire = normalizeLiveEvent(raw);
    // Exactly what the browser does with these: the statements decide what the
    // transcript holds, and live activity only paints output arriving while a
    // tool is still running.
    if (wire.type === "transcript_op") {
      if (isToolOp(wire)) tools = applyToolOp(tools, wire);
      else messages = applyTranscriptOp(messages, wire);
    }
    if (wire.type === "tool_execution_updated") {
      const { toolCallId, name, input, output } = wire;
      tools = mergeToolEvent(tools, { type: "tool_execution_update", toolCallId, name, input, output }).tools;
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
  const codex = (method, params = {}) => adapter.receive(record, JSON.stringify({ method, params }));
  const read = async () => {
    for (let attempt = 0; attempt < 50 && !held.length; attempt += 1) await settle();
    assert.ok(held.length, "Codex was never given the turn");
  };
  const request = (id, method, params) => adapter.receive(record, JSON.stringify({ id, method, params }));
  const codex_reject = (id, message) => adapter.receive(record, JSON.stringify({ id, error: { message } }));
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
    if (command.type === "prompt") { await read(); await accept(); }
    await settle();
  };
  const begin = (command) => { ws.emit("message", JSON.stringify(command)); return read(); };
  const dispatch = (command) => { ws.emit("message", JSON.stringify(command)); };

  return {
    codex, codex_reject, request, send, begin, dispatch, read, accept, settle, sent, errors, record,
    turnId: () => turnId,
    /** A prompt Codex accepts and starts; its turn id. */
    prompt: async (message) => {
      await send({ type: "prompt", message });
      codex("turn/started", { turn: { id: turnId } });
      return turnId;
    },
    complete: (turn, status = "completed") => codex("turn/completed", { turn: { id: turn, status } }),
    // Everything the chat's log kept, which is what a browser that lost the
    // socket is replayed when it asks to be caught up.
    replay: () => {
      let replayed = [];
      let replayedTools = [];
      for (const entry of chatLogs.get("chat-1").entries) {
        const wire = normalizeLiveEvent(JSON.parse(JSON.stringify(entry)));
        if (wire.type !== "transcript_op") continue;
        if (isToolOp(wire)) replayedTools = applyToolOp(replayedTools, wire);
        else replayed = applyTranscriptOp(replayed, wire);
      }
      return buildTurnRows(replayed, replayedTools);
    },
    rows: () => (assert.deepEqual(errors, [], "the server reported an error"), buildTurnRows(messages, tools)),
    messages: () => messages,
  };
}

function agentMessage(codex, turnId, itemId, text, { phase = "final_answer" } = {}) {
  codex("item/agentMessage/delta", { turnId, itemId, delta: text });
  codex("item/completed", { turnId, item: { id: itemId, type: "agentMessage", text, phase } });
}

function command(codex, turnId, itemId, line, output) {
  codex("item/started", { turnId, item: { id: itemId, type: "commandExecution", command: line } });
  codex("item/completed", { turnId, item: { id: itemId, type: "commandExecution", command: line, aggregatedOutput: output, status: "completed" } });
}

const shape = (rows) => rows.map((row) => (row.type === "trace"
  ? `trace(${row.value.status})${row.value.segments.filter((segment) => segment.discarded).map((segment) => ` ~${segment.text}~`).join("")}`
  : `${row.value.role}: ${row.value.content}`));

const order = (messages) => messages.map((message) => `${message.role}:${(message.content || "").slice(0, 16)}`);

test("an answer that begins before its turn is accepted still sits under its prompt", async () => {
  const chat = harness();
  // Codex starts writing while the turn/start reply is still in flight.
  await chat.begin({ type: "prompt", message: "Fix the build" });
  chat.codex("turn/started", { turn: { id: "turn-early" } });
  agentMessage(chat.codex, "turn-early", "a1", "Built.");
  await chat.settle();
  await chat.accept();
  chat.complete("turn-early");
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), ["user: Fix the build", "trace(complete)", "assistant: Built."]);
  assert.deepEqual(order(chat.messages()), ["user:Fix the build", "assistant:Built."]);
});

test("commentary and the commands it ran collapse into the turn's trace, and a replayed browser gets them back", async () => {
  const chat = harness();
  const turn = await chat.prompt("Fix the build");
  agentMessage(chat.codex, turn, "a1", "Looking now.", { phase: "commentary" });
  command(chat.codex, turn, "e1", "npm run build", "ok");
  agentMessage(chat.codex, turn, "a2", "Built.");
  chat.complete(turn);
  await chat.settle();

  const rows = chat.rows();
  assert.deepEqual(shape(rows), ["user: Fix the build", "trace(complete)", "assistant: Built."]);
  // The commentary and the command it ran belong to the turn that produced
  // them, in that order -- not to a neighbouring turn, and not to the answer.
  assert.deepEqual(rows[1].value.segments.map((segment) => segment.kind), ["narration", "tool"]);
  assert.equal(rows[1].value.segments[0].text, "Looking now.");
  // What the browser that stayed connected has, and what a reconnecting one is
  // caught up to from the chat's log, are the same transcript, commands included.
  const replayed = chat.replay();
  assert.deepEqual(shape(replayed), shape(rows));
  const trace = replayed.find((row) => row.type === "trace");
  assert.deepEqual(trace.value.segments.map((segment) => segment.kind), ["narration", "tool"]);
  assert.equal(trace.value.segments[1].tool.name, "command");
  assert.equal(trace.value.segments[1].tool.output, "ok");
});

test("an interrupted answer keeps its text, and the next turn is its own", async () => {
  const chat = harness();
  const turn = await chat.prompt("Tell me a long story");
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "The rain fell upward." });
  await chat.settle();

  chat.dispatch({ type: "stop_generation" });
  await chat.settle();
  chat.codex("item/completed", { turnId: turn, item: { id: "a1", type: "agentMessage", text: "The rain fell upward.", phase: "final_answer" } });
  chat.complete(turn);
  await chat.settle();

  const second = await chat.prompt("now stop");
  agentMessage(chat.codex, second, "a2", "Got it — stopping.");
  chat.complete(second);
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story", "trace(interrupted) ~The rain fell upward.~",
    "user: now stop", "trace(complete)", "assistant: Got it — stopping.",
  ]);
  assert.deepEqual(order(chat.messages()), [
    "user:Tell me a long s", "assistant:The rain fell up", "user:now stop", "assistant:Got it — stoppin",
  ]);
});

test("a steered message is a message of its own, and the answer answers it", async () => {
  const chat = harness();
  const turn = await chat.prompt("Tell me a long story");
  agentMessage(chat.codex, turn, "a1", "The rain fell upward.", { phase: "commentary" });
  await chat.settle();

  await chat.send({ type: "steer", message: "make it shorter" });
  const steered = chat.sent.find((message) => message.method === "turn/steer");
  assert.ok(steered, "the steer reached Codex");
  chat.codex("item/started", { turnId: turn, item: { id: "u2", clientId: steered.params.clientUserMessageId, type: "userMessage", content: [{ type: "text", text: "make it shorter" }] } });
  agentMessage(chat.codex, turn, "a2", "Rain. Upward.");
  chat.complete(turn);
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story", "trace(complete)", "user: make it shorter", "trace(complete)", "assistant: Rain. Upward.",
  ]);
});

test("a follow-up sent while the turn runs waits, and then becomes its own turn", async () => {
  const chat = harness();
  const turn = await chat.prompt("Fix the build");
  await chat.send({ type: "follow_up", message: "and run the tests" });
  assert.deepEqual(shape(chat.rows()), ["user: Fix the build"]);

  agentMessage(chat.codex, turn, "a1", "Built.");
  chat.complete(turn);
  await chat.read();
  await chat.accept();
  const second = chat.turnId();
  chat.codex("turn/started", { turn: { id: second } });
  agentMessage(chat.codex, second, "a2", "All green.");
  chat.complete(second);
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Fix the build", "trace(complete)", "assistant: Built.",
    "user: and run the tests", "trace(complete)", "assistant: All green.",
  ]);
});

test("a prompt Codex refuses takes back the row it stated", async () => {
  const chat = harness();
  chat.dispatch({ type: "prompt", message: "Fix the build" });
  await chat.read();
  const request = chat.sent.find((message) => message.method === "turn/start");
  chat.codex_reject(request.id, "refused");
  await chat.settle();

  assert.deepEqual(chat.errors.map((event) => event.error?.message), ["refused"]);
  assert.deepEqual(buildTurnRows(chat.messages(), []), []);
});

test("a turn pauses for an approval and carries on into its answer", async () => {
  const chat = harness();
  const turn = await chat.prompt("Clean the tree");
  agentMessage(chat.codex, turn, "a1", "Removing build.", { phase: "commentary" });
  chat.request(7, "item/commandExecution/requestApproval",
    { approvalId: "ap-1", turnId: turn, command: "rm -rf build", reason: "Cleaning the tree" });
  await chat.settle();
  assert.equal(chat.record.activity, "waiting_for_user");

  chat.dispatch({ type: "extension_ui_response", id: "ap-1", value: "Approve" });
  await chat.settle();
  assert.equal(chat.record.activity, "working", "the turn resumes once the prompt clears");

  command(chat.codex, turn, "e1", "rm -rf build", "");
  agentMessage(chat.codex, turn, "a2", "Tree is clean.");
  chat.complete(turn);
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), ["user: Clean the tree", "trace(complete)", "assistant: Tree is clean."]);
});

test("a turn Codex reports as failed leaves what it wrote in place", async () => {
  const chat = harness();
  const turn = await chat.prompt("Fix the build");
  chat.codex("item/agentMessage/delta", { turnId: turn, itemId: "a1", delta: "Half an ans" });
  chat.codex("turn/completed", { turn: { id: turn, status: "failed", error: { message: "upstream refused" } } });
  await chat.settle();

  assert.deepEqual(chat.errors.map((event) => event.error?.message), ["upstream refused"]);
  // The half-answer stays, as the trace's last, struck-through step.
  assert.deepEqual(shape(buildTurnRows(chat.messages(), [])), ["user: Fix the build", "trace(failed) ~Half an ans~"]);
  assert.equal(chat.messages().at(-1).content, "Half an ans");
});
