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
import { sendClientEvent } from "../src/server/live-session-stream.js";
import { piRpcGenerationFixtures } from "./fixtures/pi-rpc-generations.js";

test("Pi adapter normalization retains every native payload in its privileged envelope", () => {
  const sent = {};
  for (const [name, fixture] of Object.entries(piRpcGenerationFixtures)) {
    const normalizer = createPiEventNormalizer(`adapter-${name}`);
    for (const event of fixture.events.flatMap((item) => normalizer.normalize(item))) {
      // The native payload is kept on the server's side of the projection and
      // never on the browser's, whether or not the browser is sent anything.
      assert.deepEqual(normalizePiBackendEvent(event).pi, event, `${name}:${event.type}`);
      const frame = serializePiV0(event);
      if (frame === null) { sent[event.type] = sent[event.type] ?? false; continue; }
      assert.equal(Object.hasOwn(JSON.parse(frame), "pi"), false, `${name}:${event.type}`);
      sent[event.type] = true;
    }
  }
  // An event the contract has no case for is not sent as an empty envelope.
  // These three were a third of every frame in a Pi turn, and the browser's
  // only handler for them was to recognise the type and drop it.
  assert.deepEqual(
    Object.entries(sent).filter(([, delivered]) => !delivered).map(([type]) => type).sort(),
    ["content_block_completed", "content_block_started", "generation_turn_ended"]);
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

test("the frame a reconnecting browser is caught up by keeps what it missed", () => {
  // Built by the stream from `adapter.view(record)` and sent on every attach.
  // Pi's is the only adapter that rewrites this event, and it used to return
  // four derived fields and drop the rest -- so reconnecting to a Pi chat lost
  // the context bar, lost what was queued, and left a confirmation the harness
  // was waiting on undrawn, while the same reconnect on Codex kept all three.
  const view = {
    status: "running", activity: "waiting_for_user", active: true,
    hostUiRequests: [{ id: "r1", kind: "confirm", title: "Allow rm -rf?" }],
    queue: { steering: ["do this next"], followUp: [] },
    contextUsage: { tokens: 4000, contextWindow: 128000 },
    sessionStats: { totalMessages: 12 }, cacheStats: { cacheHits: 9 },
  };
  const frame = JSON.parse(serializePiV0({ type: "runtime_state", session: view,
    hostUiRequests: view.hostUiRequests, queue: view.queue, contextUsage: view.contextUsage,
    sessionStats: view.sessionStats, cacheStats: view.cacheStats }));

  assert.deepEqual(frame.hostUiRequests, view.hostUiRequests);
  assert.deepEqual(frame.queue, view.queue);
  assert.deepEqual(frame.contextUsage, view.contextUsage);
  assert.deepEqual(frame.sessionStats, view.sessionStats);
  assert.deepEqual(frame.cacheStats, view.cacheStats);
  assert.deepEqual(frame.session, view, "the whole view, not a summary of it");
  // And still derives the three the contract states.
  assert.equal(frame.activity, "waiting_for_user");
  assert.equal(frame.status, "working");
  assert.equal(frame.lifecycle, "working");
  assert.equal(frame.capabilities.approvals, true);
});

test("what leaves for the browser is the contract, on every path out", () => {
  // Two ways out, and only one of them was mapping. These assert the wire, not
  // the manager's event bus: the bus was already right both times, which is how
  // the suite stayed green while Stop process reconnected and a reconnect
  // shipped native Pi.
  //
  // A deliberate exit is the difference between "the session is over" and "the
  // connection dropped, start another one". It fell through to `pi_event`, so
  // the browser's handler for it could never run.
  const exit = { type: "runtime_exit", code: 0, signal: null, deliberate: true };
  assert.deepEqual(JSON.parse(serializePiV0(exit)),
    { generationId: null, type: "runtime_exit", deliberate: true });
  assert.equal(JSON.parse(serializePiV0({ ...exit, deliberate: false })).deliberate, false);

  // The replay a reconnecting browser reads first is the path that used to have
  // no serializer at all, then had one of its own. Asserted here as a frame off
  // the socket, through the same helper the stream sends everything by, because
  // that is the only thing that proves it is the same path.
  const generation = { id: "g1", lastSeq: 5, assistantMessages: [{ id: "m1", blocks: [] }] };
  const adapter = new PiRpcAdapter({
    attach: () => ({ type: "generation_resume", generationId: "g1", seq: 5, generation }),
  });
  const frames = [];
  const ws = { readyState: 1, send: (payload) => frames.push(JSON.parse(payload)) };
  assert.equal(sendClientEvent(ws, adapter, adapter.attach("live", ws)), true);
  const replay = frames[0];
  // `pi` on this event is a second copy of the entire generation snapshot.
  assert.equal(Object.hasOwn(replay, "pi"), false, "no native payload reaches the browser");
  assert.equal(replay.type, "generation_replay");
  assert.equal(replay.seq, 5);
  assert.deepEqual(replay.generation, generation);
  // Nothing to say is nothing sent, so a fresh session does not open with an
  // empty frame the browser has to recognise and ignore.
  assert.equal(sendClientEvent(ws, adapter, new PiRpcAdapter({ attach: () => null }).attach("live", ws)), false);
  assert.equal(frames.length, 1);
});
