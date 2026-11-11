import test from "node:test";
import assert from "node:assert/strict";
import { Receipts } from "../src/nodes/receipts.js";

// Reconnect replays from the next event missing, without repeating work.
test("a repeated action replays only missing events and its result without running twice", { timeout: 1000 }, async () => {
  const receipts = new Receipts();
  const events = [{ kind: "output", text: "first" }, { kind: "output", text: "second" }];
  const result = { ok: true, exitCode: 0 };
  let starts = 0;
  const completed = Promise.withResolvers();
  receipts.follow("fixture-action", 0, { event() {}, result: completed.resolve }, (emit) => {
    starts += 1;
    events.forEach(emit);
    return result;
  });
  assert.deepEqual(await completed.promise, result);
  const replayed = [];
  let replayedResult;
  receipts.follow("fixture-action", 1, { event: (event) => replayed.push(event), result: (value) => { replayedResult = value; } },
    () => { starts += 1; return { ok: false }; });
  assert.equal(starts, 1);
  assert.deepEqual(replayed, [{ ...events[1], seq: 1 }]);
  assert.deepEqual(replayedResult, result);
});

// The socket went; work goes on until asked again.
test("dropping a listener leaves an action running for a new listener", { timeout: 1000 }, async () => {
  const receipts = new Receipts();
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const completed = Promise.withResolvers();
  let oldResults = 0;
  const first = receipts.follow("fixture-action", 0, { event() {}, result() { oldResults += 1; } }, async (_emit, signal) => {
    started.resolve(signal);
    return release.promise;
  });
  const signal = await started.promise;
  first.drop();
  assert.equal(signal.aborted, false);
  receipts.follow("fixture-action", 0, { event() {}, result: completed.resolve }, () => assert.fail("action ran twice"));
  first.drop(); // An old socket must not detach the new listener.
  const result = { ok: true };
  release.resolve(result);
  assert.deepEqual(await completed.promise, result);
  assert.equal(oldResults, 0);
});
