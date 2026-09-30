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

test("new users get Incremark", () => {
  withSearch("", () => {
    assert.equal(selectedMarkdownRenderer(stored(null)), "incremark");
    assert.equal(MARKDOWN_RENDERER_DEFAULT, "incremark");
  });
});

test("both offered renderers round-trip", () => {
  withSearch("", () => {
    for (const option of MARKDOWN_RENDERER_OPTIONS) {
      assert.ok(isMarkdownRendererId(option.value), option.value);
      assert.equal(selectedMarkdownRenderer(stored(option.value)), option.value);
    }
  });
  assert.equal(MARKDOWN_RENDERER_OPTIONS.length, 2);
});

test("a retired renderer id falls back instead of stranding the reader", () => {
  // These were selectable before the renderer surface collapsed to two. Nobody
  // should be left pointing at a renderer that no longer exists.
  withSearch("", () => {
    for (const retired of ["marked-stable", "incremark-advanced", "incremark-typewriter", "incremark-synthetic", "incremark-fast", "current", ""]) {
      assert.equal(selectedMarkdownRenderer(stored(retired)), "incremark", retired);
    }
  });
});

test("the query override wins over storage, and a bad one is ignored", () => {
  withSearch("?markdownRenderer=marked", () => {
    assert.equal(selectedMarkdownRenderer(stored("incremark")), "marked");
  });
  withSearch("?markdownRenderer=incremark-synthetic", () => {
    assert.equal(selectedMarkdownRenderer(stored("marked")), "marked");
  });
});
