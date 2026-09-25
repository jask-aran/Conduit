/**
 * What a Claude Code chat ends up looking like, driven through the real pipeline.
 *
 * The Agent SDK is faked where Conduit meets it -- `query()` and the session
 * helpers -- replaying the sequences Claude Code 2.1.282 was recorded sending
 * through SDK 0.3.282, and everything after that is real: the adapter, the chat
 * log, the command handling, the normalizers and the client projection. The
 * fake saves a session the way Claude Code does, one entry per prompt, block and
 * tool result, so a reload reads what the live turn wrote. The other harnesses'
 * versions of this file are `transcript-pipeline.test.js`,
 * `codex-transcript-pipeline.test.js` and `opencode-transcript-pipeline.test.js`.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ClaudeCodeAdapter } from "../src/claude-code-adapter.js";
import { reduceActiveGeneration } from "../src/active-generation.js";
import { ChatLogs } from "../src/server/chat-log.js";
import { createLiveSessionStream } from "../src/server/live-session-stream.js";
import { applyTranscriptOps } from "../src/transcript-fold.js";
import { isStructuredGenerationEvent, normalizeLiveEvent } from "../src/client/api/live-events.ts";
import { applyToolOp, applyTranscriptOp, isToolOp } from "../src/client/timeline-order.ts";
import { buildTurnRows } from "../src/client/turn-rows.ts";

const MODEL = "claude-haiku-4-5-20251001";
const MODELS = [
  { value: "default", resolvedModel: MODEL, displayName: "Default (recommended)", description: "" },
  { value: "haiku", resolvedModel: MODEL, displayName: "Haiku 4.5", description: "" },
];

/** Claude Code behind the SDK: the sessions it has saved and the queries it is running. */
function claudeCode() {
  const saved = new Map();
  const runs = [];
  const save = (sessionId, message) => {
    if (!saved.has(sessionId)) saved.set(sessionId, []);
    saved.get(sessionId).push({ type: message.type, uuid: message.uuid, session_id: sessionId, message: message.message,
      parent_tool_use_id: message.parent_tool_use_id ?? null, parent_agent_id: null });
  };
  const query = ({ prompt, options }) => {
    const sessionId = options.resume || options.sessionId;
    const out = [];
    let wake = null;
    const run = { options, sessionId, prompts: [], interrupts: 0, closed: false, mode: options.permissionMode || "default" };
    const deliver = () => {
      if (!wake || (!out.length && !run.closed)) return;
      const resolve = wake;
      wake = null;
      resolve(out.length ? { value: out.shift(), done: false } : { value: undefined, done: true });
    };
    run.emit = (message) => {
      const stated = { uuid: crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null, ...message };
      if (stated.type === "user" || stated.type === "assistant") save(sessionId, stated);
      out.push(stated);
      deliver();
    };
    void (async () => { for await (const message of prompt) { run.prompts.push(message); save(sessionId, message); } })();
    runs.push(run);
    return {
      [Symbol.asyncIterator]() { return this; },
      next: () => (out.length ? Promise.resolve({ value: out.shift(), done: false })
        : run.closed ? Promise.resolve({ value: undefined, done: true }) : new Promise((resolve) => { wake = resolve; })),
      return: async () => ({ value: undefined, done: true }),
      initializationResult: async () => ({ models: MODELS, commands: [], current_permission_mode: run.mode }),
      interrupt: async () => { run.interrupts += 1; return { still_queued: [] }; },
      setPermissionMode: async (mode) => { run.mode = mode; },
      setModel: async () => {},
      applyFlagSettings: async () => {},
      close: () => { run.closed = true; deliver(); },
    };
  };
  return {
    saved,
    runs,
    run: () => runs.at(-1),
    sdk: {
      query,
      getSessionInfo: async (id) => (saved.has(id) ? { sessionId: id } : undefined),
      getSessionMessages: async (id) => saved.get(id) || [],
      listSessions: async () => [],
      resolveSettings: async () => ({ effective: {} }),
    },
  };
}

