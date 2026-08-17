import assert from "node:assert/strict";
import test from "node:test";
import { createTranscriptTruth } from "../src/server/dictation-stream.js";

test("transcript truth accepts higher tentative revisions and removes covered text", () => {
  const events = [];
  const truth = createTranscriptTruth("session-1", { onEvent: (event) => events.push(event) });

  assert.deepEqual(truth.acceptTentative({
    regionId: "region-1",
    revision: 1,
    text: "hello wor",
    fromSample: 0,
    throughSample: 4_000,
  }), { accepted: true, revision: 1 });
  assert.equal(truth.displayText(), "hello wor");

  assert.deepEqual(truth.acceptTentative({
    regionId: "region-1",
    revision: 1,
    text: "stale",
    fromSample: 0,
    throughSample: 4_000,
  }), { accepted: false, revision: 1 });
  assert.equal(truth.displayText(), "hello wor");

  assert.deepEqual(truth.acceptStableSegment({
    segmentId: "segment-1",
    sequence: 0,
    text: "hello world",
    fromSample: 0,
    throughSample: 4_000,
  }), { accepted: true, sequence: 0 });
  assert.equal(truth.displayText(), "hello world");
  assert.equal(truth.tentativeRegions().length, 0);
  assert.deepEqual(events.map((event) => event.type), ["tentative_region", "stable_segment"]);
  assert.equal(events[1].segmentId, "segment-1");
});

test("stable segments are append-only and idempotent", () => {
  const truth = createTranscriptTruth("session-2");
  const segment = {
    segmentId: "segment-1",
    sequence: 0,
    text: "first phrase",
    fromSample: 0,
    throughSample: 8_000,
  };

  assert.deepEqual(truth.acceptStableSegment(segment), { accepted: true, sequence: 0 });
  assert.deepEqual(truth.acceptStableSegment(segment), { accepted: false, sequence: 0 });
  assert.throws(() => truth.acceptStableSegment({ ...segment, text: "changed" }), /stable segment/i);
  assert.throws(() => truth.acceptStableSegment({
    segmentId: "segment-2",
    sequence: 0,
    text: "out of order",
    fromSample: 8_000,
    throughSample: 9_000,
  }), /sequence/i);
});

test("session final is derived from stable transcript and rejects unrelated runtime text", () => {
  const events = [];
  const truth = createTranscriptTruth("session-3", { onEvent: (event) => events.push(event) });
  truth.acceptStableSegment({
    segmentId: "segment-1",
    sequence: 0,
    text: "first",
    fromSample: 0,
    throughSample: 8_000,
  });

  assert.deepEqual(truth.acceptSessionFinal({ text: "first", committedThroughSample: 8_000 }), {
    type: "session_final",
    sessionId: "session-3",
    text: "first",
    committedThroughSample: 8_000,
  });
  assert.throws(() => truth.acceptSessionFinal({ text: "unrelated", committedThroughSample: 8_000 }), /transcript/i);
  assert.deepEqual(truth.watermarks(), {
    submittedThroughSample: 0,
    processedThroughSample: null,
    committedThroughSample: 8_000,
  });
  assert.equal(events.at(-1).type, "session_final");
});

test("tentative output can be discarded for a from-zero fallback", () => {
  const truth = createTranscriptTruth("session-4");
  truth.acceptTentative({
    regionId: "region-1",
    revision: 4,
    text: "unstable phrase",
    fromSample: 0,
    throughSample: 12_000,
  });

  assert.equal(truth.discardTentative().discardedRevisions, 1);
  assert.equal(truth.displayText(), "");
});
