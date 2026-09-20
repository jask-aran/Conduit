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
// The stream names every message it sends. These tests are about what it does
// with commands, not about identity, so the ledger answers plainly.
const messageIds = {
  owns: () => true,
  load: async () => ({}),
  claim: async (_project, _chat, _role, offered) => offered || "m_claimed",
  mint: async () => "m_minted",
  claimNow: () => "m_answer",
  bind: async () => null,
  release: async () => {},
  // The real ledger frees a name whose entry a fork abandoned, and refuses one
  // it never minted. Both matter here: the first is what keeps the row, the
  // second is what makes a prompt adopted from history fall back to a new name.
  reclaim: async (_project, _chat, messageId) => (String(messageId).startsWith("m_") ? messageId : null),
  resolver: async () => (id) => id,
  entryIdFor: async (_project, _chat, id) => id,
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
      recordMessage: async () => {},
    },
    registry: { metadata: () => ({ backend: { implementation: "conduit_pi" } }) },
    config: {},
    findChatContext: async () => ({
      chat: { id: "chat_interrupt" },
      project: { id: "project-1" },
    }),
    lifecycle,
    messageIds,
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
    messageIds,
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
    messageIds,
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
    messageIds,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "fork_and_prompt", entryId: "user-old", message: "replacement" }));
  await new Promise((resolve) => setImmediate(resolve));

  // The prompt's own message is stated before it is sent: the harness can start
  // answering while its acceptance is still in flight, and an answer must not
  // be placed before the prompt it answers exists.
  assert.deepEqual(operations, ["fork", "history_truncated", "transcript_op", "transcript_op", "prompt"]);
  assert.deepEqual(updates, [{ backend: { implementation: "conduit_pi", opaqueSession: "/tmp/provisional-fork.jsonl" } }]);
  assert.equal(chat.backend.opaqueSession, "/tmp/durable-session.jsonl");
  assert.equal(sent.some((event) => event.type === "error"), false);
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
    messageIds,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "backend_native_command", payload: { destructive: true } }));
  await new Promise((resolve) => setImmediate(resolve));

  // Conduit's own words, sent without passing through a harness translator:
  // the same rejection used to reach the browser as `client_error` on three
  // harnesses and as a `backend_unavailable` runtime failure on Pi.
  assert.deepEqual(sent.at(-1), {
    type: "error",
    scope: "request",
    generationId: null,
    error: { code: "invalid_request", message: "Unknown live-session command: backend_native_command" },
  });
});

/**
 * Regenerating re-asks a prompt; it does not replace it.
 *
 * The row on screen was taken away and an identical one sent back, because the
 * fork cut through the prompt and the replacement was minted a new name. For
 * the reader that is the bubble disappearing for a round trip and returning
 * unchanged -- a flicker with nothing behind it, since the words cannot differ.
 */
test("regenerate keeps the prompt it re-asks, under the name it already had", async () => {
  const published = [];
  const sent = [];
  const record = { id: "live-1", chatId: "chat-1", projectId: "project-1", status: "running", hostUiRequests: [] };
  const adapter = {
    getCapabilities: () => ({ fork: true, regenerate: true }),
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    fork: async () => ({ opaqueSession: "/tmp/fork.jsonl", sourceMessage: { id: "m_held", text: "a longer story" } }),
    publish: (_record, event) => { published.push(event); },
    readTranscript: async () => ({ messages: [], tools: [] }),
    prompt: async () => "generation-2",
  };
  const chat = {
    id: "chat-1", status: "active", title: "Chat",
    backend: { implementation: "conduit_pi", opaqueSession: "/tmp/session.jsonl" },
  };
  const project = { id: "project-1", kind: "workspace", workingRoot: "/tmp" };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = (message) => { sent.push(JSON.parse(message)); };
  const stream = createLiveSessionStream({
    manager: {},
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: { resolveMany: async () => [], recordMessage: async () => {} },
    registry: { metadata: () => chat, update: async () => chat, markUserMessage: async () => chat },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    messageIds,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
  });
  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "regenerate", entryId: "m_held" }));
  await new Promise((resolve) => setImmediate(resolve));

  // The history now ends *after* the prompt, not before it.
  assert.deepEqual(published.find((event) => event.type === "history_truncated"),
    { type: "history_truncated", afterMessageId: "m_held" });
  const cut = published.find((event) => event.op === "message.drop");
  assert.equal(cut.messageId, "m_held");
  assert.equal(cut.keep, true, "the prompt stands; only what it produced goes");
  assert.equal(cut.inclusive, undefined);

  // And the prompt is restated under the name the row already has, so the
  // client folds it into the row it is holding instead of drawing a second one.
  const opened = published.filter((event) => event.op === "message.open");
  assert.deepEqual(opened.map((event) => event.message.id), ["m_held"]);
  assert.equal(opened[0].message.content, "a longer story");
  assert.equal(sent.some((event) => event.type === "error"), false);
});

test("a prompt adopted from history has no name to keep, and is re-sent under a new one", async () => {
  const published = [];
  const record = { id: "live-1", chatId: "chat-1", projectId: "project-1", status: "running", hostUiRequests: [] };
  const adapter = {
    getCapabilities: () => ({ fork: true, regenerate: true }),
    attach: () => null,
    view: () => record,
    toClientEvent: (event) => event,
    refreshContext: async () => {},
    fork: async () => ({ opaqueSession: "/tmp/fork.jsonl", sourceMessage: { id: "pi:entry-9", text: "typed in the CLI" } }),
    publish: (_record, event) => { published.push(event); },
    readTranscript: async () => ({ messages: [], tools: [] }),
    prompt: async () => "generation-2",
  };
  const chat = {
    id: "chat-1", status: "active", title: "Chat",
    backend: { implementation: "conduit_pi", opaqueSession: "/tmp/session.jsonl" },
  };
  const project = { id: "project-1", kind: "workspace", workingRoot: "/tmp" };
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = () => {};
  const stream = createLiveSessionStream({
    manager: {},
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: { resolveMany: async () => [], recordMessage: async () => {} },
    registry: { metadata: () => chat, update: async () => chat, markUserMessage: async () => chat },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    messageIds,
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
  });
  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "regenerate", entryId: "pi:entry-9" }));
  await new Promise((resolve) => setImmediate(resolve));

  // `pi:<entryId>` is the entry's own name, and the entry is what the fork just
  // abandoned, so there is nothing to keep. The cut still keeps the row, and the
  // replacement simply arrives under a name of its own.
  assert.deepEqual(published.filter((event) => event.op === "message.open").map((event) => event.message.id),
    ["m_claimed"]);
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
    manager: {},
    wss: { handleUpgrade: (_request, _socket, _head, accept) => accept(ws) },
    attachments: { resolveMany: async () => [], pathFor: () => "", recordMessage: async () => {} },
    registry: { metadata: () => chat, markUserMessage: async () => {}, update: async () => chat },
    config: {},
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    // This harness names its own messages, so the ledger claims nothing.
    messageIds: { ...messageIds, owns: () => false, claim: async () => null },
    chatLogs: new ChatLogs(),
    backends: { get: () => record, forChat: () => adapter },
    autoNameSession: async () => {},
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "prompt", messageId: "m_11111111-2222-3333-4444-555555555555", message: "hello" }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(prompts[0].clientUserMessageId, "m_11111111-2222-3333-4444-555555555555");
  // And Conduit states nothing itself: naming the row is the adapter's job here,
  // so two statements for one prompt would be the same duplicate from the server.
  assert.equal(published.filter((event) => event.op === "message.open").length, 0);
});
