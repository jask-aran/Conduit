import { createEffect, createSignal, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import katex from "katex";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import "katex/dist/katex.min.css";
import { Button } from "@/components/primitives";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";
import { splitStreamingMarkdown, type StreamingPending } from "./streaming-markdown";

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);

export type MarkdownRendererId = "marked" | "incremark";

export function selectedMarkdownRenderer(): MarkdownRendererId {
  const value = new URLSearchParams(location.search).get("markdownRenderer") || localStorage.getItem("conduit:markdown-renderer");
  return value === "incremark" ? "incremark" : "marked";
}

export function markdownRendererSwitchEnabled() {
  return import.meta.env.DEV || ["127.0.0.1", "localhost", "::1"].includes(location.hostname)
    || new URLSearchParams(location.search).has("markdownRenderer");
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function pendingMarkup(pending: StreamingPending, streaming: boolean) {
  if (pending.kind === "fence") {
    const language = escapeHtml(pending.language || "text");
    return `<div class="artifact${streaming ? " streaming-pending streaming-pending-fence" : ""}" data-language="${language}"${streaming ? " data-streaming-pending=\"fence\"" : ""}><div class="artifact-header"><span>${language}</span><button type="button" aria-label="Copy code" data-copy-code>Copy</button></div><pre><code>${escapeHtml(pending.body)}</code></pre></div>`;
  }
  const className = `streaming-pending ${pending.kind === "math-block" ? "streaming-pending-math-block" : "streaming-pending-math-inline"}`;
  const tag = pending.kind === "math-block" ? "div" : "span";
  return `<${tag} class="${className}"${streaming ? ` data-streaming-pending="${pending.kind}"` : ""} aria-hidden="true"></${tag}>`;
}

function appendPendingMarkup(fragment: DocumentFragment, pending: StreamingPending, streaming: boolean) {
  const pendingFragment = DOMPurify.sanitize(pendingMarkup(pending, streaming), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["aria-hidden", "aria-label", "class", "data-copy-code", "data-language", "data-streaming-final", "data-streaming-pending"],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  if (pending.kind === "math-inline") {
    const paragraph = [...fragment.children].reverse().find((child) => child.tagName === "P");
    if (paragraph) {
      paragraph.append(...[...pendingFragment.childNodes]);
      return;
    }
  }
  fragment.append(...[...pendingFragment.childNodes]);
}

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

function renderMarkdown(source: string, inline = false, animateMath = false) {
  const recorder = getHarnessRecorder();
  const parseStartedAt = recorder ? performance.now() : 0;
  let katexMs = 0;
  let katexCalls = 0;
  let katexTimingAvailable = false;
  let katexTimingBlocker: string | null = null;
  let restoreKatex: (() => void) | null = null;
  if (recorder) {
    const katexApi = katex as typeof katex & { renderToString: (...args: any[]) => string };
    const originalRenderToString = katexApi.renderToString;
    if (typeof originalRenderToString !== "function") {
      katexTimingBlocker = "katex.renderToString is unavailable";
    } else {
      try {
        katexApi.renderToString = function measuredRenderToString(...args: any[]) {
          const startedAt = performance.now();
          try {
            return originalRenderToString.apply(this, args);
          } finally {
            katexCalls += 1;
            katexMs += performance.now() - startedAt;
          }
        };
        katexTimingAvailable = true;
        restoreKatex = () => { katexApi.renderToString = originalRenderToString; };
      } catch {
        katexTimingBlocker = "katex.renderToString cannot be wrapped without changing the module export";
      }
    }
  }
  let html: string;
  try {
    html = (inline ? marked.parseInline(source, { async: false }) : marked.parse(source, { async: false })) as string;
  } finally {
    restoreKatex?.();
  }
  const parsedAt = recorder ? performance.now() : 0;
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "class"],
    FORBID_TAGS: ["img", "script", "style", "iframe", "object", "embed", ...(inline ? ["a", "button"] : [])],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  if (animateMath) {
    const mathSelector = inline ? ".katex" : ".katex-display, .katex";
    for (const element of fragment.querySelectorAll(mathSelector)) element.classList.add("streaming-final-math");
  }
  if (recorder) {
    const sanitisedAt = performance.now();
    recordHarnessMetric(recorder, {
      stage: "markdown-render",
      renderer: "marked",
      sourceCharacters: source.length,
      inline,
      parseMs: parsedAt - parseStartedAt,
      sanitiseMs: sanitisedAt - parsedAt,
      katexCandidate: /\$(?:\$?)[^\n]+\$(?:\$?)/.test(source),
      katexMs: katexCalls > 0 ? katexMs : null,
      katexCallCount: katexCalls,
      katexTimingAvailable,
      katexTimingBlocker,
    });
  }
  return fragment;
}

const sameKind = (current: Node, next: Node) => current.nodeType === next.nodeType
  && (current.nodeType !== Node.ELEMENT_NODE || (current as Element).tagName === (next as Element).tagName);
const managedAttributes = new Set(["class", "href", "title", "type", "aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "data-streaming-final", "data-streaming-pending"]);

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

export type ChatMarkdownProps = {
  children?: string;
  streaming?: boolean;
  streamVersion?: number;
  inline?: boolean;
  onRendered?: () => void;
  renderer?: MarkdownRendererId;
};

function MarkedMarkdown(props: ChatMarkdownProps) {
  let root!: HTMLDivElement;
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);
  let externalReturnFocus: HTMLElement | null = null;
  let renderedSource = "";
  let renderedVersion = -1;

  createEffect(() => {
    const source = String(props.children || "");
    const version = Number(props.streamVersion || 0);
    if (source === renderedSource && version === renderedVersion) return;
    const split = splitStreamingMarkdown(source);
    const previousPending = splitStreamingMarkdown(renderedSource).pending;
    const animateMath = !split.pending && previousPending != null && previousPending.kind.startsWith("math");
    const fragment = renderMarkdown(split.pending ? split.stable : source, props.inline, animateMath);
    if (split.pending) appendPendingMarkup(fragment, split.pending, Boolean(props.streaming));
    const recorder = getHarnessRecorder();
    const reconcileStartedAt = recorder ? performance.now() : 0;
    reconcileChildren(root, fragment);
    if (recorder) {
      recordHarnessMetric(recorder, {
        stage: "markdown-reconcile",
        renderer: "marked",
        sourceCharacters: source.length,
        inline: Boolean(props.inline),
        reconcileMs: performance.now() - reconcileStartedAt,
      });
    }
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

  onMount(() => {
    root.addEventListener("click", click);
    props.onRendered?.();
  });
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

const IncremarkMarkdown = lazy(() => import("./incremark-markdown").then((module) => ({ default: module.IncremarkMarkdown })));

export function ChatMarkdown(props: ChatMarkdownProps) {
  const renderer = () => props.renderer || selectedMarkdownRenderer();
  return <Show when={renderer() === "incremark"} fallback={<MarkedMarkdown {...props} />}>
    <Suspense fallback={<div class="markdown-skeleton" />}>
      <IncremarkMarkdown {...props} />
    </Suspense>
  </Show>;
}
