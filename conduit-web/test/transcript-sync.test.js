import assert from "node:assert/strict";
import test from "node:test";
import { applyTranscriptProjection, truncateAt, upsertMessages } from "../src/client/timeline-order.ts";

const message = (id, role, content, extra = {}) => ({ id, role, content, ...extra });

test("a synced turn replaces the version the client assembled", () => {
  const live = [message("m_u1", "user", "write a story"), message("m_a1", "assistant", "half a stor")];
  const merged = upsertMessages(live, [
    message("m_u1", "user", "write a story"),
    message("m_a1", "assistant", "half a story", { stopReason: "aborted", stopped: true }),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["m_u1", "m_a1"]);
  assert.equal(merged[1].content, "half a story");
  assert.equal(merged[1].stopReason, "aborted");
});

test("messages older than the synced turn are left alone", () => {
  const current = [
    message("pi:old_u", "user", "first"),
    message("pi:old_a", "assistant", "first answer"),
    message("m_u2", "user", "second"),
  ];
  const merged = upsertMessages(current, [
    message("m_u2", "user", "second"),
    message("m_a2", "assistant", "second answer"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["pi:old_u", "pi:old_a", "m_u2", "m_a2"]);
  assert.equal(merged[0].content, "first");
});

test("a queued message survives a sync, and the answer it is waiting on lands ahead of it", () => {
  const current = [message("m_u1", "user", "go"), message("user_2", "user", "queued", { pending: true })];
  const merged = upsertMessages(current, [
    message("m_u1", "user", "go"),
    message("m_a1", "assistant", "answer"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["m_u1", "m_a1", "user_2"]);
  assert.equal(merged.find((item) => item.id === "user_2").pending, true);
});

test("a turn synced after the client moved on is placed where the server put it", () => {
  const current = [
    message("m_u1", "user", "first"),
    message("m_u2", "user", "second"),
    message("m_a2", "assistant", "second answer"),
  ];
  const merged = upsertMessages(current, [
    message("m_u1", "user", "first"),
    message("pi:a1", "assistant", "first answer"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["m_u1", "pi:a1", "m_u2", "m_a2"]);
});

test("an empty sync changes nothing", () => {
  const current = [message("m_u1", "user", "go")];
  assert.equal(upsertMessages(current, []), current);
});

test("a sync that names nothing the client holds appends rather than replacing", () => {
  const current = [message("m_u1", "user", "go"), message("m_a1", "assistant", "done")];
  const merged = upsertMessages(current, [
    message("pi:u9", "user", "elsewhere"),
    message("pi:a9", "assistant", "answered elsewhere"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["m_u1", "m_a1", "pi:u9", "pi:a9"]);
});

test("an interrupt's two-turn sync replaces both turns and nothing else", () => {
  const current = [
    message("pi:k", "user", "keep"), message("pi:ka", "assistant", "kept"),
    message("m_u1", "user", "interrupted"), message("m_a1", "assistant", "partial"),
    message("m_u2", "user", "steered"), message("m_a2", "assistant", "streaming"),
  ];
  const merged = upsertMessages(current, [
    message("m_u1", "user", "interrupted"), message("m_a1", "assistant", "partial", { stopped: true }),
    message("m_u2", "user", "steered"), message("m_a2", "assistant", "final"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["pi:k", "pi:ka", "m_u1", "m_a1", "m_u2", "m_a2"]);
  assert.equal(merged[3].stopped, true);
  assert.equal(merged[5].content, "final");
});

test("regenerate cuts the prompt the fork replaces, and everything after it", () => {
  const current = [
    message("m_u1", "user", "hi"), message("pi:a1", "assistant", "hello"),
    message("m_u2", "user", "hi again"), message("pi:a2", "assistant", "hello again"),
  ];
  assert.deepEqual(truncateAt(current, "m_u2", { inclusive: true }).map((item) => item.id), ["m_u1", "pi:a1"]);
  assert.deepEqual(truncateAt(current, "pi:a2").map((item) => item.id), ["m_u1", "pi:a1", "m_u2", "pi:a2"]);
});

test("a cut naming a message this client never loaded leaves it alone", () => {
  const current = [message("m_u1", "user", "hi")];
  assert.equal(truncateAt(current, "pi:somewhere-else", { inclusive: true }), current);
});

test("the cut a fork states removes every abandoned message, and keeps what is unsent", () => {
  const current = [
    message("m_u1", "user", "hi"), message("pi:a1", "assistant", "hello"),
    message("m_u2", "user", "abandoned"), message("pi:a2", "assistant", "abandoned answer"),
    message("user_3", "user", "unsent", { pending: true }),
  ];
  const cut = truncateAt(current, "m_u2", { inclusive: true });
  assert.deepEqual(cut.map((item) => item.id), ["m_u1", "pi:a1"]);
  assert.equal(current.at(-1).pending, true);
});

test("a synced turn replaces its tools and retains tools from older turns", () => {
  const current = [
    message("pi:old", "assistant", "older", { blocks: [{ type: "toolCall", id: "t_old" }] }),
    message("m_a1", "assistant", "newer", { blocks: [{ type: "toolCall", id: "t_new" }] }),
  ];
  const tools = [{ id: "t_old", name: "read", seq: 0 }, { id: "t_new", name: "stale", seq: 1 }];
  const { tools: merged } = applyTranscriptProjection(current, tools, [
    message("m_a1", "assistant", "newer", { blocks: [{ type: "toolCall", id: "t_new" }] }),
  ], [{ id: "t_new", name: "write", seq: 1 }]);
  assert.deepEqual(merged.map((tool) => [tool.id, tool.name]), [["t_old", "read"], ["t_new", "write"]]);
});
