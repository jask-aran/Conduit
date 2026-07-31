import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
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

test("live harness rejects abbreviated deployment release identities", async () => {
  const server = createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ready", release: "abcdef1" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const child = spawn(process.execPath, [
    "scripts/run-live-harness.mjs",
    "--origin",
    `http://127.0.0.1:${port}`,
    "--chat-id",
    "performance-chat",
  ], {
    cwd,
    env: {
      ...process.env,
      CONDUIT_PERF_PASSWORD: "test-password",
      CONDUIT_PERF_PROMPT: "test prompt",
    },
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /did not identify an immutable release/);
});
