import { createSignal } from "solid-js";
/**
 * Syntax highlighting and line numbers.
 *
 * Highlighting a block *while it streams* costs three things, and each is
 * handled here rather than avoided:
 *
 * 1. DOM ownership. A post-hoc pass that rewrites <code> fights the renderer
 *    for nodes it owns and re-appears wiped on the next chunk. So the streaming
 *    path renders highlighted markup as reactive innerHTML -- the renderer
 *    still owns the node, the highlighting is just what it renders.
 * 2. Cost. Re-highlighting a growing block every frame is quadratic over a
 *    stream. StreamingCodeHighlighter recomputes at most every
 *    STREAM_REHIGHLIGHT_MS and only when a line has actually completed.
 * 3. Correctness on partial input. An unterminated string or comment tokenizes
 *    differently from the finished text, so colours would flicker and settle.
 *    Only the text up to the last newline is highlighted; the line still being
 *    written stays plain until it is complete.
 *
 * The grammars are dynamically imported, so they land in their own lazy chunk
 * and cost nothing until a transcript actually contains code.
 */

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", rs: "rust", golang: "go",
  yml: "yaml", md: "markdown", html: "xml", htm: "xml", svg: "xml", vue: "xml",
  "c++": "cpp", "c#": "csharp", cs: "csharp", kt: "kotlin", plaintext: "text",
};

type Highlighter = {
  highlight: (code: string, options: { language: string; ignoreIllegals?: boolean }) => { value: string };
  getLanguage: (name: string) => unknown;
};

let highlighterPromise: Promise<Highlighter> | null = null;
let loaded: Highlighter | null = null;
const [highlighterReady, setHighlighterReady] = createSignal(false);

/**
 * Tracks whether the grammars have arrived. Reading it inside a render makes a
 * block re-highlight itself the moment the lazy chunk lands, so the first code
 * block in a session is not left plain just because it rendered first.
 */
export { highlighterReady };

/** Start loading without waiting; safe to call on every frame. */
export function primeHighlighter() {
  if (!loaded) void loadHighlighter().catch(() => {});
}

/**
 * Load the core engine plus a curated language set. Importing the default
 * bundle would pull ~190 grammars; these are the ones an assistant answer
 * actually produces.
 */
function loadHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= (async () => {
    const [{ default: hljs }, ...languages] = await Promise.all([
      import("highlight.js/lib/core"),
      import("highlight.js/lib/languages/bash"),
      import("highlight.js/lib/languages/javascript"),
      import("highlight.js/lib/languages/typescript"),
      import("highlight.js/lib/languages/python"),
      import("highlight.js/lib/languages/json"),
      import("highlight.js/lib/languages/xml"),
      import("highlight.js/lib/languages/css"),
      import("highlight.js/lib/languages/markdown"),
      import("highlight.js/lib/languages/yaml"),
      import("highlight.js/lib/languages/sql"),
      import("highlight.js/lib/languages/go"),
      import("highlight.js/lib/languages/rust"),
      import("highlight.js/lib/languages/java"),
      import("highlight.js/lib/languages/csharp"),
      import("highlight.js/lib/languages/cpp"),
      import("highlight.js/lib/languages/ruby"),
      import("highlight.js/lib/languages/php"),
      import("highlight.js/lib/languages/diff"),
      import("highlight.js/lib/languages/dockerfile"),
    ]);
    const names = [
      "bash", "javascript", "typescript", "python", "json", "xml", "css", "markdown",
      "yaml", "sql", "go", "rust", "java", "csharp", "cpp", "ruby", "php", "diff", "dockerfile",
    ];
    languages.forEach((module, index) => {
      hljs.registerLanguage(names[index]!, (module as { default: never }).default);
    });
    loaded = hljs as unknown as Highlighter;
    setHighlighterReady(true);
    return loaded;
  })();
  return highlighterPromise;
}

export function resolveHighlightLanguage(language: string) {
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

/**
 * Rebuild highlighted markup as one element per line.
 *
 * A highlighter's spans freely cross newlines -- a block comment is one span
 * over many lines -- so lines cannot be produced by splitting the HTML. Walk
 * the tree instead and, at each newline, re-open the same chain of enclosing
 * elements inside a fresh line.
 */
export function splitHighlightedLines(html: string): HTMLElement[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const lines: HTMLElement[] = [];
  const sourceChain: HTMLElement[] = [];
  let openChain: HTMLElement[] = [];

  const startLine = () => {
    const line = document.createElement("span");
    line.className = "code-line";
    lines.push(line);
    let parent: HTMLElement = line;
    openChain = sourceChain.map((source) => {
      const clone = source.cloneNode(false) as HTMLElement;
      parent.append(clone);
      parent = clone;
      return clone;
    });
  };
  const deepest = () => openChain.at(-1) ?? lines.at(-1)!;

  startLine();
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? "").split("\n");
        parts.forEach((part, index) => {
          if (index > 0) startLine();
          if (part) deepest().append(document.createTextNode(part));
        });
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const clone = child.cloneNode(false) as HTMLElement;
      deepest().append(clone);
      sourceChain.push(child);
      openChain.push(clone);
      walk(child);
      sourceChain.pop();
      openChain.pop();
    }
  };
  walk(template.content);
  // A trailing newline in the source produces one empty line the reader never
  // asked for.
  if (lines.length > 1 && !lines.at(-1)!.textContent) lines.pop();
  return lines;
}

