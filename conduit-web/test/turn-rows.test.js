import assert from "node:assert/strict";
import test from "node:test";
import { buildTurnRows } from "../src/client/turn-rows.ts";

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

  assert.deepEqual(rows.map((row) => row.key), ["message:u1", "trace:u1", "message:live:g1:m2"]);
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

  assert.deepEqual(rows.map((row) => row.key), ["message:u1", "message:live:g_continue:m1"]);
  assert.equal(rows[1]?.type === "message" && rows[1].value.content, "The answer continues here.");
});
