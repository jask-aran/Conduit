import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createLiveSessionStream } from "../src/server/live-session-stream.js";
import { ChatLogs } from "../src/server/chat-log.js";

const lifecycle = {
  run: (_chatId, operation) => operation(),
  assertAvailable: () => {},
};

test("one socket delivers backend commands in browser order", async () => {
  const delivered = [];
  const record = {
    id: "live-1", chatId: "chat_interrupt", status: "running",
    queue: { steering: [], followUp: [] }, hostUiRequests: [],
  };
  const adapter = {
    attach: () => null,
    view: () => record,
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

  // A fork does not read the forked transcript back: the branch keeps the entry
  // ids of everything it retains, so there is nothing for a re-read to correct.
  assert.equal(operations[0], "fork");
  assert.deepEqual(operations.filter((item) => typeof item === "string"), ["fork", "prompt"]);
  assert.deepEqual(operations.filter((item) => item?.type).map((item) => item.type),
    // The prompt's own row is the adapter's to state, not the server's.
    ["history_truncated", "transcript_op"]);
  assert.deepEqual(operations.find((item) => item?.type === "history_truncated"),
    { type: "history_truncated", beforeMessageId: "user-old" });
});

test("an unknown browser command cannot reach a backend escape hatch", async () => {
  const sent = [];
  const record = { id: "live-1", chatId: "chat-1", status: "running", hostUiRequests: [] };
  const adapter = {
    attach: () => null,
    view: () => record,
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

  // Conduit's own words, sent without passing through a harness translator.
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
