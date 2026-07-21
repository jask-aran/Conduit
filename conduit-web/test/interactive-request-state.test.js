import assert from "node:assert/strict";
import test from "node:test";
import {
  failInteractiveRequest,
  markInteractiveRequestSubmitting,
  mergeInteractiveRequestSnapshot,
  normalizeInteractiveRequest,
  resolveInteractiveRequest,
} from "../src/client/interactive-request-state.js";

const timestamp = "2026-07-20T12:00:00.000Z";

function pendingRequest(overrides = {}) {
  return {
    id: "request-1",
    kind: "input",
    title: "Name the branch",
    message: "",
    options: [],
    placeholder: "feat/example",
    prefill: "",
    timeoutMs: null,
    status: "pending",
    response: null,
    error: null,
    timestamp,
    seq: 4,
    ...overrides,
  };
}

test("normalizeInteractiveRequest normalizes blocking select, confirm, input, and editor requests", () => {
  assert.deepEqual(normalizeInteractiveRequest({
    type: "extension_ui_request",
    id: "select-1",
    method: "select",
    title: "Choose a profile",
    options: ["Fast", 2],
    timeout: 5000,
  }, { timestamp, seq: 1 }), {
    id: "select-1",
    kind: "select",
    title: "Choose a profile",
    message: "",
    options: ["Fast", "2"],
    placeholder: "",
    prefill: "",
    timeoutMs: 5000,
    status: "pending",
    response: null,
    error: null,
    timestamp,
    seq: 1,
  });

  assert.deepEqual(normalizeInteractiveRequest({
    request: {
      id: "confirm-1",
      method: "confirm",
      title: "Allow write?",
      message: "Update the file",
      timeoutMs: 7500,
    },
  }, { timestamp, seq: 2 }), pendingRequest({
    id: "confirm-1",
    kind: "confirm",
    title: "Allow write?",
    message: "Update the file",
    placeholder: "",
    timeoutMs: 7500,
    seq: 2,
  }));

  const input = normalizeInteractiveRequest({
    id: "input-1",
    method: "input",
    title: "Branch name",
    placeholder: "feat/example",
  }, { timestamp, seq: 3 });
  assert.equal(input.kind, "input");
  assert.equal(input.placeholder, "feat/example");
  assert.equal(input.prefill, "");

  const editor = normalizeInteractiveRequest({
    id: "editor-1",
    method: "editor",
    title: "Edit release notes",
    prefill: "Initial text",
  }, { timestamp, seq: 4 });
  assert.equal(editor.kind, "editor");
  assert.equal(editor.prefill, "Initial text");
  assert.equal(editor.placeholder, "");
});

test("normalizeInteractiveRequest excludes fire-and-forget UI methods and malformed requests", () => {
  for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]) {
    assert.equal(normalizeInteractiveRequest({ id: `fire-${method}`, method }, { timestamp, seq: 1 }), null);
  }
  assert.equal(normalizeInteractiveRequest({ method: "confirm", title: "Missing id" }, { timestamp, seq: 1 }), null);
  assert.equal(normalizeInteractiveRequest(null, { timestamp, seq: 1 }), null);
});

test("mergeInteractiveRequestSnapshot preserves first identity fields and resident resolved history", () => {
  const resolved = pendingRequest({
    id: "resolved-1",
    kind: "select",
    status: "resolved",
    response: { value: "Fast" },
    timestamp: "2026-07-20T10:00:00.000Z",
    seq: 1,
  });
  const current = [
    resolved,
    pendingRequest({ id: "pending-1", timestamp: "2026-07-20T11:00:00.000Z", seq: 2 }),
  ];
  const incoming = [
    pendingRequest({
      id: "pending-1",
      title: "Updated prompt",
      timestamp: "2026-07-20T13:00:00.000Z",
      seq: 99,
    }),
    pendingRequest({ id: "pending-2", seq: 3 }),
  ];

  const merged = mergeInteractiveRequestSnapshot(current, incoming);
  assert.deepEqual(merged.map((request) => request.id), ["pending-1", "pending-2", "resolved-1"]);
  assert.equal(merged[0].title, "Updated prompt");
  assert.equal(merged[0].timestamp, "2026-07-20T11:00:00.000Z");
  assert.equal(merged[0].seq, 2);
  assert.equal(merged[2].status, "resolved");
  assert.deepEqual(merged[2].response, { value: "Fast" });
});

test("mergeInteractiveRequestSnapshot does not regress a resolved request from a stale snapshot", () => {
  const current = [pendingRequest({
    status: "resolved",
    response: { confirmed: true },
  })];
  const incoming = [pendingRequest({ status: "pending", response: null })];

  const merged = mergeInteractiveRequestSnapshot(current, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "resolved");
  assert.deepEqual(merged[0].response, { confirmed: true });
});

test("interactive request lifecycle supports submit, acknowledgement, remote resolution, failure, and retry", () => {
  const pending = [pendingRequest()];
  const submitting = markInteractiveRequestSubmitting(pending, "request-1", { value: "feat/ui" });
  assert.equal(submitting[0].status, "submitting");
  assert.deepEqual(submitting[0].response, { value: "feat/ui" });
  assert.equal(submitting[0].error, null);

  const acknowledged = resolveInteractiveRequest(submitting, "request-1");
  assert.equal(acknowledged[0].status, "resolved");
  assert.deepEqual(acknowledged[0].response, { value: "feat/ui" });

  const remotelyResolved = resolveInteractiveRequest([
    pendingRequest({ id: "confirm-2", kind: "confirm" }),
  ], "confirm-2", { confirmed: false });
  assert.equal(remotelyResolved[0].status, "resolved");
  assert.deepEqual(remotelyResolved[0].response, { confirmed: false });

  const failed = failInteractiveRequest(submitting, "request-1", "Socket closed");
  assert.equal(failed[0].status, "error");
  assert.equal(failed[0].error, "Socket closed");
  assert.deepEqual(failed[0].response, { value: "feat/ui" });

  const retried = markInteractiveRequestSubmitting(failed, "request-1", failed[0].response);
  assert.equal(retried[0].status, "submitting");
  assert.equal(retried[0].error, null);
});

test("lifecycle updates ignore unknown request IDs", () => {
  const current = [pendingRequest()];
  assert.equal(markInteractiveRequestSubmitting(current, "missing", { value: "x" }), current);
  assert.equal(resolveInteractiveRequest(current, "missing", { value: "x" }), current);
  assert.equal(failInteractiveRequest(current, "missing", "nope"), current);
});
