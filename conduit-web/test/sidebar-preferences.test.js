import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSidebarChatLimit,
  DEFAULT_SIDEBAR_CHAT_LIMIT,
  MIN_SIDEBAR_CHAT_LIMIT,
  MAX_SIDEBAR_CHAT_LIMIT,
} from "../src/client/navigation/sidebar-preferences.ts";

test("sidebar chat limit defaults and clamps to the supported range", () => {
  for (const value of [null, undefined, "", "not a number", NaN, Infinity, -Infinity]) {
    assert.equal(clampSidebarChatLimit(value), DEFAULT_SIDEBAR_CHAT_LIMIT);
  }
  assert.equal(clampSidebarChatLimit(String(MIN_SIDEBAR_CHAT_LIMIT - 1)), MIN_SIDEBAR_CHAT_LIMIT);
  assert.equal(clampSidebarChatLimit(String(MAX_SIDEBAR_CHAT_LIMIT + 1)), MAX_SIDEBAR_CHAT_LIMIT);
  const middle = Math.floor((MIN_SIDEBAR_CHAT_LIMIT + MAX_SIDEBAR_CHAT_LIMIT) / 2);
  assert.equal(clampSidebarChatLimit(String(middle + 0.6)), middle + 1);
  assert.equal(clampSidebarChatLimit(middle + 0.4), middle);
  for (const value of [MIN_SIDEBAR_CHAT_LIMIT - 1, middle + 0.6, MAX_SIDEBAR_CHAT_LIMIT + 1, null]) {
    const clamped = clampSidebarChatLimit(value);
    assert.equal(clampSidebarChatLimit(clamped), clamped);
  }
});
