import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { keptBack } from "../src/nodes/secrets.js";

// Case-insensitive segments and directory subtrees.
test("secret files stay excluded at any depth and regardless of letter case", () => {
  const root = { path: path.resolve("fixture-share") };
  for (const file of [".ENV", "nested/.env.production", "nested/PRIVATE.KEY", "nested/.SSH/config", ".aws/nested/token"]) {
    assert.equal(keptBack(root, path.join(root.path, file)), true, file);
  }
  assert.equal(keptBack(root, path.join(root.path, "source.js")), false);
});
