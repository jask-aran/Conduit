import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
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
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
}

export function ChatMarkdown(props: { children?: string; streaming?: boolean; streamVersion?: number }) {
  let root!: HTMLDivElement;
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);
  let externalReturnFocus: HTMLElement | null = null;
  let renderedSource = "";
  let streamLength = 0;
  let activeStreamVersion = -1;
  let streamChunks: string[] = [];
  let streamLineChunks: string[] = [];
  let streamTail: HTMLSpanElement | null = null;
  let streamText: Text | null = null;
  let fence: { character: string; length: number } | null = null;
  let displayMath = false;
  let commitAtBlankLine: boolean | null = null;
  let streaming = false;

  const appendRendered = (source: string) => {
    if (!source) return;
    root.insertBefore(renderMarkdown(source), streamTail);
  };

  const commitStreamBuffer = () => {
    const source = streamChunks.join("");
    if (source.trim()) appendRendered(source);
    streamChunks = [];
    commitAtBlankLine = null;
    if (streamText) streamText.data = "";
  };

  const finishLine = () => {
    const line = streamLineChunks.join("").slice(0, -1).replace(/\r$/, "");
    const trimmed = line.trim();
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] || null;
    const closingMarker = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1] || null;
    streamLineChunks = [];
    if (commitAtBlankLine == null && trimmed) {
      // Containers can legally continue after blank lines. Keep their entire
      // tail raw rather than split one Markdown block into several documents.
      commitAtBlankLine = !/^(?: {0,3}(?:[-+*]|\d+[.)])\s| {0,3}>|(?: {4}|\t)| {0,3}<[A-Za-z!/]| {0,3}\[[^\]]+\]:)/.test(line);
    }

    if (fence) {
      if (closingMarker?.[0] === fence.character && closingMarker.length >= fence.length) {
        fence = null;
        commitStreamBuffer();
      }
      return;
    }
    if (marker) {
      fence = { character: marker[0]!, length: marker.length };
      return;
    }
    if (trimmed === "$$") {
      displayMath = !displayMath;
      if (!displayMath) commitStreamBuffer();
      return;
    }
    if (!displayMath && !trimmed && commitAtBlankLine !== false) commitStreamBuffer();
  };

  const appendStream = (delta: string) => {
    if (!delta || !streamText) return;
    streamLength += delta.length;
    let start = 0;
    for (let newline = delta.indexOf("\n"); newline >= 0; newline = delta.indexOf("\n", start)) {
      const segment = delta.slice(start, newline + 1);
      streamChunks.push(segment);
      streamLineChunks.push(segment);
      streamText.appendData(segment);
      finishLine();
      start = newline + 1;
    }
    const remainder = delta.slice(start);
    if (!remainder) return;
    streamChunks.push(remainder);
    streamLineChunks.push(remainder);
    streamText.appendData(remainder);
  };

  const beginStream = (source: string, version: number) => {
    root.replaceChildren();
    renderedSource = "";
    streamLength = 0;
    activeStreamVersion = version;
    streamChunks = [];
    streamLineChunks = [];
    fence = null;
    displayMath = false;
    commitAtBlankLine = null;
    streaming = true;
    streamTail = document.createElement("span");
    streamTail.className = "markdown-stream-tail";
    streamTail.dataset.markdownStreamTail = "";
    streamText = document.createTextNode("");
    streamTail.append(streamText);
    root.append(streamTail);
    appendStream(source);
  };

  const finishStream = (source: string) => {
    // Fragments are useful while tokens arrive, but only a canonical parse of
    // the whole document can resolve cross-block Markdown such as reference
    // definitions. This is the stream's single full parse.
    root.replaceChildren(renderMarkdown(source));
    streamTail = null;
    streamText = null;
    streamChunks = [];
    streamLineChunks = [];
    renderedSource = source;
    streaming = false;
  };

  createEffect(() => {
    const source = String(props.children || "");
    const version = Number(props.streamVersion || 0);
    if (props.streaming) {
      if (!streaming || version !== activeStreamVersion || source.length < streamLength) beginStream(source, version);
      else appendStream(source.slice(streamLength));
      return;
    }
    if (streaming) finishStream(source);
    else if (source !== renderedSource) {
      root.replaceChildren(renderMarkdown(source));
      renderedSource = source;
    }
  });

  const click = async (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-copy-code], [data-external-url]");
    if (!target) return;
    if (target.hasAttribute("data-copy-code")) {
      await navigator.clipboard.writeText(target.closest("[data-language]")?.querySelector("code")?.textContent || "");
    } else {
      externalReturnFocus = target;
      setExternalUrl(target.dataset.externalUrl || null);
    }
  };

  onMount(() => root.addEventListener("click", click));
  onCleanup(() => root.removeEventListener("click", click));

  return <>
    <div ref={root} class="chat-markdown" data-streaming={props.streaming || undefined} />
    <KAlertDialog.Root open={Boolean(externalUrl())} onOpenChange={(open) => { if (!open) setExternalUrl(null); }}>
      <KAlertDialog.Portal><KAlertDialog.Content data-state={externalUrl() ? "open" : "closed"} class="external-link-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); if (externalReturnFocus?.isConnected) externalReturnFocus.focus(); externalReturnFocus = null; }}>
        <div class="external-link-dialog-card">
          <KAlertDialog.Title>Open external link?</KAlertDialog.Title>
          <KAlertDialog.Description>This link opens outside Conduit.</KAlertDialog.Description>
          <code class="external-link-url">{externalUrl()}</code>
          <div class="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExternalUrl(null)}>Cancel</Button>
            <Button onClick={() => { if (externalUrl()) window.open(externalUrl()!, "_blank", "noopener,noreferrer"); setExternalUrl(null); }}>Open link</Button>
          </div>
        </div>
      </KAlertDialog.Content></KAlertDialog.Portal>
    </KAlertDialog.Root>
  </>;
}
