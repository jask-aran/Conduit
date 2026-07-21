import assert from "node:assert/strict";
import test from "node:test";
import { prettyPrintValue, summarizeTool, truncateValue } from "../src/client/tool-summary.js";

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
