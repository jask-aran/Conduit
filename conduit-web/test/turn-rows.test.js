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
        call_1: { toolCallId: "call_1", name: "read", status: "complete", output: "ok" },
      },
      assistantMessages: [{
        id: "m1",
        blocks: [
          { kind: "thinking", identity: "g1:m1:0", contentIndex: 0, text: "Planning", status: "complete" },
          { kind: "text", identity: "g1:m1:1", contentIndex: 1, text: "Inspecting files", status: "complete" },
          { kind: "tool_call", identity: "g1:m1:2", contentIndex: 2, toolCallId: "call_1", name: "read", status: "complete" },
        ],
      }, {
        id: "m2",
        blocks: [{ kind: "text", identity: "g1:m2:0", contentIndex: 0, text: "Here is the answer", status: "streaming" }],
      }],
    },
  });

  assert.deepEqual(rows.map((row) => row.key), ["message:u1", "trace:u1", "answer:u1:0"]);
  const trace = rows[1];
  assert.equal(trace?.type, "trace");
  if (trace?.type !== "trace") return;
  assert.deepEqual(trace.value.segments.map((segment) => segment.kind), ["thinking", "narration", "tool"]);
  assert.equal(trace.value.status, "thinking");
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
      blocks: [{ kind: "thinking", identity: "g1:m1:0", contentIndex: 0, text: "Current plan", status: "streaming" }],
    }],
  };
  const rows = buildTurnRows([
    { id: "u1", role: "user", content: "Inspect this" },
    {
      id: "persisted-partial",
      role: "assistant",
      content: "",
      stopReason: "toolUse",
      blocks: [{ kind: "thinking", text: "Older plan" }],
    },
  ], [], { activeGeneration: generation });

  assert.deepEqual(rows.map((row) => row.key), ["message:u1", "trace:u1"]);
  const trace = rows[1];
  assert.equal(trace?.type === "trace" && trace.value.segments[0]?.kind === "thinking" && trace.value.segments[0].text, "Current plan");
});

