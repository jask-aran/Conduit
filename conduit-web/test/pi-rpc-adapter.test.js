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

test("Pi adapter normalization retains every native payload in its privileged envelope", () => {
  for (const [name, fixture] of Object.entries(piRpcGenerationFixtures)) {
    const normalizer = createPiEventNormalizer(`adapter-${name}`);
    for (const event of fixture.events.flatMap((item) => normalizer.normalize(item))) {
      assert.equal(Object.hasOwn(JSON.parse(serializePiV0(event)), "pi"), false, `${name}:${event.type}`);
      assert.deepEqual(normalizePiBackendEvent(event).pi, event, `${name}:${event.type}`);
    }
  }
});

test("Pi adapter maps required neutral events and retains Pi richness", () => {
  const delta = { type: "content_block_delta", generationId: "g1", seq: 2, messageId: "m1", contentIndex: 0, blockKind: "text", delta: "hi" };
  assert.deepEqual(normalizePiBackendEvent(delta), {
    generationId: "g1", pi: delta, type: "assistant_content", phase: "delta",
    seq: 2, messageId: "m1", contentIndex: 0, blockKind: "text", delta: "hi",
  });
  // The server's post-turn repair: the browser needs the persisted messages,
  // not an opaque pi_event, or its optimistic ids never get replaced.
  const sync = { type: "transcript_sync", generationId: "g1", messages: [{ id: "user-1", role: "user" }], tools: [] };
  assert.deepEqual(normalizePiBackendEvent(sync), {
    generationId: "g1", pi: sync, type: "transcript_sync",
    messages: [{ id: "user-1", role: "user" }], tools: [],
  });
  // The whole transcript, for a client that lost its place in the chat's order
  // and has to take a fresh copy rather than fold this into what it holds.
  const reset = { ...sync, generationId: null, replace: true };
  assert.deepEqual(normalizePiBackendEvent(reset), {
    generationId: null, pi: reset, type: "transcript_sync", replace: true,
    messages: [{ id: "user-1", role: "user" }], tools: [],
  });
  // A committed user message says nothing the `message.open` that placed it
  // has not already said, so it no longer travels as a transcript event of its
  // own -- the two could disagree about where the message went.
  const user = { type: "message_end", generationId: "g1", message: { id: "u1", role: "user", content: "Hi" } };
  assert.deepEqual(normalizePiBackendEvent(user), {
    generationId: "g1", pi: user, type: "pi_event",
  });
  const assistant = { ...user, message: { role: "assistant", content: "No duplicate route" } };
  assert.deepEqual(normalizePiBackendEvent(assistant), {
    generationId: "g1", pi: assistant, type: "pi_event",
  });
  const unknown = { type: "pi_extension_event", value: 4 };
  assert.deepEqual(normalizePiBackendEvent(unknown), { generationId: null, pi: unknown, type: "pi_event" });
  // Pi is the reference backend: it does everything Conduit asks of a harness
  // except offer permission profiles to pick between, which is a Codex feature
  // rather than a gap in Pi. Approving a request and choosing a mode to approve
  // under are separate questions, and Pi only answers the first.
  assert.equal(PI_CAPABILITIES.approvals, true);
  assert.equal(PI_CAPABILITIES.permissionModes, false);
  // And except keeping a partial answer when a turn is interrupted. Pi writes
  // the interrupted message to its session file but builds the next request
  // without it, so what the reader is shown and what the model was given differ.
  assert.equal(PI_CAPABILITIES.interruptKeepsPartial, false);
  const optional = new Set(["permissionModes", "interruptKeepsPartial"]);
  for (const [name, value] of Object.entries(PI_CAPABILITIES)) {
    if (optional.has(name)) continue;
    assert.ok(value, `Pi supports ${name}`);
  }
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
  assert.throws(() => registry.forChat({ backend: { protocol: "pi_rpc", implementation: "native_pi" } }), { code: "backend_unavailable" });
  assert.throws(() => registry.forChat({ backend: { protocol: "acp", implementation: "codex" } }), { code: "backend_unavailable" });
});
