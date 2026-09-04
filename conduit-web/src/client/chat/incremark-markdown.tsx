import { createEffect, createMemo, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createIncremarkParser, type DisplayBlock, type ParsedBlock } from "@incremark/core";
import katex from "katex";
import { getHarnessRecorder, recordHarnessMetric } from "@/client/harness-metrics";
import type { ChatMarkdownProps } from "./markdown";
import { ExternalLinkDialog } from "./external-link-dialog";
import { copyWithFeedback, createExternalLinkController } from "./markdown-actions";
import { codeBlockCollapseLabel, codeBlockState, countCodeLines, normalizeCodeLanguage, publishCodeBlockToggle } from "./code-block";
import { useCodeBlockCollapse } from "./transcript-appearance";
import { highlighterReady, StreamingCodeHighlighter } from "./code-highlight";
import { createSyntheticMathPreviewNode, repairSyntheticMathSource } from "./incremark-synthetic-math";
import { conduitMathPlugin } from "./incremark-math-extension";
import { BufferedIncremarkTypewriter, visibleAstCharacters } from "./incremark-typewriter";
import { MathRenderQueue, type MathRenderPolicy } from "./incremark-math-queue";
import { citationHost, resolveMarkdownUrl } from "./markdown-security";
import { projectTableMathSource, promoteTableCellDisplayMath, restoreTableMathAst, restoreTableMathSentinel } from "./table-math";
import type { StreamingPending } from "./streaming-markdown";
import { splitStreamingMarkdown } from "./streaming-markdown";
import "./incremark-markdown.css";

type MarkdownNode = any;
type Definition = { url?: string; title?: string | null };
/** Quiet frames a message must hold before its source is frozen. */
const SETTLE_DELAY_FRAMES = 2;

const incremarkParserOptions = { gfm: true, plugins: [conduitMathPlugin({ tex: true })], htmlTree: true, containers: true };
type RendererContext = {
  definitions: () => Record<string, Definition>;
  inline: boolean;
  requestExternalLink: (url: string, trigger?: HTMLElement) => void;
  deferMath: () => boolean;
  mathRenderPolicy: () => MathRenderPolicy;
  rendererId: () => string;
  onMathBusyChange: (busy: boolean) => void;
  onPendingPlaceholderChange: (delta: number) => void;
};

function restoreParsedBlock(block: ParsedBlock, sentinel: string | null, originalSource: string) {
  const restoredNode = promoteTableCellDisplayMath(restoreTableMathAst(block.node, sentinel));
  const parsedRawText = typeof (block as ParsedBlock & { rawText?: string }).rawText === "string"
    ? restoreTableMathSentinel((block as ParsedBlock & { rawText?: string }).rawText!, sentinel)
    : (block as ParsedBlock & { rawText?: string }).rawText;
  const sourceRawText = originalSource.slice(block.startOffset, block.endOffset);
  const restoredRawText = sourceRawText.length === parsedRawText?.length ? sourceRawText : parsedRawText;
  const stableId = "conduit-block-" + block.startOffset;
  if (restoredNode === block.node
    && restoredRawText === (block as ParsedBlock & { rawText?: string }).rawText
    && block.id === stableId) return block;
  return {
    ...block,
    id: stableId,
    node: restoredNode,
    rawText: restoredRawText,
  } as ParsedBlock;
}

function sameDefinitions(previous: Record<string, Definition>, next: Record<string, Definition>) {
  const previousKeys = Object.keys(previous);
  if (previousKeys.length !== Object.keys(next).length) return false;
  return previousKeys.every((key) => {
    const left = previous[key];
    const right = next[key];
    return Boolean(left) && Boolean(right) && left!.url === right!.url && left!.title === right!.title;
  });
}

function safeUrl(value: unknown): { href: string; external: boolean } | null {
  return resolveMarkdownUrl(value);
}

function inlineText(nodes: MarkdownNode[]) {
  let text = "";
  for (const node of nodes) {
    if (node.value) {
      text += node.value;
      continue;
    }
    if (!Array.isArray(node.children)) continue;
    for (const child of node.children) text += child.value || "";
  }
  return text;
}

function summarizeTableAst(blocks: ParsedBlock[]) {
  const tables: Array<{ blockId: string; rows: number; cells: number; rowCells: number[] }> = [];
  const visit = (node: MarkdownNode, blockId: string) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "table") {
      const rows = Array.isArray(node.children) ? node.children : [];
      const rowCells = rows.map((row: MarkdownNode) => Array.isArray(row?.children) ? row.children.length : 0);
      tables.push({ blockId, rows: rows.length, cells: rowCells.reduce((total: number, count: number) => total + count, 0), rowCells });
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child, blockId);
  };
  for (const block of blocks) visit(block.node, block.id);
  return {
    tableCount: tables.length,
    rowCount: tables.reduce((total, table) => total + table.rows, 0),
    cellCount: tables.reduce((total, table) => total + table.cells, 0),
    tables,
  };
}

const sameBlockList = (previous: ParsedBlock[], next: ParsedBlock[]) =>
  previous.length === next.length && previous.every((block, index) => block === next[index]);

type NodeAccessor = () => MarkdownNode;
type NodeList = MarkdownNode[] | (() => MarkdownNode[]);

function readNode(value: MarkdownNode | NodeAccessor) {
  return typeof value === "function" ? value() : value;
}

function readNodes(value: NodeList) {
  return typeof value === "function" ? value() : value;
}

function InlineNodes(props: { nodes: NodeList; context: RendererContext }) {
  return <Index each={readNodes(props.nodes)}>{(node) => <AstNode node={node} context={props.context} />}</Index>;
}

function BlockNodes(props: { nodes: NodeList; context: RendererContext }) {
  return <Index each={readNodes(props.nodes)}>{(node) => <AstNode node={node} context={props.context} />}</Index>;
}

const PENDING_INLINE_MATH_NODE = "conduitPendingInlineMath";
const pendingInlineNodeCache = new WeakMap<object, MarkdownNode>();

function appendPendingInlineMath(node: MarkdownNode): MarkdownNode {
  if (!node || typeof node !== "object" || !Array.isArray(node.children)) return node;
  if (["paragraph", "heading", "tableCell"].includes(node.type)) {
    return {
      ...node,
      children: [...node.children, { type: PENDING_INLINE_MATH_NODE }],
    };
  }
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    const next = appendPendingInlineMath(child);
    if (next !== child) {
      const children = [...node.children];
      children[index] = next;
      return { ...node, children };
    }
  }
  return node;
}

