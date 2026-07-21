import assert from "node:assert/strict";
import test from "node:test";
import {
  getToolRenderer,
  registerTimelineItemRenderer,
  registerToolRenderer,
  setDefaultToolRenderer,
  timelineItemRenderers,
  toolRenderers,
} from "../src/client/tool-registry.js";

test("getToolRenderer falls back to the default renderer for unregistered tool names", () => {
  setDefaultToolRenderer("DEFAULT_CARD");
  assert.equal(getToolRenderer("some_unregistered_tool"), "DEFAULT_CARD");
});

test("getToolRenderer returns the exact-name match when registered", () => {
  setDefaultToolRenderer("DEFAULT_CARD");
  registerToolRenderer("write", "WRITE_CARD");
  assert.equal(getToolRenderer("write"), "WRITE_CARD");
  assert.equal(getToolRenderer("read"), "DEFAULT_CARD");
  assert.ok(Object.prototype.hasOwnProperty.call(toolRenderers, "write"));
});

test("timelineItemRenderers looks up by timeline item type", () => {
  registerTimelineItemRenderer("tool", "TOOL_ITEM_RENDERER");
  assert.equal(timelineItemRenderers.tool, "TOOL_ITEM_RENDERER");
  registerTimelineItemRenderer("question", "QUESTION_ITEM_RENDERER");
  assert.equal(timelineItemRenderers.question, "QUESTION_ITEM_RENDERER");
});
