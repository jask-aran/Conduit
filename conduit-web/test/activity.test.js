import assert from "node:assert/strict";
import test from "node:test";
import {
  applyActivityEvent,
  deriveCoarseActivity,
  deriveFineActivity,
  activityLabel,
  normalizeHostUiRequest,
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
  const state = record({ generation: { id: "g1", closed: false, settled: false }, active: true });
  applyActivityEvent(state, { type: "agent_end", willRetry: false });
  assert.equal(state.active, false);
  assert.equal(state.generation.settled, true);
  assert.equal(state.activity, "idle");
});

test("applyActivityEvent tracks tools, compaction, retry, and host UI", () => {
  const state = record();
  assert.equal(applyActivityEvent(state, { type: "tool_execution_start", toolName: "read" }), true);
  assert.equal(state.activity, "working");
  assert.match(state.activityDetail, /read/);

  // Detail-only change while already working must still report a change for SSE/sidebar.
  assert.equal(applyActivityEvent(state, { type: "tool_execution_start", toolName: "bash" }), true);
  assert.equal(state.activity, "working");
  assert.match(state.activityDetail, /bash/);

  applyActivityEvent(state, { type: "compaction_start" });
  assert.equal(state.activity, "compacting");

  applyActivityEvent(state, { type: "compaction_end" });
  applyActivityEvent(state, { type: "auto_retry_start", attempt: 2, delayMs: 3000 });
  assert.equal(state.activity, "retrying");

  applyActivityEvent(state, {
    type: "extension_ui_request",
    id: "req1",
    method: "confirm",
    title: "Allow write?",
    message: "Write file",
    timestamp: "2026-07-20T12:00:00.000Z",
    seq: 3,
  });
  assert.equal(state.activity, "waiting_for_user");
  assert.equal(state.hostUiRequests.length, 1);
  assert.equal(state.hostUiRequests[0].status, "pending");
  assert.equal(state.hostUiRequests[0].timestamp, "2026-07-20T12:00:00.000Z");
  assert.equal(state.hostUiRequests[0].seq, 3);

  applyActivityEvent(state, { type: "extension_ui_resolved", requestId: "req1" });
  assert.equal(state.hostUiRequests.length, 0);
});

test("normalizeHostUiRequest uses the transcript request shape and excludes fire-and-forget methods", () => {
  const request = normalizeHostUiRequest({
    type: "extension_ui_request",
    id: "x",
    method: "select",
    title: "Pick",
    options: ["a", "b"],
  }, {
    timestamp: "2026-07-20T12:00:00.000Z",
    seq: 7,
  });
  assert.deepEqual(request, {
    id: "x",
    kind: "select",
    title: "Pick",
    message: "",
    options: ["a", "b"],
    placeholder: "",
    prefill: "",
    timeoutMs: null,
    status: "pending",
    response: null,
    error: null,
    timestamp: "2026-07-20T12:00:00.000Z",
    seq: 7,
  });
  for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]) {
    assert.equal(normalizeHostUiRequest({ method, id: `fire-${method}` }), null);
  }
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
});

test("activity labels and ranking", () => {
  assert.equal(activityLabel("working", "using read"), "Pi working — using read");
  assert.equal(activityLabel("idle"), "Pi ready (idle)");
  assert.ok(pickHigherActivity("failed", "working") === "failed");
  assert.ok(pickHigherActivity("working", "idle") === "working");
});
