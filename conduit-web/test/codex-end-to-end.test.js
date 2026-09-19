/**
 * A Codex chat driven through the real server, and what a browser would draw.
 *
 * `codex-transcript-pipeline.test.js` drives the adapter directly, which is
 * fast and lets a test hold a turn open mid-flight. This one gives up that
 * control to gain the rest of the stack: a real Conduit process, a real chat,
 * a real WebSocket, and a fake app-server daemon talking the real protocol over
 * its control socket. What both agree on is the rows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { startConduitHarness, waitFor } from "./helpers/conduit-harness.js";
import { normalizeLiveEvent } from "../src/client/api/live-events.ts";
import { applyToolOp, applyTranscriptOp, isToolOp, mergeToolEvent } from "../src/client/timeline-order.ts";
import { buildTurnRows } from "../src/client/turn-rows.ts";

/** The browser, as far as the transcript is concerned. */
function project(frames) {
  let messages = [];
  let tools = [];
  for (const frame of frames) {
    const wire = normalizeLiveEvent(frame);
    // Exactly what the browser does with these: the statements decide what the
    // transcript holds, and live activity only paints output arriving while a
    // tool is still running.
    if (wire.type === "transcript_op") {
      if (isToolOp(wire)) tools = applyToolOp(tools, wire);
      else messages = applyTranscriptOp(messages, wire);
    }
    if (wire.type === "tool_execution_updated") {
      tools = mergeToolEvent(tools, {
        type: "tool_execution_update",
        toolCallId: wire.toolCallId, toolName: wire.name, args: wire.arguments,
        partialResult: wire.partialResult,
      }).tools;
    }
  }
  return { messages, rows: buildTurnRows(messages, tools) };
}

const shape = (rows) => rows.map((row) => (row.type === "trace"
  ? `trace(${row.value.status})`
  : `${row.value.role}: ${row.value.content}`));

async function codexChat(harness) {
  const project = await harness.createProject("Codex workspace");
  const chat = await (await harness.request("/v0/chats", {
    method: "POST", body: JSON.stringify({ projectId: project.id, profileId: "codex" }),
  })).json();
  const live = await (await harness.request("/v0/live-sessions", {
    method: "POST", body: JSON.stringify({ chatId: chat.id, projectId: project.id, intent: "prompt" }),
  })).json();
  const stream = harness.connectStream(live.id);
  await stream.opened;
  return { project, chat, live, stream };
}

test("a Codex turn reaches the browser as prompt, trace and answer", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const { stream } = await codexChat(harness);

  const settled = stream.next((event) => event.type === "status" && event.detail === "settled", 10_000);
  stream.socket.send(JSON.stringify({ type: "prompt", message: "Fix the build" }));
  await settled;
  stream.close();

  const { rows } = project(stream.messages);
  assert.deepEqual(shape(rows), [
    "user: Fix the build",
    "trace(complete)",
    "assistant: codex-test medium works",
  ]);
  // The command the turn ran belongs to that turn's trace.
  assert.deepEqual(rows[1].value.segments.map((segment) => segment.kind), ["narration", "tool"]);
});

test("the server states the order, and a second turn does not disturb the first", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const { stream } = await codexChat(harness);

  const settledCount = () => stream.messages.filter((event) => event.type === "status" && event.detail === "settled").length;
  for (const [index, message] of ["short first", "short second"].entries()) {
    stream.socket.send(JSON.stringify({ type: "prompt", message }));
    await waitFor(() => settledCount() > index, `turn ${index + 1} never settled`);
  }
  stream.close();

  const { messages, rows } = project(stream.messages);
  assert.deepEqual(shape(rows), [
    "user: short first",
    "assistant: codex-test medium works",
    "user: short second",
    "assistant: codex-test medium works",
  ]);
  // Held in that order too, not merely grouped into it.
  assert.deepEqual(messages.map((item) => item.role), ["user", "assistant", "user", "assistant"]);
  // Every answer says which prompt it answers, rather than leaving the browser
  // to work it out from position.
  assert.deepEqual(messages.filter((item) => item.role === "assistant").map((item) => item.answers),
    [messages[0].id, messages[2].id]);
  // And the chat carries a sequenced log a reconnecting client can count from.
  const logState = stream.messages.find((event) => event.type === "log_state");
  assert.ok(logState?.log?.id, "the chat's order was stated on attach");
});
