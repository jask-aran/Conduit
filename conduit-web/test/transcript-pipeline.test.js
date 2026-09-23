/**
 * What a chat ends up looking like, driven through the real pipeline.
 *
 * A Pi process (faked at its stdio), the real manager, the real command
 * handling, the real neutral-event normalizers, and the real client projection.
 * Nothing in here describes what the code does; it describes what should be on
 * screen, and every layer between the harness and the rows has to agree for the
 * assertions to hold. Bugs that made a transcript wrong without making a unit
 * test wrong -- an answer above the prompt it answers, a finished story folded
 * into a collapsed trace, a row left blank because two sources disagreed --
 * fail here.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { PiManager } from "../src/pi-manager.js";
import { PiRpcAdapter, normalizePiBackendEvent } from "../src/pi-rpc-adapter.js";
import { projectSessionEntries } from "../src/session-store.js";
import { ChatLogs } from "../src/server/chat-log.js";
import { createLiveSessionStream } from "../src/server/live-session-stream.js";
import { normalizeLiveEvent } from "../src/client/api/live-events.ts";
import { applyToolOp, applyTranscriptOp, applyTranscriptOps, isToolOp, mergeToolEvent } from "../src/client/timeline-order.ts";
import { buildTurnRows } from "../src/client/turn-rows.ts";

const lifecycle = { run: (_chatId, operation) => operation(), assertAvailable: () => {} };

/** A ledger that names messages the way the real one does, without the disk. */
function ledger() {
  let sequence = 0;
  const next = () => `m_${String(++sequence).padStart(2, "0")}`;
  return {
    owns: () => true,
    load: async () => ({}),
    claim: async (_project, _chat, _role, offered) => offered || next(),
    mint: async () => next(),
    claimNow: () => next(),
    bind: async () => null,
    release: async () => {},
    resolver: async () => (id) => id,
    entryIdFor: async (_project, _chat, id) => id,
  };
}

