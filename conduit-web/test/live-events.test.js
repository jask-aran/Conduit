import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLiveEvent } from "../src/client/api/live-events.ts";

test("preserves a sync that replaces the whole transcript", () => {
  assert.deepEqual(normalizeLiveEvent({
    type: "transcript_sync",
    generationId: null,
    replace: true,
    messages: [{ id: "user-kept", role: "user" }],
    tools: [],
  }), {
    type: "transcript_sync",
    generationId: null,
    replace: true,
    messages: [{ id: "user-kept", role: "user" }],
    tools: [],
  });
});

test("an op arrives at the client as the server stated it", () => {
  // Not rebuilt: the op is checked where it is made, and anything the builders
  // add travels without this file learning about it first.
  const op = {
    type: "transcript_op",
    op: "message.open",
    generationId: "g1",
    after: "m_prompt",
    answers: "m_prompt",
    message: { id: "m_answer", role: "assistant" },
    log: { id: "log-1", seq: 7 },
  };
  assert.deepEqual(normalizeLiveEvent(op), op);
  // An op name nothing applies is not passed through as one.
  assert.deepEqual(normalizeLiveEvent({ ...op, op: "message.rewrite" }),
    { type: "unknown", sourceType: "transcript_op", generationId: "g1", log: { id: "log-1", seq: 7 } });
});

test("a generation event is folded only if it carries what the folds read", () => {
  const final = { type: "assistant_content", phase: "final", generationId: "g1", seq: 4,
    messageId: "m1", blocks: [], stopReason: "stop" };
  assert.deepEqual(normalizeLiveEvent(final), final, "stated as the server sent it");
  // Blocks the browser's store maps over. Without them this passed the boundary
  // and threw inside the fold, which is a crash rather than a dropped event.
  assert.equal(normalizeLiveEvent({ ...final, blocks: undefined }).type, "unknown");
  // A phase neither fold has a case for takes no place in the turn.
  assert.equal(normalizeLiveEvent({ ...final, phase: "midway" }).type, "unknown");
  // What the session is busy with is not a transition, and no longer travels as
  // a status with no phase.
  assert.equal(normalizeLiveEvent({ type: "status", generationId: "g1", seq: 5, activity: "waiting_for_user" }).type,
    "unknown");
  const delta = { type: "assistant_content", phase: "delta", generationId: "g1", seq: 5,
    messageId: "m1", contentIndex: 0, blockKind: "text", delta: "hi" };
  assert.deepEqual(normalizeLiveEvent(delta), delta);
  assert.equal(normalizeLiveEvent({ ...delta, contentIndex: undefined }).type, "unknown");
  // A block is text, thinking or a tool call. Anything else is a block kind the
  // renderer has no case for, arriving as one it does.
  assert.equal(normalizeLiveEvent({ ...delta, blockKind: "diagram" }).type, "unknown");
  // And a tool is named when it starts, because that is what the row says while
  // it runs.
  const tool = { type: "tool_activity", phase: "start", generationId: "g1", seq: 6,
    toolCallId: "call_1", name: "read", input: {} };
  assert.deepEqual(normalizeLiveEvent(tool), tool);
  assert.equal(normalizeLiveEvent({ ...tool, name: undefined }).type, "unknown");
});

test("unknown wire events cannot masquerade as lifecycle events", () => {
  assert.deepEqual(normalizeLiveEvent({ type: "future_protocol_event", generationId: "g2" }), {
    type: "unknown",
    sourceType: "future_protocol_event",
    generationId: "g2",
  });
});
