import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONDUIT_ORIGIN,
  resolveLocalTarget,
} from "../scripts/agent-browser-target.mjs";

test("defaults to the WSL-local Conduit origin", () => {
  assert.equal(
    resolveLocalTarget(),
    `${DEFAULT_CONDUIT_ORIGIN}/`,
  );
});

test("accepts a local chat path", () => {
  assert.equal(
    resolveLocalTarget({ rawPath: "/chat/example?probe=1" }),
    "http://127.0.0.1:4310/chat/example?probe=1",
  );
});

test("accepts the WSL bind address", () => {
  assert.equal(
    resolveLocalTarget({
      rawOrigin: "http://0.0.0.0:4310",
      rawPath: "/healthz",
    }),
    "http://0.0.0.0:4310/healthz",
  );
});

test("rejects external origins", () => {
  assert.throws(
    () => resolveLocalTarget({ rawOrigin: "https://conduit.jask-aran.com" }),
    /only accepts http:\/\/127\.0\.0\.1:4310 or http:\/\/0\.0\.0\.0:4310/,
  );
});

test("rejects a path that escapes the local origin", () => {
  assert.throws(
    () => resolveLocalTarget({ rawPath: "https://example.com/" }),
    /must stay on the local Conduit origin/,
  );
});
