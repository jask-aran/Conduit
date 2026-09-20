import assert from "node:assert/strict";
import test from "node:test";
import { SessionRecords } from "../src/harnesses/session-records.js";
import { ChatLogs } from "../src/server/chat-log.js";
import { messageOpen, toolClose, toolOpen } from "../src/harnesses/transcript-ops.js";

const CAPABILITIES = Object.freeze({ history: "linear", steer: false, cancel: true });
const BACKEND = { protocol: "native_api", implementation: "test", installationId: "test" };

const socket = () => {
  const sent = [];
  return { readyState: 1, sent, send(payload) { sent.push(JSON.parse(payload)); }, once() {} };
};

const records = (options) => new SessionRecords({ capabilities: CAPABILITIES, backend: BACKEND, ...options });
const record = () => ({ id: "live", chatId: "chat", status: "running", activity: "idle",
  active: true, stopping: false, generation: { id: "g1" }, clients: new Set(), events: [] });

const delta = (index) => ({ type: "assistant_content", phase: "delta", generationId: "g1",
  messageId: "m1", contentIndex: 0, blockKind: "text", delta: `${index} ` });

test("a turn's paint costs the replay buffer one slot per block, not one per token", () => {
  const sessions = records({ logs: new ChatLogs() });
  const live = sessions.add(record());
  sessions.publish(live, messageOpen({ id: "m1", role: "assistant", generationId: "g1", answers: "u1" }));
  for (let index = 0; index < 2000; index += 1) sessions.publish(live, delta(index));

  // One op, one block. Two thousand deltas used to be two thousand entries,
  // which is how a busy turn evicted its own structure.
  assert.equal(live.events.length, 2);
  assert.equal(live.events[0].op, "message.open");
  assert.equal(live.events[1].phase, "delta");
});

test("a browser arriving mid-answer is replayed the whole answer, from its beginning", () => {
  const sessions = records({ logs: new ChatLogs() });
  const live = sessions.add(record());
  sessions.publish(live, messageOpen({ id: "m1", role: "assistant", generationId: "g1", answers: "u1" }));
  const written = [];
  for (let index = 0; index < 1200; index += 1) {
    written.push(`${index} `);
    sessions.publish(live, delta(index));
  }

  const late = socket();
  sessions.attach(live.id, late);
  const replayed = late.sent.filter((event) => event.phase === "delta").map((event) => event.delta).join("");
  // The window was the last 500 events, so what a reconnecting browser got was
  // a slice out of the middle of the answer and nothing that placed the row.
  assert.equal(replayed, written.join(""));
  assert.equal(late.sent.filter((event) => event.op === "message.open").length, 1);
});

test("separate blocks and separate tools keep their own place in the replay", () => {
  const sessions = records({ logs: new ChatLogs() });
  const live = sessions.add(record());
  sessions.publish(live, { ...delta(0), contentIndex: 0, blockKind: "thinking", delta: "plan " });
  sessions.publish(live, { ...delta(1), contentIndex: 1, blockKind: "text", delta: "answer " });
  sessions.publish(live, { ...delta(2), contentIndex: 0, blockKind: "thinking", delta: "more " });
  sessions.publish(live, { type: "tool_activity", phase: "update", generationId: "g1", toolCallId: "call_1", output: "one" });
  sessions.publish(live, { type: "tool_activity", phase: "update", generationId: "g1", toolCallId: "call_1", output: "two" });

  assert.equal(live.events.length, 3);
  assert.equal(live.events[0].delta, "plan more ", "same block merges wherever it arrives");
  assert.equal(live.events[1].delta, "answer ", "a different block is a different entry");
  // A tool's progress is a restatement, not an accumulation: the latest stands.
  assert.equal(live.events[2].output, "two");
});

test("an event already sent is never changed by a later merge", () => {
  const sessions = records({ logs: new ChatLogs() });
  const live = sessions.add(record());
  const watching = socket();
  sessions.attach(live.id, watching);
  const first = sessions.publish(live, delta(0));
  sessions.publish(live, delta(1));
  // The delivery layer serializes an event once and caches it against that
  // object, so the buffer merges into a copy rather than into what went out.
  assert.equal(first.delta, "0 ");
});

test("structure survives a buffer long past its limit", () => {
  const sessions = records({ logs: new ChatLogs(), replayLimit: 4 });
  const live = sessions.add(record());
  sessions.publish(live, messageOpen({ id: "m1", role: "assistant", generationId: "g1", answers: "u1" }));
  for (let index = 0; index < 50; index += 1) {
    sessions.publish(live, { ...delta(index), contentIndex: index, blockKind: "text" });
  }
  assert.equal(live.events.length, 4);
  // The op is still there. It used to be the first thing evicted, because the
  // buffer dropped by age and a turn with more blocks than slots pushed out the
  // row its own deltas were painting into -- so a browser arriving late was
  // sent text for a message it had never been told existed.
  assert.equal(live.events[0].op, "message.open");
  // Evicted paint lets go of its merge key, so a new block does not merge into
  // an entry that is no longer in the buffer.
  assert.ok(live.paint.size <= 4);
  sessions.publish(live, { ...delta(0), contentIndex: 0, blockKind: "text" });
  assert.equal(live.events.at(-1).delta, "0 ");
});

test("a tool-heavy turn keeps its structure, not its paint", () => {
  // Paint that cannot be merged -- a message starting, a tool starting and
  // ending -- was not recognised as paint by the eviction, because the question
  // asked was "does this merge". So a turn calling tools kept its own starts
  // and ends and evicted the row they belong under.
  const sessions = records({ logs: new ChatLogs(), replayLimit: 6 });
  const live = sessions.add(record());
  sessions.publish(live, messageOpen({ id: "m1", role: "assistant", generationId: "g1", answers: "u1" }));
  for (let index = 0; index < 2; index += 1) {
    const toolCallId = `call_${index}`;
    sessions.publish(live, { type: "tool_activity", phase: "start", generationId: "g1", seq: index, toolCallId, name: "read" });
    sessions.publish(live, toolOpen({ toolCallId, name: "read", input: {}, generationId: "g1" }));
    sessions.publish(live, { type: "tool_activity", phase: "end", generationId: "g1", seq: index, toolCallId, output: "ok" });
    sessions.publish(live, toolClose({ toolCallId, output: "ok", generationId: "g1" }));
  }
  assert.equal(live.events.length, 6);
  // Every statement the turn made is still there; what went is the paint that
  // drew them arriving.
  assert.deepEqual(live.events.filter((event) => event.type === "transcript_op").map((event) => event.op),
    ["message.open", "tool.open", "tool.close", "tool.open", "tool.close"]);
  assert.equal(live.events.filter((event) => event.type === "tool_activity").length, 1,
    "paint is given up first, in every phase");
});
