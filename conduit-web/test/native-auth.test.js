import assert from "node:assert/strict";
import test from "node:test";
import { SocketTicketStore } from "../src/native-auth.js";

test("socket tickets expire and authorize exactly one use", () => {
  const store = new SocketTicketStore({ ttlMs: 100 });
  const ticket = store.issue("session-hash", 1_000);
  assert.equal(store.consume(ticket, 1_099), "session-hash");
  assert.equal(store.consume(ticket, 1_099), null);
  const expired = store.issue("expired-hash", 2_000);
  assert.equal(store.consume(expired, 2_100), null);
});
