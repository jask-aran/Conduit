import assert from "node:assert/strict";
import test from "node:test";
import { mobileSwipeAction } from "../src/client/navigation/mobile-swipe.ts";
const swipe = (overrides = {}) => mobileSwipeAction({
  startX: 100, startY: 100, endX: 180, endY: 104,
  sidebarOpen: false, workspaceOpen: false, ...overrides,
});

test("mobile edge swipes open and inward swipes close each sidebar", () => {
  assert.equal(swipe(), "open-sidebar");
  assert.equal(swipe({ startX: 200, endX: 120 }), "open-workspace");
  assert.equal(swipe({ startX: 300, endX: 220, sidebarOpen: true }), "close-sidebar");
  assert.equal(swipe({ startX: 80, endX: 160, workspaceOpen: true }), "close-workspace");
  assert.equal(swipe({ startX: 100, endX: 140 }), null);
  assert.equal(swipe({ endX: 40, endY: 180 }), null);
});
