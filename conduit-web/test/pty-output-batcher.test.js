import assert from "node:assert/strict";
import test from "node:test";
import { PtyOutputBatcher } from "../src/pty-output-batcher.js";

function controlledScheduler() {
  const callbacks = [];
  const cancelled = new Set();
  return {
    schedule: (callback) => { callbacks.push(callback); return callback; },
    cancel: (callback) => cancelled.add(callback),
    run: () => {
      for (const callback of callbacks.splice(0)) if (!cancelled.has(callback)) callback();
    },
  };
}

test("PTY output batcher bounds bulk output without reordering bytes", () => {
  const scheduler = controlledScheduler();
  const sent = [];
  const batcher = new PtyOutputBatcher(
    (id, bytes) => sent.push({ id, bytes }),
    { ...scheduler, maxBatchBytes: 5 },
  );

  batcher.append("pty-1", Buffer.from("1234567890x"));
  scheduler.run();

  assert.deepEqual(sent.map(({ id, bytes }) => [id, bytes.toString()]), [
    ["pty-1", "12345"],
    ["pty-1", "67890"],
    ["pty-1", "x"],
  ]);
});
