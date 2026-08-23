import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../src/client/chat/", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("Incremark Advanced settles the existing streaming DOM without a second render", async () => {
  const source = await read("incremark-advanced.tsx");
  assert.match(source, /<IncremarkMarkdown/);
  assert.match(source, /\btypewriter\b/);
  assert.match(source, /\bsyntheticMath\b/);
  assert.match(source, /setFrozenSource\(snapshot\)/);
  assert.match(source, /const source = createMemo/);
  assert.match(source, /const streaming = createMemo/);
  assert.match(source, /data-incremark-advanced-state/);
  assert.doesNotMatch(source, /cloneNode|replaceChildren|innerHTML\s*=|DOMParser|marked\.parse/);
});

test("Advanced deliberately uses the same live renderer contract as Synthetic", async () => {
  const source = await read("incremark-advanced.tsx");
  const transcriptMarkdown = await read("transcript-markdown.tsx");
  assert.match(source, /<IncremarkMarkdown[\s\S]*\btypewriter\b[\s\S]*\bsyntheticMath\b/);
  assert.match(source, /streaming=\{streaming\(\)\}/);
  assert.match(source, /streamVersion/);
  assert.doesNotMatch(source, /typewriter=\{false\}|syntheticMath=\{false\}/);
  assert.match(transcriptMarkdown, /renderer === "incremark-synthetic"[\s\S]*renderer === "incremark-advanced"/);
  assert.match(transcriptMarkdown, /renderer="incremark-synthetic"/);
});

test("fresh typewriter-family mounts seed existing live source before animating future deltas", async () => {
  const source = await read("transcript-markdown.tsx");
  assert.match(source, /createRenderEffect/);
  assert.match(source, /setAttached\(false\)/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /effectiveStreaming/);
  assert.match(source, /!usesTypewriter\(props\.renderer\) \|\| attached\(\)/);
});

test("Incremark Advanced waits for streaming, typewriter and deferred math to go quiet", async () => {
  const source = await read("incremark-advanced.tsx");
  assert.match(source, /props\.streaming/);
  assert.match(source, /data-display-busy/);
  assert.match(source, /data-pending-math-renders/);
  assert.match(source, /SETTLE_DELAY_FRAMES\s*=\s*2/);
});

test("Synthetic and Advanced share stable inline sizing while only Advanced virtualizes settled math per block", async () => {
  const visibility = await read("transcript-visibility.ts");
  const advancedCss = await read("incremark-advanced.css");
  const rendererCss = await read("transcript-renderer.css");
  assert.match(visibility, /advancedIncremarkBlocks/);
  assert.match(visibility, /!advancedIncremarkBlocks\.has\(element\)/);
  assert.match(visibility, /data-incremark-advanced-state/);
  assert.match(rendererCss, /data-markdown-synthetic-math="true"[\s\S]*contain:\s*inline-size/);
  assert.doesNotMatch(rendererCss, /contain:\s*(?:layout|paint|strict|content)/);
  assert.doesNotMatch(advancedCss, /contain:/);
});

test("transcript picker exposes the five existing renderers plus Advanced and remains live during generation", async () => {
  const transcript = await read("transcript.tsx");
  const preference = await read("transcript-renderer.ts");
  assert.match(transcript, /aria-label="Composer renderer"/);
  assert.match(transcript, /aria-label="Transcript renderer"/);
  assert.match(transcript, /<TranscriptMarkdown/);
  assert.doesNotMatch(transcript, /aria-label="Transcript renderer"[^>]*disabled=/);
  assert.match(preference, /\.\.\.MARKDOWN_RENDERER_OPTIONS/);
  assert.match(preference, /Incremark Advanced/);
  assert.match(preference, /MARKDOWN_RENDERER_STORAGE_KEY/);
  assert.match(preference, /transcriptRenderer/);
});
