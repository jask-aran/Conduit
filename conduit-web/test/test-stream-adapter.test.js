import assert from "node:assert/strict";
import test from "node:test";
import { assertChatBackendAdapter } from "../src/chat-backend-contract.js";
import { manifest } from "../src/harnesses/test-stream.js";
import { buildTurnRows } from "../src/client/turn-rows.ts";
import { applyToolOp, applyTranscriptOp, isToolOp } from "../src/transcript-fold.js";
import { TestStreamAdapter } from "../src/test-stream-adapter.js";

const settle = (adapter) => new Promise((resolve) => adapter.once("settled", resolve));

async function streamed(adapter, { model, thinkingLevel, prompt, clientUserMessageId }) {
  const record = await adapter.create({ chatId: `chat-${model}`, model, thinkingLevel });
  const socket = { readyState: 1, sent: [], send(payload) { this.sent.push(JSON.parse(payload)); }, once() {} };
  adapter.attach(record.id, socket);
  const startedAt = Date.now();
  await adapter.prompt(record.id, prompt, { clientUserMessageId });
  await settle(adapter);
  return { record, socket, elapsedMs: Date.now() - startedAt };
}

test("the test backend satisfies the same adapter contract as a real one", () => {
  // The point of a fake harness is that nothing downstream can tell. If it
  // needed an exemption from the contract it would stop being a measurement of
  // the real path and become a measurement of the exemption.
  assertChatBackendAdapter(new TestStreamAdapter(), manifest.id, manifest.capabilities);
});

test("a chat reads back the transcript it streamed", async () => {
  const adapter = new TestStreamAdapter();
  const { record } = await streamed(adapter, { model: "paced-60", prompt: "60t" });
  const { messages, page } = await adapter.readTranscript({ liveSessionId: record.id });

  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
  // Stated on the read, exactly as the socket stated them, because turn-rows
  // refuses a message that says neither.
  assert.equal(messages[1].answers, messages[0].id);
  assert.equal(messages[1].interim, false);
  assert.ok(messages[1].content.includes("quick brown fox"));
  assert.deepEqual(page, { before: null });
});

function readerOf(adapter) {
  let messages = [];
  let tools = [];
  const record = { messages, tools, events: [] };
  const socket = { readyState: 1, sent: [], once() {},
    send(payload) {
      const event = JSON.parse(payload);
      record.events.push(event);
      if (event.type !== "transcript_op") return;
      if (isToolOp(event)) tools = applyToolOp(tools, event);
      else messages = applyTranscriptOp(messages, event);
    } };
  return { socket,
    messages: () => messages,
    tools: () => tools,
    events: () => record.events,
    rows: () => buildTurnRows(messages, tools) };
}

const attached = async (adapter, options = {}) => {
  const record = await adapter.create({ chatId: options.chatId || "chat-parity", model: "flood-4000",
    thinkingLevel: "400 tokens" });
  const reader = readerOf(adapter);
  adapter.attach(record.id, reader.socket);
  return { record, reader };
};

test("a fork cuts the chat at the entry it was given", async () => {
  const adapter = new TestStreamAdapter();
  const { record, reader } = await attached(adapter);
  await adapter.prompt(record.id, "40t", { clientUserMessageId: "u1" });
  await settle(adapter);
  await adapter.prompt(record.id, "40t second", { clientUserMessageId: "u2" });
  await settle(adapter);
  assert.equal(reader.messages().length, 4);

  const forked = await adapter.fork(record.id, { nodeId: "u2" });
  assert.equal(forked.sourceMessage.text, "40t second", "what was asked there, so a regenerate can re-ask it");
  assert.deepEqual(reader.messages().map((message) => message.id), ["u1", reader.messages()[1].id]);
  assert.equal(adapter.readJournal(record.chatId).filter((event) => event.op === "message.drop").length, 1,
    "one cut is one record operation");
  const history = await adapter.readHistory({ liveSessionId: record.id });
  assert.equal(history.mode, "tree");
  assert.equal(history.tree[0].entry.forkable, true);
});

test("a browser that arrives mid-turn is given the turn so far", async () => {
  const adapter = new TestStreamAdapter();
  const record = await adapter.create({ chatId: "chat-replay", model: "paced-60", thinkingLevel: "400 tokens" });
  await adapter.prompt(record.id, "400t", { clientUserMessageId: "u1" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const resume = adapter.replay(record.id);
  assert.equal(resume.type, "generation_replay");
  assert.equal(resume.generation.status, "running");
  assert.ok(resume.generation.assistantMessages[0].blocks[0].text.length > 0,
    "reduced from what it published, with the reducer the browser runs");
  await adapter.cancel(record.id);
});
