import assert from "node:assert/strict";
import test from "node:test";
import { createPiEventNormalizer } from "../src/pi-event-normalizer.js";
import { deliveryDeltaKey, mergeDeliveryDelta } from "../src/pi-manager.js";
import { piRpcGenerationFixtures } from "./fixtures/pi-rpc-generations.js";
import { createCadence, runDeterministicStreamingScenario } from "./helpers/streaming-scenario.js";

test("Pi normalizer fixtures keep generation-local sequence and identity", () => {
  for (const [name, fixture] of Object.entries(piRpcGenerationFixtures)) {
    const generationId = `contract-${name}`;
    const normalizer = createPiEventNormalizer(generationId);
    const events = fixture.events.flatMap((event) => normalizer.normalize(event));

    assert.ok(events.length > 0, `${name} emitted no normalized events`);
    assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index + 1), name);
    assert.ok(events.every((event) => event.generationId === generationId), name);
    for (const event of events.filter((candidate) => candidate.type === "content_block_delta")) {
      assert.match(event.messageId, /^m\d+$/, name);
      assert.ok(Number.isInteger(event.contentIndex), name);
      assert.ok(["text", "thinking", "toolCall"].includes(event.blockType), name);
    }
  }
});

test("delivery coalescing keeps the current Pi block key and complete text", () => {
  const first = {
    type: "content_block_delta",
    generationId: "g1",
    seq: 4,
    messageId: "m2",
    blockType: "text",
    contentIndex: 3,
    delta: "Hello",
  };
  const next = { ...first, seq: 5, delta: " world" };

  assert.equal(deliveryDeltaKey(first), "structured:g1:m2:text:3");
  assert.equal(deliveryDeltaKey({ ...first, contentIndex: 4 }), "structured:g1:m2:text:4");
  assert.equal(deliveryDeltaKey({ type: "generation_settled" }), null);
  assert.deepEqual(mergeDeliveryDelta(first, next), { ...next, delta: "Hello world" });
});

test("steady, burst, and stall harness profiles emit versioned passing reports", async () => {
  const profiles = {
    steady: { intervalMs: 8 },
    burst: { burstSize: 3, burstIntervalMs: 24 },
    stall: { stallAfter: 3, stallMs: 120 },
  };

  for (const [profile, options] of Object.entries(profiles)) {
    const text = `${profile}-contract`;
    const report = await runDeterministicStreamingScenario({
      name: `streaming-${profile}`,
      cadence: createCadence(profile, { text, chunkSize: 1, ...options }),
    });

    assert.equal(report.schemaVersion, 1, profile);
    assert.equal(report.scenario, `streaming-${profile}`, profile);
    assert.equal(report.outcome, "passed", profile);
    assert.equal(report.transport.finalText, text, profile);
  }
});