function harness() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  // Every RPC is accepted, but a prompt's acceptance is held until the test
  // releases it. Pi begins answering when it reads the prompt off stdin, not
  // when it gets round to acknowledging it, and the transcript has to survive
  // the gap between the two.
  const held = { prompt: [], abort: [] };
  const sent = [];
  child.stdin = {
    write(line) {
      const command = JSON.parse(line);
      sent.push(command);
      const requestId = command.id || lastRequestId();
      if (held[command.type]) { held[command.type].push(requestId); return; }
      queueMicrotask(() => pi({ type: "response", id: requestId, success: true, data: {} }));
    },
  };
  child.kill = () => true;
  const manager = new PiManager({
    agentDir: "/tmp/conduit-transcript-pipeline",
    spawnImpl: () => child,
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
    logs: new ChatLogs(),
  });
  const lastRequestId = () => `conduit_${manager.requestSequence}`;
  const project = { id: "project-1", kind: "workspace", slug: "p", path: "/tmp/p", workingRoot: "/tmp/p", sessionsDir: "/tmp/p" };
  const record = manager.create({ project, chatId: "chat-1", sessionFile: null });
  child.emit("spawn");
  const chat = { id: "chat-1", title: "Epic Tale", status: "active", backend: { implementation: "conduit_pi" } };
  // The server reads a window of the harness's own transcript back after an
  // interrupt and republishes it. What that window contains is the test's to
  // decide, because it is the last turn as the harness has written it so far --
  // which is not the end of the conversation once a replacement prompt exists.
  let transcriptWindow = () => ({ messages: [], tools: [] });
  const adapter = Object.assign(
    Object.create(Object.getPrototypeOf(new PiRpcAdapter(manager))),
    new PiRpcAdapter(manager),
    { readTranscript: async () => transcriptWindow() },
  );

  // The client, as far as the transcript is concerned.
  let messages = [];
  let tools = [];
  manager.on("event", ({ event }) => {
    const wire = normalizeLiveEvent(JSON.parse(JSON.stringify(normalizePiBackendEvent(event))));
    // Exactly what the browser does with these: the statements decide what the
    // transcript holds, and live activity only paints output arriving while a
    // tool is still running.
    if (wire.type === "transcript_op") {
      if (isToolOp(wire)) tools = applyToolOp(tools, wire);
      else messages = applyTranscriptOp(messages, wire);
    }
    if (wire.type === "tool_execution_updated") {
      tools = mergeToolEvent(tools, {
        type: "tool_execution_update",
        toolCallId: wire.toolCallId, name: wire.name, input: wire.input, output: wire.output,
      }).tools;
    }
  });

  const ws = new EventEmitter();
  ws.readyState = 1;
  const errors = [];
  ws.send = (frame) => {
    const event = JSON.parse(frame);
    if (event.type === "error") errors.push(event);
  };
  // Which socket the next upgrade lands on, so a test can put a second browser
  // on the same chat.
  let attaching = ws;
  const stream = createLiveSessionStream({
    manager,
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(attaching) },
    attachments: {
      resolveMany: async () => [], pathFor: () => "", recordMessage: async () => {},
      decorateMessages: async (_p, _c, list) => list, discardMessages: async () => {},
    },
    registry: { metadata: () => chat, markUserMessage: async () => {}, update: async () => chat },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    messageIds: ledger(),
    chatLogs: manager.logs,
    backends: { get: () => record, forChat: () => adapter, adapterForRecord: () => adapter },
  });
  stream.handleUpgrade(record.id, {}, {}, null);

  const pi = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  /** Wait until Pi has actually been given a command it has not answered yet. */
  const read = async (type) => {
    for (let attempt = 0; attempt < 50 && !held[type].length; attempt += 1) await settle();
    assert.ok(held[type].length, `Pi was never given the ${type}`);
  };
  const accept = async (type) => {
    while (held[type].length) pi({ type: "response", id: held[type].shift(), success: true, data: {} });
    await settle();
  };
  const promptRead = () => read("prompt");
  const acceptPrompt = () => accept("prompt");
  /** The ordinary case: send, and let the harness accept it straight away. */
  const send = async (command) => {
    ws.emit("message", JSON.stringify(command));
    if (command.type === "prompt" || command.type === "interrupt_and_send"
      || command.type === "fork_and_prompt" || command.type === "regenerate") {
      await promptRead();
      await acceptPrompt();
    }
    await settle();
  };
  const begin = (command) => { ws.emit("message", JSON.stringify(command)); return promptRead(); };
  /** Emit a command that answers with no prompt of its own, such as a stop. */
  const dispatch = (command) => { ws.emit("message", JSON.stringify(command)); };

  /**
   * A second browser opening this chat, the way a reload does it.
   *
   * It reads the transcript over HTTP -- whatever the harness has written so
   * far, which mid-turn is nothing, because Pi writes its session file when the
   * turn ends -- and then attaches. Everything it knows after that is what the
   * socket tells it.
   */
  const reattach = async () => {
    const socket = new EventEmitter();
    socket.readyState = 1;
    // What `GET /v0/sessions/:id` serves: the harness's own read, brought up to
    // what the server has stated about this chat.
    const loaded = applyTranscriptOps(
      { messages: (transcriptWindow().messages || []).map((message) => ({ ...message })),
        tools: transcriptWindow().tools || [] },
      manager.logs.get(record.chatId)?.entries || []);
    let held = loaded.messages;
    let heldTools = loaded.tools;
    socket.send = (frame) => {
      const wire = normalizeLiveEvent(JSON.parse(frame));
      if (wire.type !== "transcript_op") return;
      if (isToolOp(wire)) heldTools = applyToolOp(heldTools, wire);
      else held = applyTranscriptOp(held, wire);
    };
    attaching = socket;
    stream.handleUpgrade(record.id, {}, {}, null);
    attaching = ws;
    await settle();
    return { messages: () => held, rows: () => buildTurnRows(held, heldTools) };
  };

  return { pi, send, begin, dispatch, read, accept, acceptPrompt, promptRead, settle, sent, errors, reattach,
    setTranscriptWindow: (window) => { transcriptWindow = window; },
    // A turn checkpoints after it ends, which republishes its own window --
    // late, and long after a replacement prompt has been sent.
    publishStaleWindow: async (count) => {
      adapter.publish(record, {
        type: "transcript_sync",
        messages: messages.slice(0, count).map(({ id, role, content }) => ({ id, role, content })),
        tools: [],
      });
      await settle();
    },
    // Reading the rows also insists the server never reported an error: a
    // command that was rejected would otherwise show up only as a transcript
    // that quietly stops changing.
    rows: () => {
      assert.deepEqual(errors, [], "the server reported an error");
      return buildTurnRows(messages, tools);
    },
    messages: () => messages };
}

/** Pi's shape for an assistant message that streams text and then ends. */
const assistantText = (pi, text, { stopReason = "stop" } = {}) => {
  const partial = { role: "assistant", content: [{ type: "text", text }], stopReason };
  pi({ type: "message_start", message: { role: "assistant", content: [] } });
  pi({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...partial, content: [{ type: "text", text: "" }] } } });
  pi({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text, partial } });
  pi({ type: "message_end", message: partial });
};