// One model message as Claude Code streams it: stream events around one
// `assistant` message per block, all under the API's message id.
const opened = (run, id) => run.emit({ type: "stream_event", event: { type: "message_start", message: { id, model: MODEL } } });
function block(run, id, index, content) {
  const event = (value) => run.emit({ type: "stream_event", event: { index, ...value } });
  if (content.type === "tool_use") {
    event({ type: "content_block_start", content_block: { type: "tool_use", id: content.id, name: content.name, input: {} } });
    event({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: JSON.stringify(content.input) } });
  } else {
    const field = content.type === "thinking" ? "thinking" : "text";
    event({ type: "content_block_start", content_block: { type: content.type, [field]: "" } });
    event({ type: "content_block_delta", delta: { type: `${field}_delta`, [field]: content[field] } });
  }
  run.emit({ type: "assistant", message: { id, model: MODEL, role: "assistant", content: [content], stop_reason: null } });
  event({ type: "content_block_stop" });
}
function ended(run, stopReason) {
  run.emit({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: stopReason } } });
  run.emit({ type: "stream_event", event: { type: "message_stop" } });
}
const toolResult = (run, toolUseId, content, isError = false) => run.emit({ type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] } });
const succeeded = (run, result) => run.emit({ type: "result", subtype: "success", is_error: false, stop_reason: "end_turn",
  terminal_reason: "completed", result, errors: undefined });
/** A model message that thinks and then answers. */
function answer(run, id, text) {
  opened(run, id);
  block(run, id, 0, { type: "thinking", thinking: "Short and direct.", signature: "sig" });
  block(run, id, 1, { type: "text", text });
  ended(run, "end_turn");
}
/** A model message that thinks and calls one tool. */
function calls(run, id, tool) {
  opened(run, id);
  block(run, id, 0, { type: "thinking", thinking: "Use the tool.", signature: "sig" });
  block(run, id, 1, { type: "tool_use", ...tool });
}

const lifecycle = { run: (_chatId, operation) => operation(), assertAvailable: () => {} };
const ledger = () => ({
  owns: () => false, load: async () => ({}), claim: async () => null, bind: async () => null,
  release: async () => {}, resolver: async () => (id) => id, entryIdFor: async (_p, _c, id) => id,
});

async function harness() {
  const chatLogs = new ChatLogs();
  const claude = claudeCode();
  const adapter = new ClaudeCodeAdapter({ command: "", logs: chatLogs, sdk: claude.sdk });
  const project = { id: "project-1", kind: "workspace", slug: "p", path: "/tmp/p", workingRoot: "/tmp/p" };
  const record = await adapter.create({ chatId: "chat-1", project });
  const chat = { id: "chat-1", title: "Claude Code", status: "active",
    backend: { implementation: "claude-code", opaqueSession: record.sessionId } };

  // The browser, as the OpenCode pipeline test draws it.
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
    claude,
    adapter,
    record,
    chat,
    project,
    settle,
    errors,
    run: () => claude.run(),
    asked: () => asked,
    tools: () => tools,
    answer: async (request, option) => {
      ws.emit("message", JSON.stringify({ type: "extension_ui_response", id: request.id,
        ...(typeof option === "string" ? { value: option } : option) }));
      await settle();
    },
    send: async (message) => {
      ws.emit("message", JSON.stringify({ type: "prompt", message, messageId: `m_00000000-0000-4000-8000-00000000000${++messageCount}` }));
      await settle();
    },
    stop: async () => { ws.emit("message", JSON.stringify({ type: "stop_generation" })); await settle(); },
    /** Claude Code asking before a tool runs, as `canUseTool` is called. */
    ask: (toolName, input, options) => claude.run().options.canUseTool(toolName, input,
      { signal: new AbortController().signal, requestId: crypto.randomUUID(), ...options }),
    screen: () => buildTurnRows(messages, tools, { activeGeneration: generation }),
    rows: () => {
      assert.deepEqual(errors, [], "the server reported an error");
      return buildTurnRows(messages, tools);
    },
    reload: async ({ log = true } = {}) => {
      const projection = await adapter.readTranscript({ opaqueSession: record.sessionId });
      const view = log ? { ...projection, ...applyTranscriptOps(projection, chatLogs.peek("chat-1")?.entries || []) } : projection;
      return { rows: buildTurnRows(view.messages, view.tools), tools: view.tools };
    },
  };
}

const shape = (rows) => rows.map((row) => (row.type === "trace"
  ? `trace(${row.value.status})`
  : `${row.value.role}: ${row.value.content}`));