test("reports an executing tool and a persisted interrupted trace", () => {
  const live = buildTurnRows([{ id: "u1", role: "user", content: "Wait" }], [], {
    activeGeneration: {
      id: "g1", status: "running", lastSeq: 3,
      toolExecutions: { call_1: { toolCallId: "call_1", name: "bash", status: "running" } },
      assistantMessages: [{
        id: "a1",
        blocks: [{ kind: "tool_call", identity: "g1:a1:0", contentIndex: 0, toolCallId: "call_1", name: "bash", status: "complete" }],
      }],
    },
  });
  const liveTrace = live.find((row) => row.type === "trace");
  assert.equal(liveTrace?.type === "trace" && liveTrace.value.status, "executing_tool");

  const persisted = buildTurnRows([
    { id: "u1", role: "user", content: "Wait" },
    {
      id: "a1", role: "assistant", content: "", stopReason: "toolUse",
      blocks: [{ kind: "tool_call", toolCallId: "call_1", name: "bash", input: {} }],
    },
    { id: "a2", role: "assistant", content: "", stopReason: "aborted", stopped: true },
  ], [{ toolCallId: "call_1", name: "bash", done: true, output: "Command aborted" }]);
  const persistedTrace = persisted.find((row) => row.type === "trace");
  assert.equal(persistedTrace?.type === "trace" && persistedTrace.value.status, "interrupted");
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
        blocks: [{ kind: "text", identity: "g_continue:m1:0", contentIndex: 0, text: " continues here.", status: "streaming" }],
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
        blocks: [{ kind: "text", identity: "g_live:m_live:0", contentIndex: 0, text: "Partial answer", status: "streaming" }],
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

test("keeps consecutive final assistant messages in the answer area", () => {
  const rows = buildTurnRows([
    { id: "u1", role: "user", content: "Explain the pathway" },
    {
      id: "a1",
      role: "assistant",
      content: "I will check the sources first.",
      stopReason: "toolUse",
      blocks: [
        { kind: "thinking", text: "Checking sources" },
        { kind: "tool_call", toolCallId: "call_1", name: "web_search", input: {} },
      ],
    },
    { id: "a2", role: "assistant", content: "The main answer.", stopReason: "stop", blocks: [{ kind: "text", text: "The main answer." }] },
    { id: "a3", role: "assistant", content: "A short follow-up.", stopReason: "stop", blocks: [{ kind: "text", text: "A short follow-up." }] },
  ], [{ id: "call_1", name: "web_search", done: true }]);

  const answers = rows.filter((row) => row.type === "message" && row.value.role === "assistant");
  assert.deepEqual(answers.map((row) => row.type === "message" && row.value.content), ["The main answer.\n\nA short follow-up."]);
  const trace = rows.find((row) => row.type === "trace");
  assert.equal(trace?.type === "trace" && trace.value.segments.some((segment) => segment.kind === "narration" && segment.text === "The main answer."), false);
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
        blocks: [{ kind: "text", identity: "g_error:m_error:0", contentIndex: 0, text: "Partial response", status: "complete" }],
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
      blocks: [{ kind: "thinking", text: "Retrying the provider request" }],
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
        { kind: "thinking", identity: "g_index:m1:0", contentIndex: 0, text: "Plan", status: "complete" },
        { kind: "text", identity: "g_index:m1:1", contentIndex: 1, text: "Narration", status: "complete" },
        { kind: "tool_call", identity: "g_index:m1:2", contentIndex: 2, toolCallId: "call_1", name: "read", status: "streaming" },
      ],
    }, {
      id: "m2",
      blocks: [{ kind: "text", identity: "g_index:m2:0", contentIndex: 0, text: "Answer", status: "streaming" }],
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

test("keeps a recovered live error in the trace while it is still generating", () => {
  const rows = buildTurnRows([{ id: "u1", role: "user", content: "Try this request" }], [], {
    activeGeneration: {
      id: "g_recovered",
      status: "running",
      lastSeq: 9,
      toolExecutions: {},
      assistantMessages: [
        { id: "m_error", stopReason: "error", errorMessage: "Temporary provider failure", blocks: [] },
        { id: "m_retry", stopReason: null, blocks: [{ kind: "text", identity: "g_recovered:m_retry:0", contentIndex: 0, text: "Recovered answer", status: "complete" }] },
      ],
    },
  });
  // The turn moved past this one, so it is history the reader should see - the
  // distinction the terminal and still-retrying cases turn on.
  assert.deepEqual(rows.map((row) => row.type), ["message", "trace", "message"]);
  const trace = rows[1];
  assert.equal(trace?.type === "trace" && trace.value.segments.map((segment) => segment.kind).join(), "error");
  assert.equal(rows[2]?.type === "message" && rows[2].value.content, "Recovered answer");
});

test("an answer is grouped under the prompt it says it answers", () => {
  // The transcript order here is deliberately not the grouping: the second
  // answer sits after a later prompt, and says it answers the earlier one.
  const messages = [
    { id: "u1", role: "user", content: "first" },
    { id: "a1", role: "assistant", content: "first answer", answers: "u1" },
    { id: "u2", role: "user", content: "second" },
    { id: "a2", role: "assistant", content: "late answer to the first", answers: "u1" },
  ];
  const rows = buildTurnRows(messages, []);
  const answers = rows.filter((row) => row.type === "message" && row.value.role === "assistant");
  assert.equal(answers.length, 1, "both answers belong to one turn, so they render as one answer row");
  assert.equal(answers[0].precedingUserId, "u1");
  assert.match(answers[0].value.content, /first answer/);
  assert.match(answers[0].value.content, /late answer to the first/);
});

test("a tool nothing claims is not handed to a turn by its timestamp", () => {
  const messages = [
    { id: "u1", role: "user", content: "run it", timestamp: "2026-01-01T00:00:00.000Z" },
    { id: "a1", role: "assistant", content: "done", answers: "u1", timestamp: "2026-01-01T00:00:02.000Z" },
  ];
  const orphan = { id: "call_1", name: "bash", done: true, timestamp: "2026-01-01T00:00:01.000Z" };
  const rows = buildTurnRows(messages, [orphan]);
  const traces = rows.filter((row) => row.type === "trace");
  assert.deepEqual(traces, [], "the message claimed no tools, so the turn shows none");
});

test("an answer stays an answer when a later message calls a tool", () => {
  // The turn answered, was steered, and the follow-on ran a tool. Reading the
  // turn's shape would call the first answer narration and fold it into the
  // trace, which is how a finished story disappeared from the transcript.
  const messages = [
    { id: "u1", role: "user", content: "tell me a long story" },
    { id: "a1", role: "assistant", content: "Once upon a time…", answers: "u1", interim: false },
    { id: "a2", role: "assistant", content: "", answers: "u1", interim: true,
      blocks: [{ kind: "tool_call", toolCallId: "call_1", name: "bash" }] },
  ];
  const rows = buildTurnRows(messages, [{ id: "call_1", name: "bash", done: true }]);
  const answers = rows.filter((row) => row.type === "message" && row.value.role === "assistant");
  assert.equal(answers.length, 1);
  assert.equal(answers[0].value.content, "Once upon a time…");
  assert.equal(rows.some((row) => row.type === "trace"), true, "the tool still shows in the trace");
});

/**
 * A reload draws the same rows the socket drew, for the same reason.
 *
 * The live stream states whether a message is the turn's answer or the turn
 * talking as it works, and which prompt each answer answers. Reading a session
 * file back stated neither, so a refresh quietly fell through to the two
 * fallbacks underneath: answer-or-narration read off the shape of the turn, and
 * tools matched to turns by timestamp. Those are the guesses that put one
 * turn's work beneath another turn's prompt, and a reload is exactly when they
 * had no supervision. The file is ordered, so both are read off it instead.
 */
test("a session read back from disk states its own rows", async () => {
  const { projectSessionEntries } = await import("../src/session-store.js");
  const entry = (id, message) => ({ type: "message", id, timestamp: "2026-01-01T00:00:00.000Z", message });
  const { messages, tools } = projectSessionEntries([
    entry("u1", { role: "user", content: "fix the bug" }),
    entry("a1", {
      role: "assistant", stopReason: "toolUse",
      content: [{ type: "text", text: "Let me look." }, { type: "toolCall", id: "t1", name: "read", arguments: {} }],
    }),
    entry("r1", { role: "toolResult", toolCallId: "t1", toolName: "read", content: "ok" }),
    entry("a2", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Fixed it." }] }),
  ]);

  // Stated, not inferred: the narration says it is narration and the answer
  // says which prompt it answers.
  assert.deepEqual(messages.filter((message) => message.role === "assistant")
    .map(({ interim, answers }) => ({ interim, answers })),
  [{ interim: true, answers: "u1" }, { interim: false, answers: "u1" }]);

  const rows = buildTurnRows(messages, tools);
  assert.deepEqual(rows.map((row) => row.type), ["message", "trace", "message"]);
  assert.equal(rows[0].value.content, "fix the bug");
  assert.equal(rows[2].value.content, "Fixed it.");
  // The tool sits in the trace because its message said it called it, not
  // because its timestamp fell inside the turn.
  assert.deepEqual(rows[1].value.segments.map((segment) => segment.kind), ["narration", "tool"]);
});

/**
 * The case the shape-reading fallback gets wrong.
 *
 * "Anything before the turn's last tool call is narration" is right for a turn
 * that ran straight through and wrong for one that answered and then kept
 * working -- a steer, above all, where the model finishes what it was saying
 * and then goes off in the new direction. The message itself knows: it called
 * no tool and it did not stop to use one, so it is an answer wherever it sits.
 */
test("an answer that is followed by more tool work is still an answer", async () => {
  const { projectSessionEntries } = await import("../src/session-store.js");
  const entry = (id, message) => ({ type: "message", id, timestamp: "2026-01-01T00:00:00.000Z", message });
  const { messages, tools } = projectSessionEntries([
    entry("u1", { role: "user", content: "what did you find?" }),
    entry("a1", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Two failing tests." }] }),
    entry("a2", {
      role: "assistant", stopReason: "toolUse",
      content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }],
    }),
    entry("r1", { role: "toolResult", toolCallId: "t1", toolName: "read", content: "ok" }),
    entry("a3", { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "And now three." }] }),
  ]);

  const said = (rows) => rows.map((row) => (row.type === "message" ? row.value.content : "trace"));
  // A turn draws its working above its answer, so the two answers meet in one
  // bubble -- but both of them are in it.
  assert.deepEqual(said(buildTurnRows(messages, tools)),
    ["what did you find?", "trace", "Two failing tests.\n\nAnd now three."]);

  // Without the statement there is only the shape to go on, and the shape says
  // the first answer came before a tool call, so it is filed as narration and
  // the reader finds it inside a collapsed trace.
  const unstated = messages.map(({ interim, ...message }) => message);
  assert.deepEqual(said(buildTurnRows(unstated, tools)),
    ["what did you find?", "trace", "And now three."]);
});
