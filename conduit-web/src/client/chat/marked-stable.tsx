import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import katex from "katex";
import "katex/dist/katex.min.css";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";
import { ExternalLinkDialog } from "./external-link-dialog";
import { escapeHtml, renderMarkdownLink, sanitizeMarkdownFragment } from "./markdown-security";

// This instance is isolated from the current Marked Experimental extensions.
// It intentionally keeps the old reference path: GFM, marked-katex, and the
// application security renderer only. It does not hide pending constructs or
// add a streaming projection.
const markedStable = new Marked();
markedStable.use(markedKatex({ nonStandard: true, throwOnError: false }));
markedStable.use({
  gfm: true,
  breaks: false,
  renderer: {
    strong({ tokens }) {
      return `<strong data-markdown="strong">${this.parser.parseInline(tokens)}</strong>`;
    },
    image() { return ""; },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      return renderMarkdownLink({
        href,
        title,
        label,
        labelText: String(tokens.map((token) => "text" in token ? token.text : "").join("")),
      });
    },
    code({ text, lang }) {
      const language = String(lang || "text").split(/\s+/)[0]!.toLowerCase();
      return `<div class="artifact" data-language="${escapeHtml(language)}"><div class="artifact-header"><span>${escapeHtml(language)}</span><button type="button" aria-label="Copy code" data-copy-code>Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`;
    },
  },
});

type MarkedStableProps = {
  children?: string;
  streaming?: boolean;
  streamVersion?: number;
  inline?: boolean;
  onRendered?: () => void;
};

function renderMarkdown(source: string, inline = false) {
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
    html = (inline ? markedStable.parseInline(source, { async: false }) : markedStable.parse(source, { async: false })) as string;
  } finally {
    restoreKatex?.();
  }
  const parsedAt = recorder ? performance.now() : 0;
  const fragment = sanitizeMarkdownFragment(html, { inline });
  if (recorder) {
    const sanitisedAt = performance.now();
    recordHarnessMetric(recorder, {
      stage: "markdown-render",
      renderer: "marked-stable",
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
const managedAttributes = new Set(["class", "href", "title", "type", "aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown"]);

function reconcileNode(current: Node, next: Node) {
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  const currentElement = current as Element;
  const nextElement = next as Element;
  for (const attribute of [...currentElement.attributes]) {
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

export function MarkedStableMarkdown(props: MarkedStableProps) {
  let root!: HTMLDivElement;
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);
  let externalReturnFocus: HTMLElement | null = null;
  let renderedSource = "";
  let renderedVersion = -1;

  createEffect(() => {
    const source = String(props.children || "");
    const version = Number(props.streamVersion || 0);
    if (source === renderedSource && version === renderedVersion) return;
    const fragment = renderMarkdown(source, props.inline);
    const recorder = getHarnessRecorder();
    const reconcileStartedAt = recorder ? performance.now() : 0;
    reconcileChildren(root, fragment);
    if (recorder) {
      recordHarnessMetric(recorder, {
        stage: "markdown-reconcile",
        renderer: "marked-stable",
        sourceCharacters: source.length,
        inline: Boolean(props.inline),
        reconcileMs: performance.now() - reconcileStartedAt,
      });
    }
    renderedSource = source;
    renderedVersion = version;
    queueMicrotask(() => props.onRendered?.());
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
    <div ref={root} class="chat-markdown" data-renderer="marked-stable" data-streaming={props.streaming || undefined} />
    <ExternalLinkDialog url={externalUrl} onClose={() => setExternalUrl(null)} returnFocus={() => externalReturnFocus} onFocusRestored={() => { externalReturnFocus = null; }} />
  </>;
}