const shape = (rows) => rows.map((row) => (row.type === "trace"
  ? `trace(${row.value.status})`
  : `${row.value.role}: ${row.value.content}`));

/**
 * The transcript in the order it is held, not the order it is drawn.
 *
 * Grouping can put an answer under the right prompt while the list itself has
 * it above that prompt, and everything drawn from position rather than from
 * grouping -- the live overlay above all -- then draws the turn in the wrong
 * place. So the order is asserted on its own.
 */
const order = (messages) => messages.map((message) => `${message.role}:${(message.content || "").slice(0, 16)}`);

test("a plain turn reads as prompt then answer", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "Tell me a long story" } });
  assistantText(chat.pi, "Once upon a time.");
  chat.pi({ type: "agent_settled" });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    "assistant: Once upon a time.",
  ]);
});

test("an answer that begins before its prompt is accepted still sits under it", async () => {
  const chat = harness();
  // The harness starts writing while the prompt's acceptance is still in
  // flight. Nothing may end up above the prompt it answers.
  await chat.begin({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  assistantText(chat.pi, "Once upon a time.");
  await chat.settle();
  await chat.acceptPrompt();
  chat.pi({ type: "agent_settled" });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    "assistant: Once upon a time.",
  ]);
});

test("an interrupted story keeps its text, and the next turn is its own", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "Tell me a long story" } });
  const story = { role: "assistant", content: [{ type: "text", text: "The rain fell upward." }], stopReason: "aborted" };
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...story, content: [{ type: "text", text: "" }] } } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The rain fell upward.", partial: story } });
  await chat.settle();

  // The interrupt publishes the last turn as the harness has it on disk: the
  // prompt and the story it cut off. That window ends before the replacement
  // prompt, and must not be taken for the end of the conversation.
  chat.setTranscriptWindow(() => ({
    messages: chat.messages().slice(0, 2).map(({ id, role, content }) => ({ id, role, content })),
    tools: [],
  }));
  chat.dispatch({ type: "interrupt_and_send", message: "now stop, start a 90s bash timer" });
  // Pi reports the cut-off message between the abort request and its answer,
  // and the session file it will eventually be written to does not exist yet.
  await chat.read("abort");
  chat.pi({ type: "message_end", message: story });
  await chat.accept("abort");
  await chat.promptRead();
  await chat.acceptPrompt();
  // The cut-off turn checkpoints after the replacement prompt has gone out, and
  // republishes its own window. That window ends at the story, which is no
  // longer the end of the conversation.
  await chat.publishStaleWindow(2);

  // The replacement turn narrates, calls a tool, and then answers.
  const narration = {
    role: "assistant",
    content: [{ type: "text", text: "Planning the timer." }, { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "sleep 90" } }],
    stopReason: "toolUse",
  };
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...narration, content: [{ type: "text", text: "" }] } } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Planning the timer.", partial: narration } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial: narration } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, partial: narration, toolCall: { id: "call_1", name: "bash", arguments: { command: "sleep 90" } } } });
  chat.pi({ type: "message_end", message: narration });
  chat.pi({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "sleep 90" } });
  chat.pi({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: "started", isError: false });
  assistantText(chat.pi, "Story stopped. Timer started.");
  chat.pi({ type: "agent_settled" });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    // The story was cut off, not abandoned: its text is what the turn had
    // written, and a later message calling a tool does not demote it.
    "assistant: The rain fell upward.",
    "user: now stop, start a 90s bash timer",
    "trace(complete)",
    "assistant: Story stopped. Timer started.",
  ]);
  assert.deepEqual(order(chat.messages()), [
    "user:Tell me a long s",
    "assistant:The rain fell up",
    "user:now stop, start ",
    // The narration is held as what that message said, not blanked out: the
    // trace draws it, and `interim` is what keeps it out of the answer.
    "assistant:Planning the tim",
    "assistant:Story stopped. T",
  ], "the replacement turn is held after the prompt that asked for it");
});

test("a turn that names an answer and writes nothing leaves no row behind", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "Tell me a long story" } });
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "generation_stopped" });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), ["user: Tell me a long story"]);
});

test("an answer cut off without a final message from the harness keeps what it had", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "Tell me a long story" } });
  const story = { role: "assistant", content: [{ type: "text", text: "The rain fell upward." }] };
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...story, content: [{ type: "text", text: "" }] } } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The rain fell upward.", partial: story } });
  await chat.settle();

  // The turn ends with nothing more said about the message being written. The
  // text the user watched arrive is still the message.
  chat.dispatch({ type: "stop_generation" });
  await chat.read("abort");
  await chat.accept("abort");
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    "assistant: The rain fell upward.",
  ]);
});

