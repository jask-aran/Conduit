import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  activeGenerationFromPersistedMessages,
  generationResumeEvent,
  reduceActiveGeneration,
  reduceGenerationEvents,
  textBlockClassifications,
} from "../src/active-generation.js";
import { createPiEventNormalizer } from "../src/pi-event-normalizer.js";
import { createClientActiveGenerationStore } from "../src/client/state/active-generation-store.js";
import { serializePiV0 } from "../src/pi-rpc-adapter.js";
import { isFoldedTurnEvent, isStructuredGenerationEvent, normalizeLiveEvent } from "../src/client/api/live-events.ts";
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
      kind: block.kind,
      contentIndex: block.contentIndex,
      identity: block.identity,
      text: block.text,
      toolCallId: block.toolCallId,
      name: block.name,
      input: block.input,
      status: block.status,
    })),
  }));
}

/**
 * The server's generation and the browser's, built the way each really is.
 *
 * The server reduces Pi's own stream. The browser reduces what comes off the
 * socket, which is that stream serialized through the adapter and read back --
 * so this drives the client through `serializePiV0` and `normalizeLiveEvent`
 * rather than handing it the internal events directly.
 *
 * Feeding both the same internal events is what let six cases sit in the
 * client reducer that no adapter could ever produce: the test delivered them,
 * the wire never did. Anything that stops crossing the wire now shows up here
 * as the two halves disagreeing.
 */
/**
 * One event as the browser really receives it: serialized out, read back.
 * Null for an event the browser is not sent at all.
 */
const overTheWire = (event) => {
  const frame = serializePiV0(event);
  return frame === null ? null : normalizeLiveEvent(JSON.parse(frame));
};

/** A fixture as it crosses the socket, which is what both reducers now read. */
const wireFixture = (name, generationId = `g_${name}`) =>
  normalizedFixture(name, generationId).map(overTheWire).filter(Boolean);

/**
 * Where a fixture says to disconnect, counted in frames rather than in Pi
 * events. The fixture names an index into Pi's stream, and not every one of
 * those reaches a browser.
 */
const wireSplit = (name) => normalizedFixture(name)
  .slice(0, piRpcGenerationFixtures[name].resumeAfter)
  .filter((event) => serializePiV0(event) !== null).length;

/**
 * What the browser's router would do with this event.
 *
 * The comparison below feeds the client's fold directly, which is one step
 * short of the browser: `active-chat` decides what reaches that fold, and for a
 * while it decided that a retry and a failure did not -- both folds had a case
 * for them and nothing could ever reach it, so the browser's copy of a turn
 * carried `retry: null` through a retry the server's copy had on. Every event
 * this test folds is asserted routable, so the two cannot come apart again
 * without a failure here.
 */
const routedToTheFold = (event) => isStructuredGenerationEvent(event) || isFoldedTurnEvent(event);

function clientFixture(name, generationId = `g_${name}`) {
  const events = wireFixture(name, generationId);
  const client = createClientActiveGenerationStore();
  let shared = null;
  // The same object into both. That is the whole assertion: two
  // implementations of one reducer -- plain data for the server, fine-grained
  // for the browser -- given identical input, must agree about the turn.
  events.forEach((event) => {
    const before = shared;
    shared = reduceActiveGeneration(shared, event);
    if (shared !== before) {
      assert.ok(routedToTheFold(event),
        `${name}: ${event.type} changes the turn but the browser would not fold it`);
    }
    client.apply(event);
    assert.deepEqual(client.snapshot(), shared, `${name} diverged at seq ${event.seq} (${event.type})`);
  });
  return { client, events, shared };
}

function referenceList(state) {
  const references = [state, state.assistantMessages, state.toolExecutions];
  for (const message of state.assistantMessages) {
    references.push(message, message.blocks);
    references.push(...message.blocks);
  }
  for (const tool of Object.values(state.toolExecutions)) references.push(tool);
  return references;
}

