import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_EXECUTION_CATALOG } from "../src/server/voice-execution-catalog.js";
import { createVoiceRuntimeAdapters } from "../src/server/voice-runtime-adapters.js";

test("WP8 adapters expose the canonical BatchPort and StreamPort for Unified English", async () => {
  const profile = VOICE_EXECUTION_CATALOG.profiles.find((candidate) => candidate.artifactId === "parakeet-unified-en-0.6b-q8-gguf" && candidate.execution === "live");
  const calls = [];
  let nativeStream;
  const adapters = createVoiceRuntimeAdapters({
    profile,
    modelManager: {
      transcribe: async (_modelId, pcm, options) => {
        calls.push({ type: "batch", pcm, options });
        return "batch result";
      },
      stream: async (_modelId, options) => {
        calls.push({ type: "open", options });
        nativeStream = {
          text: { full: "hello", committed: "he", tentative: "llo" },
          async feed(pcm) {
            calls.push({ type: "feed", pcm });
            return { revision: 1, bufferedMs: 32 };
          },
          async finalize() {
            calls.push({ type: "finalize" });
            return { revision: 2, bufferedMs: 0 };
          },
          reset() { calls.push({ type: "reset" }); },
        };
        return nativeStream;
      },
    },
  });
  const batch = await adapters.batch.transcribe({ pcm16: Buffer.from([0, 0, 255, 127]), operationId: "op-1", sequence: 3, startSample: 10, endSample: 12 });
  assert.equal(batch.text, "batch result");
  assert.equal(calls[0].options.operationId, "op-1");
  await adapters.stream.open({});
  const feed = await adapters.stream.feed({ pcm16: Buffer.from([0, 0, 0, 64]), operationId: "op-2", startSample: 0, endSample: 2 });
  assert.equal(feed.text.full, "hello");
  assert.ok(feed.update);
  const final = await adapters.stream.finalize({ endSample: 2 });
  assert.equal(final.text.committed, "he");
  assert.equal(typeof nativeStream.reset, "function");
  assert.deepEqual(calls.map((call) => call.type), ["batch", "open", "feed", "finalize"]);

  const session = await adapters.stream.openSession({});
  const sessionUpdate = await session.feed(new Float32Array([0.25, -0.25]));
  assert.ok(sessionUpdate);
  assert.equal(session.text.full, "hello");
  await session.finalize();
  assert.deepEqual(calls.map((call) => call.type), ["batch", "open", "feed", "finalize", "open", "feed", "finalize"]);
  assert.ok(Math.abs(calls[5].pcm[0] - 0.25) < 0.001);
  assert.ok(Math.abs(calls[5].pcm[1] + 0.25) < 0.001);
});
test("WP8 adapter cancellation is idempotent and blocks use after cancel", async () => {
  const profile = VOICE_EXECUTION_CATALOG.profiles.find((candidate) => candidate.execution === "live");
  let resets = 0;
  const adapters = createVoiceRuntimeAdapters({
    profile,
    modelManager: {
      stream: async () => ({
        text: {},
        feed: async () => ({}),
        finalize: async () => ({}),
        reset: () => { resets += 1; },
      }),
    },
  });
  await adapters.stream.open();
  await adapters.stream.cancel("socket_close");
  await adapters.stream.cancel("socket_close");
  assert.equal(resets, 1);
  await assert.rejects(adapters.stream.feed({ pcm16: Buffer.alloc(2), startSample: 0, endSample: 1 }), { code: "voice_stream_not_open" });
});
