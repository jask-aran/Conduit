import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { serializeAttachmentEnvelope } from "../src/attachment-envelope.js";
import { createLiveSessionStream, interruptedPromptInput } from "../src/server/live-session-stream.js";
import { ChatLogs } from "../src/server/chat-log.js";

const queuedAttachment = {
  id: "13dd7444-3bc5-4e9f-880d-2d83b6554862",
  storedName: "13dd7444-3bc5-4e9f-880d-2d83b6554862--notes.txt",
  name: "notes.txt",
};
const lifecycle = {
  run: (_chatId, operation) => operation(),
  assertAvailable: () => {},
};

test("interrupt and send preserves queued and composer attachments", () => {
  const queued = serializeAttachmentEnvelope({
    chatId: "chat_interrupt",
    attachments: [queuedAttachment],
    message: "read the notes",
  });
  const composerAttachment = "4512361e-e615-41ba-8a94-d7bd8fe592c1";

  assert.deepEqual(interruptedPromptInput(
    { steering: [queued], followUp: [] },
    "then summarize",
    [composerAttachment],
  ), {
    message: "read the notes\nthen summarize",
    attachmentIds: [queuedAttachment.id, composerAttachment],
  });
});

test("interrupt and send deduplicates attachment ids", () => {
  const queued = serializeAttachmentEnvelope({
    chatId: "chat_interrupt",
    attachments: [queuedAttachment],
    message: "read it",
  });

  assert.deepEqual(interruptedPromptInput(
    { steering: [queued], followUp: [queued] },
    "",
    [queuedAttachment.id],
  ).attachmentIds, [queuedAttachment.id]);
});

test("one socket delivers backend commands in browser order", async () => {
  const delivered = [];
  const record = {
    id: "live-1", chatId: "chat_interrupt", status: "running",
    queue: { steering: [], followUp: [] }, hostUiRequests: [],
  };
  const adapter = {
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    queue: async (_id, _type, message) => { delivered.push(message); },
  };
  const backends = {
    get: () => record,
    forChat: () => adapter,
  };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = () => {};
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {
      resolveMany: async (_project, _chatId, ids) => {
        if (ids[0] === "slow") await new Promise((resolve) => setTimeout(resolve, 20));
        return [];
      },
      pathFor: () => "",
      recordMessage: async () => {},
    },
    registry: { metadata: () => ({ backend: { implementation: "conduit-runtime" } }) },
    config: {},
    findChatContext: async () => ({
      chat: { id: "chat_interrupt" },
      project: { id: "project-1" },
    }),
    lifecycle,
    chatLogs: new ChatLogs(),
    backends,
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "steer", message: "first", attachmentIds: ["slow"] }));
  ws.emit("message", JSON.stringify({ type: "steer", message: "second", attachmentIds: [] }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(delivered.length, 2);
  assert.equal(delivered[0], "first");
  assert.equal(delivered[1], "second");
});

test("a manifest-owned Codex prompt uses Conduit's naming service", async () => {
  const record = {
    id: "live-codex", chatId: "chat-codex", projectId: "project-1", status: "running",
    adapterImplementation: "codex", hostUiRequests: [],
  };
  const adapter = {
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    getCapabilities: () => ({ attachments: true }),
    prompt: async () => ({ generationId: "generation-1", attachmentIdentity: { messageId: "user-1" } }),
    publish: () => {},
  };
  const chat = { id: record.chatId, status: "draft", title: "", backend: { implementation: "codex" } };
  const project = { id: record.projectId, kind: "workspace", workingRoot: "/tmp" };
  const named = [];
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = () => {};
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {
      resolveMany: async () => [],
      pathFor: () => "",
      recordMessage: async () => {},
    },
    registry: {
      metadata: () => chat,
      markUserMessage: async () => {},
      update: async () => chat,
    },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
    autoNameSession: async (_record, _context, message) => { named.push(message); },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "prompt", message: "Name this through Conduit" }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(named, ["Name this through Conduit"]);
});

test("a successful fork replaces the browser transcript before the new prompt", async () => {
  const operations = [];
  const record = {
    id: "live-1", chatId: "chat-1", projectId: "project-1", status: "running",
    sessionId: "1", hostUiRequests: [],
  };
  const adapter = {
    getCapabilities: () => ({ fork: true, regenerate: true }),
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    fork: async () => { operations.push("fork"); return { opaqueSession: "2" }; },
    publish: (_record, event) => { operations.push(event); },
    readTranscript: async () => ({
      messages: [{ id: "user-kept", role: "user", content: "keep" }],
      tools: [],
    }),
    prompt: async () => { operations.push("prompt"); return "generation-1"; },
  };
  const chat = { id: "chat-1", title: "Chat", backend: { implementation: "conduit-runtime" } };
  const project = { id: "project-1", kind: "workspace", workingRoot: "/tmp" };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = () => {};
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {
      resolveMany: async () => [],
      decorateMessages: async (_project, _chatId, messages) => messages,
      recordMessage: async () => {},
    },
    registry: {
      metadata: () => chat,
      update: async () => chat,
    },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "fork_and_prompt", entryId: "user-old", message: "replacement" }));
  await new Promise((resolve) => setImmediate(resolve));

  // A fork states where the history now ends and repoints the chat. It no
  // longer reads the forked transcript back: the branch keeps the entry ids of
  // everything it retains, so there is nothing for a re-read to correct.
  assert.equal(operations[0], "fork");
  assert.deepEqual(operations.filter((item) => typeof item === "string"), ["fork", "prompt"]);
  assert.deepEqual(operations.filter((item) => item?.type).map((item) => item.type),
    ["history_truncated", "transcript_op", "transcript_op"]);
  assert.deepEqual(operations.find((item) => item?.type === "history_truncated"),
    { type: "history_truncated", beforeMessageId: "user-old" });
});