function benchmarkStore({ messageCount, blockCount, toolCount, textLength }) {
  const generationId = "g_benchmark";
  const client = createClientActiveGenerationStore({ collectMetrics: true });
  let seq = 0;
  const apply = (event) => client.apply({ ...event, generationId, seq: ++seq });
  // Built out of the events the socket really carries. A block is never
  // announced on its own -- the first delta into it is what opens it -- so the
  // seeding here is deltas, not block starts.
  apply({ type: "status", phase: "started" });
  for (let messageIndex = 0; messageIndex < messageCount; messageIndex += 1) {
    const messageId = `m${messageIndex + 1}`;
    apply({ type: "assistant_content", phase: "start", messageId });
    for (let contentIndex = 0; contentIndex < blockCount; contentIndex += 1) {
      apply({
        type: "assistant_content",
        phase: "delta",
        messageId,
        contentIndex,
        blockKind: "text",
        delta: "",
      });
    }
  }
  for (let toolIndex = 0; toolIndex < toolCount; toolIndex += 1) {
    apply({
      type: "tool_activity",
      phase: "start",
      toolCallId: `call_${toolIndex}`,
      name: "read",
      input: { path: `file-${toolIndex}.txt` },
    });
  }
  apply({
    type: "assistant_content",
    phase: "delta",
    messageId: "m1",
    contentIndex: 0,
    blockKind: "text",
    delta: "x".repeat(textLength),
  });
  return { client, apply };
}

function summarizeBenchmarkSamples(samples) {
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  return {
    sampleCount: samples.length,
    changedAccessorCount: samples.at(-1).changedAccessorCount,
    referenceChurn: Math.max(...samples.map((sample) => sample.referenceChurn)),
    workCount: samples.at(-1).workCount,
    durationMs: {
      p50: durations[Math.floor(durations.length * 0.5)],
      p95: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))],
      max: durations.at(-1),
    },
  };
}

test("normalizes Pi block structure with stable generation-local identities", () => {
  const state = reduceGenerationEvents(wireFixture("multipleToolTurns", "g_tools"));

  assert.deepEqual(tree(state), [
    {
      id: "g_tools:m1",
      status: "complete",
      stopReason: "toolUse",
      blocks: [
        { kind: "thinking", contentIndex: 0, identity: "g_tools:m1:0", text: "Read first", toolCallId: undefined, name: undefined, input: undefined, status: "complete" },
        { kind: "tool_call", contentIndex: 1, identity: "g_tools:m1:1", text: undefined, toolCallId: "call_read", name: "read", input: { path: "README.md" }, status: "complete" },
      ],
    },
    {
      id: "g_tools:m2",
      status: "complete",
      stopReason: "toolUse",
      blocks: [
        { kind: "tool_call", contentIndex: 0, identity: "g_tools:m2:0", text: undefined, toolCallId: "call_shell", name: "bash", input: { command: "git status --short" }, status: "complete" },
      ],
    },
    {
      id: "g_tools:m3",
      status: "complete",
      stopReason: "stop",
      blocks: [
        { kind: "text", contentIndex: 0, identity: "g_tools:m3:0", text: "Repository is clean.", toolCallId: undefined, name: undefined, input: undefined, status: "complete" },
      ],
    },
  ]);
  assert.equal(state.status, "complete");
});

test("classifies provisional answer text exactly once when later tool structure appears", () => {
  const events = wireFixture("textBeforeToolUse", "g_interim");
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
  const live = reduceGenerationEvents(wireFixture("textBeforeToolUse", "g_same"));
  const persisted = activeGenerationFromPersistedMessages("g_same", persistedTextBeforeToolUse);

  assert.deepEqual(textBlockClassifications(live), textBlockClassifications(persisted));
  assert.deepEqual(tree(live), tree(persisted));
});

for (const name of ["noThinkingAnswer", "thinkingThenAnswer"]) {
  test(`resume during ${name === "noThinkingAnswer" ? "answer" : "thinking"} is idempotent and converges`, () => {
    const events = wireFixture(name);
    const split = wireSplit(name);
    const beforeDisconnect = reduceGenerationEvents(events.slice(0, split));
    const resume = overTheWire(generationResumeEvent(beforeDisconnect));
    let reconnected = reduceActiveGeneration(null, resume);

    reconnected = reduceActiveGeneration(reconnected, events[split - 1]);
    reconnected = reduceGenerationEvents(events.slice(split), reconnected);

    assert.deepEqual(reconnected, reduceGenerationEvents(events));
  });
}

