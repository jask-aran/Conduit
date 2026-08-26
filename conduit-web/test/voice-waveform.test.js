import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import fs from "node:fs/promises";

const source = await fs.readFile(new URL("../src/client/chat/voice-waveform-model.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" });
const waveform = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("compact waveforms size bars from plot width without exceeding history capacity", () => {
  assert.equal(waveform.compactWaveformBarCount(220, 3), 73);
  assert.equal(waveform.compactWaveformBarCount(220, 6), 36);
  assert.ok(waveform.compactWaveformBarCount(800, 3) <= waveform.MAX_RESPONSIVE_BAR_COUNT);
  assert.deepEqual(waveform.selectWaveformBars([0.1, 0.4, 0.8], 6, { pad: true }), [0, 0, 0, 0.1, 0.4, 0.8]);
  assert.equal(waveform.selectWaveformBars(Array.from({ length: 64 }, (_, index) => (index + 1) / 64), 62, { pad: true }).filter((value) => value === 0).length, 0);
});

test("spoken levels use most of the compact plot height", () => {
  assert.equal(waveform.normalizeVoiceLevel({ rms: 0.1, peak: 0.2 }), 1);
  assert.equal(waveform.waveformBarHeightPercent(0, true), 7);
  assert.equal(waveform.waveformBarHeightPercent(1, true), 100);
  assert.ok(waveform.waveformBarHeightPercent(1, true) > waveform.waveformBarHeightPercent(1));
});
