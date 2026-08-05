import assert from "node:assert/strict";
import test from "node:test";
import { selectedMarkdownRenderer, selectedMarkdownTypewriter } from "../src/client/chat/markdown-settings.ts";

function withBrowserSettings(search, stored, run) {
  const previousLocation = globalThis.location;
  const previousStorage = globalThis.localStorage;
  globalThis.location = { search };
  globalThis.localStorage = { getItem: (key) => stored[key] ?? null };
  try {
    return run();
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
}

test("new users default to Incremark with Typewriter enabled", () => {
  withBrowserSettings("", {}, () => {
    assert.equal(selectedMarkdownRenderer(), "incremark");
    assert.equal(selectedMarkdownTypewriter(), true);
  });
});

test("explicit renderer and Typewriter preferences remain authoritative", () => {
  withBrowserSettings("", {
    "conduit:markdown-renderer": "marked",
    "conduit:incremark-typewriter": "0",
  }, () => {
    assert.equal(selectedMarkdownRenderer(), "marked");
    assert.equal(selectedMarkdownTypewriter(), false);
  });
});

test("URL overrides take precedence over stored defaults", () => {
  withBrowserSettings("?markdownRenderer=marked&markdownTypewriter=0", {
    "conduit:markdown-renderer": "incremark",
    "conduit:incremark-typewriter": "1",
  }, () => {
    assert.equal(selectedMarkdownRenderer(), "marked");
    assert.equal(selectedMarkdownTypewriter(), false);
  });
});