test("parallel tool executions join independently by toolCallId", () => {
  const state = reduceGenerationEvents(wireFixture("parallelTools"));

  assert.deepEqual(Object.keys(state.toolExecutions), ["call_one", "call_two"]);
  // When it ran is the time its event states, so only that it has one is pinned.
  const { timestamp, completedAt, ...execution } = state.toolExecutions.call_one;
  assert.equal(typeof timestamp, "string");
  assert.equal(typeof completedAt, "string");
  assert.deepEqual(execution, {
    toolCallId: "call_one",
    name: "read",
    kind: "read",
    subject: "one",
    input: { path: "one" },
    status: "complete",
    output: "one",
    isError: false,
  });
  assert.equal(state.toolExecutions.call_two.output, "two");
});

test("retry gaps retain the generation and settle only after the successful retry", () => {
  const events = wireFixture("retry");
  const retryStart = events.findIndex((event) => event.type === "retry" && event.active);
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
  const state = reduceGenerationEvents(wireFixture("stopped", "g_stop"));

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
  const state = reduceGenerationEvents(wireFixture("providerError"));

  assert.equal(state.status, "failed");
  assert.equal(state.assistantMessages[0].status, "error");
  assert.equal(state.assistantMessages[0].errorMessage, "Provider rejected the request");
  assert.equal(state.assistantMessages[0].provider, "anthropic");
  assert.equal(state.assistantMessages[0].model, "fixture-model");
  assert.equal(state.assistantMessages[0].timestamp, "2025-07-22T16:00:00.000Z");
});

