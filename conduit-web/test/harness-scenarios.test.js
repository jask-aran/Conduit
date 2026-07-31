import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCadence, runDeterministicStreamingScenario } from "./helpers/streaming-scenario.js";

test("the harness CLI documents named scenario execution", () => {
  const result = spawnSync(process.execPath, ["scripts/run-harness.mjs", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--scenario <name>/);
  assert.match(result.stdout, /--profile <steady\|burst\|stall\|jitter>/);
  assert.match(result.stdout, /versioned JSON/);
});

test("the browser harness CLI documents deterministic render profiles", () => {
  const result = spawnSync(process.execPath, ["scripts/run-browser-harness.mjs", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--scenario <name>/);
  assert.match(result.stdout, /--profile <steady\|burst\|jitter>/);
  assert.match(result.stdout, /production client/);
});

test("built-in cadence profiles are declarative and seeded jitter is reproducible", () => {
  const steady = createCadence("steady", { text: "abcd", chunkSize: 2, intervalMs: 16 });
  assert.deepEqual(steady, { delaysMs: [0, 16], deltas: ["ab", "cd"] });

  const burst = createCadence("burst", { text: "abcdef", chunkSize: 1, burstSize: 3, burstIntervalMs: 120 });
  assert.deepEqual(burst, {
    delaysMs: [0, 0, 0, 120, 0, 0],
    deltas: ["a", "b", "c", "d", "e", "f"],
  });

  const stall = createCadence("stall", {
    text: "abcdef",
    chunkSize: 1,
    stallAfter: 3,
    stallMs: 300,
  });
  assert.deepEqual(stall, {
    delaysMs: [0, 0, 0, 300, 0, 0],
    deltas: ["a", "b", "c", "d", "e", "f"],
  });

  const first = createCadence("jitter", { text: "abcdef", chunkSize: 1, minDelayMs: 5, maxDelayMs: 20, seed: 42 });
  const second = createCadence("jitter", { text: "abcdef", chunkSize: 1, minDelayMs: 5, maxDelayMs: 20, seed: 42 });
  assert.deepEqual(first, second);
  assert.equal(first.delaysMs[0], 0);
  assert.ok(first.delaysMs.slice(1).every((delay) => delay >= 5 && delay <= 20));
});

test("a stalled deterministic scenario reports the intentional source gap", async () => {
  const cadence = createCadence("stall", {
    text: "abcdef",
    chunkSize: 1,
    stallAfter: 3,
    stallMs: 300,
  });
  const report = await runDeterministicStreamingScenario({ name: "stalled-text", cadence });

  assert.equal(report.outcome, "passed");
  assert.equal(report.transport.sourceStallCount, 1);
  assert.equal(report.transport.sourceStallMs, 300);
  assert.equal(report.transport.sourceGapsOver100Ms, 1);
  assert.equal(report.transport.finalText, "abcdef");
});

test("a named deterministic streaming scenario emits a versioned transport report", async () => {
  const report = await runDeterministicStreamingScenario({
    name: "steady-text",
    cadence: { delaysMs: [0, 20, 20], deltas: ["One", " two", " three"] },
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scenario, "steady-text");
  assert.equal(report.mode, "deterministic-transport");
  assert.equal(report.target, "local-harness");
  assert.equal(report.outcome, "passed");
  assert.equal(report.transport.sourceDeltaCount, 3);
  assert.equal(report.transport.sourceCharacters, 13);
  assert.deepEqual(report.transport.sourceGapMs, {
    count: 2,
    p50: 20,
    p95: 20,
    p99: 20,
    max: 20,
  });
  assert.equal(report.transport.finalText, "One two three");
  assert.ok(report.transport.deliveredDeltaCount >= 1);
  assert.ok(report.transport.deliveredDeltaCount <= 3);
  assert.ok(report.transport.firstDeltaMs >= 0);
  assert.ok(report.transport.completionMs >= report.transport.firstDeltaMs);
  assert.equal(report.transport.gapMs.count, report.transport.deliveredDeltaCount - 1);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.artifacts, []);
});
