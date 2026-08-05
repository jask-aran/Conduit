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
import {
  MARKDOWN_RENDERER_STORAGE_KEY,
  MARKDOWN_TYPEWRITER_STORAGE_KEY,
  markdownRendererSwitchEnabled,
  selectedMarkdownRenderer,
  selectedMarkdownTypewriter,
  type MarkdownRendererId,
} from "./markdown-settings";

export {
  MARKDOWN_RENDERER_STORAGE_KEY,
  MARKDOWN_TYPEWRITER_STORAGE_KEY,
  markdownRendererSwitchEnabled,
  selectedMarkdownRenderer,
  selectedMarkdownTypewriter,
} from "./markdown-settings";
export type { MarkdownRendererId } from "./markdown-settings";

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);

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
  extensions: [
    {
      name: "texInlineKatex",
      level: "inline",
      start(source: string) {
        const index = source.indexOf("\\(");
        return index >= 0 ? index : undefined;
      },
      tokenizer(source: string) {
        const match = /^\\\(([\s\S]*?)\\\)/.exec(source);
        if (!match) return undefined;
        return {
          type: "texInlineKatex",
          raw: match[0],
          text: match[1]!.trim(),
          displayMode: false,
        };
      },
      renderer(token: any) {
        return katex.renderToString(token.text, { displayMode: false, throwOnError: false });
      },
    },
    {
      name: "texBlockKatex",
      level: "block",
      start(source: string) {
        const match = /^ {0,3}\\\[/.exec(source);
        return match ? match.index : undefined;
      },
      tokenizer(source: string) {
        const match = /^ {0,3}\\\[([\s\S]*?)\\\] *(?:\n+|$)/.exec(source);
        if (!match) return undefined;
        return {
          type: "texBlockKatex",
          raw: match[0],
          text: match[1]!.trim(),
          displayMode: true,
        };
      },
      renderer(token: any) {
        return `${katex.renderToString(token.text, { displayMode: true, throwOnError: false })}\n`;
      },
    },
  ],
});
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

type MarkedToken = { type?: string; raw?: string; tokens?: MarkedToken[] };
const markedKatexCache = new Map<string, string>();
const markedKatexCacheLimit = 512;

function sanitizeMarkdownHtml(html: string, inline: boolean) {
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "class"],
    FORBID_TAGS: ["img", "script", "style", "iframe", "object", "embed", ...(inline ? ["a", "button"] : [])],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  return fragment;
}

function renderMarkdownFragment(source: string, inline: boolean, render: () => string) {
  const recorder = getHarnessRecorder();
  const parseStartedAt = recorder ? performance.now() : 0;
  let katexMs = 0;
  let katexCalls = 0;
  let katexTimingAvailable = false;
  let katexTimingBlocker: string | null = null;
  let restoreKatex: (() => void) | null = null;
  const katexApi = katex as typeof katex & { renderToString: (...args: any[]) => string };
  const originalRenderToString = katexApi.renderToString;
  if (typeof originalRenderToString !== "function") {
    katexTimingBlocker = "katex.renderToString is unavailable";
  } else {
    try {
      katexApi.renderToString = function measuredRenderToString(...args: any[]) {
        const key = JSON.stringify(args);
        const cached = markedKatexCache.get(key);
        if (cached !== undefined) return cached;
        const startedAt = recorder ? performance.now() : 0;
        try {
          const html = originalRenderToString.apply(this, args);
          if (markedKatexCache.size >= markedKatexCacheLimit) markedKatexCache.delete(markedKatexCache.keys().next().value!);
          markedKatexCache.set(key, html);
          return html;
        } finally {
          if (recorder) {
            katexCalls += 1;
            katexMs += performance.now() - startedAt;
          }
        }
      };
      katexTimingAvailable = true;
      restoreKatex = () => { katexApi.renderToString = originalRenderToString; };
    } catch {
      katexTimingBlocker = "katex.renderToString cannot be wrapped without changing the module export";
    }
  }
  let html: string;
  try {
    html = render();
  } finally {
    restoreKatex?.();
  }
  const parsedAt = recorder ? performance.now() : 0;
  const fragment = sanitizeMarkdownHtml(html, inline);
  const sanitisedAt = recorder ? performance.now() : 0;
  if (recorder) {
    recordHarnessMetric(recorder, {
      stage: "markdown-render",
      renderer: "marked",
      sourceCharacters: source.length,
      inline,
      parseMs: parsedAt - parseStartedAt,
      sanitiseMs: sanitisedAt - parsedAt,
      katexCandidate: /\$(?:\$?)[^\n]+\$(?:\$?)|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(source),
      katexMs: katexCalls > 0 ? katexMs : null,
      katexCallCount: katexCalls,
      katexTimingAvailable,
      katexTimingBlocker,
    });
  }
  return fragment;
}

