import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveAnswerRow,
  buildLiveProjectionIndex,
  buildTurnRows,
} from "../src/client/turn-rows.ts";

test("projects a live generation directly from ordered Pi blocks", () => {
  const rows = buildTurnRows([
    { id: "u1", role: "user", content: "Inspect this" },
  ], [], {
    activeGeneration: {
      id: "g1",
      status: "running",
      lastSeq: 9,
      toolExecutions: {
        call_1: { toolCallId: "call_1", name: "read", status: "complete", result: "ok" },
      },
      assistantMessages: [{
        id: "m1",
        blocks: [
          { type: "thinking", identity: "g1:m1:0", contentIndex: 0, text: "Planning", status: "complete" },
          { type: "text", identity: "g1:m1:1", contentIndex: 1, text: "Inspecting files", status: "complete" },
          { type: "toolCall", identity: "g1:m1:2", contentIndex: 2, toolCallId: "call_1", name: "read", status: "complete" },
        ],
      }, {
        id: "m2",
        blocks: [{ type: "text", identity: "g1:m2:0", contentIndex: 0, text: "Here is the answer", status: "streaming" }],
      }],
    },
  });

  assert.deepEqual(rows.map((row) => row.key), ["message:u1", "trace:u1", "answer:u1:0"]);
  const trace = rows[1];
  assert.equal(trace?.type, "trace");
  if (trace?.type !== "trace") return;
  assert.deepEqual(trace.value.segments.map((segment) => segment.kind), ["thinking", "narration", "tool"]);
  assert.equal(trace.value.segments[1]?.kind === "narration" && trace.value.segments[1].text, "Inspecting files");
  assert.equal(trace.value.segments[2]?.kind === "tool" && trace.value.segments[2].tool.name, "read");
  const answer = rows[2];
  assert.equal(answer?.type, "message");
  assert.equal(answer?.type === "message" && answer.value.content, "Here is the answer");
  assert.equal(answer?.type === "message" && answer.live, true);
});

test("does not project persisted partials beside their resumed active generation", () => {
  const generation = {
    id: "g1",
    status: "running",
    lastSeq: 4,
    toolExecutions: {},
    assistantMessages: [{
      id: "m1",
      blocks: [{ type: "thinking", identity: "g1:m1:0", contentIndex: 0, text: "Current plan", status: "streaming" }],
    }],
  };
  const rows = buildTurnRows([
    { id: "u1", role: "user", content: "Inspect this" },
    {
      id: "persisted-partial",
      role: "assistant",
      content: "",
      stopReason: "toolUse",
      blocks: [{ type: "thinking", thinking: "Older plan" }],
    },
  ], [], { activeGeneration: generation });

  assert.deepEqual(rows.map((row) => row.key), ["message:u1", "trace:u1"]);
  const trace = rows[1];
  assert.equal(trace?.type === "trace" && trace.value.segments[0]?.kind === "thinking" && trace.value.segments[0].text, "Current plan");
});

test("projects partial continuation through Active Generation without a flattened stream", () => {
  const rows = buildTurnRows([
    { id: "u1", role: "user", content: "Write a long answer" },
    { id: "partial", role: "assistant", content: "The answer continues", stopped: true },
  ], [], {
    activeGeneration: {
      id: "g_continue",
      status: "running",
      lastSeq: 3,
      continuation: true,
      continuationBase: "The answer continues",
      toolExecutions: {},
      assistantMessages: [{
        id: "m1",
        blocks: [{ type: "text", identity: "g_continue:m1:0", contentIndex: 0, text: " continues here.", status: "streaming" }],
      }],
    },
  });

  assert.deepEqual(rows.map((row) => row.key), ["message:u1", "answer:u1:0"]);
  assert.equal(rows[1]?.type === "message" && rows[1].value.content, "The answer continues here.");
});

test("keeps the answer display key across live and persisted projections", () => {
  const user = { id: "u1", role: "user", content: "Write a long answer" };
  const liveRows = buildTurnRows([user], [], {
    activeGeneration: {
      id: "g_live",
      status: "running",
      lastSeq: 2,
      toolExecutions: {},
      assistantMessages: [{
        id: "m_live",
        blocks: [{ type: "text", identity: "g_live:m_live:0", contentIndex: 0, text: "Partial answer", status: "streaming" }],
      }],
    },
  });
  const persistedRows = buildTurnRows([
    user,
    { id: "m_persisted", role: "assistant", content: "Partial answer", stopReason: "stop" },
  ], []);
  const liveAnswer = liveRows.find((row) => row.type === "message" && row.value.role === "assistant");
  const persistedAnswer = persistedRows.find((row) => row.type === "message" && row.value.role === "assistant");
  assert.equal(liveAnswer?.type === "message" && liveAnswer.displayKey, "answer:u1:0");
  assert.equal(persistedAnswer?.type === "message" && persistedAnswer.displayKey, "answer:u1:0");
});

