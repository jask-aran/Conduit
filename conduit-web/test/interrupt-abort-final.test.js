import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { PiManager } from "../src/pi-manager.js";

// Pi reports the interrupted assistant message between the abort request and
// its response - measured at request +3ms, response +4ms. Conduit closes the
// generation before sending the abort, so that message used to be discarded and
// the turn's text never reached the transcript.
function managerWithFakePi() {
  const writes = [];
  let child;
  const manager = new PiManager({
    agentDir: "/tmp/conduit-interrupt-abort-test",
    spawnImpl: () => {
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { write: (line) => writes.push(JSON.parse(line)) };
      child.kill = () => true;
      return child;
    },
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project_test", slug: "test", path: "/tmp/project", workingRoot: "/tmp/project", sessionsDir: "/tmp/sessions" };
  const record = manager.create({ project, chatId: "chat-interrupt" });
  const emit = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { manager, record, writes, emit, settle };
}

test("an interrupted turn still reports its assistant message", async () => {
  const { manager, record, writes, emit, settle } = managerWithFakePi();
  const published = [];
  manager.publish = (target, event) => published.push(event);
  const transient = manager.publishTransient.bind(manager);
  manager.publishTransient = (target, event) => { published.push(event); return transient(target, event); };

  const prompt = manager.promptAccepted(record.id, "write a long story");
  await settle();
  emit({ type: "response", id: writes.at(-1).id, command: "prompt", success: true });
  await prompt;

  emit({ type: "message_start", message: { role: "assistant", content: [] } });
  await settle();

  const abort = manager.abortGeneration(record.id);
  await settle();
  // Pi's real ordering: the interrupted message lands before the abort reply.
  emit({ type: "message_end", message: { role: "assistant", stopReason: "aborted",
    content: [{ type: "text", text: "On the morning the bells rang backward" }] } });
  await settle();
  emit({ type: "response", id: writes.at(-1).id, command: "abort", success: true });
  await abort;

  const final = published.find((event) => event.type === "assistant_message_completed");
  assert.ok(final, "the interrupted assistant message must reach the transcript");
  assert.equal(final.stopReason, "aborted");
  assert.equal(final.blocks[0].text, "On the morning the bells rang backward");

  // The same message is published as a transcript entry, which is what commits
  // the turn's text. Without it the text lives only in the live structure and
  // disappears when the next turn replaces it.
  const entry = published.find((event) => event.type === "message_end" && event.message?.role === "assistant");
  assert.ok(entry, "the interrupted assistant message must be published as a transcript entry");
  assert.equal(entry.message.stopReason, "aborted");
});

test("a closed generation still ignores a later unrelated turn", async () => {
  const { manager, record, writes, emit, settle } = managerWithFakePi();
  const prompt = manager.promptAccepted(record.id, "hello");
  await settle();
  emit({ type: "response", id: writes.at(-1).id, command: "prompt", success: true });
  await prompt;

  const abort = manager.abortGeneration(record.id);
  await settle();
  emit({ type: "response", id: writes.at(-1).id, command: "abort", success: true });
  await abort;

  // Pi starting a turn of its own opens a fresh generation rather than folding
  // its events into the one that was just aborted.
  const before = record.generation;
  emit({ type: "turn_start" });
  await settle();
  assert.notEqual(record.generation, before);
  assert.equal(record.generation.closed, false);
});
