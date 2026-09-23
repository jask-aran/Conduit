import assert from "node:assert/strict";
import test from "node:test";
import { FxAcpAdapter } from "../src/fx-acp-adapter.js";

function setup() {
  const adapter = new FxAcpAdapter();
  const events = [];
  adapter.publish = (_record, event) => { events.push(event); };
  const record = {
    sessionId: "fx-session", loading: false, active: true, promptText: "hi", answering: "user-message",
    generation: { id: "generation" }, generationSeq: 0, answer: null, tools: new Map(), model: "test",
    traceMessages: [], reasoningMessage: null, currentFxMessageId: null, currentActivity: null, liveMessageText: "",
  };
  return { adapter, events, record };
}

function update(adapter, record, sessionUpdate, update) {
  adapter.notification(record, { method: "session/update", params: { sessionId: record.sessionId, update: {
    sessionUpdate, ...update,
  } } });
}

test("fx ACP streams reasoning and message chunks into trace, then uses the saved reply", async () => {
  const { adapter, events, record } = setup();
  adapter.json = async () => ({ history: [{ user: { text: "  hi \n" }, assistant: "Saved reply" }] });

  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-a", content: { type: "text", text: "[context]" } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-a", content: { type: "text", text: " notice" } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-b", content: { type: "text", text: "default" } });
  update(adapter, record, "agent_thought_chunk", { content: { type: "text", text: "I should reason" } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-c", content: { type: "text", text: "Live answer" } });

  const narration = events.filter((event) => event.type === "assistant_content"
    && event.phase === "delta" && event.blockKind === "narration");
  assert.deepEqual(narration.map((event) => event.delta), ["[context]", " notice", "default", "Live answer"]);
  assert.equal(narration[0].messageId, narration[1].messageId);
  assert.notEqual(narration[1].messageId, narration[2].messageId);
  assert.notEqual(narration[2].messageId, narration[3].messageId);
  assert.equal(events.some((event) => event.type === "assistant_content" && event.phase === "delta"
    && event.blockKind === "thinking" && event.delta === "I should reason"), true);
  assert.equal(events.some((event) => event.type === "assistant_content" && event.phase === "delta"
    && event.blockKind === "text"), false);

  await adapter.finish(record, "end_turn");
  const final = events.find((event) => event.type === "assistant_content" && event.phase === "final"
    && event.messageId === record.answer.id);
  assert.equal(final.blocks[0].text, "Saved reply");
  assert.equal(final.errorMessage, null);
  assert.equal(final.blocks.some((block) => block.text?.includes("[context]")), false);
  assert.equal(events.at(-1).phase, "settled");
});

test("fx ACP accepts the latest saved reply when its user text differs", async () => {
  const { adapter, events, record } = setup();
  adapter.json = async () => ({ history: [{ user: { text: "different prompt" }, assistant: "Latest saved reply" }] });

  await adapter.finish(record, "end_turn");
  const final = events.find((event) => event.type === "assistant_content" && event.phase === "final"
    && event.messageId === record.answer.id);
  assert.equal(final.blocks[0].text, "Latest saved reply");
  assert.equal(final.errorMessage, null);
});

test("fx ACP uses concatenated live message chunks when the saved session cannot be read", async () => {
  const { adapter, events, record } = setup();
  let reads = 0;
  adapter.json = async () => { reads += 1; throw new Error("session read failed"); };
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-a", content: { type: "text", text: "notice " } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-b", content: { type: "text", text: "reply" } });

  await adapter.finish(record, "end_turn");
  const final = events.find((event) => event.type === "assistant_content" && event.phase === "final"
    && event.messageId === record.answer.id);
  assert.equal(reads, 1);
  assert.equal(final.blocks[0].text, "notice reply");
  assert.equal(final.stopReason, "error");
  assert.equal(final.errorMessage, "session read failed");
});
