import assert from "node:assert/strict";
import test from "node:test";
import { terminalRecoveryView } from "../src/client/remotes/terminal-recovery.ts";

test("terminal recovery states expose one clear action", () => {
  for (const [state, action] of Object.entries({ reconnecting: null, offline: "retry", stopped: "restart", conflict: "takeover" })) {
    const view = terminalRecoveryView(state);
    assert.equal(view.state, state);
    assert.equal(view.action, action);
    assert.equal(typeof view.title, "string");
    assert.ok(view.title.trim().length > 0);
    assert.equal(typeof view.message, "string");
    assert.ok(view.message.trim().length > 0);
  }
  const error = "The connection timed out.";
  for (const state of ["offline", "conflict"]) {
    assert.equal(terminalRecoveryView(state, error).message, error);
  }
});

test("live terminal states do not render a recovery action", () => {
  for (const state of ["idle", "connecting", "live"]) {
    assert.equal(terminalRecoveryView(state), null);
  }
});
