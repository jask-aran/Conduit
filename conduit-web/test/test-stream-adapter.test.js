import assert from "node:assert/strict";
import test from "node:test";
import { assertChatBackendAdapter } from "../src/chat-backend-contract.js";
import { agentProfiles } from "../src/chat-backend.js";
import { manifest } from "../src/harnesses/test-stream.js";
import {
  DEFAULT_RATE_ID,
  TEST_STREAM_CAPABILITIES,
  TEST_STREAM_RATES,
  TestStreamAdapter,
  durationFromPrompt,
  rateFor,
  tokenAt,
} from "../src/test-stream-adapter.js";

const settle = (adapter) => new Promise((resolve) => adapter.once("settled", resolve));

async function streamed(adapter, { model, prompt }) {
  const record = await adapter.create({ chatId: `chat-${model}`, model });
  const socket = { readyState: 1, sent: [], send(payload) { this.sent.push(JSON.parse(payload)); }, once() {} };
  adapter.attach(record.id, socket);
  const startedAt = Date.now();
  await adapter.prompt(record.id, prompt);
  await settle(adapter);
  return { record, socket, elapsedMs: Date.now() - startedAt };
}

test("the test backend satisfies the same adapter contract as a real one", () => {
  // The point of a fake harness is that nothing downstream can tell. If it
  // needed an exemption from the contract it would stop being a measurement of
  // the real path and become a measurement of the exemption.
  assertChatBackendAdapter(new TestStreamAdapter(), manifest.id, manifest.capabilities);
});

test("the test profile is offered like any other harness-backed profile", () => {
  const profiles = agentProfiles([], { available: new Set(["test-stream"]) });
  const profile = profiles.find((item) => item.id === "test-stream");
  assert.ok(profile, "the manifest alone puts it in the profile list");
  assert.equal(profile.label, "Test profile");
  assert.equal(profile.disabled, false);
  assert.equal(profile.agent.implementation, "test-stream");
});

test("a run holds the rate it was asked for against the clock", async () => {
  const adapter = new TestStreamAdapter();
  const rate = rateFor("fast-250");
  const { socket, elapsedMs } = await streamed(adapter, { model: "fast-250", prompt: "1s" });
  const deltas = socket.sent.filter((event) => event.type === "assistant_content" && event.phase === "delta");
  const text = deltas.map((event) => event.delta).join("");
  const tokens = text.trim().split(/\s+/).length;

  // Counted from the text, not from the frames. What arrives at a socket is
  // whatever SocketDelivery merged; what the stream produced is the tokens
  // inside it, and only the second is this scheduler's business.
  assert.ok(tokens >= rate.tokensPerSecond * 0.8 && tokens <= rate.tokensPerSecond * 1.2,
    `expected about ${rate.tokensPerSecond} tokens in a second, got ${tokens}`);
  assert.ok(elapsedMs >= 800 && elapsedMs <= 2500, `expected about a second of streaming, took ${elapsedMs}ms`);

  // The merge is the reason a fast harness does not cost a frame per token:
  // 250 tokens reach the socket as roughly one send per 16ms frame. Asserting
  // it here means a regression in delivery shows up as a number rather than as
  // a transcript that feels bad to watch.
  assert.ok(deltas.length < tokens / 2,
    `expected the frames to be merged well below ${tokens} tokens, got ${deltas.length}`);
});

test("a stopped run keeps the text the reader watched arrive", async () => {
  const adapter = new TestStreamAdapter();
  const record = await adapter.create({ chatId: "chat-cancel", model: "fast-1000" });
  const socket = { readyState: 1, sent: [], send(payload) { this.sent.push(JSON.parse(payload)); }, once() {} };
  adapter.attach(record.id, socket);
  await adapter.prompt(record.id, "60s");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const settled = settle(adapter);
  await adapter.cancel(record.id);
  await settled;

  const close = socket.sent.find((event) => event.op === "message.close");
  assert.equal(close.stopReason, "aborted");
  assert.equal(close.interim, false);
  assert.ok(close.content.length > 0, "the partial answer stands");
  // The one harness whose partial genuinely survives. `discarded` is stated
  // only when it is true, so an unmarked close is the statement, and the fold
  // is where that becomes the flag the transcript reads.
  assert.equal(close.discarded, undefined);
  const { messages } = await adapter.readTranscript({ liveSessionId: record.id });
  assert.equal(messages.at(-1).discarded, false);
  assert.equal(adapter.get(record.id).active, false);
});

test("a chat reads back the transcript it streamed", async () => {
  const adapter = new TestStreamAdapter();
  const { record } = await streamed(adapter, { model: "paced-60", prompt: "1s" });
  const { messages, page } = await adapter.readTranscript({ liveSessionId: record.id });

  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
  // Stated on the read, exactly as the socket stated them, because turn-rows
  // now refuses a message that says neither.
  assert.equal(messages[1].answers, messages[0].id);
  assert.equal(messages[1].interim, false);
  assert.ok(messages[1].content.includes("quick brown fox"));
  assert.deepEqual(page, { before: null });
});

test("the prompt names the run length, and the model names the rate", () => {
  assert.equal(durationFromPrompt("45s"), 45);
  assert.equal(durationFromPrompt("hold it for 90 s please"), 90);
  assert.equal(durationFromPrompt("anything else"), 15);
  // A run long enough to wedge the profiling session is not a useful default.
  assert.equal(durationFromPrompt("9999s"), 120);
  assert.equal(rateFor("flood-4000").tokensPerSecond, 4000);
  assert.equal(rateFor("nonsense").id, DEFAULT_RATE_ID);
  assert.equal(TEST_STREAM_RATES.length, 4);
});

test("the stream is deterministic and broken into paragraphs", () => {
  assert.equal(tokenAt(0), "the ");
  assert.equal(tokenAt(0), tokenAt(0));
  assert.ok(tokenAt(60).startsWith("\n\n"), "a paragraph break so the renderer draws real blocks");
  assert.equal(TEST_STREAM_CAPABILITIES.toolUse, false);
});
