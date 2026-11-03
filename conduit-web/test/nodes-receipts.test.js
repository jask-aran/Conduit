import test from "node:test";
import assert from "node:assert/strict";
import { Receipts } from "../src/nodes/receipts.js";

// Design: "How far do we go on knowing whether a cut-off action happened?"
// receipts.js follow: reconnect replays from the next event missing, without repeating work.
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

// receipts.js drop: the socket went; work goes on until asked again.
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

// receipts.js abort(action): only the named action's signal is aborted.
test("aborting an action stops that action and leaves other actions running", { timeout: 1000 }, async () => {
  const receipts = new Receipts();
  const started = [Promise.withResolvers(), Promise.withResolvers()];
  const release = [Promise.withResolvers(), Promise.withResolvers()];
  const completed = [Promise.withResolvers(), Promise.withResolvers()];
  for (const index of [0, 1]) {
    receipts.follow(`fixture-${index}`, 0, { event() {}, result: completed[index].resolve }, async (_emit, signal) => {
      started[index].resolve(signal);
      return release[index].promise;
    });
  }
  const signals = await Promise.all(started.map((item) => item.promise));
  receipts.abort("fixture-0");
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  release.forEach((item) => item.resolve({ ok: true }));
  await Promise.all(completed.map((item) => item.promise));
});
