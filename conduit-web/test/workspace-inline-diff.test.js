import assert from "node:assert/strict";
import test from "node:test";
import { buildInlineDiff, inlineDocLine, inlineRowNumber, unchangedRuns } from "../src/client/workspace/workspace-inline-diff.ts";

const kinds = (diff) => diff.rows.map((row) => row.kind);
const numbers = (diff) => diff.rows.map((row) => inlineRowNumber(row));

test("an unchanged document is all context", () => {
  const diff = buildInlineDiff("one\ntwo\n", "one\ntwo\n");
  assert.deepEqual(kinds(diff), ["context", "context", "context"]);
  assert.equal(diff.doc, "one\ntwo\n");
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
});

test("a replacement lays the removed lines above the added ones", () => {
  const diff = buildInlineDiff("keep\nold one\nold two\ntail", "keep\nnew one\ntail");
  assert.deepEqual(kinds(diff), ["context", "removed", "removed", "added", "context"]);
  assert.deepEqual(diff.doc.split("\n"), ["keep", "old one", "old two", "new one", "tail"]);
  assert.equal(diff.removed, 2);
  assert.equal(diff.added, 1);
});

test("each side is numbered in its own document", () => {
  const diff = buildInlineDiff("keep\nold one\nold two\ntail", "keep\nnew one\ntail");
  assert.deepEqual(numbers(diff), ["1", "2", "3", "2", "3"]);
});

test("a pure insertion carries no removed rows", () => {
  const diff = buildInlineDiff("one\ntwo", "one\nextra\ntwo");
  assert.deepEqual(kinds(diff), ["context", "added", "context"]);
  assert.equal(diff.removed, 0);
});

test("a deleted line stays in the document, on the original side", () => {
  const diff = buildInlineDiff("one\ngone\ntwo", "one\ntwo");
  const line = inlineDocLine(diff.rows, "original", 2);
  assert.equal(diff.doc.split("\n")[line - 1], "gone");
  assert.equal(diff.rows[line - 1].kind, "removed");
  assert.equal(diff.rows[line - 1].modified, null);
});

test("a side's line resolves back to its row", () => {
  const diff = buildInlineDiff("keep\nold one\nold two\ntail", "keep\nnew one\ntail");
  assert.equal(inlineDocLine(diff.rows, "original", 3), 3);
  assert.equal(inlineDocLine(diff.rows, "modified", 2), 4);
  assert.equal(inlineDocLine(diff.rows, "modified", 3), 5);
  assert.equal(inlineDocLine(diff.rows, "original", 99), null);
});

test("every row's text is the line it came from", () => {
  const original = "alpha\nbeta\ngamma";
  const modified = "alpha\nBETA\ngamma";
  const diff = buildInlineDiff(original, modified);
  const originalLines = original.split("\n");
  const modifiedLines = modified.split("\n");
  diff.doc.split("\n").forEach((text, index) => {
    const row = diff.rows[index];
    const source = row.kind === "removed" ? originalLines[row.original - 1] : modifiedLines[row.modified - 1];
    assert.equal(text, source);
  });
});

test("long stretches of context are offered for folding, with a margin", () => {
  const original = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n");
  const modified = original.replace("line 20", "LINE 20");
  const diff = buildInlineDiff(original, modified);
  const runs = unchangedRuns(diff.rows, { margin: 3, minSize: 8 });

  assert.equal(runs.length, 2);
  assert.equal(runs[0].from, 1);
  assert.ok(runs[0].to < diff.rows.findIndex((row) => row.kind !== "context") + 1);
  assert.ok(runs.every((run) => run.to - run.from + 1 >= 8));
  for (const run of runs) {
    for (let line = run.from; line <= run.to; line++) assert.equal(diff.rows[line - 1].kind, "context");
  }
});

test("a short file has nothing to fold", () => {
  const diff = buildInlineDiff("one\ntwo\nthree", "one\nTWO\nthree");
  assert.deepEqual(unchangedRuns(diff.rows), []);
});