test("projects empty and partial assistant errors as highlighted message rows", () => {
  const user = { id: "u1", role: "user", content: "Try this request" };
  const persisted = buildTurnRows([
    user,
    {
      id: "persisted-error",
      role: "assistant",
      content: "",
      stopReason: "error",
      errorMessage: "Provider rejected the request",
    },
  ], []);
  assert.equal(persisted[1]?.type, "message");
  assert.equal(persisted[1]?.type === "message" && persisted[1].value.errorMessage, "Provider rejected the request");

  const live = buildTurnRows([user], [], {
    activeGeneration: {
      id: "g_error",
      status: "failed",
      lastSeq: 5,
      toolExecutions: {},
      assistantMessages: [{
        id: "m_error",
        stopReason: "error",
        errorMessage: "Connection closed",
        provider: "example-provider",
        model: "example-model",
        timestamp: "2026-08-12T09:48:47.341Z",
        blocks: [{ type: "text", identity: "g_error:m_error:0", contentIndex: 0, text: "Partial response", status: "complete" }],
      }],
    },
  });
  assert.equal(live[1]?.type === "message" && live[1].value.content, "Partial response");
  assert.equal(live[1]?.type === "message" && live[1].value.errorMessage, "Connection closed");
  assert.equal(live[1]?.type === "message" && live[1].value.stopReason, "error");
  assert.equal(live[1]?.type === "message" && live[1].value.provider, "example-provider");
  assert.equal(live[1]?.type === "message" && live[1].value.model, "example-model");
  assert.equal(live[1]?.type === "message" && live[1].value.timestamp, "2026-08-12T09:48:47.341Z");
});

test("keeps a recovered assistant error inside the turn trace", () => {
  const rows = buildTurnRows([
    { id: "u1", role: "user", content: "Try this request" },
    {
      id: "m_error",
      role: "assistant",
      content: "",
      blocks: [{ type: "thinking", thinking: "Retrying the provider request" }],
      stopReason: "error",
      errorMessage: "Temporary provider failure",
      provider: "example-provider",
      model: "example-model",
      timestamp: "2026-08-12T09:48:47.341Z",
    },
    { id: "m_recovered", role: "assistant", content: "Recovered answer", stopReason: "stop" },
  ], []);

  assert.deepEqual(rows.map((row) => row.type), ["message", "trace", "message"]);
  const trace = rows[1];
  assert.equal(trace?.type, "trace");
  if (trace?.type !== "trace") return;
  assert.deepEqual(trace.value.segments.map((segment) => segment.kind), ["thinking", "error"]);
  const error = trace.value.segments[1];
  assert.equal(error?.kind, "error");
  assert.equal(error?.kind === "error" && error.message.errorMessage, "Temporary provider failure");
  assert.equal(rows.some((row) => row.type === "message" && row.value.errorMessage === "Temporary provider failure"), false);
  assert.equal(rows[2]?.type === "message" && rows[2].value.content, "Recovered answer");
});

test("does not expose a transient assistant error as terminal while Pi retries", () => {
  const rows = buildTurnRows([
    { id: "u1", role: "user", content: "Try this request" },
  ], [], {
    activeGeneration: {
      id: "g_retry",
      status: "running",
      lastSeq: 5,
      toolExecutions: {},
      assistantMessages: [{
        id: "m_error",
        stopReason: "error",
        errorMessage: "Temporary provider failure",
        blocks: [],
      }],
    },
  });

  assert.deepEqual(rows.map((row) => row.key), ["message:u1"]);
});

test("indexes live blocks to one trace or answer row", () => {
  const generation = {
    id: "g_index",
    status: "running",
    lastSeq: 4,
    toolExecutions: {
      call_1: { toolCallId: "call_1", name: "read", status: "running" },
    },
    assistantMessages: [{
      id: "m1",
      blocks: [
        { type: "thinking", identity: "g_index:m1:0", contentIndex: 0, text: "Plan", status: "complete" },
        { type: "text", identity: "g_index:m1:1", contentIndex: 1, text: "Narration", status: "complete" },
        { type: "toolCall", identity: "g_index:m1:2", contentIndex: 2, toolCallId: "call_1", name: "read", status: "streaming" },
      ],
    }, {
      id: "m2",
      blocks: [{ type: "text", identity: "g_index:m2:0", contentIndex: 0, text: "Answer", status: "streaming" }],
    }],
  };
  const messages = [{ id: "u1", role: "user", content: "Inspect this" }];
  const index = buildLiveProjectionIndex(generation, messages);

  assert.deepEqual(index.blockLocations.get("g_index:m1:0"), { kind: "trace", rowKey: "trace:u1", segmentIndex: 0 });
  assert.deepEqual(index.blockLocations.get("g_index:m1:1"), { kind: "trace", rowKey: "trace:u1", segmentIndex: 1 });
  assert.deepEqual(index.blockLocations.get("g_index:m1:2"), { kind: "trace", rowKey: "trace:u1", segmentIndex: 2 });
  assert.deepEqual(index.blockLocations.get("g_index:m2:0"), { kind: "answer", rowKey: "answer:u1:0", assistantId: "m2" });
  assert.deepEqual(index.toolLocations.get("call_1"), { rowKey: "trace:u1", segmentIndex: 2 });

  generation.assistantMessages[1].blocks[0].text = "Answer updated";
  generation.lastSeq = 5;
  const row = buildLiveAnswerRow(generation, "m2", index, index.messageIndex);
  assert.equal(row?.value.content, "Answer updated");
  assert.equal(row?.key, "answer:u1:0");
});