function renderBlockNode(node: MarkdownNode) {
  if (!node || typeof node !== "object") return node;
  const cached = pendingInlineNodeCache.get(node);
  if (cached) return cached;
  const next = appendPendingInlineMath(node);
  pendingInlineNodeCache.set(node, next);
  return next;
}

const sameIdList = (previous: string[], next: string[]) =>
  previous.length === next.length && previous.every((id, index) => id === next[index]);

/**
 * Index a keyed block list once per update.
 *
 * These lists are re-read for every row on every streamed frame, so a linear
 * scan per row made each frame quadratic in the number of blocks on screen. The
 * id list keeps value equality, so an update that only changes a block's
 * contents does not re-run the keyed list reconciliation as well.
 */
function createBlockIndex<T extends { id: string }>(blocks: () => T[]) {
  const index = createMemo(() => {
    const map = new Map<string, T>();
    for (const block of blocks()) map.set(block.id, block);
    return map;
  });
  const ids = createMemo(() => [...index().keys()], [], { equals: sameIdList });
  return { ids, lookup: (id: string) => index().get(id) };
}

function ParsedBlockNodes(props: { blocks: () => ParsedBlock[]; context: RendererContext }) {
  const list = createBlockIndex(() => props.blocks());
  return <For each={list.ids()}>{(id) => {
    const block = () => list.lookup(id);
    // Seeded blocks are complete by definition -- a persisted message, or the
    // finished prefix of a live one -- so no caret placeholder belongs here.
    // Adding one left three permanent markers in every restored message, and
    // the settled-message check looks for exactly that marker, so a transcript
    // loaded from history could never settle.
    const node = createMemo(() => block()?.node);
    return <Show when={block()}><AstNode node={node} context={props.context} /></Show>;
  }}</For>;
}

function preserveAppendOnlyNode(
  previous: MarkdownNode | undefined,
  current: MarkdownNode | undefined,
  preferCurrentTail = false,
): MarkdownNode | undefined {
  if (!previous) return current;
  if (!current) return preferCurrentTail ? undefined : previous;
  if (previous.type !== current.type) return current;
  if (typeof previous.value === "string" && typeof current.value === "string") {
    if (preferCurrentTail) return current;
    if (current.value.startsWith(previous.value) || previous.value.startsWith(current.value)) {
      return current.value.length >= previous.value.length ? current : previous;
    }
    return current;
  }
  if (!Array.isArray(previous.children) || !Array.isArray(current.children)) return current;
  const childCount = Math.max(previous.children.length, current.children.length);
  const children = Array.from({ length: childCount }, (_, index) => {
    const currentChild = current.children[index];
    const isMissingCurrentTail = preferCurrentTail && index >= current.children.length;
    return preserveAppendOnlyNode(
      previous.children[index],
      currentChild,
      preferCurrentTail && (index === childCount - 1 || isMissingCurrentTail),
    );
  }).filter((child): child is MarkdownNode => Boolean(child));
  return { ...current, children };
}

function preserveAppendOnlyTable(previous: MarkdownNode | undefined, current: MarkdownNode | undefined) {
  if (!current || current.type !== "table" || previous?.type !== "table") return current;
  return preserveAppendOnlyNode(previous, current);
}

function DisplayBlockNodes(props: { blocks: () => DisplayBlock[]; context: RendererContext; history: Map<string, MarkdownNode> }) {
  const structuralType = (block: DisplayBlock) => {
    const sourceNode = block.node as MarkdownNode;
    if (sourceNode?.type === "paragraph" && /^ {0,3}\|/.test(String((block as DisplayBlock & { rawText?: string }).rawText || ""))) return "table";
    return sourceNode?.type;
  };
  const displayNode = (block: DisplayBlock) => {
    const sourceNode = block.node as MarkdownNode;
    let currentNode = block.displayNode as MarkdownNode;
    if (sourceNode && currentNode && typeof sourceNode === "object" && typeof currentNode === "object") {
      currentNode = { ...currentNode };
      for (const key in sourceNode) {
        const value = sourceNode[key];
        if (key !== "children" && currentNode[key] == null && value != null) currentNode[key] = value;
      }
    }
    const type = structuralType(block);
    if (type && currentNode?.type !== type) {
      currentNode = { ...currentNode, type };
    }
    const previousNode = props.history.get(block.id);
    const stableNode = type === "table" ? preserveAppendOnlyTable(previousNode, currentNode) : currentNode;
    props.history.set(block.id, stableNode);
    return stableNode;
  };
  // Keep completed blocks and the one active transformer block in one keyed
  // list. Moving the active block between separate Solid branches would
  // remove and recreate its DOM when it completes.
  const list = createBlockIndex(() => props.blocks());
  return <For each={list.ids()}>{(id) => {
    const block = () => list.lookup(id);
    // displayNode rebuilds the node and appendPendingInlineMath clones its
    // spine. Without the memo the accessor recomputes both for every JSX
    // position that reads it, and the clone cache -- keyed on node identity --
    // never hits, so every frame re-clones every visible block. The memo makes
    // both run once per update; preserveAppendOnly is idempotent, so the node
    // the history ends up holding is the same either way.
    const node = createMemo(() => {
      const current = block();
      if (!current) return undefined;
      const display = displayNode(current);
      // The placeholder reserves the line box for math that is about to appear
      // at the caret, so it belongs only to a block still being typed. Left on
      // finished blocks it was a permanent zero-width span in every paragraph,
      // and the settled-message check -- which looks for exactly this marker --
      // could therefore never pass.
      return current.isDisplayComplete ? display : renderBlockNode(display);
    });
    return <Show when={block()}><AstNode node={node} context={props.context} /></Show>;
  }}</For>;
}

