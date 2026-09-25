import assert from "node:assert/strict";
import test from "node:test";
import { FxAcpAdapter } from "../src/fx-acp-adapter.js";

function setup() {
  const adapter = new FxAcpAdapter();
  const events = [];
  adapter.publish = (_record, event) => { events.push(event); };
  const record = {
    sessionId: "fx-session", loading: false, active: true, promptText: "hi", answering: "user-message",
    generation: { id: "generation" }, generationSeq: 0, steps: [], tools: new Map(), requests: new Map(), hostUiRequests: [], model: "test",
  };
  return { adapter, events, record };
}

const closeOf = (events, interim) => events.filter((event) => event.op === "message.close" && event.interim === interim);
const finalOf = (events, messageId) => events.findLast((event) => event.type === "assistant_content"
  && event.phase === "final" && event.messageId === messageId);

function update(adapter, record, sessionUpdate, update) {
  adapter.notification(record, { method: "session/update", params: { sessionId: record.sessionId, update: {
    sessionUpdate, ...update,
  } } });
}

test("fx ACP streams each step as a message of its own, then answers with the saved reply", async () => {
  const { adapter, events, record } = setup();
  adapter.json = async () => ({ history: [{ user: { text: "  hi \n" }, assistant: "Saved reply" }] });

  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-a", content: { type: "text", text: "[context]" } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-a", content: { type: "text", text: " notice" } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-b", content: { type: "text", text: "default" } });
  update(adapter, record, "agent_thought_chunk", { content: { type: "text", text: "I should reason" } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-c", content: { type: "text", text: "Live answer" } });

  const text = events.filter((event) => event.type === "assistant_content" && event.phase === "delta" && event.blockKind === "text");
  assert.deepEqual(text.map((event) => event.delta), ["[context]", " notice", "default", "Live answer"]);
  assert.equal(text[0].messageId, text[1].messageId);
  assert.notEqual(text[1].messageId, text[2].messageId);
  assert.notEqual(text[2].messageId, text[3].messageId);
  // Thinking opens the step its words then follow in.
  const thought = events.find((event) => event.type === "assistant_content" && event.phase === "delta" && event.blockKind === "thinking");
  assert.equal(thought.delta, "I should reason");
  assert.equal(thought.messageId, text[3].messageId);

  await adapter.finish(record, "end_turn");
  const [answer] = closeOf(events, false);
  assert.equal(answer.messageId, text[3].messageId);
  assert.equal(answer.content, "Saved reply");
  assert.equal(answer.stopReason, "stop");
  assert.equal(finalOf(events, answer.messageId).errorMessage, null);
  assert.deepEqual(closeOf(events, true).map((event) => [event.content, event.stopReason]), [["[context] notice", "toolUse"], ["default", "toolUse"]]);
  assert.equal(events.at(-1).phase, "settled");
});

test("fx ACP accepts the latest saved reply when its user text differs", async () => {
  const { adapter, events, record } = setup();
  adapter.json = async () => ({ history: [{ user: { text: "different prompt" }, assistant: "Latest saved reply" }] });

  await adapter.finish(record, "end_turn");
  const [answer] = closeOf(events, false);
  assert.equal(answer.content, "Latest saved reply");
  assert.equal(finalOf(events, answer.messageId).errorMessage, null);
});

test("fx ACP keeps the live reply when the saved session cannot be read", async () => {
  const { adapter, events, record } = setup();
  let reads = 0;
  adapter.json = async () => { reads += 1; throw new Error("session read failed"); };
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-a", content: { type: "text", text: "notice " } });
  update(adapter, record, "agent_message_chunk", { messageId: "fx-id-b", content: { type: "text", text: "reply" } });

  await adapter.finish(record, "end_turn");
  const [answer] = closeOf(events, false);
  assert.equal(reads, 1);
  assert.equal(answer.content, "reply");
  assert.equal(answer.stopReason, "error");
  assert.equal(finalOf(events, answer.messageId).errorMessage, "session read failed");
});
