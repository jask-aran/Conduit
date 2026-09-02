import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await fs.readFile(new URL("../src/client/navigation/mobile-swipe.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source);
const { mobileSwipeAction } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
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