function renderMarkdown(source: string, inline = false) {
  return renderMarkdownFragment(source, inline, () =>
    (inline ? marked.parseInline(source, { async: false }) : marked.parse(source, { async: false })) as string);
}

function renderMarkdownTokens(tokens: MarkedToken[]) {
  const source = tokens.map((token) => token.raw || "").join("");
  return renderMarkdownFragment(source, false, () => marked.Parser.parse(tokens as any));
}

function tokenParts(source: string) {
  const tokens = marked.lexer(source) as MarkedToken[];
  let lastContent = tokens.length - 1;
  while (lastContent >= 0 && tokens[lastContent]?.type === "space") lastContent -= 1;
  if (lastContent < 0) return { stable: tokens, tail: [] };
  const tailStart = lastContent;
  return {
    stable: tokens.slice(0, tailStart),
    tail: tokens.slice(tailStart),
  };
}

function tokenRaws(tokens: MarkedToken[]) {
  return tokens.map((token) => (token.raw || "").replace(/\s+$/, ""));
}

function tokenContainsMath(token: MarkedToken): boolean {
  if (token.type === "blockKatex" || token.type === "inlineKatex" || token.type === "texBlockKatex" || token.type === "texInlineKatex") return true;
  return Boolean(token.tokens?.some(tokenContainsMath));
}

function sourceContainsMath(source: string, pending: StreamingPending | null) {
  if (pending?.kind.startsWith("math")) return true;
  if (!/[\\$]/.test(source)) return false;
  return (marked.lexer(source) as MarkedToken[]).some(tokenContainsMath);
}

function hasTokenPrefix(value: string[], prefix: string[]) {
  return prefix.every((entry, index) => value[index] === entry);
}

