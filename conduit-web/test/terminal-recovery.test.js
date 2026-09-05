import assert from "node:assert/strict";
import test from "node:test";
import { terminalRecoveryView } from "../src/client/remotes/terminal-recovery.ts";

test("terminal recovery states expose one clear action", () => {
  assert.deepEqual(terminalRecoveryView("reconnecting"), {
    state: "reconnecting",
    title: "Reconnecting to terminal",
    message: "The terminal connection was interrupted. Retrying automatically.",
    action: null,
  });
  assert.deepEqual(terminalRecoveryView("offline", "The connection timed out."), {
    state: "offline",
    title: "Terminal offline",
    message: "The connection timed out.",
    action: "retry",
  });
  assert.deepEqual(terminalRecoveryView("stopped"), {
    state: "stopped",
    title: "Terminal stopped",
    message: "The terminal process has exited.",
    action: "restart",
  });
  assert.deepEqual(terminalRecoveryView("conflict"), {
    state: "conflict",
    title: "Terminal in use",
    message: "Another Conduit client controls this terminal.",
    action: "takeover",
  });
});

test("live terminal states do not render a recovery action", () => {
  for (const state of ["idle", "connecting", "live"]) {
    assert.equal(terminalRecoveryView(state), null);
  }
});
