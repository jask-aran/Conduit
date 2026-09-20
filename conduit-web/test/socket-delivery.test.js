/**
 * The delivery discipline every harness now gets, not just Pi.
 *
 * Pi merged a frame's deltas and stopped piling onto a socket that was not
 * keeping up; Codex and ChatGPT Web published straight into `socket.send`, one
 * event at a time, so a fast turn put a frame's worth of syscalls and a frame's
 * worth of renders where Pi put one of each. What makes the simple version safe
 * is the distinction the chat's log already draws: a delta is paint the closing
 * message will restate, an op is a statement about the transcript's shape.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SocketDelivery, deliveryKey } from "../src/harnesses/socket-delivery.js";

const socket = (buffered = 0) => ({ readyState: 1, bufferedAmount: buffered, sent: [],
  send(payload) { this.sent.push(JSON.parse(payload)); } });

const delta = (text, contentIndex = 0) => ({
  type: "assistant_content", phase: "delta", generationId: "g1", messageId: "m1",
  blockKind: "text", contentIndex, delta: text,
});

const frame = () => new Promise((resolve) => setTimeout(resolve, 30));

/**
 * The window is a rate limit, not a delay. Holding the first delta bought
 * nothing -- there was nothing to merge it with -- and cost a frame on every
 * stream slower than the window, which is every ordinary token rate.
 */
test("the first delta goes out now and the rest of the burst arrives as one send", async () => {
  const delivery = new SocketDelivery();
  const client = socket();
  for (const piece of ["Once ", "upon ", "a ", "time."]) delivery.send(client, delta(piece));
  assert.deepEqual(client.sent.map((event) => event.delta), ["Once "], "the reader is not made to wait for it");
  await frame();
  assert.deepEqual(client.sent.map((event) => event.delta), ["Once ", "upon a time."]);
});

test("a stream slower than the frame is never held back", async () => {
  const delivery = new SocketDelivery();
  const client = socket();
  for (const piece of ["Once ", "upon "]) {
    delivery.send(client, delta(piece));
    await frame();
  }
  // Two deltas further apart than the window: two sends, neither delayed, and
  // nothing merged because there was never anything to merge.
  assert.deepEqual(client.sent.map((event) => event.delta), ["Once ", "upon "]);
});

test("deltas for different blocks keep their own order", async () => {
  const delivery = new SocketDelivery();
  const client = socket();
  delivery.send(client, delta("thinking", 0));
  delivery.send(client, delta("answer", 1));
  delivery.send(client, delta(" more", 0));
  await frame();
  // The first goes out on the leading edge; the two behind it are one frame,
  // in the order their blocks were first spoken to. A block's own deltas are
  // never reordered against each other, which is the whole of the promise.
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

test("paint that cannot be merged is dropped by the same rule", async () => {
  // Only a delta and a tool's partial output can be merged, so these four went
  // out through the unmerged path -- which had no high-water test at all. A
  // turn calling tools put a start and an end on a socket for every one of
  // them, however far behind it was. Each is restated by the op that closes
  // the message or the tool.
  const delivery = new SocketDelivery({ highWaterMark: 100 });
  const client = socket(4096);
  for (const event of [
    { type: "assistant_content", phase: "start", generationId: "g1", messageId: "m1" },
    { type: "tool_activity", phase: "start", generationId: "g1", toolCallId: "t1", name: "read" },
    { type: "tool_activity", phase: "end", generationId: "g1", toolCallId: "t1", output: "..." },
    { type: "assistant_content", phase: "final", generationId: "g1", messageId: "m1", blocks: [] },
  ]) delivery.send(client, event);
  await frame();
  assert.deepEqual(client.sent, [], "every phase of paint is droppable");

  // A transition is not paint: a client that misses one has a hole in the
  // chat's order, which is what `status` being numbered is for.
  delivery.send(client, { type: "status", phase: "settled", generationId: "g1", seq: 9 });
  assert.deepEqual(client.sent.map((event) => event.phase), ["settled"]);
});

test("one event is serialized once however many browsers are reading", () => {
  const delivery = new SocketDelivery();
  const event = { type: "transcript_op", op: "message.open", message: { id: "m1", role: "user" } };
  const readers = [socket(), socket(), socket()];
  for (const client of readers) delivery.send(client, event);
  assert.deepEqual(readers.map((client) => client.sent.length), [1, 1, 1]);
  // The same string object, not three JSON.stringify calls over the same event.
  assert.equal(delivery.serialize(event), JSON.stringify(event));
});

test("only paint is merged", () => {
  assert.ok(deliveryKey(delta("x")));
  assert.ok(deliveryKey({ type: "tool_activity", phase: "update", generationId: "g1", toolCallId: "t1" }));
  assert.equal(deliveryKey({ type: "tool_activity", phase: "end", toolCallId: "t1" }), null);
  assert.equal(deliveryKey({ type: "assistant_content", phase: "final", messageId: "m1" }), null);
  assert.equal(deliveryKey({ type: "transcript_op", op: "message.drop", messageId: "m1" }), null);
  assert.equal(deliveryKey({ type: "status", activity: "working" }), null);
});
