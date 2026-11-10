import assert from "node:assert/strict";
import test from "node:test";
import { deriveFineActivity, activityLabel } from "../src/activity.js";
import { activityOf } from "../src/harnesses/turn.js";

test("a session's activity: starting > failed > stopping > waiting > compacting > working", () => {
  const all = { status: "running", failed: true, stopping: true, hostRequests: new Map([["1", { host: { id: "1" } }]]), compacting: true, active: true };
  assert.equal(activityOf({ ...all, status: "starting" }), "starting");
  assert.equal(activityOf(all), "failed");
  assert.equal(activityOf({ ...all, failed: false }), "stopping");
  // A stop with a prompt still up is stopping; one of two prompts answered is still waiting.
  assert.equal(activityOf({ ...all, failed: false, stopping: false }), "waiting_for_user");
  assert.equal(activityOf({ status: "running", active: true, hostRequests: new Map([["a", { host: {} }]]) }), "waiting_for_user");
  assert.equal(activityOf({ status: "running", active: true, compacting: true }), "compacting");
  assert.equal(activityOf({ status: "running", turnStarting: true }), "working");
  assert.equal(activityOf({ status: "running" }), "idle");
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

test("activity labels", () => {
  // The indicator is given a record with no harness name, so its label is
  // shared across adapters.
  assert.equal(activityLabel("working", "using read"), "Working — using read");
  assert.equal(activityLabel("idle"), "Ready (idle)");
});
