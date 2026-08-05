import { createEffect, createSignal, For, Index, Match, onCleanup, Show, Switch } from "solid-js";
import { createIncremarkParser, type DisplayBlock, type ParsedBlock } from "@incremark/core";
import katex from "katex";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { Button } from "@/components/primitives";
import { getHarnessRecorder, recordHarnessMetric } from "@/client/harness-metrics";
import type { ChatMarkdownProps } from "./markdown";
import { AdaptiveIncremarkTypewriter, visibleAstCharacters } from "./incremark-typewriter";
import type { StreamingPending } from "./streaming-markdown";
import { splitStreamingMarkdown } from "./streaming-markdown";

type MarkdownNode = any;
type Definition = { url?: string; title?: string | null };
const incremarkParserOptions = { gfm: true, math: { tex: true }, htmlTree: true, containers: true };
type RendererContext = {
  definitions: () => Record<string, Definition>;
  inline: boolean;
  requestExternalLink: (url: string) => void;
  deferMath: () => boolean;
  onMathBusyChange: (busy: boolean) => void;
};

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);

function safeUrl(value: unknown): { href: string; external: boolean } | null {
  try {
    const target = new URL(String(value || ""), location.href);
    if (!allowedProtocols.has(target.protocol)) return null;
    return {
      href: target.href,
      external: target.protocol !== "mailto:" && target.origin !== location.origin,
    };
  } catch {
    return null;
  }
}

function inlineText(nodes: MarkdownNode[]) {
  return nodes.map((node) => node.value || node.children?.map((child: MarkdownNode) => child.value || "").join("") || "").join("");
}

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

function ParsedBlockNodes(props: { blocks: () => ParsedBlock[]; context: RendererContext }) {
  return <For each={props.blocks().map((block) => block.id)}>{(id) => {
    const block = () => props.blocks().find((entry) => entry.id === id);
    return <Show when={block()}>{(value) => <AstNode node={() => value()?.node} context={props.context} />}</Show>;
  }}</For>;
}

function DisplayBlockNodes(props: { blocks: () => DisplayBlock[]; context: RendererContext }) {
  const structuralType = (block: DisplayBlock) => {
    const sourceNode = block.node as MarkdownNode;
    if (sourceNode?.type === "paragraph" && /^ {0,3}\|/.test(String((block as DisplayBlock & { rawText?: string }).rawText || ""))) return "table";
    return sourceNode?.type;
  };
  const displayNode = (block: DisplayBlock) => {
    const sourceNode = block.node as MarkdownNode;
    const currentNode = block.displayNode as MarkdownNode;
    const type = structuralType(block);
    if (type && currentNode?.type !== type) {
      return { ...currentNode, type };
    }
    return currentNode;
  };
  const displayShape = (block: DisplayBlock) => {
    const node = displayNode(block) || {};
    if (node.type === "heading") return `${node.type}:${node.depth}`;
    if (node.type === "list") return `${node.type}:${node.ordered ? "ordered" : "unordered"}`;
    return String(node.type || "unknown");
  };
  return <For each={props.blocks().map((block) => `${block.id}:${displayShape(block)}`)}>{(key) => {
    const block = () => props.blocks().find((entry) => `${entry.id}:${displayShape(entry)}` === key);
    return <Show when={block()}>{(value) => <AstNode node={() => value() ? displayNode(value()) : undefined} context={props.context} />}</Show>;
  }}</For>;
}

function LinkNode(props: { node: MarkdownNode | NodeAccessor; context: RendererContext; reference?: () => Definition | undefined }) {
  const node = () => readNode(props.node);
  const reference = () => props.reference?.();
  const target = () => safeUrl(reference()?.url || node()?.url);
  const label = () => reference() === undefined && node()?.type === "linkReference"
    ? `[${inlineText(node()?.children || [])}][${node()?.identifier || node()?.label || ""}]`
    : <InlineNodes nodes={() => node()?.children || []} context={props.context} />;
  return <Show when={target()} fallback={label()}>
    {(resolved) => <Show when={!props.context.inline} fallback={label()}>
      <Show when={resolved().external} fallback={<a href={resolved().href} title={reference()?.title || node()?.title || undefined}>{label()}</a>}>
        <button
          type="button"
          class="external-markdown-link"
          data-external-url={resolved().href}
          aria-label={inlineText(node()?.children || []) || resolved().href}
          onClick={() => props.context.requestExternalLink(resolved().href)}
        >{label()}</button>
      </Show>
    </Show>}
  </Show>;
}