test("an unknown browser command cannot reach a backend escape hatch", async () => {
  const sent = [];
  const record = { id: "live-1", chatId: "chat-1", status: "running", hostUiRequests: [] };
  const adapter = {
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
  };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = (message) => sent.push(JSON.parse(message));
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {},
    registry: { metadata: () => ({ backend: { implementation: "conduit-runtime" } }) },
    config: {},
    findChatContext: async () => ({
      chat: { id: "chat-1" },
      project: { id: "project-1" },
    }),
    lifecycle,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "backend_native_command", payload: { destructive: true } }));
  await new Promise((resolve) => setImmediate(resolve));

  // Conduit's own words, sent without passing through a harness translator:
  // the same rejection used to reach the browser under different error names
  // across harnesses.
  assert.deepEqual(sent.at(-1), {
    type: "error",
    scope: "request",
    generationId: null,
    error: { code: "invalid_request", message: "Unknown live-session command: backend_native_command" },
  });
});

test("a fresh socket learns the log order before replay", () => {
  const sent = [];
  const record = { id: "live-1", chatId: "chat-1", status: "running", hostUiRequests: [] };
  const adapter = {
    attach: () => { sent.push({ type: "transcript_op", op: "message.close", log: { id: "log", seq: 7 } }); },
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
  };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = (message) => sent.push(JSON.parse(message));
  const chatLogs = new ChatLogs();
  const log = chatLogs.get(record.chatId);
  for (let index = 0; index < 7; index += 1) log.stamp({ type: "status", phase: "started" });
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {},
    registry: { metadata: () => ({ backend: { implementation: "test" } }) },
    config: {},
    findChatContext: async () => null,
    lifecycle,
    chatLogs,
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);

  assert.deepEqual(sent.slice(0, 2), [
    { type: "log_state", log: { id: log.id, seq: 0 } },
    { type: "transcript_op", op: "message.close", log: { id: "log", seq: 7 } },
  ]);
  const states = sent.filter((event) => event.type === "log_state");
  assert.equal(states.at(-1).log.seq, 7);
});

test("a replacing sync that races the log still publishes", async () => {
  const published = [];
  let reads = 0;
  const record = { id: "live-1", chatId: "chat-1", status: "running", hostUiRequests: [] };
  const chatLogs = new ChatLogs();
  const log = chatLogs.get(record.chatId);
  log.stamp({ type: "status", phase: "started" });
  const adapter = {
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    readTranscript: async () => {
      reads += 1;
      log.stamp({ type: "status", phase: "started" });
      return { messages: [{ id: "m1", role: "user", content: "hi" }], tools: [] };
    },
    publish: (_record, event) => { published.push(event); },
  };
  const chat = { id: "chat-1", backend: { implementation: "conduit-runtime" } };
  const project = { id: "project-1" };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = () => {};
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: { decorateMessages: async (_project, _chatId, messages) => messages },
    registry: { metadata: () => chat },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    chatLogs,
    backends: { get: () => record, forChat: () => adapter, adapterForRecord: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "resume_log", logId: "other", since: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(reads, 3);
  assert.equal(published.length, 1);
  assert.equal(published[0].type, "transcript_sync");
  assert.equal(published[0].replace, true);
});

test("a harness that names its own messages is told what the browser named this one", async () => {
  // The browser draws the prompt row before it sends it, then the server tells
  // the harness to state that row. For Pi the name comes from the ledger; for a
  // harness that names its own messages the ledger stands aside, and the
  // browser's name has to reach the adapter some other way or the adapter
  // invents one -- stating a second row for a message already on screen.
  const record = {
    id: "live-own-ids", chatId: "chat-own-ids", projectId: "project-1", status: "running",
    adapterImplementation: "test-stream", hostUiRequests: [],
  };
  const prompts = [];
  const published = [];
  const adapter = {
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    getCapabilities: () => ({ attachments: false }),
    prompt: async (_id, _message, options) => { prompts.push(options); return "generation-1"; },
    publish: (_record, event) => { published.push(event); },
  };
  const chat = { id: record.chatId, status: "draft", title: "t", backend: { implementation: "test-stream" } };
  const project = { id: record.projectId, kind: "workspace", workingRoot: "/tmp" };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = () => {};
  const stream = createLiveSessionStream({
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: { resolveMany: async () => [], pathFor: () => "", recordMessage: async () => {} },
    registry: { metadata: () => chat, markUserMessage: async () => {}, update: async () => chat },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
    autoNameSession: async () => {},
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "prompt", messageId: "m_11111111-2222-3333-4444-555555555555", message: "hello" }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(prompts[0].clientUserMessageId, "m_11111111-2222-3333-4444-555555555555");
  // Conduit states nothing itself: naming the row is the adapter's job here,
  // so two statements for one prompt would be the same duplicate from the server.
  assert.equal(published.filter((event) => event.op === "message.open").length, 0);
});