function LinkNode(props: { node: MarkdownNode | NodeAccessor; context: RendererContext; reference?: () => Definition | undefined }) {
  const node = () => readNode(props.node);
  const reference = () => props.reference?.();
  const target = createMemo(() => safeUrl(reference()?.url || node()?.url));
  // The citation test walks the link's inline children. It is read from four
  // attribute positions below, so it is computed once rather than per read.
  const labelText = createMemo(() => inlineText(node()?.children || []));
  // Same rule as the string renderers: a link whose visible text is its own URL
  // is a citation and shows its host; anything the model gave a real label to
  // renders untouched. Keeping the test in one shared helper is what stops the
  // renderers drifting apart on it.
  const host = createMemo(() => {
    const resolved = target();
    return resolved ? citationHost(resolved.href, labelText()) : null;
  });
  const label = () => reference() === undefined && node()?.type === "linkReference"
    ? `[${labelText()}][${node()?.identifier || node()?.label || ""}]`
    : <InlineNodes nodes={() => node()?.children || []} context={props.context} />;
  const content = () => host() ?? label();
  return <Show when={target()} fallback={label()}>
    {(resolved) => <Show when={!props.context.inline} fallback={label()}>
      <Show when={resolved().external} fallback={<a href={resolved().href} data-citation={host() ? "true" : undefined} title={host() ? resolved().href : (reference()?.title || node()?.title || undefined)}>{content()}</a>}>
        <button
          type="button"
          class="external-markdown-link"
          data-citation={host() ? "true" : undefined}
          title={host() ? resolved().href : undefined}
          data-external-url={resolved().href}
          aria-label={labelText() || resolved().href}
          onClick={(event) => props.context.requestExternalLink(resolved().href, event.currentTarget as HTMLElement)}
        >{content()}</button>
      </Show>
    </Show>}
  </Show>;
}

const MATH_HTML_CACHE_LIMIT = 512;
const mathHtmlCache = new Map<string, string>();
const mathRenderQueue = new MathRenderQueue({
  onMetrics: (metrics) => {
    const recorder = getHarnessRecorder();
    if (!recorder) return;
    recordHarnessMetric(recorder, {
      stage: "markdown-math-queue",
      renderer: "incremark-math",
      queuePolicy: metrics.policy,
      queueEvent: metrics.event,
      queueDepth: metrics.queueDepth,
      oldestJobAgeMs: metrics.oldestJobAgeMs,
      processedJobs: metrics.processedJobs,
      cancelledJobs: metrics.cancelledJobs,
      frameBudgetMs: metrics.frameBudgetMs,
    });
  },
});

function mathCacheKey(node: MarkdownNode, source: string) {
  return `${node?.type === "math" ? "display" : "inline"}\u0000${source}`;
}

function getCachedMathHtml(node: MarkdownNode, source: string) {
  return mathHtmlCache.get(mathCacheKey(node, source));
}

/**
 * Store a formula, never a partial.
 *
 * Every streamed delta produces a different candidate string, so a live
 * formula writes one dead entry per delta -- thirty or more for one equation
 * -- and none of them is ever read again. Left uncapped by policy they evicted
 * the finished formulas that re-render on remount, scrollback and settle, so
 * the cache had a hit rate near zero exactly where it was supposed to pay.
 * Writes are therefore gated on the message being complete.
 */
function cacheMathHtml(node: MarkdownNode, source: string, html: string) {
  const key = mathCacheKey(node, source);
  if (!mathHtmlCache.has(key) && mathHtmlCache.size >= MATH_HTML_CACHE_LIMIT) {
    const oldest = mathHtmlCache.keys().next().value;
    if (oldest) mathHtmlCache.delete(oldest);
  }
  mathHtmlCache.delete(key);
  mathHtmlCache.set(key, html);
}

function scheduleMathRender(run: () => void, policy: MathRenderPolicy) {
  return mathRenderQueue.enqueue(run, policy);
}

function MathNode(props: { node: MarkdownNode | NodeAccessor; defer?: () => boolean; policy?: () => MathRenderPolicy; renderer?: () => string; onBusyChange?: (busy: boolean) => void }) {
  const node = () => readNode(props.node);
  const [html, setHtml] = createSignal("");
  const [type, setType] = createSignal<string | undefined>();
  const [previewMinHeight, setPreviewMinHeight] = createSignal(0);
  let wrapper: HTMLSpanElement | undefined;
  let cancelJob: (() => void) | null = null;
  let busy = false;
  let renderVersion = 0;
  let lastValidHtml = "";
  // A settled message never streams another partial, so its formulas are the
  // only candidates worth keeping in the shared cache.
  const complete = () => (props.policy?.() || "stream") === "reattach";
  const setBusy = (next: boolean) => {
    if (next === busy) return;
    busy = next;
    props.onBusyChange?.(next);
  };
  const samplePreviewHeight = (current: MarkdownNode) => {
    if (current?.type !== "math") return;
    queueMicrotask(() => {
      const height = wrapper?.getBoundingClientRect().height || 0;
      if (height > previewMinHeight()) setPreviewMinHeight(height);
    });
  };
  const renderCurrent = (current: MarkdownNode, source: string, version: number) => {
    if (version !== renderVersion) return;
    const candidate = repairSyntheticMathSource(source);
    const cached = getCachedMathHtml(current, candidate);
    if (cached !== undefined) {
      lastValidHtml = cached;
      setHtml(cached);
      setBusy(false);
      samplePreviewHeight(current);
      return;
    }
    let renderedHtml: string | null = null;
    let valid = false;
    const recorder = getHarnessRecorder();
    const startedAt = recorder ? performance.now() : 0;
    try {
      renderedHtml = katex.renderToString(candidate, {
        displayMode: current?.type === "math",
        throwOnError: true,
      });
      if (renderedHtml.includes("katex-error")) renderedHtml = null;
      else valid = true;
    } catch {
      renderedHtml = null;
    }
    if (renderedHtml == null) {
      // A first invalid partial must not reserve a larger fallback box than
      // the valid preview that follows it. Keep the stable wrapper mounted,
      // but let the cell grow when KaTeX first accepts the candidate.
      renderedHtml = lastValidHtml;
    }
    if (recorder) {
      recordHarnessMetric(recorder, {
        stage: "markdown-katex",
        renderer: props.renderer?.() || "incremark",
        katexMs: performance.now() - startedAt,
        katexCallCount: 1,
        katexSourceCharacters: candidate.length,
        katexHtmlCharacters: renderedHtml.length,
      });
    }
    if (valid) {
      lastValidHtml = renderedHtml;
      if (complete()) cacheMathHtml(current, candidate, renderedHtml);
    }
    if (renderedHtml !== html()) setHtml(renderedHtml);
    samplePreviewHeight(current);
    setBusy(false);
  };
  const initial = node();
  const initialSource = String(initial?.__conduitMathSource ?? initial?.value ?? "");
  if (initial && initialSource && !(props.defer?.() && initial.type === "math")) {
    renderVersion = 1;
    setType(initial.type);
    renderCurrent(initial, initialSource, renderVersion);
  }
  createEffect(() => {
    const current = node();
    const source = String(current?.__conduitMathSource ?? current?.value ?? "");
    setType(current?.type);
    renderVersion += 1;
    const version = renderVersion;
    cancelJob?.();
    cancelJob = null;
    setBusy(false);
    if (!current || !source) {
      setHtml("");
      lastValidHtml = "";
      setPreviewMinHeight(0);
      return;
    }
    const cached = getCachedMathHtml(current, repairSyntheticMathSource(source));
    if (cached !== undefined) {
      lastValidHtml = cached;
      setHtml(cached);
      return;
    }
    // Inline math changes line width. Render it in the same effect as the
    // atomic display update so a later rAF cannot clear the span and reflow
    // the transcript. Display equations remain queued to protect the frame
    // budget when a response contains many large formulas.
    if (props.defer?.() && current?.type === "math") {
      // Keep the last valid formula in place while the replacement render is
      // queued. Clearing the span here makes every streamed partial flash
      // blank before KaTeX completes, which is most visible on mobile.
      setBusy(true);
      cancelJob = scheduleMathRender(() => renderCurrent(current, source, version), props.policy?.() || "stream");
      return;
    }
    renderCurrent(current, source, version);
  });
  onCleanup(() => {
    cancelJob?.();
    setBusy(false);
  });
  return <span ref={wrapper} class={type() === "math" ? "incremark-math-block" : "incremark-math-inline"} style={{ "min-height": type() === "math" && previewMinHeight() > 0 ? `${previewMinHeight()}px` : undefined }} innerHTML={html()} />;
}