const MATH_HTML_CACHE_LIMIT = 512;
const mathHtmlCache = new Map<string, string>();
type MathRenderJob = { cancelled: boolean; run: () => void };
const mathRenderQueue: MathRenderJob[] = [];
let mathRenderFrame: number | null = null;

function mathCacheKey(node: MarkdownNode, source: string) {
  return `${node?.type === "math" ? "display" : "inline"}\u0000${source}`;
}

function getCachedMathHtml(node: MarkdownNode, source: string) {
  return mathHtmlCache.get(mathCacheKey(node, source));
}

function cacheMathHtml(node: MarkdownNode, source: string, html: string) {
  const key = mathCacheKey(node, source);
  if (!mathHtmlCache.has(key) && mathHtmlCache.size >= MATH_HTML_CACHE_LIMIT) {
    const oldest = mathHtmlCache.keys().next().value;
    if (oldest) mathHtmlCache.delete(oldest);
  }
  mathHtmlCache.delete(key);
  mathHtmlCache.set(key, html);
}

function requestMathRenderFrame() {
  if (mathRenderFrame != null || !mathRenderQueue.length) return;
  mathRenderFrame = requestAnimationFrame(() => {
    mathRenderFrame = null;
    const startedAt = performance.now();
    let processed = 0;
    while (mathRenderQueue.length && processed < 1 && performance.now() - startedAt < 4) {
      const next = mathRenderQueue.shift()!;
      if (!next.cancelled) {
        next.run();
        processed += 1;
      }
    }
    requestMathRenderFrame();
  });
}

function scheduleMathRender(run: () => void) {
  const job: MathRenderJob = { cancelled: false, run };
  mathRenderQueue.push(job);
  requestMathRenderFrame();
  return () => { job.cancelled = true; };
}

function MathNode(props: { node: MarkdownNode | NodeAccessor; defer?: () => boolean; onBusyChange?: (busy: boolean) => void }) {
  const node = () => readNode(props.node);
  const [html, setHtml] = createSignal("");
  const [type, setType] = createSignal<string | undefined>();
  let cancelJob: (() => void) | null = null;
  let busy = false;
  let renderVersion = 0;
  const setBusy = (next: boolean) => {
    if (next === busy) return;
    busy = next;
    props.onBusyChange?.(next);
  };
  const renderCurrent = (current: MarkdownNode, source: string, version: number) => {
    if (version !== renderVersion) return;
    const cached = getCachedMathHtml(current, source);
    if (cached !== undefined) {
      setHtml(cached);
      setBusy(false);
      return;
    }
    let renderedHtml = "";
    const recorder = getHarnessRecorder();
    const startedAt = recorder ? performance.now() : 0;
    try {
      renderedHtml = katex.renderToString(source, {
        displayMode: current?.type === "math",
        throwOnError: false,
      });
    } catch {
      renderedHtml = "";
    }
    if (recorder) {
      recordHarnessMetric(recorder, {
        stage: "markdown-katex",
        renderer: "incremark",
        katexMs: performance.now() - startedAt,
        katexCallCount: 1,
        katexSourceCharacters: source.length,
        katexHtmlCharacters: renderedHtml.length,
      });
    }
    cacheMathHtml(current, source, renderedHtml);
    setHtml(renderedHtml);
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
      return;
    }
    const cached = getCachedMathHtml(current, source);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    // Inline math changes line width. Render it in the same effect as the
    // atomic display update so a later rAF cannot clear the span and reflow
    // the transcript. Display equations remain queued to protect the frame
    // budget when a response contains many large formulas.
    if (props.defer?.() && current?.type === "math") {
      setHtml("");
      setBusy(true);
      cancelJob = scheduleMathRender(() => renderCurrent(current, source, version));
      return;
    }
    renderCurrent(current, source, version);
  });
  onCleanup(() => {
    cancelJob?.();
    setBusy(false);
  });
  return <span class={type() === "math" ? "incremark-math-block" : "incremark-math-inline"} innerHTML={html()} />;
}

