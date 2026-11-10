import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { ChatGptWebAdapter } from "../src/chatgpt-web-adapter.js";
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
    // One entry for the block, holding everything written into it. The buffer
    // is what a reconnecting browser is replayed, and it keeps a block rather
    // than every delta that built it -- the sockets still saw both.
    assert.deepEqual(record.events.filter((event) => event.phase === "delta").map((event) => event.delta), ["Hello world"]);
    // The transition is stated rather than passed along in free text.
    assert.equal(record.events.at(-1).phase, "settled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatGPT Web still reads a journal written before it stated ops", () => {
  // The legacy path, and only that: a journal this build writes is ops and
  // nothing else, which the test below asserts line by line. These two shapes
  // exist so a conversation that predates the ops is not lost, and no live
  // path may produce them.
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
    // Every line is an op -- the legacy shapes the reader above still accepts
    // are not written by anything here.
    assert.deepEqual([...new Set(journal.map((event) => event.type))], ["transcript_op"]);
    assert.deepEqual(journal.map((event) => `${event.type}:${event.op}`),
      ["transcript_op:message.open", "transcript_op:message.open", "transcript_op:message.drop", "transcript_op:turn.settle"]);
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

test("sidecar cleanup without a child is quiet, not a crash", async () => {
  // Shutdown runs mid-sequence in the server's SIGTERM path: a throw here took
  // the terminals, the voice model and the archive drain down with it.
  const adapter = new ChatGptWebAdapter({ dataDir: "." });
  await adapter.shutdownResources();
  const killed = [];
  // A child that exits when told to, as a real one does.
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null,
    kill: (signal) => { killed.push(signal); child.signalCode = signal; child.emit("exit", null, signal); } });
  adapter.child = child;
  await adapter.shutdownResources();
  assert.deepEqual(killed, ["SIGTERM"]);
  adapter.child = { exitCode: 0, kill: () => killed.push("late") };
  await adapter.shutdownResources();
  assert.deepEqual(killed, ["SIGTERM"], "an exited sidecar is not signalled again");
});
