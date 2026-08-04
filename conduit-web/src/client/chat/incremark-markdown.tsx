import { createEffect, createSignal, For, Show } from "solid-js";
import { createIncremarkParser } from "@incremark/core";
import katex from "katex";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { Button } from "@/components/primitives";
import { getHarnessRecorder, recordHarnessMetric } from "@/client/harness-metrics";
import type { ChatMarkdownProps } from "./markdown";
import type { StreamingPending } from "./streaming-markdown";
import { splitStreamingMarkdown } from "./streaming-markdown";

type MarkdownNode = any;
type Definition = { url?: string; title?: string | null };
type RendererContext = {
  definitions: () => Record<string, Definition>;
  inline: boolean;
  requestExternalLink: (url: string) => void;
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

function InlineNodes(props: { nodes: MarkdownNode[]; context: RendererContext }) {
  return <For each={props.nodes}>{(node) => <AstNode node={node} context={props.context} />}</For>;
}

function BlockNodes(props: { nodes: MarkdownNode[]; context: RendererContext }) {
  return <For each={props.nodes}>{(node) => <AstNode node={node} context={props.context} />}</For>;
}

function LinkNode(props: { node: MarkdownNode; context: RendererContext; reference?: Definition }) {
  const target = () => safeUrl(props.reference?.url || props.node.url);
  const label = () => props.reference === undefined && props.node.type === "linkReference"
    ? `[${inlineText(props.node.children || [])}][${props.node.identifier || props.node.label || ""}]`
    : <InlineNodes nodes={props.node.children || []} context={props.context} />;
  return <Show when={target()} fallback={label()}>
    {(resolved) => <Show when={!props.context.inline} fallback={label()}>
      <Show when={resolved().external} fallback={<a href={resolved().href} title={props.reference?.title || props.node.title || undefined}>{label()}</a>}>
        <button
          type="button"
          class="external-markdown-link"
          data-external-url={resolved().href}
          aria-label={inlineText(props.node.children || []) || resolved().href}
          onClick={() => props.context.requestExternalLink(resolved().href)}
        >{label()}</button>
      </Show>
    </Show>}
  </Show>;
}

function MathNode(props: { node: MarkdownNode }) {
  let html = "";
  const recorder = getHarnessRecorder();
  const startedAt = recorder ? performance.now() : 0;
  try {
    html = katex.renderToString(String(props.node.value || ""), {
      displayMode: props.node.type === "math",
      throwOnError: false,
    });
  } catch {
    html = "";
  }
  if (recorder) {
    recordHarnessMetric(recorder, {
      stage: "markdown-katex",
      renderer: "incremark",
      katexMs: performance.now() - startedAt,
      katexCallCount: 1,
    });
  }
  return <span class={props.node.type === "math" ? "incremark-math-block" : "incremark-math-inline"} innerHTML={html} />;
}

function CodeNode(props: { node: MarkdownNode }) {
  const language = () => String(props.node.lang || "text").split(/\s+/)[0]!.toLowerCase();
  const copy = () => {
    if (navigator.clipboard) void navigator.clipboard.writeText(String(props.node.value || ""));
  };
  return <div class="artifact" data-language={language()}>
    <div class="artifact-header"><span>{language()}</span><button type="button" aria-label="Copy code" data-copy-code onClick={copy}>Copy</button></div>
    <pre><code>{String(props.node.value || "")}</code></pre>
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
  const recorder = getHarnessRecorder();
  const startedAt = recorder ? performance.now() : 0;
  let html = "";
  if (pending.body.trim()) {
    try {
      html = katex.renderToString(pending.body, {
        displayMode: pending.kind === "math-block",
        throwOnError: true,
      });
    } catch {
      html = "";
    }
  }
  if (recorder) {
    recordHarnessMetric(recorder, {
      stage: "markdown-katex-pending",
      renderer: "incremark",
      katexMs: performance.now() - startedAt,
      katexCallCount: pending.body.trim() ? 1 : 0,
      pendingKind: pending.kind,
    });
  }
  const fallback = html || (props.streaming ? "Math in progress" : pending.body);
  const className = props.streaming
    ? `streaming-pending ${pending.kind === "math-block" ? "streaming-pending-math-block" : "streaming-pending-math-inline"}`
    : "streaming-final-math";
  const content = html ? <span innerHTML={html} /> : <span class="streaming-pending-placeholder">{fallback}</span>;
  return pending.kind === "math-block"
    ? <div class={className} data-streaming-pending={props.streaming ? pending.kind : undefined} data-streaming-final={props.streaming ? undefined : "math"} aria-label="Math formula">{content}</div>
    : <span class={className} data-streaming-pending={props.streaming ? pending.kind : undefined} data-streaming-final={props.streaming ? undefined : "math"} aria-label="Math formula">{content}</span>;
}

function TableNode(props: { node: MarkdownNode; context: RendererContext }) {
  const [head, ...body] = props.node.children || [];
  return <table>
    <Show when={head}><thead><TableRow node={head} context={props.context} header /></thead></Show>
    <tbody><For each={body}>{(row) => <TableRow node={row} context={props.context} />}</For></tbody>
  </table>;
}

function TableRow(props: { node: MarkdownNode; context: RendererContext; header?: boolean }) {
  return <tr><For each={props.node.children || []}>{(cell) => props.header
    ? <th>{<InlineNodes nodes={cell.children || []} context={props.context} />}</th>
    : <td>{<InlineNodes nodes={cell.children || []} context={props.context} />}</td>}
  </For></tr>;
}

function AstNode(props: { node: MarkdownNode; context: RendererContext }) {
  const node = () => props.node;
  switch (props.node.type) {
    case "text": return props.node.value;
    case "strong": return <strong data-markdown="strong"><InlineNodes nodes={props.node.children || []} context={props.context} /></strong>;
    case "emphasis": return <em><InlineNodes nodes={props.node.children || []} context={props.context} /></em>;
    case "delete": return <del><InlineNodes nodes={props.node.children || []} context={props.context} /></del>;
    case "inlineCode": return <code>{props.node.value}</code>;
    case "inlineMath":
    case "math": return <MathNode node={props.node} />;
    case "break": return <br />;
    case "link": return <LinkNode node={props.node} context={props.context} />;
    case "linkReference": return <LinkNode node={props.node} context={props.context} reference={props.context.definitions()[props.node.identifier]} />;
    case "image":
    case "imageReference": return null;
    case "heading": {
      const children = <InlineNodes nodes={props.node.children || []} context={props.context} />;
      if (props.node.depth === 1) return <h1>{children}</h1>;
      if (props.node.depth === 2) return <h2>{children}</h2>;
      if (props.node.depth === 3) return <h3>{children}</h3>;
      if (props.node.depth === 4) return <h4>{children}</h4>;
      if (props.node.depth === 5) return <h5>{children}</h5>;
      return <h6>{children}</h6>;
    }
    case "paragraph": return <p><InlineNodes nodes={props.node.children || []} context={props.context} /></p>;
    case "list": {
      const children = <For each={props.node.children || []}>{(item) => <AstNode node={item} context={props.context} />}</For>;
      return props.node.ordered ? <ol start={props.node.start || undefined}>{children}</ol> : <ul>{children}</ul>;
    }
    case "listItem": return <li>{props.node.checked !== null && <input type="checkbox" checked={Boolean(props.node.checked)} disabled />}{<BlockNodes nodes={props.node.children || []} context={props.context} />}</li>;
    case "blockquote": return <blockquote><BlockNodes nodes={props.node.children || []} context={props.context} /></blockquote>;
    case "code": return <CodeNode node={props.node} />;
    case "table": return <TableNode node={props.node} context={props.context} />;
    case "thematicBreak": return <hr />;
    case "html":
    case "htmlElement":
    case "definition": return null;
    case "root": return <BlockNodes nodes={props.node.children || []} context={props.context} />;
    default: return node().children ? <BlockNodes nodes={node().children} context={props.context} /> : null;
  }
}

/**
 * Local Incremark-core adapter. The published Solid package is not usable with
 * the repository's Solid runtime, so this spike exercises the incremental core
 * and keeps Conduit's security and interaction boundary in this adapter.
 */
export function IncremarkMarkdown(props: ChatMarkdownProps) {
  const parser = createIncremarkParser({ gfm: true, math: true, htmlTree: true, containers: true });
  const [displayAst, setDisplayAst] = createSignal<MarkdownNode>({ type: "root", children: [] });
  const [pending, setPending] = createSignal<StreamingPending | null>(null);
  const [definitions, setDefinitions] = createSignal<Record<string, Definition>>({});
  const [externalUrl, setExternalUrl] = createSignal<string | null>(null);
  let previousSource = "";
  let finalised = false;

  createEffect(() => {
    const source = String(props.children || "");
    const split = splitStreamingMarkdown(source);
    const recorder = getHarnessRecorder();
    const parseStartedAt = recorder ? performance.now() : 0;
    let parserMode = "none";
    let update: ReturnType<typeof parser.append> | undefined;
    if (source !== previousSource) {
      if (source.startsWith(previousSource)) {
        parserMode = "append";
        update = parser.append(source.slice(previousSource.length));
      } else {
        parserMode = "render";
        update = parser.render(source);
      }
      previousSource = source;
      finalised = false;
    }
    if (!props.streaming && !finalised) {
      parserMode = parserMode === "none" ? "finalize" : `${parserMode}+finalize`;
      update = parser.finalize();
      finalised = true;
    }
    const parsedAt = recorder ? performance.now() : 0;
    setDefinitions({ ...parser.getDefinitionMap() });
    const nextAst = { ...parser.getAst() };
    setPending(split.pending);
    if (split.pending) {
      const presentationParser = createIncremarkParser({ gfm: true, math: true, htmlTree: true, containers: true });
      if (split.stable) presentationParser.render(split.stable);
      if (!props.streaming) presentationParser.finalize();
      setDisplayAst({ ...presentationParser.getAst() });
    } else {
      setDisplayAst(nextAst);
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
        katexCandidate: /\$(?:\$?)[^\n]+\$(?:\$?)/.test(source),
        katexMs: null,
        katexCallCount: 0,
        katexTimingAvailable: false,
        katexTimingBlocker: "Incremark adapter KaTeX calls are not instrumented",
        parserMode,
        pendingBlockCount: update?.pending?.length ?? null,
        completedBlockCount: update?.completed?.length ?? null,
        updatedBlockCount: update?.updated?.length ?? null,
      });
      recordHarnessMetric(recorder, {
        stage: "markdown-reconcile",
        renderer: "incremark",
        sourceCharacters: source.length,
        inline: Boolean(props.inline),
        reconcileMs: reconciledAt - parsedAt,
      });
    }
    queueMicrotask(() => props.onRendered?.());
  });

  const context = (): RendererContext => ({
    definitions,
    inline: Boolean(props.inline),
    requestExternalLink: setExternalUrl,
  });

  return <>
    <div class="chat-markdown" data-renderer="incremark" data-streaming={props.streaming || undefined}>
      <div class="incremark" data-incremark-core="true">
        <Show when={props.inline} fallback={<>
          <AstNode node={displayAst()} context={context()} />
          <Show when={pending()}>{(value) => <PendingConstruct pending={value()} streaming={Boolean(props.streaming)} />}</Show>
        </>}>
          <InlineNodes nodes={displayAst().children?.flatMap((child: MarkdownNode) => child.children || [child]) || []} context={context()} />
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