const HIGHLIGHTED = "data-highlighted";

function needsHighlight(card: HTMLElement) {
  if (card.dataset.streamingPending === "fence") return false;
  const code = card.querySelector("code");
  if (!code) return false;
  // Presence of line spans is the real test, not the marker. It skips the
  // Incremark path -- which renders its own highlighted markup and must not be
  // rewritten from outside -- and it self-heals a card whose renderer replaced
  // the spans with plain text after the marker was set.
  return !code.querySelector(".code-line");
}

/**
 * Highlight and number every settled code block under `root` that still needs
 * it. Safe to call often -- finished cards are skipped by attribute.
 */
export async function highlightCodeBlocks(root: ParentNode) {
  const cards = [...root.querySelectorAll<HTMLElement>(".artifact[data-language]")].filter(needsHighlight);
  if (!cards.length) return;
  let hljs: Highlighter;
  try {
    hljs = await loadHighlighter();
  } catch {
    return; // Highlighting is an enhancement; plain code is still readable.
  }
  for (const card of cards) {
    if (!card.isConnected || !needsHighlight(card)) continue;
    const code = card.querySelector("code");
    if (!code) continue;
    const text = codeElementText(code);
    const language = resolveHighlightLanguage(card.dataset.language || "");
    let lines: HTMLElement[];
    try {
      const html = language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escapeForLines(text);
      lines = splitHighlightedLines(html);
    } catch {
      lines = splitHighlightedLines(escapeForLines(text));
    }
    code.replaceChildren(...lines);
    card.setAttribute(HIGHLIGHTED, "true");
    card.dataset.lines = String(lines.length);
  }
}

function escapeForLines(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The code's text with its newlines intact.
 *
 * Once lines are separate block elements the newlines are gone from the DOM,
 * so textContent alone would hand the reader every line run together.
 */
export function codeElementText(code: Element) {
  const lines = code.querySelectorAll(".code-line");
  if (!lines.length) return code.textContent || "";
  return [...lines].map((line) => line.textContent || "").join("\n");
}

/** Recompute budget while a fence is still being written. */
export const STREAM_REHIGHLIGHT_MS = 100;

function lineSpans(html: string) {
  return splitHighlightedLines(html).map((line) => line.outerHTML).join("");
}

function highlightToHtml(text: string, language: string) {
  const hljs = loaded;
  if (!hljs) return escapeForLines(text);
  const resolved = resolveHighlightLanguage(language);
  if (!resolved || !hljs.getLanguage(resolved)) return escapeForLines(text);
  try {
    return hljs.highlight(text, { language: resolved, ignoreIllegals: true }).value;
  } catch {
    return escapeForLines(text);
  }
}

/**
 * Per-block incremental highlighter for the streaming path.
 *
 * Holds the highlighted prefix between frames so a growing block does not pay
 * for its whole length on every chunk, and leaves the in-progress line plain so
 * its colours do not change under the reader as it is completed.
 */
export class StreamingCodeHighlighter {
  private prefixLength = -1;
  private prefixHtml = "";
  private lastRunAt = 0;
  private lastLanguage = "";
  private hadGrammars = false;

  render(text: string, language: string, streaming: boolean): string {
    primeHighlighter();
    // The grammars arrive asynchronously, so the first render of a block is
    // usually plain. Caching on length alone would keep serving that plain
    // result forever once they land.
    const hasGrammars = Boolean(loaded);
    if (language !== this.lastLanguage || hasGrammars !== this.hadGrammars) {
      this.lastLanguage = language;
      this.hadGrammars = hasGrammars;
      this.prefixLength = -1;
      this.prefixHtml = "";
      this.lastRunAt = 0;
    }
    if (!streaming) {
      // Settled: the text is final, so highlight all of it exactly once.
      if (this.prefixLength !== text.length) {
        this.prefixLength = text.length;
        this.prefixHtml = lineSpans(highlightToHtml(text, language));
      }
      return this.prefixHtml;
    }

    // Only whole lines are stable enough to colour.
    const lastBreak = text.lastIndexOf("\n");
    const stable = lastBreak < 0 ? "" : text.slice(0, lastBreak);
    const tail = lastBreak < 0 ? text : text.slice(lastBreak + 1);
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    const grew = stable.length !== this.prefixLength;
    if (grew && now - this.lastRunAt >= STREAM_REHIGHLIGHT_MS) {
      this.lastRunAt = now;
      this.prefixLength = stable.length;
      this.prefixHtml = stable ? lineSpans(highlightToHtml(stable, language)) : "";
    } else if (this.prefixLength < 0) {
      this.prefixLength = 0;
      this.prefixHtml = "";
    }

    // Anything past the highlighted prefix is rendered plain, so text is never
    // withheld from the reader while waiting for the next recompute.
    const plainFrom = this.prefixLength <= 0 ? text : text.slice(this.prefixLength + 1);
    if (!plainFrom) return this.prefixHtml;
    return this.prefixHtml + lineSpans(escapeForLines(plainFrom));
  }
}
