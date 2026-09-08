import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatBackendRegistry,
  PI_CAPABILITIES,
  PiRpcAdapter,
  normalizePiBackendEvent,
  serializePiV0,
} from "../src/pi-rpc-adapter.js";
import { createPiEventNormalizer } from "../src/pi-event-normalizer.js";
import { piRpcGenerationFixtures } from "./fixtures/pi-rpc-generations.js";

test("Pi adapter normalization preserves every v0 wire payload byte-for-byte", () => {
  for (const [name, fixture] of Object.entries(piRpcGenerationFixtures)) {
    const normalizer = createPiEventNormalizer(`adapter-${name}`);
    for (const event of fixture.events.flatMap((item) => normalizer.normalize(item))) {
      assert.equal(serializePiV0(event), JSON.stringify(event), `${name}:${event.type}`);
      assert.deepEqual(normalizePiBackendEvent(event).pi, event, `${name}:${event.type}`);
    }
  }
});

test("Pi adapter maps required neutral events and retains Pi richness", () => {
  const delta = { type: "content_block_delta", generationId: "g1", seq: 2, messageId: "m1", contentIndex: 0, blockType: "text", delta: "hi" };
  assert.deepEqual(normalizePiBackendEvent(delta), {
    generationId: "g1", pi: delta, type: "assistant_content", phase: "delta",
    sequence: 2, messageId: "m1", contentIndex: 0, blockKind: "text", delta: "hi",
  });
  const unknown = { type: "pi_extension_event", value: 4 };
  assert.deepEqual(normalizePiBackendEvent(unknown), { generationId: null, pi: unknown, type: "pi_event" });
  assert.ok(Object.values(PI_CAPABILITIES).every(Boolean));
});

test("Pi adapter delegates the neutral lifecycle to the existing manager", async () => {
  const calls = [];
  const manager = {
    createWithCapacity: async (options) => (calls.push(["create", options]), { id: "live" }),
    promptAccepted: async (...args) => (calls.push(["prompt", ...args]), "generation"),
    abortGeneration: async (...args) => calls.push(["cancel", ...args]),
    stopAndWait: async (...args) => calls.push(["close", ...args]),
    respondHostUi: (...args) => calls.push(["host", ...args]),
    get: () => null,
    getAvailableModels: async () => ["model"],
  };
  const adapter = new PiRpcAdapter(manager);
  await adapter.create({ chatId: "chat" });
  await adapter.restore("session.jsonl", { chatId: "chat" });
  assert.equal(await adapter.prompt("live", "hello", { streamingBehavior: null }), "generation");
  await adapter.cancel("live", "generation");
  await adapter.close("live");
  adapter.respondHostUi("live", { requestId: "request" });
  assert.deepEqual(await adapter.listModels("live"), ["model"]);
  assert.equal(adapter.replay("live"), null);
  assert.deepEqual(calls.slice(0, 2), [
    ["create", { chatId: "chat", sessionFile: null }],
    ["create", { chatId: "chat", sessionFile: "session.jsonl" }],
  ]);
  assert.deepEqual(calls.slice(2).map(([name]) => name), ["prompt", "cancel", "close", "host"]);
});

test("backend registry resolves persisted Pi identity without compatibility shims", () => {
  const registry = new ChatBackendRegistry({});
  assert.equal(registry.forChat({ backend: { protocol: "pi_rpc", implementation: "conduit_pi" } }), registry.forImplementation("conduit_pi"));
  assert.equal(registry.forChat({ backend: { protocol: "pi_rpc", implementation: "native_pi" } }), registry.forImplementation("native_pi"));
  assert.throws(() => registry.forChat({ backend: { protocol: "acp", implementation: "codex" } }), { code: "backend_unavailable" });
});
