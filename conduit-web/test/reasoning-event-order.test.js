import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { PiManager } from "../src/pi-manager.js";

function fixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = {
    write(line) {
      const command = JSON.parse(line);
      if (command.type !== "prompt") return;
      child.stdout.write([
        JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }),
        JSON.stringify({ type: "agent_start" }),
        JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        }),
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "early" },
        }),
      ].join("\n") + "\n");
    },
  };
  child.kill = () => true;

  const manager = new PiManager({
    agentDir: "/tmp/conduit-reasoning-order-test",
    spawnImpl: () => child,
    reaperIntervalMs: 0,
    template: {
      id: "test",
      version: "1",
      models: [],
      tools: [],
      extensions: [],
      skills: [],
      promptTemplates: [],
    },
  });
  const record = manager.create({
    project: { id: "project_test", slug: "test", path: "/tmp/project", sessionsDir: "/tmp/sessions" },
    chatId: "chat-test",
  });
  child.emit("spawn");
  return { manager, record };
}

test("Pi events in the prompt response chunk arrive before generation_started", async () => {
  const { manager, record } = fixture();
  await manager.promptAccepted(record.id, "Hello");

  const observed = record.events.filter((event) => [
    "agent_start",
    "message_start",
    "message_update",
    "generation_started",
  ].includes(event.type));
  assert.deepEqual(observed.map((event) => event.type), [
    "agent_start",
    "message_start",
    "message_update",
    "message_update",
    "generation_started",
  ]);
  assert.equal(observed[2].assistantMessageEvent.type, "thinking_start");
  assert.equal(observed[3].assistantMessageEvent.type, "thinking_delta");
  assert.equal(observed[2].generationId, "g1");
  assert.equal(observed.at(-1).generationId, "g1");
});