function CodeNode(props: { node: MarkdownNode | NodeAccessor }) {
  const node = () => readNode(props.node);
  const language = () => normalizeCodeLanguage(node()?.lang);
  const text = () => String(node()?.value || "");
  // Expanding by hand is a decision about this block, so it outlives later
  // preference changes and any re-evaluation of the collapse default.
  const [userExpanded, setUserExpanded] = createSignal(false);
  const collapse = useCodeBlockCollapse();
  const state = createMemo(() => codeBlockState(text(), collapse.mode(), collapse.threshold(), false));
  const collapsed = () => state().collapsed && !userExpanded();
  const highlighter = new StreamingCodeHighlighter();
  const highlighted = createMemo(() => {
    highlighterReady();
    return highlighter.render(text(), language(), false);
  });
  // Folding removes a lot of height at once. Tell the transcript so it can hold
  // this card still and re-measure, instead of leaving stale placeholders.
  const toggle = (control: HTMLElement) => {
    const card = control.closest<HTMLElement>(".artifact");
    const previousTop = card?.getBoundingClientRect().top ?? 0;
    setUserExpanded((value) => !value);
    if (card) queueMicrotask(() => publishCodeBlockToggle(card, previousTop));
  };
  return <div
    class="artifact"
    data-language={language()}
    data-lines={state().lines}
    data-collapsible={state().collapsible ? "true" : undefined}
    data-collapsed={collapsed() ? "true" : undefined}
    data-user-expanded={userExpanded() ? "true" : undefined}
  >
    <div class="artifact-header">
      <span>{language()}</span>
      <span class="artifact-actions">
        <CodeCopyButton text={text} />
        <Show when={state().collapsible}>
          {/* Pinned with the header, so it stays reachable part-way down a
              block the footer button has long since scrolled past. */}
          <button
            type="button"
            class="artifact-toggle"
            data-expand-code
            aria-label={collapsed() ? "Expand code" : "Collapse code"}
            aria-expanded={collapsed() ? "false" : "true"}
            onClick={(event) => toggle(event.currentTarget)}
          />
        </Show>
      </span>
    </div>
    {/* innerHTML rather than a post-hoc DOM rewrite: the renderer keeps
        ownership of the node, so a later render cannot wipe the highlighting. */}
    <pre><code innerHTML={highlighted()} /></pre>
    <Show when={state().collapsible}>
      <button type="button" class="artifact-expand" data-expand-code data-expand-label onClick={(event) => toggle(event.currentTarget)}>
        {collapsed() ? state().expandLabel : codeBlockCollapseLabel()}
      </button>
    </Show>
  </div>;
}

/**
 * Copy control shared by the settled and streaming code cards.
 *
 * The confirmation is left entirely to copyWithFeedback, which drives it
 * through attributes. Mirroring it in a signal here would have two owners
 * writing the same label, and the marked renderers -- which have no component
 * to hold that signal -- would still need the attribute path anyway.
 */
function CodeCopyButton(props: { text: () => string }) {
  let button!: HTMLButtonElement;
  return <button
    ref={button}
    type="button"
    class="artifact-copy"
    aria-label="Copy code"
    data-copy-code
    onClick={() => void copyWithFeedback(props.text(), button)}
  ><span class="artifact-copy-label">Copy</span></button>;
}

