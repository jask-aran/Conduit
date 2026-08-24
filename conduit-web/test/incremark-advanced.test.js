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
  const transcript = await read("transcript.tsx");
  assert.match(source, /<IncremarkMarkdown[\s\S]*\btypewriter\b[\s\S]*\bsyntheticMath\b/);
  assert.match(source, /streaming=\{streaming\(\)\}/);
  // The advanced renderer forwards the full ChatMarkdown contract through
  // `{...props}`; this includes streamVersion without duplicating every prop.
  assert.match(source, /<IncremarkMarkdown[\s\S]*\{\.\.\.props\}/);
  assert.doesNotMatch(source, /typewriter=\{false\}|syntheticMath=\{false\}/);
  assert.match(transcript, /<IncremarkAdvancedMarkdown renderer="incremark-synthetic"/);
});

test("existing renderers remain on the original direct ChatMarkdown path", async () => {
  const transcript = await read("transcript.tsx");
  assert.match(transcript, /const ChatMarkdown = lazy\(\(\) => import\("\.\/markdown"\)/);
  assert.match(transcript, /fallback=\{<ChatMarkdown renderer=\{markdownRenderer\(\)\} typewriter=\{rendererUsesTypewriter\(\)\} syntheticMath=\{markdownRenderer\(\) === "incremark-synthetic"\}/);
  assert.doesNotMatch(transcript, /TranscriptMarkdown/);
});

test("Incremark Advanced waits for streaming, typewriter and deferred math to go quiet", async () => {
  const source = await read("incremark-advanced.tsx");
  assert.match(source, /props\.streaming/);
  assert.match(source, /data-display-busy/);
  assert.match(source, /data-pending-math-renders/);
  assert.match(source, /SETTLE_DELAY_FRAMES\s*=\s*2/);
});

test("all Incremark renderers share the Advanced geometry contract", async () => {
  const visibility = await read("transcript-visibility.ts");
  const advancedCss = await read("incremark-advanced.css");
  const rendererCss = await read("transcript-renderer.css");
  assert.match(visibility, /advancedIncremarkBlocks/);
  assert.match(visibility, /!advancedIncremarkBlocks\.has\(element\)/);
  assert.match(visibility, /data-incremark-advanced-state/);
  assert.match(rendererCss, /\[data-slot="bubble-content"\]\s*>\s*\.chat-markdown\[data-renderer\^="incremark"\]/);
  assert.match(rendererCss, /width:\s*100%/);
  assert.doesNotMatch(rendererCss, /:has\(/);
  assert.doesNotMatch(rendererCss, /contain:\s*inline-size/);
  assert.doesNotMatch(rendererCss, /data-markdown-synthetic-math/);
  assert.match(advancedCss, /:has\(\.incremark-advanced-shell\)[\s\S]*width:\s*100%/);
  assert.match(advancedCss, /\.incremark-advanced-shell[\s\S]*contain:\s*inline-size/);
  assert.doesNotMatch(advancedCss, /contain:\s*(?:layout|paint|strict|content)/);
});

test("visibility reset is only introduced when crossing the Advanced boundary", async () => {
  const transcript = await read("transcript.tsx");
  assert.match(transcript, /crossesAdvancedBoundary/);
  assert.match(transcript, /renderer === "incremark-advanced" \|\| previous === "incremark-advanced"/);
});

test("transcript picker exposes the five existing renderers plus Advanced and remains live during generation", async () => {
  const transcript = await read("transcript.tsx");
  const preference = await read("transcript-renderer.ts");
  assert.match(transcript, /aria-label="Composer renderer"/);
  assert.match(transcript, /aria-label="Transcript renderer"/);
  assert.match(transcript, /aria-label="Typewriter pacing"/);
  assert.match(transcript, /<Show when=\{rendererUsesTypewriter\(\)\}>/);
  assert.match(transcript, /adaptivePacing=\{incremarkPacing\(\) === "adaptive"\}/);
  assert.match(transcript, /<IncremarkAdvancedMarkdown/);
  assert.doesNotMatch(transcript, /aria-label="Transcript renderer"[^>]*disabled=/);
  assert.match(preference, /\.\.\.MARKDOWN_RENDERER_OPTIONS/);
  assert.match(preference, /Incremark Advanced/);
  assert.match(preference, /MARKDOWN_RENDERER_STORAGE_KEY/);
  assert.match(preference, /transcriptRenderer/);
});
