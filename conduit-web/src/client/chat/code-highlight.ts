import { CODE_BLOCK } from "@/components/ui/shared";
import { createSignal } from "solid-js";
/*
 * While a block streams: a post-hoc pass that rewrites <code> fights the renderer for nodes it owns and is wiped on
 * the next chunk, so the streaming path renders highlighted markup as the renderer's own output. Re-highlighting a
 * growing block every frame is quadratic over a stream. An unterminated string or comment tokenizes differently from
 * the finished text, so the line still being written stays plain.
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
  highlight: (code: string, options: { language: string; ignoreIllegals?: boolean }) => { value: string; _top?: unknown };
  getLanguage: (name: string) => unknown;
};

let highlighterPromise: Promise<Highlighter> | null = null;
let loaded: Highlighter | null = null;
const [highlighterReady, setHighlighterReady] = createSignal(false);

/** Read inside a render, so a block re-highlights the moment the lazy chunk lands. */
export { highlighterReady };

export function primeHighlighter() {
  if (!loaded) void loadHighlighter().catch(() => {});
}

/** The default bundle would pull ~190 grammars; these are the ones an assistant answer actually produces. */
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

/** A highlighter's spans cross newlines, so lines cannot be produced by splitting the HTML: at each newline the
 *  chain of enclosing elements is re-opened inside a fresh line. */
export function splitHighlightedLines(html: string, keepTrailing = false): HTMLElement[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const lines: HTMLElement[] = [];
  const sourceChain: HTMLElement[] = [];
  let openChain: HTMLElement[] = [];

  const startLine = () => {
    const line = document.createElement("span");
    line.className = CODE_BLOCK.line;
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
  // asked for -- in finished code. A streaming prefix ending in one is a blank
  // line with the line being written after it.
  if (!keepTrailing && lines.length > 1 && !lines.at(-1)!.textContent) lines.pop();
  return lines;
}

const HIGHLIGHTED = "data-highlighted";

function needsHighlight(card: HTMLElement) {
  if (card.hasAttribute("data-streaming")) return false;
  const code = card.querySelector("code");
  if (!code) return false;
  // Coloured tokens are the real test, not the marker: it self-heals a block whose renderer put its plain lines back
  // after the marker was set. A language with no highlighter has nothing to colour.
  return Boolean(resolveHighlightLanguage(card.dataset.language || "")) && !code.querySelector(`.${CODE_BLOCK.line} *`);
}

export async function highlightCodeBlocks(root: ParentNode) {
  const cards = [...root.querySelectorAll<HTMLElement>(".ui-code[data-language]")].filter(needsHighlight);
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

/** Once lines are separate block elements the newlines are gone from the DOM, so textContent alone runs them
 *  together. */
export function codeElementText(code: Element) {
  const lines = code.querySelectorAll(`.${CODE_BLOCK.line}`);
  if (!lines.length) return code.textContent || "";
  return [...lines].map((line) => line.textContent || "").join("\n");
}

export const STREAM_REHIGHLIGHT_MS = 100;

function lineSpans(html: string, keepTrailing = false) {
  return splitHighlightedLines(html, keepTrailing).map((line) => line.outerHTML);
}

// Built as strings: the tail is rebuilt every delivery, and a template parse each time is costly.
function plainLineSpans(text: string) {
  const lines = text.split("\n");
  if (lines.length > 1 && !lines.at(-1)) lines.pop();
  return lines.map((line) => `<span class="${CODE_BLOCK.line}">${escapeForLines(line)}</span>`);
}

export function highlightToHtml(text: string, language: string) {
  return highlightPart(text, language).html;
}

/** `atTop`: no comment, string or other construct is still open, so text after this point highlights the same started
 *  afresh as continued. */
function highlightPart(text: string, language: string) {
  const hljs = loaded;
  if (!hljs) return { html: escapeForLines(text), atTop: false };
  const resolved = resolveHighlightLanguage(language);
  const grammar = resolved ? hljs.getLanguage(resolved) : null;
  if (!grammar) return { html: escapeForLines(text), atTop: true };
  try {
    const result = hljs.highlight(text, { language: resolved, ignoreIllegals: true });
    return { html: result.value, atTop: result._top === grammar };
  } catch {
    return { html: escapeForLines(text), atTop: false };
  }
}

/** Lines up to a point the grammar ends at its top level are final, and each recompute starts there, so a growing
 *  block does not pay for its whole length every chunk. */
export class StreamingCodeHighlighter {
  private prefixLength = -1;
  private prefixLines: string[] = [];
  /** Through the line break after it. */
  private committed = "";
  private committedLines: string[] = [];
  private lastRunAt = 0;
  private lastLanguage = "";
  private hadGrammars = false;

  continueFrom(other: StreamingCodeHighlighter) {
    this.lastLanguage = other.lastLanguage;
    this.hadGrammars = other.hadGrammars;
    this.committed = other.committed;
    this.committedLines = other.committedLines;
  }

  /** A line unchanged since the last render is the same string. */
  render(text: string, language: string, streaming: boolean): string[] {
    primeHighlighter();
    // The grammars arrive asynchronously, so the first render of a block is
    // usually plain. Caching on length alone would keep serving that plain
    // result forever once they land.
    const hasGrammars = Boolean(loaded);
    if (language !== this.lastLanguage || hasGrammars !== this.hadGrammars) {
      this.lastLanguage = language;
      this.hadGrammars = hasGrammars;
      this.prefixLength = -1;
      this.prefixLines = [];
      this.committed = "";
      this.committedLines = [];
      this.lastRunAt = 0;
    }
    if (!streaming) {
      if (this.prefixLength !== text.length) {
        this.prefixLength = text.length;
        const kept = this.committed && text.startsWith(this.committed) ? this.committedLines : [];
        const rest = kept.length ? text.slice(this.committed.length) : text;
        this.prefixLines = rest ? [...kept, ...lineSpans(highlightToHtml(rest, language))] : kept;
      }
      return this.prefixLines;
    }

    // Only whole lines are stable enough to colour.
    const lastBreak = text.lastIndexOf("\n");
    const stable = lastBreak < 0 ? "" : text.slice(0, lastBreak);
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    const grew = stable.length !== this.prefixLength;
    if (grew && now - this.lastRunAt >= STREAM_REHIGHLIGHT_MS) {
      this.lastRunAt = now;
      this.prefixLength = stable.length;
      // Text rewritten behind its end starts over.
      if (!stable.startsWith(this.committed)) {
        this.committed = "";
        this.committedLines = [];
      }
      const part = stable.slice(this.committed.length);
      const { html, atTop } = highlightPart(part, language);
      // An empty part after committed lines is an empty line of its own.
      const lines = part || this.committed ? lineSpans(html, true) : [];
      this.prefixLines = this.committedLines.length ? [...this.committedLines, ...lines] : lines;
      if (atTop && lines.length) {
        this.committed = `${stable}\n`;
        this.committedLines = this.prefixLines;
      }
    } else if (this.prefixLength < 0) {
      this.prefixLength = 0;
      this.prefixLines = [];
    }

    // Anything past the highlighted prefix is rendered plain, so text is never
    // withheld from the reader while waiting for the next recompute.
    const plainFrom = this.prefixLength <= 0 ? text : text.slice(this.prefixLength + 1);
    if (!plainFrom) return this.prefixLines;
    return [...this.prefixLines, ...plainLineSpans(plainFrom)];
  }
}
