import assert from "node:assert/strict";
import test from "node:test";
import * as toolSummary from "../src/client/tool-summary.js";

const { prettyPrintValue, summarizeTool, truncateValue } = toolSummary;

test("summarizeTool falls back to name() with no args", () => {
  assert.equal(summarizeTool({ name: "read" }), "read()");
  assert.equal(summarizeTool({ name: "read", args: null }), "read()");
  assert.equal(summarizeTool({}), "tool()");
});

test("summarizeTool renders up to two object arg entries and an ellipsis marker", () => {
  assert.equal(summarizeTool({ name: "write", args: { path: "note.md" } }), "write(path: note.md)");
  assert.equal(
    summarizeTool({ name: "grep", args: { pattern: "foo", path: "src", flags: "-r" } }),
    "grep(pattern: foo, path: src, …)",
  );
});

test("summarizeTool truncates long values", () => {
  const long = "x".repeat(100);
  const summary = summarizeTool({ name: "read", args: { path: long } });
  assert.ok(summary.includes("…"));
  assert.ok(summary.length < long.length);
});

test("summarizeTool prefers meaningful scalar and path arguments", () => {
  assert.equal(
    summarizeTool({
      name: "read",
      args: {
        options: { encoding: "utf8" },
        metadata: { source: "user" },
        path: "/important/file.txt",
      },
    }),
    "read(path: /important/file.txt, …)",
  );
});

test("summarizeTool handles non-object args", () => {
  assert.equal(summarizeTool({ name: "echo", args: "hello" }), "echo(hello)");
  assert.equal(summarizeTool({ name: "echo", args: 3 }), "echo(3)");
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

test("formatToolDuration formats completed tool timings", () => {
  assert.equal(typeof toolSummary.formatToolDuration, "function");
  assert.equal(toolSummary.formatToolDuration({ startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.250Z" }), "1.3s");
  assert.equal(toolSummary.formatToolDuration({ startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:05.000Z" }), "1m 5s");
  assert.equal(toolSummary.formatToolDuration({ startedAt: "invalid", completedAt: "2026-01-01T00:00:01.000Z" }), "");
});