function moveBefore(anchor: Comment, nodes: Node[]) {
  if (!nodes.length) return;
  const fragment = document.createDocumentFragment();
  fragment.append(...nodes);
  anchor.before(fragment);
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

function reconcileRange(parent: Node, currentNodes: Node[], nextNodes: Node[], anchor: Node) {
  const retained: Node[] = [];
  for (let index = 0; index < nextNodes.length; index += 1) {
    const next = nextNodes[index]!;
    const current = currentNodes[index];
    if (!current) {
      const inserted = next.cloneNode(true);
      parent.insertBefore(inserted, anchor);
      retained.push(inserted);
    } else if (!sameKind(current, next)) {
      const replacement = next.cloneNode(true);
      parent.replaceChild(replacement, current);
      retained.push(replacement);
    } else {
      reconcileNode(current, next);
      retained.push(current);
    }
  }
  for (let index = nextNodes.length; index < currentNodes.length; index += 1) {
    const current = currentNodes[index];
    if (current?.parentNode === parent) parent.removeChild(current);
  }
  return retained;
}

export type ChatMarkdownProps = {
  children?: string;
  streaming?: boolean;
  streamVersion?: number;
  inline?: boolean;
  onRendered?: () => void;
  onDisplayBusyChange?: (busy: boolean) => void;
  typewriter?: boolean;
  syntheticMath?: boolean;
  displayKey?: string;
  renderer?: MarkdownRendererId;
};

function MarkedMarkdown(props: ChatMarkdownProps) {
  let root!: HTMLDivElement;
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);
  let externalReturnFocus: HTMLElement | null = null;
  let renderedSource = "";
  let renderedVersion = -1;
  let renderedMarkdownSource = "";
  let stableBoundary: Comment | null = null;
  let pendingBoundary: Comment | null = null;
  let stableTokenRaws: string[] = [];
  let tailTokenRaws: string[] = [];
  let tailNodes: Node[] = [];
  let pendingNodes: Node[] = [];
  let incrementalActive = false;

  const ensureIncrementalRoot = () => {
    if (stableBoundary && pendingBoundary) return;
    stableBoundary = document.createComment("markdown-stable");
    pendingBoundary = document.createComment("markdown-pending");
    root.replaceChildren(stableBoundary, pendingBoundary);
    stableTokenRaws = [];
    tailTokenRaws = [];
    tailNodes = [];
    pendingNodes = [];
    renderedMarkdownSource = "";
  };

  const resetIncrementalRoot = () => {
    stableBoundary = null;
    pendingBoundary = null;
    ensureIncrementalRoot();
  };

  const discardIncrementalState = () => {
    stableBoundary = null;
    pendingBoundary = null;
    stableTokenRaws = [];
    tailTokenRaws = [];
    tailNodes = [];
    pendingNodes = [];
    renderedMarkdownSource = "";
    incrementalActive = false;
  };

  const clearPendingNodes = () => {
    for (const node of pendingNodes) node.parentNode?.removeChild(node);
    pendingNodes = [];
  };

  const renderPending = (pending: StreamingPending | null) => {
    clearPendingNodes();
    if (!pending || !pendingBoundary) return;
    const pendingFragment = DOMPurify.sanitize(pendingMarkup(pending, Boolean(props.streaming)), {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["aria-hidden", "aria-label", "class", "data-copy-code", "data-language", "data-streaming-final", "data-streaming-pending"],
      RETURN_DOM_FRAGMENT: true,
    }) as DocumentFragment;
    const nodes = [...pendingFragment.childNodes];
    if (pending.kind === "math-inline") {
      const paragraph = [...root.querySelectorAll("p")].at(-1);
      if (paragraph) {
        paragraph.append(...nodes);
        pendingNodes = nodes;
        return;
      }
    }
    const fragment = document.createDocumentFragment();
    fragment.append(...nodes);
    pendingBoundary.after(fragment);
    pendingNodes = nodes;
  };

  const renderIncremental = (source: string, split: ReturnType<typeof splitStreamingMarkdown>) => {
    ensureIncrementalRoot();
    const pending = split.pending;
    const markdownSource = pending ? split.stable : source;
    if (markdownSource === renderedMarkdownSource && Boolean(props.streaming) && pending?.kind.startsWith("math") && pendingNodes.length > 0) {
      return;
    }
    const parts = tokenParts(markdownSource);
    const nextStableRaws = tokenRaws(parts.stable);
    const nextTailRaws = tokenRaws(parts.tail);
    const previousRenderedMarkdownSourceCharacters = renderedMarkdownSource.length;
    const sourceAppended = markdownSource.startsWith(renderedMarkdownSource);
    const fullSourceAppended = source.startsWith(renderedSource);
    const firstSourceMismatchIndex = sourceAppended
      ? null
      : [...markdownSource].findIndex((character, index) => character !== renderedMarkdownSource[index]) >= 0
        ? [...markdownSource].findIndex((character, index) => character !== renderedMarkdownSource[index])
        : Math.min(markdownSource.length, renderedMarkdownSource.length);
    const stablePrefixUnchanged = hasTokenPrefix(nextStableRaws, stableTokenRaws);
    const promoted = nextStableRaws.slice(stableTokenRaws.length);
    const oldTailPromoted = hasTokenPrefix(promoted, tailTokenRaws)
      && promoted.length >= tailTokenRaws.length;
    const tailRemainsMutable = promoted.length === 0;
    const trimToPending = !sourceAppended && fullSourceAppended
      && renderedMarkdownSource.startsWith(markdownSource)
      && markdownSource.length < renderedMarkdownSource.length
      && tailNodes.length > 0;
    const canReuse = trimToPending || (sourceAppended && stablePrefixUnchanged
      && (tailTokenRaws.length === 0 || oldTailPromoted || tailRemainsMutable));
    const renderStartedAt = getHarnessRecorder() ? performance.now() : 0;
    let incrementalMode = "append-tail";

    if (trimToPending) {
      incrementalMode = "append-pending-trim";
      const tailFragment = renderMarkdownTokens(parts.tail);
      tailNodes = reconcileRange(root, tailNodes, [...tailFragment.childNodes], pendingBoundary!);
    } else if (!canReuse) {
      incrementalMode = !sourceAppended
        ? "full-reset-source"
        : !stablePrefixUnchanged
          ? "full-reset-prefix"
          : "full-reset-tail";
      resetIncrementalRoot();
      const stableFragment = renderMarkdownTokens(parts.stable);
      const tailFragment = renderMarkdownTokens(parts.tail);
      moveBefore(stableBoundary!, [...stableFragment.childNodes]);
      tailNodes = [...tailFragment.childNodes];
      moveBefore(pendingBoundary!, tailNodes);
    } else {
      if (tailTokenRaws.length && oldTailPromoted) {
        incrementalMode = "append-promote";
        pendingBoundary!.before(stableBoundary!);
        tailNodes = [];
      }
      const promotedTailLength = oldTailPromoted ? tailTokenRaws.length : 0;
      const newStableTokens = parts.stable.slice(stableTokenRaws.length + promotedTailLength);
      moveBefore(stableBoundary!, [...renderMarkdownTokens(newStableTokens).childNodes]);
      const tailFragment = renderMarkdownTokens(parts.tail);
      tailNodes = reconcileRange(root, tailNodes, [...tailFragment.childNodes], pendingBoundary!);
    }

    stableTokenRaws = nextStableRaws;
    tailTokenRaws = nextTailRaws;
    renderedMarkdownSource = markdownSource;
    renderPending(pending);
    const recorder = getHarnessRecorder();
    if (recorder) {
      recordHarnessMetric(recorder, {
        stage: "markdown-reconcile",
        renderer: "marked",
        sourceCharacters: source.length,
        inline: false,
        reconcileMs: performance.now() - renderStartedAt,
        incrementalMode,
        markdownSourceCharacters: markdownSource.length,
        previousRenderedMarkdownSourceCharacters,
        renderedMarkdownSourceCharacters: renderedMarkdownSource.length,
        stableTokenCount: nextStableRaws.length,
        previousStableTokenCount: stableTokenRaws.length,
        tailTokenCount: nextTailRaws.length,
        previousTailTokenCount: tailTokenRaws.length,
        sourceAppended,
        firstSourceMismatchIndex,
        stablePrefixUnchanged,
      });
    }
  };

  createEffect(() => {
    const source = String(props.children || "");
    const version = Number(props.streamVersion || 0);
    if (source === renderedSource && version === renderedVersion) return;
    const split = splitStreamingMarkdown(source);
    if (renderedSource && !source.startsWith(renderedSource)) incrementalActive = false;
    if (props.inline) {
      const fragment = renderMarkdown(split.pending ? split.stable : source, true);
      if (split.pending) appendPendingMarkup(fragment, split.pending, Boolean(props.streaming));
      const recorder = getHarnessRecorder();
      const reconcileStartedAt = recorder ? performance.now() : 0;
      reconcileChildren(root, fragment);
      if (recorder) {
        recordHarnessMetric(recorder, {
          stage: "markdown-reconcile",
          renderer: "marked",
          sourceCharacters: source.length,
          inline: true,
          reconcileMs: performance.now() - reconcileStartedAt,
        });
      }
    } else if (incrementalActive || sourceContainsMath(source, split.pending)) {
      incrementalActive = true;
      renderIncremental(source, split);
    } else {
      if (incrementalActive) {
        discardIncrementalState();
        root.replaceChildren();
      }
      const fragment = renderMarkdown(split.pending ? split.stable : source, false);
      if (split.pending) appendPendingMarkup(fragment, split.pending, Boolean(props.streaming));
      const recorder = getHarnessRecorder();
      const reconcileStartedAt = recorder ? performance.now() : 0;
      reconcileChildren(root, fragment);
      if (recorder) {
        recordHarnessMetric(recorder, {
          stage: "markdown-reconcile",
          renderer: "marked",
          sourceCharacters: source.length,
          inline: false,
          reconcileMs: performance.now() - reconcileStartedAt,
          incrementalMode: "legacy-full-reconcile",
        });
      }
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
const MarkedStableMarkdown = lazy(() => import("./marked-stable").then((module) => ({ default: module.MarkedStableMarkdown })));

export function ChatMarkdown(props: ChatMarkdownProps) {
  const renderer = () => props.renderer || selectedMarkdownRenderer();
  const incremark = () => renderer() !== "marked";
  const typewriter = () => renderer() === "incremark-typewriter";
  const syntheticMath = () => renderer() === "incremark-synthetic";
  return <Show when={renderer() === "marked-stable"} fallback={<Show when={incremark()} fallback={<MarkedMarkdown {...props} />}>
    <Suspense fallback={<div class="markdown-skeleton" />}>
      <IncremarkMarkdown {...props} typewriter={typewriter()} syntheticMath={syntheticMath()} />
    </Suspense>
  </Show>}>
    <Suspense fallback={<div class="markdown-skeleton" />}>
      <MarkedStableMarkdown {...props} />
    </Suspense>
  </Show>;
}
