import assert from "node:assert/strict";
import test from "node:test";
import * as toolSummary from "../src/client/tool-summary.js";

const { prettyPrintValue, summarizeTool, truncateValue } = toolSummary;

test("summarizeTool falls back to the tool name with no args", () => {
  assert.equal(summarizeTool({ name: "read" }), "read");
  assert.equal(summarizeTool({ name: "read", args: null }), "read");
  assert.equal(summarizeTool({}), "tool");
});

test("summarizeTool shows one semantic primary and counts additional arguments", () => {
  assert.equal(summarizeTool({ name: "write", args: { path: "note.md" } }), "write note.md");
  assert.equal(
    summarizeTool({ name: "write", args: { path: "note.md", content: "large payload" } }),
    "write note.md · +1",
  );
  assert.equal(
    summarizeTool({ name: "grep", args: { pattern: "foo", path: "src", flags: "-r" } }),
    "grep src · +2",
  );
});

test("summarizeTool preserves the final parent and filename of long paths", () => {
  assert.equal(
    summarizeTool({
      name: "read",
      args: { path: ".conduit/chats/50250cf8-2425-4752-8b2e-bdbfca50406e/attachments/feebe184-83c5-4a0a-8b95-1f5c999090d1--wanderlog-map-landscape.jpg" },
    }),
    "read attachments/wanderlog-map-landscape.jpg",
  );
});

test("summarizeTool excludes nested metadata and payloads from the semantic primary", () => {
  assert.equal(
    summarizeTool({
      name: "custom",
      args: {
        options: { encoding: "utf8" },
        metadata: { source: "user" },
        content: "large payload",
        query: "find this",
      },
    }),
    "custom find this · +3",
  );
});

test("summarizeTool normalizes command whitespace into one bounded line", () => {
  const summary = summarizeTool({
    name: "bash",
    args: { command: "python3 fizzbuzz.py\n\n&& printf 'more output'", timeout: 30 },
  });
  assert.equal(summary, "bash python3 fizzbuzz.py && printf 'more output' · +1");
});

test("summarizeTool handles non-object args", () => {
  assert.equal(summarizeTool({ name: "echo", args: "hello" }), "echo hello");
  assert.equal(summarizeTool({ name: "echo", args: 3 }), "echo 3");
});

test("truncateValue passes short values through unchanged", () => {
  assert.equal(truncateValue("short"), "short");
  assert.equal(truncateValue(null), "");
});

test("prettyPrintValue pretty-prints objects and passes strings through", () => {
  assert.equal(prettyPrintValue("plain text"), "plain text");
  assert.equal(prettyPrintValue({ a: 1 }), JSON.stringify({ a: 1 }, null, 2));
  assert.equal(prettyPrintValue(null), "");
});

test("previewValue bounds long content until explicitly revealed", () => {
  assert.equal(typeof toolSummary.previewValue, "function");
  const value = { content: "x".repeat(100) };
  const preview = toolSummary.previewValue(value, 40);
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.length, 41);
  assert.ok(preview.text.endsWith("…"));
  assert.equal(toolSummary.previewValue(value, 200).truncated, false);
});

test("previewToolValue shows the head and reports hidden lines", () => {
  assert.equal(typeof toolSummary.previewToolValue, "function");
  const preview = toolSummary.previewToolValue(Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"), {
    maxLines: 10,
  });
  assert.equal(preview.text, Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n"));
  assert.equal(preview.hiddenLines, 10);
  assert.equal(preview.truncated, true);
});

test("previewToolValue shows the tail for command output", () => {
  assert.equal(typeof toolSummary.previewToolValue, "function");
  const preview = toolSummary.previewToolValue(Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"), {
    direction: "tail",
    maxLines: 10,
  });
  assert.equal(preview.text, Array.from({ length: 10 }, (_, index) => `line ${index + 11}`).join("\n"));
  assert.equal(preview.hiddenLines, 10);
});

test("toolResultPreviewDirection uses the tail for command-shaped calls", () => {
  assert.equal(typeof toolSummary.toolResultPreviewDirection, "function");
  assert.equal(toolSummary.toolResultPreviewDirection({ args: { command: "npm test" } }), "tail");
  assert.equal(toolSummary.toolResultPreviewDirection({ args: { path: "src/main.js" } }), "head");
});

test("formatToolDuration formats completed tool timings", () => {
  assert.equal(typeof toolSummary.formatToolDuration, "function");
  assert.equal(toolSummary.formatToolDuration({ startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.250Z" }), "1.3s");
  assert.equal(toolSummary.formatToolDuration({ startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:05.000Z" }), "1m 5s");
  assert.equal(toolSummary.formatToolDuration({ startedAt: "invalid", completedAt: "2026-01-01T00:00:01.000Z" }), "");
});
