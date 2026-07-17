import assert from "node:assert/strict";
import test from "node:test";
import { createLiveStreamStore } from "../src/client/live-stream-store.js";

function fixture() {
  const frames = [];
  const store = createLiveStreamStore({ scheduleFrame: (callback) => { frames.push(callback); return callback; }, cancelFrame: () => {} });
  return { frames, store };
}

test("coalesces deltas into one immutable frame snapshot", () => {
  const { frames, store } = fixture();
  const snapshots = [];
  store.subscribe(() => snapshots.push(store.getSnapshot()));
  store.start("g1");
  snapshots.length = 0;
  store.append("g1", "one");
  store.append("g1", " two");
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].content, "one two");
  assert.equal(Object.isFrozen(snapshots[0]), true);
});

test("flush publishes pending content and rejects stale generations", () => {
  const { frames, store } = fixture();
  store.start("g1");
  store.append("g1", "visible");
  assert.equal(store.append("g2", "late"), false);
  store.flush();
  assert.equal(store.getSnapshot().content, "visible");
  assert.equal(frames.length, 1);
});

test("ordinary clear resets the generation and notifies subscribers", () => {
  const { store } = fixture();
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  store.start("g1");
  notifications = 0;
  store.clear();
  assert.deepEqual(store.getSnapshot(), { generationId: null, content: "" });
  assert.equal(notifications, 1);
});
