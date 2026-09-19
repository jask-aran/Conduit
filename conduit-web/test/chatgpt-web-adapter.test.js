import assert from "node:assert/strict";
import test from "node:test";
import { ChatGptWebAdapter, CHATGPT_WEB_CAPABILITIES } from "../src/chatgpt-web-adapter.js";
import { serializeAttachmentEnvelope } from "../src/attachment-envelope.js";

const streamResponse = (rows) => new Response(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", {
  status: 200, headers: { "Content-Type": "application/x-ndjson" },
});

test("ChatGPT Web maps a streamed turn to neutral events and retains its cursor", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { message: "Hi", model: "gpt-test", thinkingLevel: "high",
      conversationId: "", parentMessageId: "" });
    return streamResponse([
      { type: "delta", text: "Hello" },
      { type: "delta", text: " world" },
      { type: "done", conversationId: "conversation-1", parentMessageId: "message-1", title: "Greeting exchange" },
    ]);
  };
  try {
    const adapter = new ChatGptWebAdapter({ dataDir: "." });
    adapter.ensureSidecar = async () => { adapter.origin = "http://sidecar"; };
    adapter.appendJournal = () => {};
    adapter.readJournal = () => [];
    const record = await adapter.create({ chatId: "chat-0001", model: "gpt-test", thinkingLevel: "high" });
    const settled = new Promise((resolve) => adapter.once("settled", resolve));
    await adapter.prompt(record.id, serializeAttachmentEnvelope({ chatId: "chat-0001", attachments: [], message: "Hi" }));
    await settled;
    assert.deepEqual(record.sessionId, { conversationId: "conversation-1", parentMessageId: "message-1",
      model: "gpt-test", thinkingLevel: "high" });
    assert.equal(record.title, "Greeting exchange");
    assert.deepEqual(record.events.filter((event) => event.phase === "delta").map((event) => event.delta), ["Hello", " world"]);
    assert.equal(record.events.at(-1).detail, "settled");
    assert.equal(CHATGPT_WEB_CAPABILITIES.modelSwitch, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT Web model catalog stays dynamic", async () => {
  const adapter = new ChatGptWebAdapter({ dataDir: "." });
  adapter.request = async () => ({ models: [{ id: "new-model", label: "New Model",
    thinkingLevels: ["instant", "medium", "high"], defaultThinkingLevel: "medium" }] });
  assert.deepEqual(await adapter.listAvailableModels(), [{ provider: "chatgpt-web", id: "new-model", spec: "new-model",
    label: "New Model", reasoning: true, thinkingLevels: ["instant", "medium", "high"],
    defaultThinkingLevel: "medium" }]);
});

test("ChatGPT Web rebuilds its transcript from the native journal", () => {
  const adapter = new ChatGptWebAdapter({ dataDir: "." });
  adapter.readJournal = () => [
    { type: "transcript_message", message: { id: "user-1", role: "user", content: "Hi" } },
    { type: "assistant_content", phase: "final", messageId: "assistant-1", stopReason: "stop",
      blocks: [{ kind: "text", text: "Hello" }] },
  ];
  assert.deepEqual(adapter.transcript("chat-1"), [
    { id: "user-1", role: "user", content: "Hi" },
    { id: "assistant-1", role: "assistant", content: "Hello", stopped: false, stopReason: "stop" },
  ]);
});

test("ChatGPT Web journals the statements that make up its transcript", async () => {
  const adapter = new ChatGptWebAdapter({ dataDir: "." });
  adapter.ensureSidecar = async () => { adapter.origin = "http://sidecar"; };
  const journal = [];
  adapter.appendJournal = (_chatId, event) => journal.push(event);
  adapter.readJournal = () => [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => streamResponse([{ type: "done", conversationId: "c", parentMessageId: "p" }]);
  try {
    const record = await adapter.create({ chatId: "chat-user-event", model: "gpt-test" });
    const settled = new Promise((resolve) => adapter.once("settled", resolve));
    await adapter.prompt(record.id, "Hi");
    await settled;
    // This backend has nothing to read back, so the ops are the record: the
    // prompt, the answer it opened, and what that answer turned out to say.
    assert.deepEqual(journal.map((event) => `${event.type}:${event.op}`),
      ["transcript_op:message.open", "transcript_op:message.open", "transcript_op:message.drop"]);
    assert.equal(journal[0].message.role, "user");
    assert.equal(journal[0].message.content, "Hi");
    assert.equal(journal[1].message.role, "assistant");
    assert.equal(journal[1].answers, journal[0].message.id);
    // The model answered with nothing at all, so the row it opened goes back
    // rather than sitting in the transcript as a blank answer.
    assert.equal(journal[2].messageId, journal[1].message.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT Web changes model and effort on an existing chat", async () => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return streamResponse([{ type: "done", conversationId: "conversation-2", parentMessageId: "message-3" }]);
  };
  const adapter = new ChatGptWebAdapter({ dataDir: "." });
  adapter.ensureSidecar = async () => { adapter.origin = "http://sidecar"; };
  adapter.appendJournal = () => {};
  adapter.readJournal = () => [];
  try {
    const record = await adapter.create({ chatId: "chat-2", model: "gpt-5-5", thinkingLevel: "medium" });
    record.sessionId = { conversationId: "conversation-2", parentMessageId: "message-2",
      model: "gpt-5-5", thinkingLevel: "medium" };
    await adapter.setModel(record.id, "gpt-5-6");
    await adapter.setThinkingLevel(record.id, "high");
    const settled = new Promise((resolve) => adapter.once("settled", resolve));
    await adapter.prompt(record.id, "Next");
    await settled;
    assert.equal(sent.model, "gpt-5-6");
    assert.equal(sent.thinkingLevel, "high");
    assert.deepEqual(await adapter.getModelState(record.id), { model: "gpt-5-6", thinkingLevel: "high" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shutting down without a sidecar is quiet, not a crash", async () => {
  // Shutdown runs mid-sequence in the server's SIGTERM path: a throw here took
  // the terminals, the voice model and the archive drain down with it.
  const adapter = new ChatGptWebAdapter({ dataDir: "." });
  await adapter.shutdown();
  const killed = [];
  adapter.child = { exitCode: null, kill: (signal) => killed.push(signal) };
  await adapter.shutdown();
  assert.deepEqual(killed, ["SIGTERM"]);
  adapter.child = { exitCode: 0, kill: () => killed.push("late") };
  await adapter.shutdown();
  assert.deepEqual(killed, ["SIGTERM"], "an exited sidecar is not signalled again");
});
