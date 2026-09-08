import assert from "node:assert/strict";
import test from "node:test";
import { ChatGptWebAdapter, CHATGPT_WEB_CAPABILITIES } from "../src/chatgpt-web-adapter.js";

const streamResponse = (rows) => new Response(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", {
  status: 200, headers: { "Content-Type": "application/x-ndjson" },
});

test("ChatGPT Web maps a streamed turn to neutral events and retains its cursor", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, "gpt-test");
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
    const record = await adapter.create({ chatId: "chat-1", model: "gpt-test" });
    const settled = new Promise((resolve) => adapter.once("settled", resolve));
    await adapter.prompt(record.id, "Hi");
    await settled;
    assert.deepEqual(record.sessionId, { conversationId: "conversation-1", parentMessageId: "message-1", model: "gpt-test" });
    assert.deepEqual(record.events.filter((event) => event.phase === "delta").map((event) => event.delta), ["Hello", " world"]);
    assert.equal(record.events.at(-1).detail, "settled");
    assert.equal(CHATGPT_WEB_CAPABILITIES.modelSwitch, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT Web model catalog stays dynamic", async () => {
  const adapter = new ChatGptWebAdapter({ dataDir: "." });
  adapter.request = async () => ({ models: [{ id: "new-model", label: "New Model" }] });
  assert.deepEqual(await adapter.listAvailableModels(), [{ provider: "chatgpt-web", id: "new-model", spec: "new-model",
    label: "New Model", reasoning: false, thinkingLevels: [], defaultThinkingLevel: "" }]);
});
