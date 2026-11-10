import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { FileError, ExecutionError } from "@earendil-works/pi-durable/env";
import { encode, decode, rootFor } from "../src/nodes/protocol.js";

// protocol.js: values are JSON; bytes and environment errors retain their meaning.
const roundTrip = (value) => decode(JSON.parse(JSON.stringify(encode(value))), { FileError, ExecutionError });

test("node messages preserve bytes nested in results and event arrays", () => {
  const message = { ok: true, value: [null, { data: new Uint8Array([0, 127, 128, 255]), empty: new Uint8Array() }] };
  assert.deepEqual(roundTrip(message), message);
});

// rootFor: a path must be inside a root shared with the requested grant.
test("a shared root grants only the selected operations inside its own path", () => {
  const root = { path: path.resolve("fixture-share"), read: true, write: false, shell: false };
  assert.equal(rootFor([root], path.join(root.path, "child"), "read"), root);
  assert.equal(rootFor([root], root.path, "read"), root);
  for (const grant of ["write", "shell"]) assert.equal(rootFor([root], root.path, grant), null);
  for (const outside of [path.join(root.path, "..", "other"), `${root.path}-sibling/file`]) {
    assert.equal(rootFor([root], outside, "read"), null);
  }
});
