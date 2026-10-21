import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCoarseActivity,
  deriveFineActivity,
  activityLabel,
  pickHigherActivity,
} from "../src/activity.js";
function record(overrides = {}) {
  return {
    status: "running",
    active: false,
    stopping: false,
    compacting: false,
    retrying: false,
    hostUiRequests: [],
    activityDetail: null,
    generation: null,
    ...overrides,
  };
}

test("coarse activity precedence: failed > stopping > waiting > compacting > retrying > working", () => {
  assert.equal(deriveCoarseActivity(record({ status: "failed" })), "failed");
  assert.equal(deriveCoarseActivity(record({ stopping: true })), "stopping");
  assert.equal(deriveCoarseActivity(record({ hostUiRequests: [{ id: "1" }] })), "waiting_for_user");
  assert.equal(deriveCoarseActivity(record({ compacting: true })), "compacting");
  assert.equal(deriveCoarseActivity(record({ retrying: true })), "retrying");
  assert.equal(deriveCoarseActivity(record({ active: true })), "working");
  assert.equal(deriveCoarseActivity(record({ status: "starting" })), "starting");
  assert.equal(deriveCoarseActivity(record()), "idle");
});

test("settled generation is idle even when the generation handle remains open", () => {
  assert.equal(deriveCoarseActivity(record({
    generation: { id: "g1", closed: false, settled: false },
  })), "working");
  assert.equal(deriveCoarseActivity(record({
    generation: { id: "g1", closed: false, settled: true },
  })), "idle");
});

test("fine activity prefers tools and stop over generic working", () => {
  assert.equal(deriveFineActivity({ generation: "stopping" }).kind, "stopping");
  assert.equal(deriveFineActivity({ toolName: "bash", generation: "active" }).label, "Running bash");
  assert.equal(deriveFineActivity({ thinking: true, generation: "active" }).kind, "thinking");
  assert.equal(deriveFineActivity({ responding: true, generation: "active" }).kind, "responding");
  assert.equal(deriveFineActivity({ generation: "active" }).kind, "waiting_for_model");
  assert.equal(deriveFineActivity({ generation: "idle" }).kind, "idle");
  // Stale coarse "working" must not keep the transcript row after the turn is idle.
  assert.equal(deriveFineActivity({ generation: "idle", coarse: "working" }).kind, "idle");
  assert.deepEqual(deriveFineActivity({ generation: "failed" }), { kind: "request_failed", label: "Request failed · Ready to retry" });
  assert.deepEqual(deriveFineActivity({ generation: "failed", processStatus: "failed" }), { kind: "runtime_failed", label: "Agent failed" });
  assert.deepEqual(deriveFineActivity({ generation: "interrupted", toolName: "bash", thinking: true, responding: true, coarse: "working" }), { kind: "interrupted", label: "Interrupted · Ready" });
});

test("activity labels and ranking", () => {
  // The indicator is given a record with no harness name, so its label is
  // shared across adapters.
  assert.equal(activityLabel("working", "using read"), "Working — using read");
  assert.equal(activityLabel("idle"), "Ready (idle)");
  assert.ok(pickHigherActivity("failed", "working") === "failed");
  assert.ok(pickHigherActivity("working", "idle") === "working");
});
