import assert from "node:assert/strict";
import test from "node:test";
import { citationHost } from "../src/client/chat/markdown-security.ts";

test("a link whose visible text is its own URL becomes a citation", () => {
  const url = "https://en.wikipedia.org/wiki/Kendrick_Lamar";
  assert.equal(citationHost(url, url), "en.wikipedia.org");
  // The bare autolink form carries the same text without a scheme in some
  // model output, and is the same reference.
  assert.equal(citationHost(url, "en.wikipedia.org/wiki/Kendrick_Lamar"), "en.wikipedia.org");
  assert.equal(citationHost(`${url}/`, url), "en.wikipedia.org");
});

test("a link the model gave a real label is left as prose", () => {
  assert.equal(citationHost("https://en.wikipedia.org/wiki/Kendrick_Lamar", "Wikipedia"), null);
  assert.equal(citationHost("https://example.com/a", "https://example.com/b"), null);
  assert.equal(citationHost("https://example.com/a", ""), null);
});

test("www is dropped so a chip reads as the source, not the hostname", () => {
  assert.equal(citationHost("https://www.britannica.com/biography/x", "https://www.britannica.com/biography/x"), "britannica.com");
});

test("an unparseable href never produces a chip", () => {
  assert.equal(citationHost("not a url", "not a url"), null);
});
