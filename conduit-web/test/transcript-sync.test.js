import assert from "node:assert/strict";
import test from "node:test";
import { replaceMessages, truncateAt } from "../src/client/timeline-order.ts";

// A window of the transcript is no longer something the client folds into what
// it holds: every message was stated, one at a time, as it happened. What
// survives here is the two answers that are still whole-transcript facts -- a
// full load, and the cut a fork or an edit states.

const message = (id, role, content, extra = {}) => ({ id, role, content, ...extra });

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

test("a full load replaces, so one landing after a fork cannot restore the abandoned branch", () => {
  const afterFork = [
    message("m_u1", "user", "hi"), message("pi:a1", "assistant", "hello"),
    message("m_u3", "user", "regenerated"), message("pi:a3", "assistant", "new answer"),
    message("user_4", "user", "unsent", { pending: true }),
  ];
  // The server's whole truth, fetched before the fork and arriving after it.
  const stale = [
    message("m_u1", "user", "hi"), message("pi:a1", "assistant", "hello"),
    message("m_u2", "user", "abandoned"), message("pi:a2", "assistant", "abandoned answer"),
  ];
  assert.deepEqual(replaceMessages(afterFork, stale).map((item) => item.id),
    ["m_u1", "pi:a1", "m_u2", "pi:a2", "user_4"]);
  assert.equal(replaceMessages(afterFork, stale).some((item) => item.id === "m_u3"), false);
});
