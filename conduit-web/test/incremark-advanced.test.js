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
  assert.match(source, /<IncremarkMarkdown[\s\S]*\btypewriter\b[\s\S]*\bsyntheticMath\b/);
  assert.match(source, /streaming=\{streaming\(\)\}/);
  assert.match(source, /streamVersion/);
  assert.doesNotMatch(source, /typewriter=\{false\}|syntheticMath=\{false\}/);
});

test("Incremark Advanced waits for streaming, typewriter and deferred math to go quiet", async () => {
  const source = await read("incremark-advanced.tsx");
  assert.match(source, /props\.streaming/);
  assert.match(source, /data-display-busy/);
  assert.match(source, /data-pending-math-renders/);
  assert.match(source, /SETTLE_DELAY_FRAMES\s*=\s*2/);
});

test("settled Advanced blocks are independently virtualizable", async () => {
  const visibility = await read("transcript-visibility.ts");
  const css = await read("incremark-advanced.css");
  assert.match(visibility, /advancedIncremarkBlocks/);
  assert.match(visibility, /!advancedIncremarkBlocks\.has\(element\)/);
  assert.match(visibility, /data-incremark-advanced-state/);
  assert.match(css, /contain:\s*inline-size/);
  assert.doesNotMatch(css, /contain:\s*(?:layout|paint|strict|content)/);
});

test("transcript picker exposes the five existing renderers plus Advanced", async () => {
  const transcript = await read("transcript.tsx");
  const preference = await read("transcript-renderer.ts");
  assert.match(transcript, /aria-label="Composer renderer"/);
  assert.match(transcript, /aria-label="Transcript renderer"/);
  assert.match(transcript, /<IncremarkAdvancedMarkdown/);
  assert.match(transcript, /disabled=\{props\.chat\.streaming\(\) \|\| props\.chat\.stopping\(\)\}/);
  assert.match(preference, /\.\.\.MARKDOWN_RENDERER_OPTIONS/);
  assert.match(preference, /Incremark Advanced/);
  assert.match(preference, /MARKDOWN_RENDERER_STORAGE_KEY/);
  assert.match(preference, /transcriptRenderer/);
});
