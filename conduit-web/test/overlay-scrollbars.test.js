import test from "node:test";
import assert from "node:assert/strict";
import { scrollbarGeometry } from "../src/client/navigation/overlay-scrollbars.ts";

test("overlay thumb covers both scroll endpoints and remains grabbable", () => {
  const start = scrollbarGeometry(200, 1000, 0, 196);
  const end = scrollbarGeometry(200, 1000, 800, 196);
  assert.equal(start.offset, 0);
  assert.equal(end.offset + end.size, 196);
  assert.equal(start.range, 800);
  assert.equal(scrollbarGeometry(200, 100000, 500, 196).size, 28);
  assert.equal(scrollbarGeometry(200, 100, 0, 196).range, 0);
  assert.equal(scrollbarGeometry(200, 1000, -10, 196).offset, 0);
  assert.equal(scrollbarGeometry(200, 1000, 900, 196).offset, end.offset);
});
