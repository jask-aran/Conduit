import assert from "node:assert/strict";
import test from "node:test";
import { ChatGptWebAdapter, CHATGPT_WEB_CAPABILITIES } from "../src/chatgpt-web-adapter.js";

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
      { type: "done", conversationId: "conversation-1", parentMessageId: "message-1" },
    ]);
  };
  try {
    const adapter = new ChatGptWebAdapter({ dataDir: "." });
    adapter.ensureSidecar = async () => { adapter.origin = "http://sidecar"; };
    adapter.appendJournal = () => {};
    adapter.readJournal = () => [];
    const record = await adapter.create({ chatId: "chat-1", model: "gpt-test", thinkingLevel: "high" });
    const settled = new Promise((resolve) => adapter.once("settled", resolve));
    await adapter.prompt(record.id, "Hi");
    await settled;
    assert.deepEqual(record.sessionId, { conversationId: "conversation-1", parentMessageId: "message-1",
      model: "gpt-test", thinkingLevel: "high" });
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
    thinkingLevels: ["instant", "medium", "high", "xhigh"], defaultThinkingLevel: "medium" }] });
  assert.deepEqual(await adapter.listAvailableModels(), [{ provider: "chatgpt-web", id: "new-model", spec: "new-model",
    label: "New Model", reasoning: true, thinkingLevels: ["instant", "medium", "high", "xhigh"],
    defaultThinkingLevel: "medium" }]);
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
    await adapter.setThinkingLevel(record.id, "xhigh");
    const settled = new Promise((resolve) => adapter.once("settled", resolve));
    await adapter.prompt(record.id, "Next");
    await settled;
    assert.equal(sent.model, "gpt-5-6");
    assert.equal(sent.thinkingLevel, "xhigh");
    assert.deepEqual(await adapter.getModelState(record.id), { model: "gpt-5-6", thinkingLevel: "xhigh" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
