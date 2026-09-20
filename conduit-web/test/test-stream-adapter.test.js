import assert from "node:assert/strict";
import test from "node:test";
import { assertChatBackendAdapter } from "../src/chat-backend-contract.js";
import { agentProfiles } from "../src/chat-backend.js";
import { manifest } from "../src/harnesses/test-stream.js";
import { buildTurnRows } from "../src/client/turn-rows.ts";
import { applyToolOp, applyTranscriptOp, isToolOp } from "../src/transcript-fold.js";
import {
  DEFAULT_AMOUNT_ID,
  DEFAULT_SPEED_ID,
  TEST_STREAM_AMOUNTS,
  TEST_STREAM_CAPABILITIES,
  TEST_STREAM_SPEEDS,
  TEST_STREAM_TOOL,
  TestStreamAdapter,
  amountFor,
  amountFromPrompt,
  speedFor,
  tokenAt,
} from "../src/test-stream-adapter.js";

const settle = (adapter) => new Promise((resolve) => adapter.once("settled", resolve));

async function streamed(adapter, { model, thinkingLevel, prompt, clientUserMessageId }) {
  const record = await adapter.create({ chatId: `chat-${model}`, model, thinkingLevel });
  const socket = { readyState: 1, sent: [], send(payload) { this.sent.push(JSON.parse(payload)); }, once() {} };
  adapter.attach(record.id, socket);
  const startedAt = Date.now();
  await adapter.prompt(record.id, prompt, { clientUserMessageId });
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
  const rate = speedFor("fast-250");
  // 250 tokens at 250/s is a second, whatever the level says.
  const { socket, elapsedMs } = await streamed(adapter, { model: "fast-250", prompt: "250t" });
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
  const record = await adapter.create({ chatId: "chat-cancel", model: "fast-1000", thinkingLevel: "8000 tokens" });
  const socket = { readyState: 1, sent: [], send(payload) { this.sent.push(JSON.parse(payload)); }, once() {} };
  adapter.attach(record.id, socket);
  await adapter.prompt(record.id, "20000t");
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
  const { record } = await streamed(adapter, { model: "paced-60", prompt: "60t" });
  const { messages, page } = await adapter.readTranscript({ liveSessionId: record.id });

  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
  // Stated on the read, exactly as the socket stated them, because turn-rows
  // now refuses a message that says neither.
  assert.equal(messages[1].answers, messages[0].id);
  assert.equal(messages[1].interim, false);
  assert.ok(messages[1].content.includes("quick brown fox"));
  assert.deepEqual(page, { before: null });
});

test("speed is the model and amount is the thinking level", async () => {
  // Two independent questions on the two pickers the composer already has. A
  // level is a string the harness interprets; this one reads it as how much to
  // send back, so it is written as the amount.
  assert.deepEqual(TEST_STREAM_SPEEDS.map((speed) => speed.id),
    ["paced-60", "fast-250", "fast-1000", "flood-4000"]);
  assert.deepEqual(TEST_STREAM_AMOUNTS.map((amount) => amount.id),
    ["400 tokens", "2000 tokens", "8000 tokens", "32000 tokens"]);
  assert.equal(speedFor("nonsense").id, DEFAULT_SPEED_ID);
  assert.equal(amountFor("nonsense").id, DEFAULT_AMOUNT_ID);

  // Every model offers every amount, so the grid needs no model per combination.
  const adapter = new TestStreamAdapter();
  for (const model of await adapter.listModels()) {
    assert.deepEqual(model.thinkingLevels, TEST_STREAM_AMOUNTS.map((amount) => amount.id));
    assert.equal(model.defaultThinkingLevel, DEFAULT_AMOUNT_ID);
  }

  // Changing one does not quietly change the other.
  const record = await adapter.create({ chatId: "chat-axes", model: "paced-60", thinkingLevel: "8000 tokens" });
  await adapter.setModel(record.id, "flood-4000");
  assert.deepEqual(await adapter.getModelState(record.id), { model: "flood-4000", thinkingLevel: "8000 tokens" });
  await adapter.setThinkingLevel(record.id, "400 tokens");
  assert.deepEqual(await adapter.getModelState(record.id), { model: "flood-4000", thinkingLevel: "400 tokens" });
  assert.equal(record.tokens, 400);
});

