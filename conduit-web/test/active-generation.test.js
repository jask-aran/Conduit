import assert from "node:assert/strict";
import test from "node:test";
import {
  activeGenerationFromPersistedMessages,
  generationResumeEvent,
  reduceActiveGeneration,
  reduceGenerationEvents,
  textBlockClassifications,
} from "../src/active-generation.js";
import { createPiEventNormalizer } from "../src/pi-event-normalizer.js";
import {
  persistedTextBeforeToolUse,
  piRpcGenerationFixtures,
} from "./fixtures/pi-rpc-generations.js";

function normalizedFixture(name, generationId = `g_${name}`) {
  const normalizer = createPiEventNormalizer(generationId);
  return piRpcGenerationFixtures[name].events.flatMap((event) => normalizer.normalize(event));
}

function tree(state) {
  return state.assistantMessages.map((message) => ({
    id: message.id,
    status: message.status,
    stopReason: message.stopReason,
    blocks: message.blocks.map((block) => ({
      type: block.type,
      contentIndex: block.contentIndex,
      identity: block.identity,
      text: block.text,
      toolCallId: block.toolCallId,
      name: block.name,
      arguments: block.arguments,
      status: block.status,
    })),
  }));
}

test("normalizes Pi block structure with stable generation-local identities", () => {
  const state = reduceGenerationEvents(normalizedFixture("multipleToolTurns", "g_tools"));

  assert.deepEqual(tree(state), [
    {
      id: "m1",
      status: "complete",
      stopReason: "toolUse",
      blocks: [
        { type: "thinking", contentIndex: 0, identity: "g_tools:m1:0", text: "Read first", toolCallId: undefined, name: undefined, arguments: undefined, status: "complete" },
        { type: "toolCall", contentIndex: 1, identity: "g_tools:m1:1", text: undefined, toolCallId: "call_read", name: "read", arguments: { path: "README.md" }, status: "complete" },
      ],
    },
    {
      id: "m2",
      status: "complete",
      stopReason: "toolUse",
      blocks: [
        { type: "toolCall", contentIndex: 0, identity: "g_tools:m2:0", text: undefined, toolCallId: "call_shell", name: "bash", arguments: { command: "git status --short" }, status: "complete" },
      ],
    },
    {
      id: "m3",
      status: "complete",
      stopReason: "stop",
      blocks: [
        { type: "text", contentIndex: 0, identity: "g_tools:m3:0", text: "Repository is clean.", toolCallId: undefined, name: undefined, arguments: undefined, status: "complete" },
      ],
    },
  ]);
  assert.equal(state.status, "complete");
});

test("classifies provisional answer text exactly once when later tool structure appears", () => {
  const events = normalizedFixture("textBeforeToolUse", "g_interim");
  let state = null;
  const observed = [];
  for (const event of events) {
    state = reduceActiveGeneration(state, event);
    const classification = textBlockClassifications(state || {})["g_interim:m1:0"];
    if (classification && classification !== observed.at(-1)) observed.push(classification);
  }

  assert.deepEqual(observed, ["answer", "interim"]);
  assert.deepEqual(textBlockClassifications(state), {
    "g_interim:m1:0": "interim",
    "g_interim:m2:0": "answer",
  });
});

test("live and persisted structures produce identical interim classification", () => {
  const live = reduceGenerationEvents(normalizedFixture("textBeforeToolUse", "g_same"));
  const persisted = activeGenerationFromPersistedMessages("g_same", persistedTextBeforeToolUse);

  assert.deepEqual(textBlockClassifications(live), textBlockClassifications(persisted));
  assert.deepEqual(tree(live), tree(persisted));
});

for (const name of ["noThinkingAnswer", "thinkingThenAnswer"]) {
  test(`resume during ${name === "noThinkingAnswer" ? "answer" : "thinking"} is idempotent and converges`, () => {
    const events = normalizedFixture(name);
    const split = piRpcGenerationFixtures[name].resumeAfter;
    const beforeDisconnect = reduceGenerationEvents(events.slice(0, split));
    const resume = generationResumeEvent(beforeDisconnect);
    let reconnected = reduceActiveGeneration(null, resume);

    reconnected = reduceActiveGeneration(reconnected, events[split - 1]);
    reconnected = reduceGenerationEvents(events.slice(split), reconnected);

    assert.deepEqual(reconnected, reduceGenerationEvents(events));
  });
}

test("parallel tool executions join independently by toolCallId", () => {
  const state = reduceGenerationEvents(normalizedFixture("parallelTools"));

  assert.deepEqual(Object.keys(state.toolExecutions), ["call_one", "call_two"]);
  assert.deepEqual(state.toolExecutions.call_one, {
    toolCallId: "call_one",
    name: "read",
    arguments: { path: "one" },
    status: "complete",
    partialResult: null,
    result: "one",
    isError: false,
  });
  assert.equal(state.toolExecutions.call_two.result, "two");
});

test("retry gaps retain the generation and settle only after the successful retry", () => {
  const events = normalizedFixture("retry");
  const retryStart = events.findIndex((event) => event.type === "generation_retry_started");
  const duringRetry = reduceGenerationEvents(events.slice(0, retryStart + 1));
  const settled = reduceGenerationEvents(events);

  assert.equal(duringRetry.status, "running");
  assert.equal(duringRetry.retry.attempt, 1);
  assert.equal(settled.status, "complete");
  assert.equal(settled.assistantMessages.length, 2);
  assert.equal(settled.assistantMessages[0].stopReason, "error");
  assert.equal(settled.assistantMessages[1].blocks[0].text, "Recovered");
});

test("stop closes the generation and ignores all later events for that id", () => {
  const state = reduceGenerationEvents(normalizedFixture("stopped", "g_stop"));

  assert.equal(state.status, "stopped");
  assert.equal(state.assistantMessages[0].blocks[0].text, "Partial");
  const restarted = reduceActiveGeneration(state, {
    type: "generation_started",
    generationId: "g_stop",
    seq: state.lastSeq + 1,
  });
  assert.equal(restarted, state);
});

test("provider error settles as a failed generation", () => {
  const state = reduceGenerationEvents(normalizedFixture("providerError"));

  assert.equal(state.status, "failed");
  assert.equal(state.assistantMessages[0].status, "error");
  assert.equal(state.assistantMessages[0].errorMessage, "Provider rejected the request");
});

test("multiple native text and thinking blocks retain their separate positions", () => {
  const state = reduceGenerationEvents(normalizedFixture("multipleTextThinkingBlocks", "g_blocks"));

  assert.deepEqual(state.assistantMessages[0].blocks.map(({ type, contentIndex, text }) => ({
    type,
    contentIndex,
    text,
  })), [
    { type: "thinking", contentIndex: 0, text: "First thought" },
    { type: "text", contentIndex: 1, text: "First text" },
    { type: "thinking", contentIndex: 2, text: "Second thought" },
    { type: "text", contentIndex: 3, text: "Second text" },
  ]);
});

test("does not duplicate a provider's first block token when start and delta overlap", () => {
  const normalizer = createPiEventNormalizer("g_overlap");
  const events = [
    { type: "generation_started" },
    { type: "message_start", message: { role: "assistant" } },
    { type: "message_update", assistantMessageEvent: {
      type: "thinking_start", contentIndex: 0, partial: { content: [{ type: "thinking", thinking: "Now" }] },
    } },
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Now" } },
  ].flatMap((event) => normalizer.normalize(event));
  const state = reduceGenerationEvents(events);
  assert.equal(state.assistantMessages[0].blocks[0].text, "Now");
});
