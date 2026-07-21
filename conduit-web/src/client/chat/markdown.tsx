import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";
import { Button } from "@/components/primitives";

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

marked.use(markedKatex({ nonStandard: true, throwOnError: false }));
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    strong({ tokens }) {
      return `<strong data-markdown="strong">${this.parser.parseInline(tokens)}</strong>`;
    },
    image() { return ""; },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      try {
        const target = new URL(href, location.href);
        if (!allowedProtocols.has(target.protocol)) return label;
        if (target.origin === location.origin || target.protocol === "mailto:") {
          return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${label}</a>`;
        }
        return `<button type="button" class="external-markdown-link" data-external-url="${escapeHtml(target.href)}" aria-label="${escapeHtml(String(tokens.map((token) => "text" in token ? token.text : "").join("") || target.href))}">${label}</button>`;
      } catch { return label; }
    },
    code({ text, lang }) {
      const language = String(lang || "text").split(/\s+/)[0]!.toLowerCase();
      return `<div class="artifact" data-language="${escapeHtml(language)}"><div class="artifact-header"><span>${escapeHtml(language)}</span><button type="button" aria-label="Copy code" data-copy-code>Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`;
    },
  },
});

function renderMarkdown(source: string) {
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "class"],
    FORBID_TAGS: ["img", "script", "style", "iframe", "object", "embed"],
  });
}

export function ChatMarkdown(props: { children?: string; streaming?: boolean }) {
  let root!: HTMLDivElement;
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);

  createEffect(() => {
    const source = String(props.children || "");
    root.innerHTML = renderMarkdown(source);
  });

  const click = async (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-copy-code], [data-external-url]");
    if (!target) return;
    if (target.hasAttribute("data-copy-code")) {
      await navigator.clipboard.writeText(target.closest("[data-language]")?.querySelector("code")?.textContent || "");
    } else {
      setExternalUrl(target.dataset.externalUrl || null);
    }
  };

  onMount(() => root.addEventListener("click", click));
  onCleanup(() => root.removeEventListener("click", click));

  return <>
    <div ref={root} class="chat-markdown" data-streaming={props.streaming || undefined} />
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Open external link?"
      data-state={externalUrl() ? "open" : "closed"}
      class="external-link-dialog"
    >
      <div class="external-link-dialog-card">
        <h2>Open external link?</h2>
        <p>This link opens outside Conduit.</p>
        <code class="external-link-url">{externalUrl()}</code>
        <div class="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setExternalUrl(null)}>Cancel</Button>
          <Button onClick={() => { if (externalUrl()) window.open(externalUrl()!, "_blank", "noopener,noreferrer"); setExternalUrl(null); }}>Open link</Button>
        </div>
      </div>
    </div>
  </>;
}
