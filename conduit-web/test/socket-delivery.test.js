/**
 * A delta is paint the closing message will restate; an op is a statement about the transcript's shape.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DELIVERY_FLUSH_MS, SocketDelivery } from "../src/harnesses/socket-delivery.js";

const socket = (buffered = 0) => ({ readyState: 1, bufferedAmount: buffered, sent: [],
  send(payload) { this.sent.push(JSON.parse(payload)); } });

const delta = (text, contentIndex = 0) => ({
  type: "assistant_content", phase: "delta", generationId: "g1", messageId: "m1",
  blockKind: "text", contentIndex, delta: text,
});

const frame = () => new Promise((resolve) => setTimeout(resolve, 30));

/**
 * The window is a rate limit, not a delay: holding the first delta would cost a
 * frame on every stream slower than the window, which is every ordinary token rate.
 */
test("the first delta goes out now and the rest of the burst arrives as one send", async () => {
  const delivery = new SocketDelivery();
  const client = socket();
  for (const piece of ["Once ", "upon ", "a ", "time."]) delivery.send(client, delta(piece));
  assert.deepEqual(client.sent.map((event) => event.delta), ["Once "], "the reader is not made to wait for it");
  await frame();
  assert.deepEqual(client.sent.map((event) => event.delta), ["Once ", "upon a time."]);
});

test("deltas for different blocks keep their own order", async () => {
  const delivery = new SocketDelivery();
  const client = socket();
  delivery.send(client, delta("thinking", 0));
  delivery.send(client, delta("answer", 1));
  delivery.send(client, delta(" more", 0));
  await frame();
  // A block's own deltas are never reordered against each other, which is the whole of the promise.
  assert.deepEqual(client.sent.map((event) => [event.contentIndex, event.delta]),
    [[0, "thinking"], [1, "answer"], [0, " more"]]);
});

/**
 * An op is not paint, so it never waits and never merges -- and the paint it is
 * closing goes out ahead of it, or the browser would be told what a message
 * says before it had been shown the last of it being said.
 */
test("a statement about the transcript overtakes nothing and waits for nothing", () => {
  const delivery = new SocketDelivery();
  const client = socket();
  delivery.send(client, delta("Once upon a "));
  delivery.send(client, delta("time."));
  delivery.send(client, { type: "transcript_op", op: "message.close", messageId: "m1" });
  assert.deepEqual(client.sent.map((event) => event.delta ?? event.op),
    ["Once upon a ", "time.", "message.close"]);
});

/**
 * A socket this far behind cannot draw what it already holds, so adding to its
 * queue only makes it later. The paint is given up; the close states the whole
 * text, so the reader loses a repaint rather than words.
 */
test("a socket that has stopped keeping up is given paint to drop, not queue", async () => {
  const delivery = new SocketDelivery({ highWaterMark: 100 });
  const client = socket(4096);
  delivery.send(client, delta("Once upon a time."));
  await frame();
  assert.deepEqual(client.sent, [], "the paint is dropped");

  // The statement still gets through. Losing one of these leaves the browser
  // holding a transcript the server does not believe in.
  delivery.send(client, { type: "transcript_op", op: "message.close", messageId: "m1", content: "Once upon a time." });
  assert.deepEqual(client.sent.map((event) => event.op), ["message.close"]);
});

/**
 * The browser is the only party that can see its own refresh, so it measures
 * itself and says so.
 */
test("a reader paces its own socket, and only its own", async () => {
  const delivery = new SocketDelivery({ flushMs: 40 });
  const fast = socket();
  const untold = socket();
  assert.equal(delivery.setFrameInterval(fast, 6.9), 7, "rounded to whole milliseconds");

  for (const client of [fast, untold]) delivery.send(client, delta("Once "));
  assert.deepEqual([fast.sent.length, untold.sent.length], [1, 1]);

  delivery.send(fast, delta("upon "));
  delivery.send(untold, delta("upon "));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fast.sent.length, 2, "paced to the panel that asked for it");
  assert.equal(untold.sent.length, 1, "the assumption stands for a socket that has not said");
  assert.ok(DELIVERY_FLUSH_MS >= 4);
});
