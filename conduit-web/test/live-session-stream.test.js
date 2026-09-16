import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { serializeAttachmentEnvelope } from "../src/attachment-envelope.js";
import { createLiveSessionStream, interruptedPromptInput } from "../src/server/live-session-stream.js";

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
    manager: {},
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {
      resolveMany: async (_project, _chatId, ids) => {
        if (ids[0] === "slow") await new Promise((resolve) => setTimeout(resolve, 20));
        return [];
      },
      pathFor: () => "",
    },
    registry: { metadata: () => ({ backend: { implementation: "conduit_pi" } }) },
    config: {},
    findChatContext: async () => ({
      chat: { id: "chat_interrupt" },
      project: { id: "project-1" },
    }),
    lifecycle,
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
    manager: {},
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
    sessionFile: "/tmp/fork.jsonl", hostUiRequests: [],
  };
  const adapter = {
    getCapabilities: () => ({ fork: true, regenerate: true }),
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    fork: async () => { operations.push("fork"); return { opaqueSession: "/tmp/fork.jsonl" }; },
    publish: (_record, event) => { operations.push(event); },
    readTranscript: async () => ({
      messages: [{ id: "user-kept", role: "user", content: "keep" }],
      tools: [],
    }),
    prompt: async () => { operations.push("prompt"); return "generation-1"; },
  };
  const chat = { id: "chat-1", title: "Chat", backend: { implementation: "conduit_pi" } };
  const project = { id: "project-1", kind: "workspace", workingRoot: "/tmp" };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = () => {};
  const stream = createLiveSessionStream({
    manager: {},
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
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "fork_and_prompt", entryId: "user-old", message: "replacement" }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(operations[0], "fork");
  assert.deepEqual(operations[2], {
    type: "transcript_sync",
    generationId: null,
    replaceAll: true,
    messages: [{ id: "user-kept", role: "user", content: "keep" }],
    tools: [],
  });
  assert.equal(operations[3], "prompt");
});

test("a fork submits its prompt before Pi creates the child session file", async () => {
  const operations = [];
  const updates = [];
  const sent = [];
  const record = {
    id: "live-1", chatId: "chat-1", projectId: "project-1", status: "running",
    sessionFile: "/tmp/provisional-fork.jsonl", hostUiRequests: [],
  };
  const adapter = {
    getCapabilities: () => ({ fork: true, regenerate: true }),
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    fork: async () => { operations.push("fork"); return { opaqueSession: "/tmp/provisional-fork.jsonl" }; },
    publish: (_record, event) => { operations.push(event.type); },
    readTranscript: async () => {
      operations.push("read");
      throw Object.assign(new Error("session file not written"), { code: "ENOENT" });
    },
    prompt: async () => { operations.push("prompt"); return "generation-1"; },
  };
  const chat = {
    id: "chat-1", status: "active", title: "Chat",
    backend: { implementation: "conduit_pi", opaqueSession: "/tmp/durable-session.jsonl" },
  };
  const project = { id: "project-1", kind: "workspace", workingRoot: "/tmp" };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = (message) => { sent.push(JSON.parse(message)); };
  const stream = createLiveSessionStream({
    manager: {},
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {
      resolveMany: async () => [],
      recordMessage: async () => {},
    },
    registry: {
      metadata: () => chat,
      update: async (_id, patch) => { updates.push(patch); return chat; },
      markUserMessage: async () => chat,
    },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "fork_and_prompt", entryId: "user-old", message: "replacement" }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(operations, ["fork", "read", "history_forked", "prompt"]);
  assert.deepEqual(updates, [{ backend: { implementation: "conduit_pi", opaqueSession: "/tmp/provisional-fork.jsonl" } }]);
  assert.equal(chat.backend.opaqueSession, "/tmp/durable-session.jsonl");
  assert.equal(sent.some((event) => event.type === "client_error"), false);
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
    manager: {},
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: {},
    registry: { metadata: () => ({ backend: { implementation: "conduit_pi" } }) },
    config: {},
    findChatContext: async () => ({
      chat: { id: "chat-1" },
      project: { id: "project-1" },
    }),
    lifecycle,
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "backend_native_command", payload: { destructive: true } }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent.at(-1), {
    type: "client_error",
    code: "invalid_request",
    message: "Unknown live-session command: backend_native_command",
  });
});