function PendingConstruct(props: { pending: StreamingPending; streaming: boolean }) {
  const pending = () => props.pending;
  if (pending().kind === "fence") {
    const language = () => normalizeCodeLanguage(pending().language);
    // Whole lines colour as they complete; the line still being written stays
    // plain so its colours do not change under the reader.
    const highlighter = new StreamingCodeHighlighter();
    const highlighted = createMemo(() => {
      highlighterReady();
      return highlighter.render(pending().body, language(), props.streaming);
    });
    // A growing fence folds on the same rule as a settled one, and at the same
    // moment it crosses the threshold -- waiting for the closing fence let a
    // ten-line limit run to fifty before it took effect. Folded, the card is
    // the only thing still moving on a transcript that has stopped scrolling,
    // so the expand label counts the hidden lines as they arrive.
    const collapse = useCodeBlockCollapse();
    const [userExpanded, setUserExpanded] = createSignal(false);
    const state = createMemo(() => codeBlockState(pending().body, collapse.mode(), collapse.threshold(), false));
    const collapsed = () => state().collapsed && !userExpanded();
    const toggle = (control: HTMLElement) => {
      const card = control.closest<HTMLElement>(".artifact");
      const previousTop = card?.getBoundingClientRect().top ?? 0;
      setUserExpanded((value) => !value);
      if (card) queueMicrotask(() => publishCodeBlockToggle(card, previousTop));
    };
    return <div
      class={props.streaming ? "artifact streaming-pending streaming-pending-fence" : "artifact"}
      data-language={language()}
      data-streaming-pending={props.streaming ? "fence" : undefined}
      data-lines={state().lines}
      data-collapsible={state().collapsible ? "true" : undefined}
      data-collapsed={collapsed() ? "true" : undefined}
    >
      <div class="artifact-header">
        <span>{language()}</span>
        <span class="artifact-actions">
          <CodeCopyButton text={() => pending().body} />
          <Show when={state().collapsible}>
            <button
              type="button"
              class="artifact-toggle"
              aria-label={collapsed() ? "Expand code" : "Collapse code"}
              aria-expanded={collapsed() ? "false" : "true"}
              onClick={(event) => toggle(event.currentTarget)}
            />
          </Show>
        </span>
      </div>
      <pre><code innerHTML={highlighted()} /></pre>
      <Show when={state().collapsible}>
        <button type="button" class="artifact-expand" onClick={(event) => toggle(event.currentTarget)}>
          {collapsed() ? state().expandLabel : codeBlockCollapseLabel()}
        </button>
      </Show>
    </div>;
  }
  const className = () => `streaming-pending ${pending().kind === "math-block" ? "streaming-pending-math-block" : "streaming-pending-math-inline"}`;
  return pending().kind === "math-block"
    ? <div class={className()} data-streaming-pending={props.streaming ? pending().kind : undefined} aria-hidden="true" />
    : <span class={className()} data-streaming-pending={props.streaming ? pending().kind : undefined} aria-hidden="true" />;
}

/**
 * Register while mounted so settlement can see this without reading the DOM.
 *
 * Everything else that holds a message open -- an unfinished stream, an
 * in-flight display frame, a queued KaTeX render -- is already a signal. This
 * placeholder was the one exception, and polling for it is why settlement used
 * to need a MutationObserver over the whole subtree.
 */
function PendingInlineMathPlaceholder(props: { context: RendererContext }) {
  onMount(() => {
    props.context.onPendingPlaceholderChange(1);
    onCleanup(() => props.context.onPendingPlaceholderChange(-1));
  });
  return <span
    class="streaming-pending streaming-pending-math-inline"
    data-streaming-pending="math-inline"
    aria-hidden="true"
  />;
}

function TableNode(props: { node: MarkdownNode | NodeAccessor; context: RendererContext }) {
  const node = () => readNode(props.node);
  const head = () => node()?.children?.[0];
  const body = () => node()?.children?.slice(1) || [];
  return <table>
    <Show when={head()}>{(value) => <thead><TableRow node={() => value()} context={props.context} header /></thead>}</Show>
    {/* Streaming Markdown appends rows but replaces AST row objects on every update.
        Index keeps each logical row and its cells mounted while the active row grows. */}
    <tbody><Index each={body()}>{(row) => <TableRow node={row} context={props.context} />}</Index></tbody>
  </table>;
}

function TableRow(props: { node: MarkdownNode | NodeAccessor; context: RendererContext; header?: boolean }) {
  const node = () => readNode(props.node);
  return <tr><Index each={node()?.children || []}>{(cell) => props.header
    ? <th><InlineNodes nodes={() => cell()?.children || []} context={props.context} /></th>
    : <td><InlineNodes nodes={() => cell()?.children || []} context={props.context} /></td>}
  </Index></tr>;
}

function syntheticMathClosingDelimiter(source: string, pending: StreamingPending) {
  if (pending.kind === "math-inline") return source.startsWith("\\(", pending.start) ? "\\)" : "$";
  return source.startsWith("\\[", pending.start) ? "\n\\]" : "\n$$";
}

function containsMath(node: MarkdownNode): boolean {
  if (!node || typeof node !== "object") return false;
  if (node.type === "inlineMath" || node.type === "math") return true;
  return Array.isArray(node.children) && node.children.some((child: MarkdownNode) => containsMath(child));
}

function TextNode(props: { node: NodeAccessor }) {
  return <>{props.node()?.value || ""}</>;
}

function AstNode(props: { node: MarkdownNode | NodeAccessor; context: RendererContext }) {
  const node = () => readNode(props.node);
  return <Show when={node()?.type} keyed fallback={null}>
    {(_type) => <AstNodeContent node={node} context={props.context} />}
  </Show>;
}

function AstNodeContent(props: { node: NodeAccessor; context: RendererContext }) {
  const node = props.node;
  switch (node().type) {
    case "text": return <TextNode node={node} />;
    case "strong": return <strong data-markdown="strong"><InlineNodes nodes={() => node()?.children || []} context={props.context} /></strong>;
    case "emphasis": return <em><InlineNodes nodes={() => node()?.children || []} context={props.context} /></em>;
    case "delete": return <del><InlineNodes nodes={() => node()?.children || []} context={props.context} /></del>;
    case "inlineCode": return <code>{node()?.value || ""}</code>;
    case "inlineMath":
    case "math": return <MathNode node={node} defer={props.context.deferMath} policy={props.context.mathRenderPolicy} renderer={props.context.rendererId} onBusyChange={props.context.onMathBusyChange} />;
    case PENDING_INLINE_MATH_NODE: return <PendingInlineMathPlaceholder context={props.context} />;
    case "break": return <br />;
    case "link": return <LinkNode node={node} context={props.context} />;
    case "linkReference": return <LinkNode node={node} context={props.context} reference={() => props.context.definitions()[node()?.identifier]} />;
    case "image":
    case "imageReference": return null;
    case "heading": {
      const children = <InlineNodes nodes={() => node()?.children || []} context={props.context} />;
      if (node()?.depth === 1) return <h1>{children}</h1>;
      if (node()?.depth === 2) return <h2>{children}</h2>;
      if (node()?.depth === 3) return <h3>{children}</h3>;
      if (node()?.depth === 4) return <h4>{children}</h4>;
      if (node()?.depth === 5) return <h5>{children}</h5>;
      return <h6>{children}</h6>;
    }
    case "paragraph": return <p><InlineNodes nodes={() => node()?.children || []} context={props.context} /></p>;
    case "list": {
      const children = <Index each={node()?.children || []}>{(item) => <AstNode node={item} context={props.context} />}</Index>;
      return node()?.ordered ? <ol start={node()?.start || undefined}>{children}</ol> : <ul>{children}</ul>;
    }
    case "listItem": return <li>{node()?.checked !== null && <input type="checkbox" checked={Boolean(node()?.checked)} disabled />}{<BlockNodes nodes={() => node()?.children || []} context={props.context} />}</li>;
    case "blockquote": return <blockquote><BlockNodes nodes={() => node()?.children || []} context={props.context} /></blockquote>;
    case "code": return <CodeNode node={node} />;
    case "table": return <TableNode node={node} context={props.context} />;
    case "thematicBreak": return <hr />;
    case "html":
    case "htmlElement":
    case "definition": return null;
    case "root": return <BlockNodes nodes={() => node()?.children || []} context={props.context} />;
    default: return node().children ? <BlockNodes nodes={node().children} context={props.context} /> : null;
  }
}

