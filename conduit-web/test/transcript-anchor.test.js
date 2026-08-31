import assert from "node:assert/strict";
import test from "node:test";
import {
  captureTranscriptAnchor,
  restoreTranscriptAnchor,
} from "../src/client/chat/transcript-anchor.ts";

function fakeTranscript({ anchorTop = 100, scrollTop = 500, scrollHeight = 5000 } = {}) {
  const anchor = {
    isConnected: true,
    top: anchorTop,
    getBoundingClientRect: () => ({ top: anchor.top }),
  };
  const viewport = { scrollTop, scrollHeight };
  const thread = { querySelector: () => anchor };
  return { anchor, viewport, thread };
}

test("an undisturbed transcript needs no correction", () => {
  const { viewport, thread } = fakeTranscript();
  const anchor = captureTranscriptAnchor(viewport, thread);
  assert.equal(restoreTranscriptAnchor(viewport, anchor), 0);
  assert.equal(viewport.scrollTop, 500);
});

test("content growing above the anchor is subtracted back out", () => {
  const scene = fakeTranscript();
  const anchor = captureTranscriptAnchor(scene.viewport, scene.thread);
  // Prepending history pushes the first message 300px down the viewport.
  scene.anchor.top = 400;
  scene.viewport.scrollHeight = 5300;
  assert.equal(restoreTranscriptAnchor(scene.viewport, anchor), 300);
  assert.equal(scene.viewport.scrollTop, 800);
});

test("a relayout that shortens content above the anchor scrolls back up", () => {
  const scene = fakeTranscript();
  const anchor = captureTranscriptAnchor(scene.viewport, scene.thread);
  scene.anchor.top = 60;
  assert.equal(restoreTranscriptAnchor(scene.viewport, anchor), -40);
  assert.equal(scene.viewport.scrollTop, 460);
});

test("a lost anchor falls back to the height difference", () => {
  const scene = fakeTranscript();
  const anchor = captureTranscriptAnchor(scene.viewport, scene.thread);
  scene.anchor.isConnected = false;
  scene.viewport.scrollHeight = 5250;
  restoreTranscriptAnchor(scene.viewport, anchor);
  assert.equal(scene.viewport.scrollTop, 750);
});

test("a transcript with no messages yet still restores by height", () => {
  const viewport = { scrollTop: 0, scrollHeight: 1000 };
  const anchor = captureTranscriptAnchor(viewport, { querySelector: () => null });
  assert.equal(anchor.element, null);
  viewport.scrollHeight = 1400;
  restoreTranscriptAnchor(viewport, anchor);
  assert.equal(viewport.scrollTop, 400);
});

test("the correction routes through the caller's own scroll writer", () => {
  const scene = fakeTranscript();
  const anchor = captureTranscriptAnchor(scene.viewport, scene.thread);
  scene.anchor.top = 250;
  const writes = [];
  restoreTranscriptAnchor(scene.viewport, anchor, (next) => {
    writes.push(next);
    scene.viewport.scrollTop = next;
  });
  assert.deepEqual(writes, [650]);
});

test("sub-pixel drift is left alone rather than written back", () => {
  const scene = fakeTranscript();
  const anchor = captureTranscriptAnchor(scene.viewport, scene.thread);
  scene.anchor.top = 100.02;
  const writes = [];
  assert.equal(restoreTranscriptAnchor(scene.viewport, anchor, (next) => writes.push(next)), 0);
  assert.deepEqual(writes, []);
});