test("multiple native text and thinking blocks retain their separate positions", () => {
  const state = reduceGenerationEvents(wireFixture("multipleTextThinkingBlocks", "g_blocks"));

  assert.deepEqual(state.assistantMessages[0].blocks.map(({ kind, contentIndex, text }) => ({
    kind,
    contentIndex,
    text,
  })), [
    { kind: "thinking", contentIndex: 0, text: "First thought" },
    { kind: "text", contentIndex: 1, text: "First text" },
    { kind: "thinking", contentIndex: 2, text: "Second thought" },
    { kind: "text", contentIndex: 3, text: "Second text" },
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
  ].flatMap((event) => normalizer.normalize(event)).map(overTheWire).filter(Boolean);
  const state = reduceGenerationEvents(events);
  assert.equal(state.assistantMessages[0].blocks[0].text, "Now");
});

test("client live state remains equivalent to the shared reducer after every fixture event", () => {
  for (const name of Object.keys(piRpcGenerationFixtures)) clientFixture(name);
});

test("ordinary block deltas preserve structural and unrelated block identities", () => {
  const events = wireFixture("multipleToolTurns", "g_identity");
  // Pi names nothing it streams, so the normalizer names the turn's answers
  // after the generation that is writing them. The id is read from the events
  // rather than assumed, because it is the normalizer's to choose.
  const firstMessageId = events.find((event) => event.type === "assistant_content"
    && event.phase === "start")?.messageId;
  const client = createClientActiveGenerationStore({ collectMetrics: true });
  // Driven the way the browser is. A block is never announced to it -- there is
  // no adapter case for `content_block_started` -- so the second block exists
  // here only once a delta has landed in it, and the turn is left mid-flight so
  // one more can be applied to it.
  const openingDelta = events.find((event) => event.type === "assistant_content"
    && event.phase === "delta" && event.messageId === firstMessageId && event.contentIndex === 1);
  for (const event of events) {
    client.apply(event);
    if (event === openingDelta) break;
  }
  const targetDelta = {
    type: "assistant_content", phase: "delta", generationId: "g_identity",
    seq: client.current().lastSeq + 1, messageId: firstMessageId,
    contentIndex: 1, blockKind: "text", delta: " and more",
  };
  assert.ok(targetDelta);
  const before = client.current();
  const references = referenceList(before);
  const target = before.assistantMessages[0].blocks[1];
  const unchanged = before.assistantMessages[0].blocks[0];
  const result = client.apply(targetDelta);
  const after = client.current();

  assert.equal(result.rootChanged, false);
  assert.equal(after, before);
  assert.equal(after.assistantMessages, before.assistantMessages);
  assert.equal(after.assistantMessages[0], before.assistantMessages[0]);
  assert.equal(after.assistantMessages[0].blocks, before.assistantMessages[0].blocks);
  assert.equal(after.assistantMessages[0].blocks[1], target);
  assert.equal(after.assistantMessages[0].blocks[0], unchanged);
  assert.equal(after.toolExecutions, before.toolExecutions);
  assert.equal(referenceList(after).filter((reference, index) => reference !== references[index]).length, 0);
  assert.equal(after.assistantMessages[0].blocks[1].inputText, "{\"path\":\"README.md\"}");
  assert.ok(result.metrics.changedAccessorCount > 0);
  assert.ok(result.metrics.workCount > 0);
});

for (const name of ["noThinkingAnswer", "thinkingThenAnswer"]) {
  test(`client state resumes and converges during ${name}`, () => {
    const events = wireFixture(name);
    const split = wireSplit(name);
    const client = createClientActiveGenerationStore();
    let shared = null;
    for (const event of events.slice(0, split)) {
      shared = reduceActiveGeneration(shared, event);
      client.apply(event);
    }
    // The replay is the server handing over its own snapshot, so from here the
    // two are the same object's worth of state however they got there.
    const resume = overTheWire(generationResumeEvent(shared));
    shared = reduceActiveGeneration(shared, resume);
    client.apply(resume);
    assert.deepEqual(client.snapshot(), shared);

    const duplicate = events[split - 1];
    shared = reduceActiveGeneration(shared, duplicate);
    client.apply(duplicate);
    assert.deepEqual(client.snapshot(), shared);

    for (const event of events.slice(split)) {
      shared = reduceActiveGeneration(shared, event);
      client.apply(event);
    }
    assert.deepEqual(client.snapshot(), shared, `${name} settled differently after resume`);
  });
}

test("a continued answer reaches the browser as the one message it is", () => {
  // The browser merges the text a turn continues with what the turn writes, so
  // it needs both at the moment the turn opens. This travelled only in the
  // server's snapshot, which a client gets on a reconnect and not otherwise --
  // so staying connected showed the fragment without the answer it continues.
  const client = createClientActiveGenerationStore();
  client.apply(overTheWire({ type: "generation_started", generationId: "g_continue", seq: 1,
    continuation: true, continuationBase: "The story so far" }));
  assert.equal(client.current().continuation, true);
  assert.equal(client.current().continuationBase, "The story so far");

  const plain = createClientActiveGenerationStore();
  plain.apply(overTheWire({ type: "generation_started", generationId: "g_plain", seq: 1 }));
  assert.equal(plain.current().continuation, false);
  assert.equal(plain.current().continuationBase, "");
});

test("client block update benchmark keeps work and references independent of unrelated size", () => {
  const axes = {
    textLength: [1_000, 10_000, 100_000],
    messageCount: [1, 4, 16],
    blockCount: [1, 4, 16],
    toolCount: [0, 8, 32],
  };
  const middle = {
    textLength: 10_000,
    messageCount: 4,
    blockCount: 4,
    toolCount: 8,
  };
  const measurements = [];

  for (const [axis, values] of Object.entries(axes)) {
    for (const value of values) {
      const dimensions = { ...middle, [axis]: value };
      const { client, apply } = benchmarkStore(dimensions);
      const samples = [];
      for (let sampleIndex = 0; sampleIndex < 8; sampleIndex += 1) {
        const before = client.current();
        const references = referenceList(before);
        const startedAt = performance.now();
        const result = apply({
          type: "assistant_content",
          phase: "delta",
          messageId: "m1",
          contentIndex: 0,
          blockKind: "text",
          delta: "x",
        });
        const durationMs = performance.now() - startedAt;
        const after = client.current();
        samples.push({
          changedAccessorCount: result.metrics.changedAccessorCount,
          workCount: result.metrics.workCount,
          referenceChurn: referenceList(after).filter((reference, index) => reference !== references[index]).length,
          durationMs,
        });
      }
      const summary = summarizeBenchmarkSamples(samples);
      assert.equal(summary.referenceChurn, 0, `${axis}=${value} changed an unrelated reference`);
      assert.equal(new Set(samples.map((sample) => sample.workCount)).size, 1, `${axis}=${value} changed work count across samples`);
      measurements.push({ axis, value, ...summary });
    }
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    fixtureId: "slice2-client-state-benchmark",
    runtime: process.version,
    axes,
    measurements,
  }));
});