/** Recorded: a Write held for approval, whose suggestion is to accept edits for the session. */
const WRITE = { id: "toolu_01U8yQWhiLayXkmMVH5BqenK", name: "Write", input: { file_path: "/tmp/p/approved.txt", content: "ok" } };
const WRITE_ASKS = { suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
  decisionReason: "Claude requested permissions to edit /tmp/p/approved.txt which is a sensitive file.",
  displayName: "Write", description: "approved.txt", toolUseID: WRITE.id };

test("an edit held for approval offers what Claude Code suggests, and accepting it switches the chat's mode", async () => {
  const chat = await harness();
  await chat.send("Create approved.txt containing ok");
  calls(chat.run(), "msg_a1", WRITE);
  const decision = chat.ask("Write", WRITE.input, WRITE_ASKS);
  await chat.settle();
  const [request] = chat.asked();
  assert.equal(request.message, "approved.txt");
  assert.deepEqual(request.options, ["Allow", "Allow all edits this session", "Deny"]);
  await chat.answer(request, "Allow all edits this session");
  assert.deepEqual(await decision, { behavior: "allow", updatedInput: WRITE.input, updatedPermissions: WRITE_ASKS.suggestions });
  assert.deepEqual(chat.asked(), []);
  // Claude Code applies the suggestion and says it is accepting edits now.
  chat.run().emit({ type: "system", subtype: "status", status: null, permissionMode: "acceptEdits" });
  ended(chat.run(), "tool_use");
  toolResult(chat.run(), WRITE.id, "File created successfully at: /tmp/p/approved.txt");
  answer(chat.run(), "msg_a2", "written");
  succeeded(chat.run(), "written");
  await chat.settle();
  assert.equal(chat.adapter.view(chat.record).permissionMode, "acceptEdits");
  assert.deepEqual(shape(chat.rows()), ["user: Create approved.txt containing ok", "trace(complete)", "assistant: written"]);
});

test("a denied edit reaches Claude Code as a denial, and the turn goes on to answer", async () => {
  const chat = await harness();
  await chat.send("Create denied.txt containing no");
  const denied = { ...WRITE, id: "toolu_016j17TqJHPBT5MbQtoQqvqc", input: { file_path: "/tmp/p/denied.txt", content: "no" } };
  calls(chat.run(), "msg_d1", denied);
  const decision = chat.ask("Write", denied.input, { ...WRITE_ASKS, toolUseID: denied.id });
  await chat.settle();
  await chat.answer(chat.asked()[0], "Deny");
  assert.deepEqual(await decision, { behavior: "deny", message: "The user denied this tool call." });
  ended(chat.run(), "tool_use");
  toolResult(chat.run(), denied.id, "The user denied this tool call.", true);
  answer(chat.run(), "msg_d2", "The file was not created.");
  succeeded(chat.run(), "The file was not created.");
  await chat.settle();
  assert.deepEqual(shape(chat.rows()), ["user: Create denied.txt containing no", "trace(complete)", "assistant: The file was not created."]);
  assert.equal(chat.tools().find((tool) => tool.toolCallId === denied.id)?.isError, true);
});

/** Recorded: AskUserQuestion, and the answer Claude Code reads back. */
const QUESTION = { id: "toolu_01CFXKbcgp9Gp2Q9e5uxRfxR", name: "AskUserQuestion", input: { questions: [{
  question: "Tea or coffee?", header: "Beverage", multiSelect: false,
  options: [{ label: "Tea", description: "A warm or cold tea beverage" }, { label: "Coffee", description: "A warm or cold coffee beverage" }] }] } };

