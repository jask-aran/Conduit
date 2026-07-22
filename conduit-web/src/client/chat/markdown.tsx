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

function renderMarkdown(source: string, inline = false) {
  const html = (inline ? marked.parseInline(source, { async: false }) : marked.parse(source, { async: false })) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "class"],
    FORBID_TAGS: ["img", "script", "style", "iframe", "object", "embed", ...(inline ? ["a", "button"] : [])],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
}

const sameKind = (current: Node, next: Node) => current.nodeType === next.nodeType
  && (current.nodeType !== Node.ELEMENT_NODE || (current as Element).tagName === (next as Element).tagName);
const managedAttributes = new Set(["class", "href", "title", "type", "aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown"]);

/** Reconcile a freshly parsed canonical Markdown tree into the live tree.
 * Nodes whose semantic position and element type survive the next token keep
 * their identity, focus, listeners and measured box. A token that genuinely
 * changes Markdown structure replaces only that branch. */
function reconcileNode(current: Node, next: Node) {
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  const currentElement = current as Element;
  const nextElement = next as Element;
  for (const attribute of [...currentElement.attributes]) {
    // Attributes outside the sanitized renderer's vocabulary belong to the
    // surrounding application (measurement, focus, tests) and survive.
    if ((managedAttributes.has(attribute.name) || !attribute.name.startsWith("data-")) && !nextElement.hasAttribute(attribute.name)) {
      currentElement.removeAttribute(attribute.name);
    }
  }
  for (const attribute of [...nextElement.attributes]) {
    if (currentElement.getAttribute(attribute.name) !== attribute.value) currentElement.setAttribute(attribute.name, attribute.value);
  }
  reconcileChildren(currentElement, nextElement);
}

function reconcileChildren(current: Node, next: Node) {
  let index = 0;
  while (index < next.childNodes.length) {
    const nextChild = next.childNodes[index]!;
    const currentChild = current.childNodes[index];
    if (!currentChild) current.appendChild(nextChild.cloneNode(true));
    else if (!sameKind(currentChild, nextChild)) current.replaceChild(nextChild.cloneNode(true), currentChild);
    else reconcileNode(currentChild, nextChild);
    index += 1;
  }
  while (current.childNodes.length > next.childNodes.length) current.lastChild?.remove();
}

export function ChatMarkdown(props: { children?: string; streaming?: boolean; streamVersion?: number; inline?: boolean }) {
  let root!: HTMLDivElement;
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);
  let externalReturnFocus: HTMLElement | null = null;
  let renderedSource = "";
  let renderedVersion = -1;

  createEffect(() => {
    const source = String(props.children || "");
    const version = Number(props.streamVersion || 0);
    if (source === renderedSource && version === renderedVersion) return;
    reconcileChildren(root, renderMarkdown(source, props.inline));
    renderedSource = source;
    renderedVersion = version;
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
