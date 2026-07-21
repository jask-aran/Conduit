import assert from "node:assert/strict";
import test from "node:test";
import { reconcileMessages } from "../src/client/reconcile-messages.js";

test("keeps the render key and object identity when an id match is unchanged", () => {
  const current = [
    { id: "entry-user", key: "user_1", role: "user", content: "Hello" },
    { id: "entry-assistant", key: "live_2", role: "assistant", content: "Hi there" },
  ];
  const incoming = [
    { id: "entry-user", role: "user", content: "Hello" },
    { id: "entry-assistant", role: "assistant", content: "Hi there" },
  ];
  const result = reconcileMessages(current, incoming);
  assert.equal(result.length, 2);
  assert.equal(result[0], current[0]);
  assert.equal(result[1], current[1]);
  assert.equal(result[0].key, "user_1");
  assert.equal(result[1].key, "live_2");
});

test("keeps the key but adopts new content when an id match changed", () => {
  const current = [{ id: "entry-assistant", key: "live_2", role: "assistant", content: "partial" }];
  const incoming = [{ id: "entry-assistant", role: "assistant", content: "final answer" }];
  const result = reconcileMessages(current, incoming);
  assert.notEqual(result[0], current[0]);
  assert.equal(result[0].key, "live_2");
  assert.equal(result[0].id, "entry-assistant");
  assert.equal(result[0].content, "final answer");
});

test("adopts authoritative reasoning without changing the durable render key", () => {
  const current = [{
    id: "entry-assistant",
    key: "live_2",
    role: "assistant",
    content: "Answer",
    reasoning: {
      status: "completed",
      content: "partial",
      redacted: false,
      durationSeconds: 1,
      observed: true,
    },
  }];
  const incoming = [{
    id: "entry-assistant",
    role: "assistant",
    content: "Answer",
    reasoning: {
      status: "completed",
      content: "authoritative",
      redacted: false,
      durationSeconds: 2,
      observed: true,
    },
  }];

  const result = reconcileMessages(current, incoming);
  assert.notEqual(result[0], current[0]);
  assert.equal(result[0].key, "live_2");
  assert.deepEqual(result[0].reasoning, incoming[0].reasoning);
});

test("keeps object identity when authoritative reasoning is unchanged", () => {
  const reasoning = {
    status: "completed",
    content: "authoritative",
    redacted: false,
    durationSeconds: 2,
    observed: true,
  };
  const current = [{ id: "entry-assistant", key: "live_2", role: "assistant", content: "Answer", reasoning }];
  const incoming = [{ id: "entry-assistant", role: "assistant", content: "Answer", reasoning: { ...reasoning } }];

  const result = reconcileMessages(current, incoming);
  assert.equal(result[0], current[0]);
});

test("pairs the optimistic tail by role so durable ids inherit their keys", () => {
  const current = [
    { id: "entry-user-1", key: "user_1", role: "user", content: "First" },
    { id: "entry-assistant-1", key: "live_1", role: "assistant", content: "First answer" },
    { id: "user_1700000000000", role: "user", content: "Second" },
    { id: "live_1700000000001", role: "assistant", content: "Second answer" },
  ];
  const incoming = [
    { id: "entry-user-1", role: "user", content: "First" },
    { id: "entry-assistant-1", role: "assistant", content: "First answer" },
    { id: "entry-user-2", role: "user", content: "Second" },
    { id: "entry-assistant-2", role: "assistant", content: "Second answer" },
  ];
  const result = reconcileMessages(current, incoming);
  assert.deepEqual(result.map((message) => message.key), ["user_1", "live_1", "user_1700000000000", "live_1700000000001"]);
  assert.deepEqual(result.map((message) => message.id), ["entry-user-1", "entry-assistant-1", "entry-user-2", "entry-assistant-2"]);
});

test("drops unmatched current messages on fork/regenerate truncation", () => {
  const current = [
    { id: "entry-user", key: "user_1", role: "user", content: "Keep" },
    { id: "user_1700000000000", role: "user", content: "Edited" },
    { id: "live_1700000000001", role: "assistant", content: "Dropped" },
  ];
  const incoming = [
    { id: "entry-user", role: "user", content: "Keep" },
    { id: "entry-user-edited", role: "user", content: "Edited" },
  ];
  const result = reconcileMessages(current, incoming);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((message) => message.key), ["user_1", "user_1700000000000"]);
  assert.deepEqual(result.map((message) => message.id), ["entry-user", "entry-user-edited"]);
});

test("gives unknown incoming messages a key equal to their id", () => {
  const current = [];
  const incoming = [{ id: "entry-fresh", role: "assistant", content: "New" }];
  const result = reconcileMessages(current, incoming);
  assert.equal(result[0].key, "entry-fresh");
  assert.equal(result[0].id, "entry-fresh");
});