test("AskUserQuestion is asked as a question card, and the answer reaches Claude Code keyed by its question", async () => {
  const chat = await harness();
  await chat.send("Ask me tea or coffee");
  calls(chat.run(), "msg_q1", QUESTION);
  const decision = chat.ask("AskUserQuestion", QUESTION.input, { displayName: "AskUserQuestion", toolUseID: QUESTION.id });
  await chat.settle();
  const [request] = chat.asked();
  assert.equal(request.kind, "question");
  assert.deepEqual(request.questions.map((question) => [question.prompt, question.header, question.multiSelect,
    question.options.map((option) => option.label), Boolean(question.freeform)]),
  [["Tea or coffee?", "Beverage", false, ["Tea", "Coffee"], true]]);
  await chat.answer(request, { answers: [{ questionId: request.questions[0].id, optionIds: ["1"], note: "Strong, please" }] });
  assert.deepEqual(await decision, { behavior: "allow", updatedInput: { ...QUESTION.input,
    answers: { "Tea or coffee?": "Coffee" }, annotations: { "Tea or coffee?": { notes: "Strong, please" } } } });
  toolResult(chat.run(), QUESTION.id, "Your questions have been answered: \"Tea or coffee?\"=\"Coffee\". You can now continue with these answers in mind.");
  ended(chat.run(), "tool_use");
  answer(chat.run(), "msg_q2", "Coffee.");
  succeeded(chat.run(), "Coffee.");
  await chat.settle();
  assert.deepEqual(shape(chat.rows()), ["user: Ask me tea or coffee", "trace(complete)", "assistant: Coffee."]);
});

/** Recorded: what Claude Code sends when a running Bash is interrupted. */
const SLEEP = { id: "toolu_01LnRwUvt17NFATiDjutDvfJ", name: "Bash", input: { command: "sleep 20", description: "Sleep for 20 seconds" } };
function interrupted(run) {
  toolResult(run, SLEEP.id, "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, "
    + "the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.", true);
  run.emit({ type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } });
  run.emit({ type: "result", subtype: "error_during_execution", is_error: true, stop_reason: "tool_use", terminal_reason: "aborted_tools",
    errors: ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"] });
}
const STOPPED = ["user: Run sleep 20", "trace(interrupted)"];

test("a stop interrupts Claude Code, and the tool it killed is cancelled, not failed, live and after a reload", async () => {
  const chat = await harness();
  await chat.send("Run sleep 20");
  calls(chat.run(), "msg_s1", SLEEP);
  ended(chat.run(), "tool_use");
  await chat.settle();
  await chat.stop();
  assert.equal(chat.run().interrupts, 1);
  interrupted(chat.run());
  await chat.settle();
  assert.deepEqual(shape(chat.rows()), STOPPED);
  assert.equal(chat.tools()[0].cancelled, true);
  const reloaded = await chat.reload({ log: false });
  assert.deepEqual(shape(reloaded.rows), STOPPED);
  assert.deepEqual([reloaded.tools[0].cancelled, reloaded.tools[0].isError], [true, false]);
});

test("the session goes on after a stop, and its next turn answers", async () => {
  const chat = await harness();
  await chat.send("Run sleep 20");
  calls(chat.run(), "msg_s1", SLEEP);
  ended(chat.run(), "tool_use");
  await chat.stop();
  interrupted(chat.run());
  await chat.settle();
  await chat.send("Reply with just the word hi.");
  answer(chat.run(), "msg_s2", "hi");
  succeeded(chat.run(), "hi");
  await chat.settle();
  const rows = [...STOPPED, "user: Reply with just the word hi.", "trace(complete)", "assistant: hi"];
  assert.deepEqual(shape(chat.rows()), rows);
  assert.deepEqual(shape((await chat.reload({ log: false })).rows), rows);
});

test("a chat whose Claude Code has gone resumes the saved session, and a never-prompted one starts it", async () => {
  const chat = await harness();
  await chat.send("Say hello");
  answer(chat.run(), "msg_r1", "hello");
  succeeded(chat.run(), "hello");
  await chat.settle();
  await chat.adapter.close(chat.record.id);
  const { live } = await chat.adapter.launch({ chat: chat.chat, project: chat.project });
  assert.equal(chat.run().options.resume, chat.record.sessionId);
  assert.equal(chat.run().options.sessionId, undefined);
  assert.equal(live.sessionId, chat.record.sessionId);
  assert.deepEqual(shape((await chat.reload({ log: false })).rows), ["user: Say hello", "trace(complete)", "assistant: hello"]);

  const fresh = await chat.adapter.create({ chatId: "chat-2", project: chat.project });
  await chat.adapter.close(fresh.id);
  await chat.adapter.launch({ chat: { id: "chat-2", backend: { implementation: "claude-code", opaqueSession: fresh.sessionId } },
    project: chat.project });
  assert.equal(chat.run().options.resume, undefined);
  assert.equal(chat.run().options.sessionId, fresh.sessionId);
});