function CodeNode(props: { node: MarkdownNode | NodeAccessor }) {
  const node = () => readNode(props.node);
  const language = () => String(node()?.lang || "text").split(/\s+/)[0]!.toLowerCase();
  const copy = () => {
    if (navigator.clipboard) void navigator.clipboard.writeText(String(node()?.value || ""));
  };
  return <div class="artifact" data-language={language()}>
    <div class="artifact-header"><span>{language()}</span><button type="button" aria-label="Copy code" data-copy-code onClick={copy}>Copy</button></div>
    <pre><code>{String(node()?.value || "")}</code></pre>
  </div>;
}

function PendingConstruct(props: { pending: StreamingPending; streaming: boolean }) {
  const pending = props.pending;
  if (pending.kind === "fence") {
    const language = String(pending.language || "text").split(/\s+/)[0]!.toLowerCase();
    return <div
      class={props.streaming ? "artifact streaming-pending streaming-pending-fence" : "artifact"}
      data-language={language}
      data-streaming-pending={props.streaming ? "fence" : undefined}
    >
      <div class="artifact-header"><span>{language}</span><button type="button" aria-label="Copy code" data-copy-code onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(pending.body); }}>Copy</button></div>
      <pre><code>{pending.body}</code></pre>
    </div>;
  }
  const className = `streaming-pending ${pending.kind === "math-block" ? "streaming-pending-math-block" : "streaming-pending-math-inline"}`;
  return pending.kind === "math-block"
    ? <div class={className} data-streaming-pending={props.streaming ? pending.kind : undefined} aria-hidden="true" />
    : <span class={className} data-streaming-pending={props.streaming ? pending.kind : undefined} aria-hidden="true" />;
}

function TableNode(props: { node: MarkdownNode | NodeAccessor; context: RendererContext }) {
  const node = () => readNode(props.node);
  const head = () => node()?.children?.[0];
  const body = () => node()?.children?.slice(1) || [];
  const columnWidths = () => {
    const count = head()?.children?.length || body()?.[0]?.children?.length || 0;
    if (count === 2) return ["30%", "70%"];
    if (count === 3) return ["24%", "42%", "34%"];
    if (count === 4) return ["14%", "36%", "20%", "30%"];
    return Array.from({ length: count }, () => `${100 / Math.max(1, count)}%`);
  };
  return <table>
    <Show when={columnWidths().length}><colgroup><For each={columnWidths()}>{(width) => <col style={{ width }} />}</For></colgroup></Show>
    <Show when={head()}>{(value) => <thead><TableRow node={() => value()} context={props.context} header /></thead>}</Show>
    <tbody><For each={body()}>{(row) => <TableRow node={row} context={props.context} />}</For></tbody>
  </table>;
}

function TableRow(props: { node: MarkdownNode | NodeAccessor; context: RendererContext; header?: boolean }) {
  const node = () => readNode(props.node);
  return <tr><Index each={node()?.children || []}>{(cell) => props.header
    ? <th><InlineNodes nodes={() => cell()?.children || []} context={props.context} /></th>
    : <td><InlineNodes nodes={() => cell()?.children || []} context={props.context} /></td>}
  </Index></tr>;
}

function TextNode(props: { node: NodeAccessor }) {
  return <>{props.node()?.value || ""}</>;
}

