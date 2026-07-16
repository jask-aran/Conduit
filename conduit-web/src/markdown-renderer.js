import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import sanitizeHtml from "sanitize-html";
import { createHighlighter } from "shiki";

const languages = ["bash", "css", "diff", "html", "javascript", "json", "jsx", "markdown", "python", "sql", "tsx", "typescript", "yaml"];
const languageAliases = new Map([
  ["js", "javascript"], ["ts", "typescript"], ["sh", "bash"], ["shell", "bash"],
  ["py", "python"], ["md", "markdown"], ["yml", "yaml"], ["html", "html"],
]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function safeHref(value) {
  try {
    const target = new URL(value, "http://conduit.local");
    return ["http:", "https:", "mailto:"].includes(target.protocol) ? value : "";
  } catch { return ""; }
}

export async function createMarkdownRenderer() {
  const highlighter = await createHighlighter({
    themes: ["github-dark", "github-light"],
    langs: languages,
  });
  const renderer = {
    code({ text, lang = "" }) {
      const requested = String(lang).trim().split(/\s+/)[0].toLowerCase();
      const language = languageAliases.get(requested) || requested;
      const supported = languages.includes(language) ? language : "text";
      return highlighter.codeToHtml(text, {
        lang: supported,
        themes: { dark: "github-dark", light: "github-light" },
      });
    },
    html({ text }) { return escapeHtml(text); },
    image({ text }) { return escapeHtml(text); },
    link({ href, title, tokens }) {
      const safe = safeHref(href);
      const label = this.parser.parseInline(tokens);
      if (!safe) return label;
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(safe)}" data-conduit-link="true"${titleAttribute}>${label}</a>`;
    },
  };
  const marked = new Marked({ gfm: true, breaks: false, renderer });
  marked.use(markedKatex({ output: "htmlAndMathml", throwOnError: false, nonStandard: true }));

  return (markdown) => sanitizeHtml(marked.parse(String(markdown || "")), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "ms", "mtext",
      "mspace", "mstyle", "mfrac", "msqrt", "mroot", "msub", "msup", "msubsup",
      "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mpadded", "mphantom",
    ],
    allowedAttributes: {
      "*": ["class", "aria-hidden"],
      a: ["href", "title", "data-conduit-link"],
      annotation: ["encoding"],
      math: ["display", "xmlns"],
      pre: ["class", "style", "tabindex"],
      code: ["class"],
      span: ["class", "style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: {
      pre: { "background-color": [/^#[0-9a-f]{3,8}$/i], color: [/^#[0-9a-f]{3,8}$/i] },
      span: { color: [/^#[0-9a-f]{3,8}$/i], "--shiki-dark": [/^#[0-9a-f]{3,8}$/i] },
    },
    disallowedTagsMode: "escape",
  });
}

export function stableMarkdownBoundary(markdown) {
  const text = String(markdown || "");
  const lines = text.split(/(?<=\n)/);
  let offset = 0;
  let boundary = 0;
  let fence = "";
  let displayMath = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch && (!fence || fenceMatch[1][0] === fence[0])) {
      fence = fence ? "" : fenceMatch[1];
    } else if (!fence && /^\$\$/.test(trimmed)) {
      const markers = trimmed.match(/\$\$/g)?.length || 0;
      if (markers % 2 === 1) displayMath = !displayMath;
    }
    offset += line.length;
    if (!fence && !displayMath && (trimmed === "" || fenceMatch)) boundary = offset;
  }
  return Math.min(boundary, text.length);
}
