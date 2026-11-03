import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { keptBack } from "../src/nodes/secrets.js";

// Design: "Which files never leave a device?"; secrets.js: case-insensitive segments and directory subtrees.
test("secret files stay excluded at any depth and regardless of letter case", () => {
  const root = { path: path.resolve("fixture-share") };
  for (const file of [".ENV", "nested/.env.production", "nested/PRIVATE.KEY", "nested/.SSH/config", ".aws/nested/token"]) {
    assert.equal(keptBack(root, path.join(root.path, file)), true, file);
  }
  assert.equal(keptBack(root, path.join(root.path, "source.js")), false);
});

// secrets.js: templates are not secrets; a root can add deny patterns and allow exceptions.
test("a root can exclude more files and allow specific exceptions", () => {
  const root = { path: path.resolve("fixture-share"), deny: ["private-*.txt"], allow: ["private-public.txt"] };
  for (const [file, excluded] of [["private-notes.txt", true], ["private-public.txt", false], [".env.example", false]]) {
    assert.equal(keptBack(root, path.join(root.path, file)), excluded, file);
  }
});