function AstNode(props: { node: MarkdownNode | NodeAccessor; context: RendererContext }) {
  const node = () => readNode(props.node);
  return <Switch fallback={null}>
    <Match when={() => node()?.type === "text"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "strong"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "emphasis"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "delete"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "inlineCode"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "inlineMath" || node()?.type === "math"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "break"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "link" || node()?.type === "linkReference"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => node()?.type === "image" || node()?.type === "imageReference"}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => ["heading", "paragraph", "list", "listItem", "blockquote", "code", "table", "thematicBreak", "html", "htmlElement", "definition", "root"].includes(node()?.type)}><AstNodeContent node={node} context={props.context} /></Match>
    <Match when={() => Boolean(node()?.children)}><AstNodeContent node={node} context={props.context} /></Match>
  </Switch>;
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
    case "math": return <MathNode node={node} defer={props.context.deferMath} onBusyChange={props.context.onMathBusyChange} />;
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
  const [blocks, setBlocks] = createSignal<ParsedBlock[]>([]);
  const [pendingBlocks, setPendingBlocks] = createSignal<ParsedBlock[]>([]);
  const [seededBlocks, setSeededBlocks] = createSignal<ParsedBlock[]>([]);
  const [displayBlocks, setDisplayBlocks] = createSignal<DisplayBlock[]>([]);
  const [displayBusy, setDisplayBusy] = createSignal(false);
  const [pendingMathRenders, setPendingMathRenders] = createSignal(0);
  const [inlineAst, setInlineAst] = createSignal<MarkdownNode>({ type: "root", children: [] });
  const [pending, setPending] = createSignal<StreamingPending | null>(null);
  const [definitions, setDefinitions] = createSignal<Record<string, Definition>>({});
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);
  const completedById = new Map<string, ParsedBlock>();
  const seededById = new Map<string, ParsedBlock>();
  let currentBlocks: ParsedBlock[] = [];
  let previousSource = "";
  let finalised = false;
  let previousTypewriter: boolean | null = null;
  const typewriter = () => Boolean(props.typewriter && !props.inline);
  const typewriterController = new AdaptiveIncremarkTypewriter({
    onChange: (next) => {
      setDisplayBlocks(next);
      queueMicrotask(() => props.onRendered?.());
    },
    onDisplayBusyChange: (busy) => {
      setDisplayBusy(busy);
      props.onDisplayBusyChange?.(busy);
    },
    onMetrics: (metrics) => {
      const recorder = getHarnessRecorder();
      if (!recorder) return;
      recordHarnessMetric(recorder, {
        stage: "markdown-typewriter",
        renderer: "incremark",
        typewriter: true,
        sourceVisibleCharacters: metrics.sourceVisibleCharacters,
        displayedVisibleCharacters: metrics.displayedVisibleCharacters,
        backlogCharacters: metrics.backlogCharacters,
        backlogAgeMs: metrics.backlogAgeMs,
        observedRate: metrics.observedRate,
        targetRate: metrics.targetRate,
        controlRate: metrics.controlRate,
        displayRate: metrics.displayRate,
        relativeLag: metrics.relativeLag,
        charsPerTick: metrics.charsPerTick,
        frameIntervalMs: metrics.frameIntervalMs,
        tickInterval: metrics.tickInterval,
        frameWorkMs: metrics.frameWorkMs,
        frameWorkEmaMs: metrics.frameWorkEmaMs,
        fallbackMode: metrics.fallbackMode,
        lagTargetMet: metrics.lagTargetMet,
      });
    },
  });
  onCleanup(() => typewriterController.destroy());

  const blockContainsOffset = (block: ParsedBlock, offset: number) => offset >= block.startOffset && offset <= block.endOffset;

  createEffect(() => {
    const source = String(props.children || "");
    const split = splitStreamingMarkdown(source);
    const recorder = getHarnessRecorder();
    const parseStartedAt = recorder ? performance.now() : 0;
    let parserMode = "none";
    let update: ReturnType<typeof parser.append> | undefined;
    const updates: Array<ReturnType<typeof parser.append>> = [];
    if (source !== previousSource) {
      if (source.startsWith(previousSource)) {
        parserMode = "append";
        update = parser.append(source.slice(previousSource.length));
      } else {
        parserMode = "render";
        parser.reset();
        update = parser.append(source);
        completedById.clear();
        seededById.clear();
        setSeededBlocks([]);
        typewriterController.reset();
      }
      updates.push(update);
      previousSource = source;
      finalised = false;
    }
    if (!props.streaming && !finalised && !split.pending) {
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
      for (const block of entry.pending) pendingUpdateBlocks.set(block.id, block);
    }
    const pendingPrefixBlock = (() => {
      if (!split.pending || props.inline) return null;
      const currentBlock = [...pendingUpdateBlocks.values()].find((block) => blockContainsOffset(block, split.pending!.start));
      if (!currentBlock) return null;
      const prefixLength = Math.max(0, Math.min(currentBlock.rawText.length, split.pending.start - currentBlock.startOffset));
      const prefix = currentBlock.rawText.slice(0, prefixLength);
      if (!prefix.trim()) return null;
      const prefixParser = createIncremarkParser(incremarkParserOptions);
      prefixParser.render(prefix);
      const prefixNode = prefixParser.getAst().children?.[0];
      if (!prefixNode) return null;
      return {
        ...currentBlock,
        node: prefixNode,
        endOffset: currentBlock.startOffset + prefix.length,
        rawText: prefix,
      };
    })();
    setDefinitions({ ...parser.getDefinitionMap() });
    setPending(split.pending);
    if (updates.length) {
      for (const entry of updates) {
        for (const block of entry.updated) completedById.delete(block.id);
        for (const block of entry.completed) {
          completedById.set(block.id, block);
        }
      }
      pendingOffset = !props.streaming ? split.pending?.start ?? null : null;
      const nextBlocks = [...completedById.values()]
        .filter((block) => pendingOffset == null || !blockContainsOffset(block, pendingOffset))
        .sort((left, right) => left.startOffset - right.startOffset);
      const completedIds = new Set(nextBlocks.map((block) => block.id));
      const nextPendingBlocks = split.pending
        ? (pendingPrefixBlock ? [pendingPrefixBlock] : [])
        : [...pendingUpdateBlocks.values()].filter((block) => !completedIds.has(block.id));
      setBlocks(nextBlocks);
      setPendingBlocks(nextPendingBlocks);
      currentBlocks = nextBlocks
        .concat(nextPendingBlocks)
        .sort((left, right) => left.startOffset - right.startOffset);
    }

    const enabled = typewriter();
    typewriterController.setEnabled(enabled);
    if (previousTypewriter === true && !enabled) {
      typewriterController.flush();
      seededById.clear();
      setSeededBlocks([]);
      setDisplayBlocks([]);
    } else if (enabled && currentBlocks.length && (
      previousTypewriter === false
      || (previousTypewriter === null && !props.streaming)
      || (parserMode === "render" && previousTypewriter === true)
    )) {
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
      typewriterController.observeSource(animated);
      typewriterController.push(animated);
      setDisplayBlocks(typewriterController.getDisplayBlocks());
    }
    previousTypewriter = enabled;

    if (props.inline) {
      const inlineParser = createIncremarkParser(incremarkParserOptions);
      inlineParser.render(split.pending ? split.stable : source);
      setInlineAst({ ...inlineParser.getAst() });
    }
    const reconciledAt = recorder ? performance.now() : 0;
    if (recorder) {
      recordHarnessMetric(recorder, {
        stage: "markdown-render",
        renderer: "incremark",
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
      });
      recordHarnessMetric(recorder, {
        stage: "markdown-reconcile",
        renderer: "incremark",
        sourceCharacters: source.length,
        inline: Boolean(props.inline),
        reconcileMs: reconciledAt - parsedAt,
      });
    }
    if (!enabled) queueMicrotask(() => props.onRendered?.());
  });

  const context: RendererContext = {
    definitions,
    inline: Boolean(props.inline),
    requestExternalLink: setExternalUrl,
    deferMath: () => typewriter(),
    onMathBusyChange: (busy) => setPendingMathRenders((count) => Math.max(0, count + (busy ? 1 : -1))),
  };
  const displayedBlocks = () => {
    const byId = new Map(blocks().map((block) => [block.id, block]));
    for (const block of pendingBlocks()) if (!byId.has(block.id)) byId.set(block.id, block);
    return [...byId.values()].sort((left, right) => left.startOffset - right.startOffset);
  };
  return <>
    <div class="chat-markdown" data-renderer="incremark" data-streaming={props.streaming || undefined} data-display-busy={displayBusy() || pendingMathRenders() > 0 ? "true" : undefined} data-display-key={props.displayKey || undefined}>
      <div class="incremark" data-incremark-core="true">
        <Show when={props.inline} fallback={<>
          <Show when={typewriter()} fallback={<ParsedBlockNodes blocks={displayedBlocks} context={context} />}>
            <ParsedBlockNodes blocks={seededBlocks} context={context} />
            <DisplayBlockNodes blocks={displayBlocks} context={context} />
          </Show>
          <Show when={pending()}>
            {(value) => <>
              <PendingConstruct pending={value()} streaming={Boolean(props.streaming)} />
            </>}
          </Show>
        </>}>
          <AstNode node={inlineAst()} context={context} />
          <Show when={pending()}>{(value) => <PendingConstruct pending={value()} streaming={Boolean(props.streaming)} />}</Show>
        </Show>
      </div>
    </div>
    <KAlertDialog.Root open={Boolean(externalUrl())} onOpenChange={(open) => { if (!open) setExternalUrl(null); }}>
      <KAlertDialog.Portal><KAlertDialog.Content data-state={externalUrl() ? "open" : "closed"} class="external-link-dialog">
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
