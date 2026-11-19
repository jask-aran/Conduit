import assert from "node:assert/strict";
import test from "node:test";
import { assertChatBackendAdapter } from "../src/chat-backend-contract.js";
import { manifest } from "../src/harnesses/test-stream.js";
import { applyTranscriptOp, isToolOp } from "../src/transcript-fold.js";
import { TestStreamAdapter } from "../src/test-stream-adapter.js";

const settle = (adapter) => new Promise((resolve) => adapter.once("settled", resolve));

test("a fork cuts the chat at the entry it was given", async () => {
  const adapter = new TestStreamAdapter();
  assertChatBackendAdapter(adapter, manifest.id, manifest.capabilities);
  const record = await adapter.create({ chatId: "chat-parity", model: "flood-4000", thinkingLevel: "400 tokens" });
  let streamed = [];
  adapter.attach(record.id, { readyState: 1, once() {}, send(payload) {
    const event = JSON.parse(payload);
    if (event.type === "transcript_op" && !isToolOp(event)) streamed = applyTranscriptOp(streamed, event);
  } });
  await adapter.prompt(record.id, "40t", { clientUserMessageId: "u1" });
  await settle(adapter);
  await adapter.prompt(record.id, "40t second", { clientUserMessageId: "u2" });
  await settle(adapter);
  assert.equal(streamed.length, 4);
  const { messages, page } = await adapter.readTranscript({ liveSessionId: record.id });
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(messages[1].answers, messages[0].id);
  assert.equal(messages[1].interim, false);
  assert.deepEqual(page, { before: null });

  const forked = await adapter.fork(record.id, { nodeId: "u2" });
  assert.equal(forked.sourceMessage.text, "40t second", "what was asked there, so a regenerate can re-ask it");
  assert.deepEqual(streamed.map((message) => message.id), ["u1", streamed[1].id]);
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
