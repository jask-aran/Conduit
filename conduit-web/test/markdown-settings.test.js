import assert from "node:assert/strict";
import test from "node:test";
import {
  isMarkdownRendererId,
  MARKDOWN_RENDERER_DEFAULT,
  MARKDOWN_RENDERER_OPTIONS,
  selectedMarkdownRenderer,
} from "../src/client/chat/markdown-settings.ts";

function withSearch(search, run) {
  const previous = globalThis.location;
  globalThis.location = { search };
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
}

const stored = (value) => ({ getItem: () => value });

test("new users get an offered default renderer", () => {
  withSearch("", () => {
    assert.equal(selectedMarkdownRenderer(stored(null)), MARKDOWN_RENDERER_DEFAULT);
    assert.ok(MARKDOWN_RENDERER_OPTIONS.some((option) => option.value === MARKDOWN_RENDERER_DEFAULT));
  });
});

test("every offered renderer round-trips", () => {
  assert.ok(MARKDOWN_RENDERER_OPTIONS.length >= 2);
  withSearch("", () => {
    for (const option of MARKDOWN_RENDERER_OPTIONS) {
      assert.ok(isMarkdownRendererId(option.value), option.value);
      assert.equal(selectedMarkdownRenderer(stored(option.value)), option.value);
    }
  });
  assert.equal(new Set(MARKDOWN_RENDERER_OPTIONS.map((option) => option.value)).size, MARKDOWN_RENDERER_OPTIONS.length);
});

test("a retired renderer id falls back instead of stranding the reader", () => {
  // These were selectable before the renderer surface collapsed to two. Nobody
  // should be left pointing at a renderer that no longer exists.
  withSearch("", () => {
    for (const retired of ["marked-stable", "incremark-advanced", "incremark-typewriter", "incremark-synthetic", "incremark-fast", "current", ""]) {
      assert.equal(selectedMarkdownRenderer(stored(retired)), MARKDOWN_RENDERER_DEFAULT, retired);
    }
  });
});

test("the query override wins over storage, and a bad one is ignored", () => {
  assert.ok(MARKDOWN_RENDERER_OPTIONS.length >= 2);
  for (const { value } of MARKDOWN_RENDERER_OPTIONS) {
    const other = MARKDOWN_RENDERER_OPTIONS.find((option) => option.value !== value).value;
    withSearch(`?markdownRenderer=${encodeURIComponent(value)}`, () => {
      assert.equal(selectedMarkdownRenderer(stored(other)), value);
    });
    withSearch("?markdownRenderer=incremark-synthetic", () => {
      assert.equal(selectedMarkdownRenderer(stored(value)), value);
    });
  }
});
