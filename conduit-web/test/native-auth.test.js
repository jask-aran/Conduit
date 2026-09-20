import assert from "node:assert/strict";
import test from "node:test";
import { SocketTicketStore, installedClientOrigin } from "../src/native-auth.js";

test("socket tickets expire and authorize exactly one use", () => {
  const store = new SocketTicketStore({ ttlMs: 100 });
  const ticket = store.issue("session-hash", 1_000);
  assert.equal(store.consume(ticket, 1_099), "session-hash");
  assert.equal(store.consume(ticket, 1_099), null);
  const expired = store.issue("expired-hash", 2_000);
  assert.equal(store.consume(expired, 2_100), null);
});

test("only the clients Conduit ships are installed clients, matched exactly", () => {
  // The set is the boundary: the caller's header is never echoed back as sent,
  // and a near miss -- a scheme swap, a subdomain, a trailing slash -- is not a
  // member of it.
  assert.equal(installedClientOrigin("https://localhost"), "https://localhost");
  assert.equal(installedClientOrigin("http://tauri.localhost"), "http://tauri.localhost");
  for (const claimed of ["http://localhost", "https://tauri.localhost", "https://localhost/",
    "https://evil.localhost", "https://localhost.attacker.test", "null", "", undefined]) {
    assert.equal(installedClientOrigin(claimed), null, `${claimed} is not a client Conduit ships`);
  }
});
