import assert from "node:assert/strict";
import test from "node:test";
import { createLiveStream } from "../src/client/state/live-stream.ts";

function fixture() {
  const frames = [];
  const store = createLiveStream({ scheduleFrame: (callback) => { frames.push(callback); return frames.length; }, cancelFrame: () => {} });
  return { frames, store };
}

test("coalesces deltas into one Solid signal update per frame", () => {
  const { frames, store } = fixture();
  store.start("g1");
  store.append("g1", "one");
  store.append("g1", " two");
  assert.equal(frames.length, 1);
  assert.equal(store.content(), "");
  frames.shift()();
  assert.equal(store.content(), "one two");
});

test("flush publishes pending content and rejects stale generations", () => {
  const { frames, store } = fixture();
  store.start("g1");
  store.append("g1", "visible");
  assert.equal(store.append("g2", "late"), false);
  store.flush();
  assert.equal(store.content(), "visible");
  assert.equal(frames.length, 1);
});

test("ordinary clear resets visible and pending content", () => {
  const { store } = fixture();
  store.start("g1");
  store.append("g1", "pending");
  store.clear();
  assert.equal(store.content(), "");
  assert.equal(store.append("g2", "new"), true);
});
