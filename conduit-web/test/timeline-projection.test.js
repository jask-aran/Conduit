import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  buildLiveAnswerRow,
  buildLiveProjectionIndex,
  buildTurnRows,
} from "../src/client/turn-rows.ts";

const axes = {
  persistedRowCount: [1, 8, 32],
  activeMessageCount: [1, 4, 16],
  activeBlockCount: [1, 4, 16],
  activeToolCount: [0, 8, 32],
};

const middle = {
  persistedRowCount: 8,
  activeMessageCount: 4,
  activeBlockCount: 4,
  activeToolCount: 8,
};

function makeProjectionCase({ persistedRowCount, activeMessageCount, activeBlockCount, activeToolCount }) {
  const messages = [];
  for (let index = 0; index < persistedRowCount; index += 1) {
    messages.push({ id: `history-user-${index}`, role: "user", content: `History ${index}` });
    messages.push({ id: `history-assistant-${index}`, role: "assistant", content: `Reply ${index}`, blocks: [] });
  }
  messages.push({ id: "live-user", role: "user", content: "Inspect this", pending: false });

  const assistantMessages = [];
  for (let messageIndex = 0; messageIndex < activeMessageCount; messageIndex += 1) {
    const blocks = [];
    for (let blockIndex = 0; blockIndex < activeBlockCount; blockIndex += 1) {
      const identity = `g_projection:m${messageIndex}:${blockIndex}`;
      if (messageIndex === 0 && blockIndex === activeBlockCount - 1) {
        blocks.push({ type: "text", identity, contentIndex: blockIndex, text: "Answer", status: "streaming" });
      } else {
        blocks.push({ type: "thinking", identity, contentIndex: blockIndex, text: "Plan", status: "complete" });
      }
    }
    assistantMessages.push({ id: `m${messageIndex}`, blocks });
  }

  const tools = Array.from({ length: activeToolCount }, (_, index) => ({
    id: `tool-${index}`,
    name: "read",
    args: { path: `file-${index}.txt` },
    done: true,
    result: "ok",
    timestamp: new Date(1_000 + index).toISOString(),
  }));
  const generation = {
    id: "g_projection",
    status: "running",
    lastSeq: 1,
    assistantMessages,
    toolExecutions: {},
  };
  return { generation, messages, tools };
}

function summarize(samples) {
  const durations = samples.slice().sort((left, right) => left - right);
  return {
    p50: durations[Math.floor(durations.length * 0.5)],
    p95: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))],
    max: durations.at(-1),
  };
}

function measure(fn) {
  for (let index = 0; index < 2; index += 1) fn();
  const samples = [];
  for (let index = 0; index < 8; index += 1) {
    const startedAt = performance.now();
    fn();
    samples.push(performance.now() - startedAt);
  }
  return summarize(samples);
}

test("narrow projection work stays on the changed live answer row", () => {
  const measurements = [];
  for (const [axis, values] of Object.entries(axes)) {
    for (const value of values) {
      const dimensions = { ...middle, [axis]: value };
      const { generation, messages, tools } = makeProjectionCase(dimensions);
      const index = buildLiveProjectionIndex(generation, messages);
      const target = generation.assistantMessages[0].blocks.at(-1);
      assert.equal(target.type, "text");
      assert.equal(index.activeBlockCount, dimensions.activeMessageCount * dimensions.activeBlockCount);
      assert.equal(index.blockLocations.get(target.identity)?.kind, "answer");

      const narrow = measure(() => {
        target.text = `${target.text}!`;
        const row = buildLiveAnswerRow(generation, "m0", index, index.messageIndex);
        assert.equal(row?.key, "message:live:g_projection:m0");
      });
      const full = measure(() => {
        const rows = buildTurnRows(messages, tools, { activeGeneration: generation });
        assert.ok(rows.length > 0);
      });
      measurements.push({
        axis,
        value,
        persistedRowCount: dimensions.persistedRowCount,
        activeMessageCount: dimensions.activeMessageCount,
        activeBlockCount: dimensions.activeBlockCount,
        activeToolCount: dimensions.activeToolCount,
        fullRowCount: buildTurnRows(messages, tools, { activeGeneration: generation }).length,
        narrowChangedRowCount: 1,
        fullDurationMs: full,
        narrowDurationMs: narrow,
      });
    }
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    fixtureId: "slice3-timeline-projection-benchmark",
    runtime: process.version,
    axes,
    measurements,
  }));
});
