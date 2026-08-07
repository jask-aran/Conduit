import assert from "node:assert/strict";
import test from "node:test";
import { markdownRendererSwitchEnabled, selectedMarkdownRenderer, selectedMarkdownTypewriter } from "../src/client/chat/markdown-settings.ts";

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

test("new users default to the Incremark Typewriter renderer", () => {
  withBrowserSettings("", {}, () => {
    assert.equal(selectedMarkdownRenderer(), "incremark-typewriter");
    assert.equal(selectedMarkdownTypewriter(), true);
  });
});

test("development renderer controls stay available on tunneled origins", () => {
  withBrowserSettings("", {}, () => {
    assert.equal(markdownRendererSwitchEnabled(), true);
  });
});

test("the five renderer preferences stay distinct", () => {
  for (const renderer of ["marked-stable", "marked", "incremark", "incremark-typewriter", "incremark-synthetic"]) {
    withBrowserSettings("", { "conduit:markdown-renderer": renderer, "conduit:incremark-typewriter": renderer === "incremark" ? "0" : "1" }, () => {
      assert.equal(selectedMarkdownRenderer(), renderer);
    });
  }
});

test("Immediate remains distinct from the retired Typewriter storage key", () => {
  withBrowserSettings("", { "conduit:markdown-renderer": "incremark", "conduit:incremark-typewriter": "0" }, () => {
    assert.equal(selectedMarkdownRenderer(), "incremark");
    assert.equal(selectedMarkdownTypewriter(), false);
  });
  withBrowserSettings("", { "conduit:markdown-renderer": "incremark", "conduit:incremark-typewriter": "1" }, () => {
    assert.equal(selectedMarkdownRenderer(), "incremark");
    assert.equal(selectedMarkdownTypewriter(), false);
  });
});

test("the legacy URL override still selects the explicit renderer when no renderer is stored", () => {
  withBrowserSettings("?markdownTypewriter=0", {}, () => {
    assert.equal(selectedMarkdownRenderer(), "incremark");
    assert.equal(selectedMarkdownTypewriter(), false);
  });
  withBrowserSettings("?markdownTypewriter=1", {}, () => {
    assert.equal(selectedMarkdownRenderer(), "incremark-typewriter");
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

test("Synthetic uses the Typewriter display queue", () => {
  withBrowserSettings("", { "conduit:markdown-renderer": "incremark-synthetic" }, () => {
    assert.equal(selectedMarkdownRenderer(), "incremark-synthetic");
    assert.equal(selectedMarkdownTypewriter(), true);
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
