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
    backends,
  });

  stream.handleUpgrade(record.id, {}, {}, null);
  ws.emit("message", JSON.stringify({ type: "steer", message: "first", attachmentIds: ["slow"] }));
  ws.emit("message", JSON.stringify({ type: "steer", message: "second", attachmentIds: [] }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(delivered.length, 2);
  assert.match(delivered[0], /<user_message>\nfirst\n<\/user_message>/);
  assert.match(delivered[1], /<user_message>\nsecond\n<\/user_message>/);
});