test("a queued message lands where the model took it, with its answer under it", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "Tell me a long story" } });
  assistantText(chat.pi, "Once upon a time.");
  await chat.settle();

  // Queued while the turn runs, then taken by Pi, which writes it as an
  // ordinary user message and answers it inside the same turn.
  await chat.send({ type: "steer", message: "make it about kangaroos" });
  chat.pi({ type: "message_end", message: { role: "user", content: "make it about kangaroos" } });
  assistantText(chat.pi, "A kangaroo, then.");
  chat.pi({ type: "agent_settled" });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    "assistant: Once upon a time.",
    "user: make it about kangaroos",
    "assistant: A kangaroo, then.",
  ]);
});

test("interrupting with what was queued sends it once", async () => {
  // The shape that started all of this: a message typed while the agent works
  // is queued, then sent with the interrupt button on the queued bubble. The
  // server takes it back off the queue and prompts with it, so it must appear
  // exactly once -- as a prompt, with its answer beneath it.
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "Tell me a long story" } });
  const story = { role: "assistant", content: [{ type: "text", text: "The rain fell upward." }], stopReason: "aborted" };
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...story, content: [{ type: "text", text: "" }] } } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The rain fell upward.", partial: story } });
  await chat.settle();

  await chat.send({ type: "steer", message: "now stop" });
  // The composer is empty: everything being sent comes back off the queue.
  chat.dispatch({ type: "interrupt_and_send", message: "" });
  await chat.read("abort");
  chat.pi({ type: "message_end", message: story });
  await chat.accept("abort");
  await chat.settle();
  await chat.promptRead();
  await chat.acceptPrompt();

  chat.pi({ type: "message_end", message: { role: "user", content: "now stop" } });
  assistantText(chat.pi, "Got it — stopping.");
  chat.pi({ type: "agent_settled" });
  await chat.settle();

  assert.deepEqual(shape(chat.rows()), [
    "user: Tell me a long story",
    "assistant: The rain fell upward.",
    "user: now stop",
    "assistant: Got it — stopping.",
  ]);
});

/**
 * A turn's commentary is part of what it said, and stating the message has to
 * carry it. The trace renders narration from the message's own content, so a
 * close that states the message without its text takes it off the screen the
 * moment the turn settles -- text the reader watched arrive, gone, until a
 * later window from the session file happens to put it back.
 */
test("what the turn said while it worked survives the turn settling", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "start a 90s bash timer" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "start a 90s bash timer" } });
  const narration = {
    role: "assistant",
    content: [{ type: "text", text: "Planning the timer." }, { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "sleep 90" } }],
    stopReason: "toolUse",
  };
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...narration, content: [{ type: "text", text: "" }] } } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Planning the timer.", partial: narration } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, partial: narration, toolCall: { id: "call_1", name: "bash", arguments: { command: "sleep 90" } } } });
  chat.pi({ type: "message_end", message: narration });
  chat.pi({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "sleep 90" } });
  chat.pi({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: "started", isError: false });
  assistantText(chat.pi, "Timer started.");
  chat.pi({ type: "agent_settled" });
  await chat.settle();

  const trace = chat.rows().find((row) => row.type === "trace");
  assert.deepEqual(trace.value.segments.map((segment) => segment.kind), ["narration", "tool"]);
  assert.equal(trace.value.segments[0].text, "Planning the timer.");
});

/**
 * Pi keeps an interrupted answer in its session file and then builds every
 * later request without it. The reader watched that text arrive, so it stays on
 * screen -- but the conversation does not contain it, and the transcript has to
 * say so rather than showing it as an ordinary answer somebody can follow up on.
 */
test("an interrupted answer is kept, and marked as something the agent no longer has", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Tell me a long story" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "Tell me a long story" } });
  const story = { role: "assistant", content: [{ type: "text", text: "The rain fell upward." }], stopReason: "aborted" };
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...story, content: [{ type: "text", text: "" }] } } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The rain fell upward.", partial: story } });
  chat.dispatch({ type: "stop_generation" });
  await chat.read("abort");
  chat.pi({ type: "message_end", message: story });
  await chat.accept("abort");
  await chat.settle();

  const answer = chat.messages().find((message) => message.role === "assistant");
  assert.equal(answer.content, "The rain fell upward.", "the text the reader watched arrive is kept");
  assert.equal(answer.discarded, true, "and marked as absent from the conversation");
  // An answer that ran to completion is not marked, or the mark would mean
  // nothing: it is the difference between the two that the reader is being told.
  await chat.send({ type: "prompt", message: "again" });
  chat.pi({ type: "agent_start" });
  assistantText(chat.pi, "Once more.");
  chat.pi({ type: "agent_settled" });
  await chat.settle();
  assert.equal(chat.messages().at(-1).discarded, false);
});