/**
 * Local Incremark-core adapter. The published Solid package is not usable with
 * the repository's Solid runtime, so this spike exercises the incremental core
 * and keeps Conduit's security and interaction boundary in this adapter.
 */
export function IncremarkMarkdown(props: ChatMarkdownProps) {
  const parser = createIncremarkParser(incremarkParserOptions);
  const [seededBlocks, setSeededBlocks] = createSignal<ParsedBlock[]>([], { equals: sameBlockList });
  const [displayBlockStore, setDisplayBlockStore] = createStore<{ items: DisplayBlock[] }>({ items: [] });
  const [displayBusy, setDisplayBusy] = createSignal(false);
  const [pendingMathRenders, setPendingMathRenders] = createSignal(0);
  const [inlineAst, setInlineAst] = createSignal<MarkdownNode>({ type: "root", children: [] });
  const [pending, setPending] = createSignal<StreamingPending | null>(null);
  const [definitions, setDefinitions] = createSignal<Record<string, Definition>>({});
  const [pendingPlaceholders, setPendingPlaceholders] = createSignal(0);
  const [frozenSource, setFrozenSource] = createSignal<string | null>(null);
  const [settled, setSettled] = createSignal(false);
  const external = createExternalLinkController();
  const displayHistory = new Map<string, MarkdownNode>();
  const completedById = new Map<string, ParsedBlock>();
  const seededById = new Map<string, ParsedBlock>();
  let currentBlocks: ParsedBlock[] = [];
  let previousSource = "";
  let previousParserSource = "";
  let previousTableMathSentinel = "";
  let finalised = false;
  let previousTypewriter: boolean | null = null;
  // Block-by-block reveal is what this renderer is; only an inline preview,
  // which is a single line inside a summary, skips it.
  const typewriter = () => !props.inline;
  // Freezing is a message-level guarantee. A one-line preview inside a summary
  // has no settled state worth protecting, and giving it one would fight the
  // summary's own sizing.
  const freezes = () => !props.inline;
  // Both memos deliberately preserve value equality across settlement. When
  // frozenSource changes from null to the already-rendered final string, and
  // settled changes while streaming is already false, everything downstream
  // sees no value change and so takes no terminal render pulse. The memo also
  // drops its live props.children dependency once frozen, so later upstream
  // churn -- a checkpoint reload re-delivering the same text -- can no longer
  // reach a message that is already on screen.
  const source = createMemo(() => frozenSource() ?? String(props.children || ""));
  const streaming = createMemo(() => settled() ? false : Boolean(props.streaming));
  // Nothing is left in flight that could still change the layout.
  const quiet = () => !props.streaming
    && !displayBusy()
    && pendingMathRenders() === 0
    && pendingPlaceholders() === 0;
  let settleFrame: number | null = null;
  let settleFramesRemaining = 0;
  const cancelSettlement = () => {
    if (settleFrame != null) cancelAnimationFrame(settleFrame);
    settleFrame = null;
    settleFramesRemaining = 0;
  };
  const advanceSettlement = () => {
    settleFrame = null;
    if (settled() || !quiet()) {
      settleFramesRemaining = 0;
      return;
    }
    if (settleFramesRemaining > 1) {
      settleFramesRemaining -= 1;
      settleFrame = requestAnimationFrame(advanceSettlement);
      return;
    }
    // The mounted DOM is not cloned, serialised, replaced or reparsed. Only the
    // source branch becomes local.
    setFrozenSource(String(props.children || ""));
    setSettled(true);
  };
  createEffect(() => {
    if (!freezes() || settled()) return;
    if (!quiet()) {
      cancelSettlement();
      return;
    }
    if (settleFrame != null) return;
    settleFramesRemaining = SETTLE_DELAY_FRAMES;
    settleFrame = requestAnimationFrame(advanceSettlement);
  });
  onCleanup(cancelSettlement);
  const rendererId = () => "incremark";
  const displayBlocks = () => displayBlockStore.items;
  const setDisplayBlocks = (next: DisplayBlock[]) => {
    setDisplayBlockStore("items", reconcile(next, { key: "id", merge: true }));
  };
  const typewriterController = new BufferedIncremarkTypewriter({
    onChange: (next) => {
      setDisplayBlocks(next);
      queueMicrotask(() => props.onRendered?.());
    },
    onDisplayBusyChange: (busy) => {
      setDisplayBusy(busy);
    },
    onMetrics: (metrics) => {
      const recorder = getHarnessRecorder();
      if (!recorder) return;
      recordHarnessMetric(recorder, {
        stage: "markdown-typewriter",
        renderer: rendererId(),
        typewriter: true,
        scheduler: metrics.scheduler,
        sourceVisibleCharacters: metrics.sourceVisibleCharacters,
        displayedVisibleCharacters: metrics.displayedVisibleCharacters,
        backlogCharacters: metrics.backlogCharacters,
        backlogAgeMs: metrics.backlogAgeMs,
        pendingBlockCount: metrics.pendingBlockCount,
        completedBlockCount: metrics.completedBlockCount,
        charsPerFrame: metrics.charsPerFrame,
        frameIntervalMs: metrics.frameIntervalMs,
        frameBudgetMs: metrics.frameBudgetMs,
        frameWorkMs: metrics.frameWorkMs,
        frameWorkEmaMs: metrics.frameWorkEmaMs,
        terminal: metrics.terminal,
        nativeTransformer: typewriterController.getDebugState(),
      });
    },
  });
  onCleanup(() => typewriterController.destroy());

  const blockContainsOffset = (block: ParsedBlock, offset: number) => offset >= block.startOffset && offset <= block.endOffset;

  createEffect(() => {
    const source = frozenSource() ?? String(props.children || "");
    const tableMath = !props.inline;
    const split = splitStreamingMarkdown(source, { tableMath, allowUnclosedMath: streaming() });
    const projection = tableMath
      ? projectTableMathSource(source, {
        convertTexDisplayDelimiters: true,
        sentinel: previousTableMathSentinel || undefined,
      })
      : null;
    const parserSource = projection?.source || source;
    const normalizeBlock = (block: ParsedBlock) => projection ? restoreParsedBlock(block, projection.sentinel, source) : block;
    const recorder = getHarnessRecorder();
    const parseStartedAt = recorder ? performance.now() : 0;
    let parserMode = "none";
    let update: ReturnType<typeof parser.append> | undefined;
    const updates: Array<ReturnType<typeof parser.append>> = [];
    const preserveTypewriterState = typewriter()
      && previousTypewriter === true
      && source.startsWith(previousSource);
    if (source !== previousSource || (tableMath && parserSource !== previousParserSource)) {
      const canAppend = true
        && source.startsWith(previousSource)
        && parserSource.startsWith(previousParserSource)
        && (!projection || projection.sentinel === previousTableMathSentinel);
      if (canAppend) {
        parserMode = "append";
        update = parser.append(parserSource.slice(previousParserSource.length));
      } else {
        parserMode = "render";
        parser.reset();
        update = parser.append(parserSource);
        if (!preserveTypewriterState) {
          completedById.clear();
          seededById.clear();
          displayHistory.clear();
          setSeededBlocks([]);
          typewriterController.reset();
        }
      }
      updates.push(update);
      previousSource = source;
      previousParserSource = parserSource;
      previousTableMathSentinel = projection?.sentinel || "";
      finalised = false;
    }
    if (!streaming() && !finalised && !split.pending) {
      parserMode = parserMode === "none" ? "finalize" : `${parserMode}+finalize`;
      update = parser.finalize();
      updates.push(update);
      finalised = true;
    }
    const parsedAt = recorder ? performance.now() : 0;
    const latestUpdate = updates.at(-1);
    const pendingUpdateBlocks = new Map<string, ParsedBlock>();
    let pendingOffset: number | null = null;
    for (const entry of updates) {
      for (const block of entry.pending) {
        const normalized = normalizeBlock(block);
        pendingUpdateBlocks.set(normalized.id, normalized);
      }
    }
    const pendingPrefixBlock = (() => {
      if (!split.pending || props.inline) return null;
      const currentBlock = [...pendingUpdateBlocks.values()].find((block) => blockContainsOffset(block, split.pending!.start));
      if (!currentBlock) return null;
      if (split.pending.kind === "math-inline" || split.pending.kind === "math-block") {
        const previewNode = createSyntheticMathPreviewNode(currentBlock.node, {
          kind: split.pending.kind,
          body: split.pending.body,
          opening: split.pending.opening || (split.pending.kind === "math-inline" && source.startsWith("\\(", split.pending.start) ? "\\(" : "$"),
        });
        if (previewNode) {
          return {
            ...currentBlock,
            node: previewNode,
            endOffset: currentBlock.endOffset,
            rawText: currentBlock.rawText,
          };
        }

        const previewParser = createIncremarkParser(incremarkParserOptions);
        const previewSource = currentBlock.rawText + syntheticMathClosingDelimiter(source, split.pending);
        const previewProjection = projectTableMathSource(previewSource, {
          convertTexDisplayDelimiters: true,
          sentinel: projection?.sentinel || undefined,
        });
        previewParser.render(previewProjection.source);
        const reparsedNode = previewParser.getAst().children?.[0]
          ? promoteTableCellDisplayMath(restoreTableMathAst(previewParser.getAst().children?.[0], previewProjection.sentinel))
          : null;
        if (reparsedNode && containsMath(reparsedNode)) {
          return {
            ...currentBlock,
            node: reparsedNode,
            endOffset: currentBlock.endOffset,
            rawText: currentBlock.rawText,
          };
        }
      }
      const prefixLength = Math.max(0, Math.min(currentBlock.rawText.length, split.pending.start - currentBlock.startOffset));
      const prefix = currentBlock.rawText.slice(0, prefixLength);
      if (!prefix.trim()) return null;
      const prefixParser = createIncremarkParser(incremarkParserOptions);
      const prefixProjection = tableMath
        ? projectTableMathSource(prefix, {
          convertTexDisplayDelimiters: true,
          sentinel: projection?.sentinel || undefined,
        })
        : null;
      prefixParser.render(prefixProjection?.source || prefix);
      const prefixNode = prefixParser.getAst().children?.[0]
        ? prefixProjection
          ? promoteTableCellDisplayMath(restoreTableMathAst(prefixParser.getAst().children?.[0], prefixProjection.sentinel))
          : prefixParser.getAst().children?.[0]
        : null;
      if (!prefixNode) return null;
      // A new opening delimiter can make the parser's pending block shorter
      // than the block that was already visible. Markdown output is append-only:
      // keep that prior visible AST while the new math stays hidden behind the
      // in-place placeholder. Otherwise the native transformer receives a
      // smaller block, resets its progress, and the paragraph briefly shrinks.
      const previousBlock = currentBlocks.find((block) => block.id === currentBlock.id);
      const stableNode = previousBlock
        ? preserveAppendOnlyNode(previousBlock.node, prefixNode, true)
        : prefixNode;
      return {
        ...currentBlock,
        node: stableNode,
        endOffset: currentBlock.startOffset + prefix.length,
        rawText: prefix,
      };
    })();
    const nextDefinitions = parser.getDefinitionMap();
    setDefinitions((previous) => sameDefinitions(previous, nextDefinitions) ? previous : { ...nextDefinitions });
    setPending(split.pending);
    if (updates.length) {
      for (const entry of updates) {
        for (const block of entry.updated) completedById.delete(normalizeBlock(block).id);
        for (const block of entry.completed) {
          const normalized = normalizeBlock(block);
          completedById.set(normalized.id, normalized);
        }
      }
      // Never let the parser's raw in-progress block reach the DOM while a
      // streaming construct owns its tail. The pending prefix/placeholder is
      // the only representation of that block until the delimiter closes.
      pendingOffset = split.pending?.start ?? null;
      const nextBlocks = [...completedById.values()]
        .filter((block) => pendingOffset == null || !blockContainsOffset(block, pendingOffset))
        .sort((left, right) => left.startOffset - right.startOffset);
      const completedIds = new Set(nextBlocks.map((block) => block.id));
      const nextPendingBlocks = split.pending
        ? (pendingPrefixBlock ? [pendingPrefixBlock] : [])
        : [...pendingUpdateBlocks.values()].filter((block) => !completedIds.has(block.id));
      currentBlocks = nextBlocks
        .concat(nextPendingBlocks)
        .sort((left, right) => left.startOffset - right.startOffset);
    }

    const enabled = typewriter();
    typewriterController.setPacing(props.pacing || "buffered");
    typewriterController.setEnabled(enabled);
    if (previousTypewriter === true && !enabled) {
      typewriterController.flush();
      displayHistory.clear();
      seededById.clear();
      setSeededBlocks([]);
      setDisplayBlocks([]);
    } else if (enabled && currentBlocks.length && (
      previousTypewriter === false
      || (previousTypewriter === null && !streaming())
      || (parserMode === "render" && previousTypewriter === true && !preserveTypewriterState)
    )) {
      displayHistory.clear();
      seededById.clear();
      for (const block of currentBlocks) seededById.set(block.id, block);
      setSeededBlocks([...currentBlocks]);
      typewriterController.seed(currentBlocks);
      setDisplayBlocks([]);
    }
    if (enabled) {
      for (const block of currentBlocks) {
        if (seededById.has(block.id)) seededById.set(block.id, block);
      }
      setSeededBlocks([...seededById.values()].sort((left, right) => left.startOffset - right.startOffset));
      const seeded = [...seededById.values()];
      const animated = currentBlocks.filter((block) => !seededById.has(block.id));
      const seededRoot = { type: "root", children: seeded.map((block) => block.node) };
      typewriterController.setBaselineCharacters(visibleAstCharacters(seededRoot));
      // observeSource already hands the blocks to the scheduler; pushing the
      // same array again only repeated the diff.
      typewriterController.observeSource(animated);
      if (animated.length === 0 && currentBlocks.length > 0) typewriterController.completeSeeded();
    }
    previousTypewriter = enabled;

    if (props.inline) {
      const inlineParser = createIncremarkParser(incremarkParserOptions);
      inlineParser.render(split.pending ? split.stable : source);
      setInlineAst({ ...inlineParser.getAst() });
    }
    const reconciledAt = recorder ? performance.now() : 0;
    if (recorder) {
      const tableAst = summarizeTableAst(currentBlocks);
      recordHarnessMetric(recorder, {
        stage: "markdown-render",
        renderer: rendererId(),
        sourceCharacters: source.length,
        inline: Boolean(props.inline),
        parseMs: parsedAt - parseStartedAt,
        sanitiseMs: null,
        katexCandidate: /(?:\$(?:\$?)[^\n]+\$(?:\$?)|\\\([^\n]+\\\)|\\\[[\s\S]+?\\\])/.test(source),
        katexMs: null,
        katexCallCount: 0,
        katexTimingAvailable: false,
        katexTimingBlocker: "Incremark adapter KaTeX calls are measured per new AST node",
        parserMode,
        pendingBlockCount: latestUpdate?.pending?.length ?? null,
        completedBlockCount: latestUpdate?.completed?.length ?? null,
        updatedBlockCount: latestUpdate?.updated?.length ?? null,
        tableAst,
      });
      recordHarnessMetric(recorder, {
        stage: "markdown-reconcile",
        renderer: rendererId(),
        sourceCharacters: source.length,
        inline: Boolean(props.inline),
        reconcileMs: reconciledAt - parsedAt,
      });
    }
    queueMicrotask(() => props.onRendered?.());
  });

  const context: RendererContext = {
    definitions,
    inline: Boolean(props.inline),
    requestExternalLink: external.request,
    deferMath: () => typewriter(),
    mathRenderPolicy: () => streaming() ? "stream" : "reattach",
    rendererId,
    onMathBusyChange: (busy) => setPendingMathRenders((count) => Math.max(0, count + (busy ? 1 : -1))),
    onPendingPlaceholderChange: (delta) => setPendingPlaceholders((count) => Math.max(0, count + delta)),
  };
  return <>
    <div class="chat-markdown" data-renderer={rendererId()} data-inline={props.inline ? "true" : undefined} data-streaming={streaming() || undefined} data-display-busy={displayBusy() || pendingMathRenders() > 0 ? "true" : undefined} data-display-animation-busy={displayBusy() ? "true" : undefined} data-pending-math-renders={pendingMathRenders() > 0 ? String(pendingMathRenders()) : undefined} data-display-key={props.displayKey || undefined} data-settled={settled() ? "true" : undefined}>
      <div class="incremark" data-incremark-core="true">
        <Show when={props.inline} fallback={<>
          <ParsedBlockNodes blocks={seededBlocks} context={context} />
          <DisplayBlockNodes blocks={displayBlocks} context={context} history={displayHistory} />
          <Show when={pending()}>
            {(value) => <Show when={value().kind === "fence"}>
              <PendingConstruct pending={value()} streaming={streaming()} />
            </Show>}
          </Show>
        </>}>
          <AstNode node={inlineAst()} context={context} />
          <Show when={pending()}>{(value) => <Show when={value().kind === "fence"}><PendingConstruct pending={value()} streaming={streaming()} /></Show>}</Show>
        </Show>
      </div>
    </div>
    <ExternalLinkDialog url={external.url} onClose={external.close} returnFocus={external.returnFocus} onFocusRestored={external.clearReturnFocus} />
  </>;
}
