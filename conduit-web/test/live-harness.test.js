import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cwd = new URL("..", import.meta.url);

test("live harness documents explicit target, secret, and bounded-run inputs", () => {
  const result = spawnSync(process.execPath, ["scripts/run-live-harness.mjs", "--help"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--origin <url>/);
  assert.match(result.stdout, /--chat-id <id>/);
  assert.match(result.stdout, /CONDUIT_PERF_PASSWORD/);
  assert.match(result.stdout, /--timeout-ms <number>/);
  assert.match(result.stdout, /--dry-run/);
});

test("live harness dry-run is explicit and does not expose prompt or password", () => {
  const result = spawnSync(process.execPath, [
    "scripts/run-live-harness.mjs",
    "--dry-run",
    "--origin",
    "https://example.test",
    "--target",
    "vps-edge",
    "--chat-id",
    "chat-performance",
  ], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CONDUIT_PERF_PASSWORD: "secret-do-not-print",
      CONDUIT_PERF_PROMPT: "sensitive prompt do not print",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"outcome": "dry-run"/);
  assert.match(result.stdout, /"target": "vps-edge"/);
  assert.doesNotMatch(result.stdout, /secret-do-not-print/);
  assert.doesNotMatch(result.stdout, /sensitive prompt do not print/);
});

test("live harness rejects a non-HTTPS origin before network work", () => {
  const result = spawnSync(process.execPath, [
    "scripts/run-live-harness.mjs",
    "--dry-run",
    "--origin",
    "ftp://example.test",
  ], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use http or https/);
});