/**
 * Reloading the page in the middle of a turn.
 *
 * The browser reads the transcript over HTTP and attaches. Mid-turn the read
 * has nothing to give it -- Pi writes its session file when the turn ends --
 * so everything the reader sees has to come off the socket. The prompt was
 * stated once, before this browser existed, and the chat's log is the only
 * thing that still holds it.
 */
test("a browser that arrives mid-turn is told the prompt it is watching an answer to", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Output a long story" });
  chat.pi({ type: "agent_start" });
  assistantText(chat.pi, "The Cartographer of Lost Things");
  await chat.settle();

  const late = await chat.reattach();
  assert.deepEqual(shape(late.rows()), [
    "user: Output a long story",
    "assistant: The Cartographer of Lost Things",
  ]);
});

/**
 * And stopping it does not take the chat with it.
 *
 * A browser holding no prompt row is handed a `message.close` for an answer it
 * also does not hold, so nothing is left -- the reader watches a story being
 * written and is returned to an empty chat.
 */
test("stopping a turn a late browser is watching leaves the turn on screen", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "Output a long story" });
  chat.pi({ type: "agent_start" });
  assistantText(chat.pi, "The Cartographer of Lost Things", { stopReason: "aborted" });
  await chat.settle();

  const late = await chat.reattach();
  chat.dispatch({ type: "stop_generation" });
  await chat.settle();
  chat.pi({ type: "agent_settled" });
  await chat.settle();

  assert.equal(late.messages().length > 0, true, "the chat did not empty itself");
  assert.deepEqual(shape(late.rows()).map((row) => row.split(":")[0]), ["user", "assistant"]);
});

/**
 * A stop that lands while a tool is running.
 *
 * Pi reports it as the tool failing -- "Command aborted" -- and then files an
 * empty assistant entry with `stopReason: "error"`. Read off those shapes, the
 * trace called the turn complete, the tool called it an error and the composer
 * called it interrupted: three answers to one question. The turn states how it
 * ended, once, on its prompt, and everything that shows it reads that -- live,
 * and after a reload reads the session file instead.
 */
const toolCall = { id: "call_1", name: "bash", arguments: { command: "sleep 20" } };
const calling = { role: "assistant", content: [{ type: "toolCall", ...toolCall }], stopReason: "toolUse" };
const cutOff = { role: "assistant", content: [], stopReason: "error", errorMessage: "This operation was aborted" };

const readsInterrupted = (messages, rows) => {
  assert.equal(messages.find((message) => message.role === "user").outcome, "interrupted", "the turn states how it ended");
  const trace = rows.find((row) => row.type === "trace");
  assert.equal(trace.value.status, "interrupted", "the trace says so");
  const { tool } = trace.value.segments.find((segment) => segment.kind === "tool");
  assert.equal(tool.cancelled, true, "the tool was stopped");
  assert.equal(tool.isError, false, "not failed");
};

test("a stop mid-tool reads as interrupted everywhere, live and after a reload", async () => {
  const chat = harness();
  await chat.send({ type: "prompt", message: "run a bash sleep 20s" });
  chat.pi({ type: "agent_start" });
  chat.pi({ type: "message_end", message: { role: "user", content: "run a bash sleep 20s" } });
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, partial: calling, toolCall } });
  chat.pi({ type: "message_end", message: calling });
  chat.pi({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: toolCall.arguments });
  await chat.settle();

  chat.dispatch({ type: "stop_generation" });
  await chat.read("abort");
  chat.pi({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash",
    result: { content: [{ type: "text", text: "Command aborted" }] }, isError: true });
  chat.pi({ type: "message_start", message: { role: "assistant", content: [] } });
  chat.pi({ type: "message_end", message: cutOff });
  chat.pi({ type: "agent_end" });
  chat.pi({ type: "agent_settled" });
  await chat.accept("abort");
  await chat.settle();
  readsInterrupted(chat.messages(), chat.rows());

  const reloaded = projectSessionEntries([
    { type: "message", id: "u1", message: { role: "user", content: "run a bash sleep 20s" } },
    { type: "message", id: "a1", message: calling },
    { type: "message", id: "t1", message: { role: "toolResult", toolCallId: "call_1", toolName: "bash",
      content: [{ type: "text", text: "Command aborted" }], isError: true } },
    { type: "message", id: "a2", message: cutOff },
  ]);
  readsInterrupted(reloaded.messages, buildTurnRows(reloaded.messages, reloaded.tools));
});
