import assert from "node:assert/strict";
import test from "node:test";
import { clampSidebarChatLimit } from "../src/client/navigation/sidebar-preferences.ts";

test("sidebar chat limit defaults and clamps to the supported range", () => {
  assert.equal(clampSidebarChatLimit(null), 20);
  assert.equal(clampSidebarChatLimit(""), 20);
  assert.equal(clampSidebarChatLimit("3"), 5);
  assert.equal(clampSidebarChatLimit("20.6"), 21);
  assert.equal(clampSidebarChatLimit("101"), 100);
  assert.equal(clampSidebarChatLimit("not a number"), 20);
});
