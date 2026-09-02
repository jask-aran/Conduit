#!/usr/bin/env node
/**
 * Streaming renderer benchmark.
 *
 * Drives the display scheduler the way IncremarkMarkdown does -- re-parse on
 * every delta, hand the animated blocks over, drain the frames -- against
 * synthetic documents of growing size. Frame cost used to grow with message
 * length; this is what catches that coming back.
 *
 * The digest is a fingerprint of the whole emitted display sequence: every
 * block id, status, progress and display node, in order. Two runs of the same
 * document must produce the same digest, so a change that is meant to be a pure
 * cost change can be proved to be one by comparing digests either side of it.
 *
 * Pacing is fixed here on purpose. The buffered scheduler chooses its step from
 * measured frame cost, which would make the sequence -- and so the digest --
 * depend on how fast the machine is.
 */
import { createHash } from "node:crypto";
import { createIncremarkParser } from "@incremark/core";
import { BufferedIncremarkTypewriter } from "../src/client/chat/incremark-typewriter.ts";

const PARAGRAPH_COUNTS = [40, 120, 240];
const SAMPLES = 3;
const CHUNK = 24;

const frames = [];
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
globalThis.cancelAnimationFrame = () => {};

function buildSource(paragraphs) {
  const parts = [];
  for (let index = 0; index < paragraphs; index += 1) {
    parts.push(`## Section ${index}\n`);
    parts.push(`Paragraph ${index} with **bold**, _italic_ and \`code\` spans, a [link](https://example.com/${index}), and enough filler to make the block a realistic length.\n`);
    if (index % 5 === 0) parts.push(`- item one ${index}\n- item two ${index}\n- item three ${index}\n`);
    if (index % 11 === 0) parts.push("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n");
  }
  return parts.join("\n");
}

function run(source, { hash = false } = {}) {
  const parser = createIncremarkParser({ gfm: true, math: { tex: true }, htmlTree: true, containers: true });
  const digest = hash ? createHash("sha1") : null;
  const controller = new BufferedIncremarkTypewriter({
    onChange: (blocks) => digest?.update(`${JSON.stringify(blocks.map((block) =>
      [block.id, block.status, block.progress, block.displayNode]))}\n`),
  });
  controller.setPacing("fixed");
  controller.setEnabled(true);
  const completed = new Map();
  let offset = 0;
  let frameCount = 0;
  const startedAt = performance.now();
  while (offset < source.length) {
    const next = Math.min(source.length, offset + CHUNK);
    const update = parser.append(source.slice(offset, next));
    offset = next;
    for (const block of update.updated) completed.delete(block.id);
    for (const block of update.completed) completed.set(block.id, block);
    controller.observeSource([...completed.values(), ...update.pending]
      .sort((left, right) => left.startOffset - right.startOffset));
    while (frames.length) frames.shift()((frameCount += 1) * 16);
  }
  const elapsedMs = performance.now() - startedAt;
  controller.destroy();
  return { elapsedMs, frameCount, digest: digest?.digest("hex").slice(0, 16) };
}

const rows = [];
run(buildSource(20));
for (const paragraphs of PARAGRAPH_COUNTS) {
  const source = buildSource(paragraphs);
  const samples = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) samples.push(run(source).elapsedMs);
  samples.sort((left, right) => left - right);
  const { frameCount, digest } = run(source, { hash: true });
  rows.push({ characters: source.length, frames: frameCount, medianMs: Number(samples[Math.floor(SAMPLES / 2)].toFixed(1)), digest });
}

for (const row of rows) {
  console.log(`${String(row.characters).padStart(6)} chars  ${String(row.frames).padStart(5)} frames  `
    + `${String(row.medianMs).padStart(8)} ms  ${row.digest}`);
}
console.log(JSON.stringify({ benchmark: "streaming-renderer", chunkSize: CHUNK, pacing: "fixed", rows }));
