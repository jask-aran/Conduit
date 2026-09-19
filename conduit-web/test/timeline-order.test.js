import assert from "node:assert/strict";
import test from "node:test";
import { assignToolSeq, mergeToolEvent } from "../src/client/timeline-order.ts";

// What is left here is the live tool activity that still arrives outside the
// chat's order. Everything else this file used to cover -- merging a synced
// turn into one the client had assembled, claiming a row for an answer,
// settling it afterwards -- was the client working out a transcript for
// itself. The server states it now, and `transcript-fold.test.js` covers the
// statements. See `transcript-pipeline.test.js` for what a chat looks like.

test("mergeToolEvent preserves first-seen timestamp and seq on reconnect replay", () => {
  let seq = 0;
  const first = mergeToolEvent([], {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "read",
    timestamp: "2026-01-01T00:00:00.000Z",
  }, { nextSeq: () => seq++ });
  assert.equal(first.tools[0].seq, 0);
  assert.equal(first.tools[0].timestamp, "2026-01-01T00:00:00.000Z");

  const replay = mergeToolEvent(first.tools, {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "read",
    timestamp: "2026-07-17T12:00:00.000Z",
  }, { nextSeq: () => seq++ });
  assert.equal(replay.tools.length, 1);
  assert.equal(replay.tools[0].timestamp, "2026-01-01T00:00:00.000Z");
  assert.equal(replay.tools[0].seq, 0);
});

test("assignToolSeq fills missing seq values", () => {
  const tools = assignToolSeq([{ id: "a" }, { id: "b", seq: 7 }]);
  assert.equal(tools[0].seq, 0);
  assert.equal(tools[1].seq, 7);
});

