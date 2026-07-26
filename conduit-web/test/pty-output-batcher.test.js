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

test("PTY output batcher emits one ordered binary frame for a same-turn output burst", () => {
  const scheduler = controlledScheduler();
  const sent = [];
  const batcher = new PtyOutputBatcher((id, bytes) => sent.push({ id, bytes }), scheduler);

  batcher.append("pty-1", Buffer.from("one"));
  batcher.append("pty-1", Buffer.from(" two"));
  batcher.append("pty-1", Buffer.from(" three"));
  assert.equal(sent.length, 0);
  scheduler.run();

  assert.deepEqual(sent.map(({ id, bytes }) => [id, bytes.toString()]), [["pty-1", "one two three"]]);
});

test("PTY output batcher can flush synchronously without a duplicate scheduled send", () => {
  const scheduler = controlledScheduler();
  const sent = [];
  const batcher = new PtyOutputBatcher((id, bytes) => sent.push({ id, bytes }), scheduler);

  batcher.append("pty-1", Buffer.from("before attach"));
  batcher.flush("pty-1");
  scheduler.run();

  assert.deepEqual(sent.map(({ id, bytes }) => [id, bytes.toString()]), [["pty-1", "before attach"]]);
});