test("a prompt can name a one-off amount the levels do not cover", () => {
  assert.equal(amountFromPrompt("1200t", 400), 1200);
  assert.equal(amountFromPrompt("give me 900 t of it", 400), 900);
  assert.equal(amountFromPrompt("anything else", 400), 400);
  // An amount large enough to wedge the profiling session is not useful.
  assert.equal(amountFromPrompt("9999999t", 400), 100_000);
});

test("the prompt is named what the browser already calls it", async () => {
  // The row is drawn before the prompt is sent. A harness that names its own
  // messages still has to name this one what the browser did, or it states a
  // second row for a message that is already on screen -- the same prompt
  // twice, which is exactly what claiming an id prevents for Pi.
  const adapter = new TestStreamAdapter();
  const { socket } = await streamed(adapter,
    { model: "paced-60", prompt: "10t", clientUserMessageId: "m_from-the-browser" });
  const opens = socket.sent.filter((event) => event.op === "message.open");
  const users = opens.filter((event) => event.message.role === "user");
  assert.equal(users.length, 1, "one row for one prompt");
  assert.equal(users[0].message.id, "m_from-the-browser");
  // And the answer says it answers that row, not some other name for it.
  assert.equal(opens.find((event) => event.message.role === "assistant").answers, "m_from-the-browser");
});

test("the stream is deterministic and broken into paragraphs", () => {
  assert.equal(tokenAt(0), "the ");
  assert.equal(tokenAt(0), tokenAt(0));
  assert.ok(tokenAt(60).startsWith("\n\n"), "a paragraph break so the renderer draws real blocks");
  assert.equal(TEST_STREAM_CAPABILITIES.toolUse, true);
  assert.equal(TEST_STREAM_CAPABILITIES.thinkingLevels, true);
});

/** The transcript a browser would be holding, from the statements alone. */
function readerOf(adapter) {
  let messages = [];
  let tools = [];
  const record = { messages, tools, events: [] };
  const socket = { readyState: 1, sent: [], once() {},
    send(payload) {
      const event = JSON.parse(payload);
      record.events.push(event);
      if (event.type !== "transcript_op") return;
      if (isToolOp(event)) tools = applyToolOp(tools, event);
      else messages = applyTranscriptOp(messages, event);
    } };
  return { socket,
    messages: () => messages,
    tools: () => tools,
    events: () => record.events,
    rows: () => buildTurnRows(messages, tools) };
}

const attached = async (adapter, options = {}) => {
  const record = await adapter.create({ chatId: options.chatId || "chat-parity", model: "flood-4000",
    thinkingLevel: "400 tokens" });
  const reader = readerOf(adapter);
  adapter.attach(record.id, reader.socket);
  return { record, reader };
};

test("a tool call ends the message that made it and is stated as a tool", async () => {
  const adapter = new TestStreamAdapter();
  const { record, reader } = await attached(adapter);
  await adapter.prompt(record.id, "80t 1 tool", { clientUserMessageId: "u1" });
  await settle(adapter);

  // Two answers, because the message that called the tool is finished when the
  // call is made and what answers the result is a message of its own.
  const roles = reader.messages().map((message) => message.role);
  assert.deepEqual(roles, ["user", "assistant", "assistant"]);
  assert.equal(reader.messages()[1].interim, true, "the calling message is the turn talking, not its answer");
  assert.equal(reader.messages()[2].interim, false);
  // And the tool itself is a record beside the transcript, opened and closed.
  assert.deepEqual(reader.tools().map((tool) => [tool.name, tool.done, tool.output]),
    [[TEST_STREAM_TOOL.name, true, TEST_STREAM_TOOL.output]]);
  // The paint that drew it arriving is there too, in all three phases.
  assert.deepEqual(reader.events().filter((event) => event.type === "tool_activity").map((event) => event.phase),
    ["start", "update", "end"]);
});

