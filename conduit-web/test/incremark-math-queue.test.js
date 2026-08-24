import assert from "node:assert/strict";
import test from "node:test";
import {
  MATH_RENDER_REATTACH_FRAME_BUDGET_MS,
  MathRenderQueue,
} from "../src/client/chat/incremark-math-queue.ts";

function createManualQueue() {
  let now = 0;
  let nextHandle = 0;
  const frames = new Map();
  const metrics = [];
  const queue = new MathRenderQueue({
    now: () => now,
    requestFrame: (callback) => {
      const handle = ++nextHandle;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => frames.delete(handle),
    onMetrics: (metric) => metrics.push(metric),
  });
  return {
    queue,
    metrics,
    advance(milliseconds) { now += milliseconds; },
    runFrame() {
      const [handle, callback] = frames.entries().next().value || [];
      if (handle == null) throw new Error("No frame scheduled");
      frames.delete(handle);
      callback(now);
    },
  };
}

test("math queue processes several live formulas within the measured frame budget", () => {
  const harness = createManualQueue();
  const completed = [];
  for (let index = 0; index < 6; index += 1) {
    harness.queue.enqueue(() => {
      completed.push(index);
      harness.advance(1);
    }, "stream");
  }

  harness.runFrame();

  assert.equal(completed.length, 4);
  assert.equal(harness.queue.getMetrics().queueDepth, 2);
  assert.equal(harness.queue.getMetrics().oldestJobAgeMs, 4);
  assert.equal(harness.metrics.at(-1).processedJobs, 4);
});

test("complete-message reattach uses the larger bounded batch policy", () => {
  const harness = createManualQueue();
  let completed = 0;
  for (let index = 0; index < 20; index += 1) {
    harness.queue.enqueue(() => {
      completed += 1;
      harness.advance(1);
    }, "reattach");
  }

  harness.runFrame();

  assert.equal(completed, MATH_RENDER_REATTACH_FRAME_BUDGET_MS);
  assert.equal(harness.metrics.at(-1).policy, "reattach");
  assert.equal(harness.metrics.at(-1).queueDepth, 20 - MATH_RENDER_REATTACH_FRAME_BUDGET_MS);
});

test("cancelling a math render removes it from the queue and records the cancellation", () => {
  const harness = createManualQueue();
  let ran = false;
  const cancel = harness.queue.enqueue(() => { ran = true; }, "stream");
  cancel();

  assert.equal(harness.queue.getMetrics().queueDepth, 0);
  assert.equal(harness.queue.getMetrics().cancelledJobs, 1);
  assert.equal(harness.metrics.at(-1).event, "cancel");
  assert.equal(ran, false);
});
