import assert from "node:assert/strict";
import test from "node:test";
import { SessionRecords } from "../src/harnesses/session-records.js";
import { ChatLogs } from "../src/server/chat-log.js";
import { messageOpen } from "../src/harnesses/transcript-ops.js";

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