test("a tool asks first when the prompt says to, and a refusal stops the turn", async () => {
  const adapter = new TestStreamAdapter();
  const { record, reader } = await attached(adapter);
  await adapter.prompt(record.id, "80t 1 tool approve", { clientUserMessageId: "u1" });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const request = reader.events().find((event) => event.type === "permission_request");
  assert.ok(request, "the turn stops and asks");
  assert.equal(request.kind, "confirm");
  assert.equal(adapter.view(record).activity, "waiting_for_user");

  const settled = settle(adapter);
  adapter.respondHostUi(record.id, { id: request.requestId, confirmed: true });
  await settled;
  assert.ok(reader.events().some((event) => event.type === "permission_resolved"));
  assert.equal(reader.tools().length, 1, "approved, so it ran");

  // And refused, the turn ends where it stood.
  const second = await attached(adapter, { chatId: "chat-refused" });
  await adapter.prompt(second.record.id, "80t 1 tool approve", { clientUserMessageId: "u2" });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const asked = second.reader.events().find((event) => event.type === "permission_request");
  const stopped = settle(adapter);
  adapter.respondHostUi(second.record.id, { id: asked.requestId, confirmed: false });
  await stopped;
  assert.equal(second.reader.tools().length, 0);
  assert.equal(second.reader.messages().at(-1).stopped, true);
});

test("a steered message lands inside the turn; a follow-up starts its own", async () => {
  const adapter = new TestStreamAdapter();
  const { record, reader } = await attached(adapter);
  await adapter.prompt(record.id, "400t 1 tool", { clientUserMessageId: "u1" });
  await adapter.queue(record.id, "steer", "make it shorter", { messageId: "u2" });
  await settle(adapter);

  const roles = reader.messages().map((message) => message.role);
  assert.deepEqual(roles.slice(0, 2), ["user", "assistant"]);
  assert.ok(roles.includes("user", 2), "the steer is committed where the turn had got to");
  // The queue it was drawn from is emptied by the harness that took it.
  assert.deepEqual(reader.events().filter((event) => event.type === "queue_state").at(-1).queue,
    { steering: [], followUp: [] });

  const followed = settle(adapter);
  await adapter.queue(record.id, "follow_up", "and again", { messageId: "u3" });
  await adapter.prompt(record.id, "40t", { clientUserMessageId: "u4" });
  await followed;
  await settle(adapter);
  assert.ok(reader.messages().some((message) => message.content === "and again"),
    "a follow-up waits for the turn to end and is asked as its own prompt");
});

test("a fork cuts the chat at the entry it was given", async () => {
  const adapter = new TestStreamAdapter();
  const { record, reader } = await attached(adapter);
  await adapter.prompt(record.id, "40t", { clientUserMessageId: "u1" });
  await settle(adapter);
  await adapter.prompt(record.id, "40t second", { clientUserMessageId: "u2" });
  await settle(adapter);
  assert.equal(reader.messages().length, 4);

  const forked = await adapter.fork(record.id, { nodeId: "u2" });
  assert.equal(forked.sourceMessage.text, "40t second", "what was asked there, so a regenerate can re-ask it");
  assert.deepEqual(reader.messages().map((message) => message.id), ["u1", reader.messages()[1].id]);
  // And the history it reports is a tree whose prompts can be forked again.
  const history = await adapter.readHistory({ liveSessionId: record.id });
  assert.equal(history.mode, "tree");
  assert.equal(history.tree[0].entry.forkable, true);
});

test("it counts what it spent and gives it back when compacted", async () => {
  const adapter = new TestStreamAdapter();
  const { record, reader } = await attached(adapter);
  await adapter.prompt(record.id, "200t", { clientUserMessageId: "u1" });
  await settle(adapter);
  const usage = reader.events().findLast((event) => event.type === "usage");
  assert.equal(usage.contextUsage.tokens, 200);
  assert.equal(usage.sessionStats.totalMessages, 2);

  await adapter.compact(record.id);
  assert.deepEqual(reader.events().filter((event) => event.type === "compaction").map((event) => event.active),
    [true, false]);
  assert.equal(adapter.view(record).contextUsage.tokens, 0);
});

test("a browser that arrives mid-turn is given the turn so far", async () => {
  const adapter = new TestStreamAdapter();
  const record = await adapter.create({ chatId: "chat-replay", model: "paced-60", thinkingLevel: "400 tokens" });
  await adapter.prompt(record.id, "400t", { clientUserMessageId: "u1" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const resume = adapter.replay(record.id);
  assert.equal(resume.type, "generation_replay");
  assert.equal(resume.generation.status, "running");
  assert.ok(resume.generation.assistantMessages[0].blocks[0].text.length > 0,
    "reduced from what it published, with the reducer the browser runs");
  await adapter.cancel(record.id);
});
