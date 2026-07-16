import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownRenderer, stableMarkdownBoundary } from "../src/markdown-renderer.js";

test("renders safe server-side Markdown, maths, and highlighted code", async () => {
  const render = await createMarkdownRenderer();
  const html = await render("## Result\n\n$E=mc^2$\n\n```js\nconst answer = 42;\n```\n\n<script>bad()</script>\n\n[bad](javascript:bad()) [good](https://example.com)");
  assert.match(html, /<h2>Result<\/h2>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="shiki/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /data-conduit-link="true"/);
});

test("commits only complete streaming Markdown blocks", () => {
  const value = "First **complete**\n\nSecond **unfinished";
  assert.equal(value.slice(0, stableMarkdownBoundary(value)), "First **complete**\n\n");
  assert.equal(stableMarkdownBoundary("```js\nconst x = 1;\n"), 0);
  assert.equal(stableMarkdownBoundary("```js\nconst x = 1;\n```\n"), 23);
  assert.equal(stableMarkdownBoundary("$$E = mc^2$$\n\nNext\n\n"), 20);
});
