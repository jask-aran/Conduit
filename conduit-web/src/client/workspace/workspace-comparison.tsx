import { WorkbenchButton, WorkbenchStatus } from "./workspace-workbench";
import { MergeView, getChunks } from "@codemirror/merge";
import { inlineLineNumbers, inlineRowsOf, setInlineRows, workspaceInlineDiff, workspaceMergeView } from "./workspace-diff-setup";
import { buildInlineDiff, inlineDocLine, inlineRowNumber, unchangedRuns, type InlineDiff } from "./workspace-inline-diff";
import { Compartment, EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { codeFolding, foldEffect } from "@codemirror/language";
import { Columns2Icon, SearchIcon, WrapTextIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import { readSetting, writeSetting, WORKSPACE_PANEL_GLOBAL_SCOPE } from "./workspace-panel-storage";
import { workspaceReadOnlySetup } from "./workspace-editor-base";
import { workspaceLanguageForFilename } from "./workspace-languages";
import { FileTypeIcon } from "./file-type-icon";
import { annotationExtension, annotationSpan, commentHighlightsExtension, commentRange, selectionEnd, WorkspaceAnnotationPopup, type AnnotationReading, type AnnotationSelection, type AnnotationSpan, type CommentHighlight } from "./workspace-annotate";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import "./workspace-comparison.css";

const DIFF_CONFIG = { scanLimit: 500, timeout: 40 };

export type ComparisonPayload = {
  path: string;
  oldPath: string;
  scope: "changes" | "staged" | "head" | "turn" | "session";
} & ({ kind: "text"; original: string; modified: string } | { kind: "unavailable"; message: string });

export interface ComparisonViewState {
  layout: "unified" | "split";
  wrap: boolean;
  top: number;
  left: number;
  position: number;
}

export default function WorkspaceComparison(props: { comparison: ComparisonPayload; sourceKey: string; viewState: ComparisonViewState; headerAction?: JSX.Element; comparisonSource?: JSX.Element; commentHighlights?: readonly CommentHighlight[]; reveal?: ReviewNavigationRequest | null; onViewStateChange?: (state: ComparisonViewState) => void; onAnnotate?: (selection: AnnotationSelection, note: string) => boolean }) {
  let host!: HTMLDivElement;
  let activeView: EditorView | undefined;
  let captureReview = () => ({ ...props.viewState });
  const [layout, setLayout] = createSignal<"unified" | "split">(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-layout") === "split" ? "split" : props.viewState.layout);
  createEffect(() => writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-layout", layout()));
  // Wrapping is a reading preference, not a property of one comparison.
  const storedWrap = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-wrap");
  const [wrap, setWrap] = createSignal(storedWrap === null ? props.viewState.wrap : storedWrap === "true");
  createEffect(() => writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-wrap", String(wrap())));
  const [position, setPosition] = createSignal("Ln 1, Col 1");
  const [summary, setSummary] = createSignal({ added: 0, removed: 0, precise: true });
  const [languageName, setLanguageName] = createSignal("Plain text");
  const [annotation, setAnnotation] = createSignal<AnnotationSelection | null>(null);
  const selectAnnotation = (selection: AnnotationSelection | null) => {
    setAnnotation(selection);
  };

  let savedReview = { ...props.viewState };
  let revealedNonce = 0;
  const identity = createMemo(() => `${props.sourceKey}:\u0000${props.comparison.kind}:\u0000${props.comparison.path}`);
  let renderedIdentity = "";
  createEffect(() => {
    const nextIdentity = identity();
    if (renderedIdentity !== nextIdentity) {
      savedReview = { ...untrack(() => props.viewState) };
      renderedIdentity = nextIdentity;
    }
    const data = untrack(() => props.comparison);
    const commentHighlights = props.commentHighlights ?? [];
    const reveal = props.reveal;
    const split = layout() === "split";
    if (data.kind !== "text") return;
    let disposed = false;
    let ready = false;
    const publishReview = () => {
      if (!ready || disposed) return;
      untrack(() => {
        savedReview = captureReview();
        props.onViewStateChange?.(savedReview);
      });
    };
    const language = new Compartment();
    const wrapping = new Compartment();
    const extensions: Extension[] = [
      workspaceReadOnlySetup(split ? {} : inlineLineNumbers),
      EditorState.readOnly.of(true),
      EditorView.contentAttributes.of({ "aria-label": `${data.path} comparison` }),
      language.of([]), wrapping.of([]),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          // Inline, a row counts in the document it came from, not in this view.
          const rows = inlineRowsOf(update.state);
          const number = rows ? inlineRowNumber(rows[line.number - 1]) : String(line.number);
          setPosition(`Ln ${number}, Col ${head - line.from + 1}`);
          publishReview();
        }
      }),
      EditorView.domEventHandlers({ focus: (_event, view) => { activeView = view; } }),
    ];
    let merge: MergeView | undefined;
    let view: EditorView;
    // Side-by-side keeps a document per side; inline has its own reader below.
    const docFor = (side: "original" | "modified"): Text | undefined => merge && (side === "original" ? merge.a : merge.b).state.doc;
    const chunksNow = () => (merge ? getChunks(merge.b.state)?.chunks : undefined) ?? [];
    // A comment on one side of a diff carries the passage it replaced, or was
    // replaced by, so the note can be read without the comparison in front of you.
    const counterpartFor = (side: "original" | "modified", from: number, to: number): AnnotationSpan | undefined => {
      const hits = chunksNow().filter((chunk) => side === "modified"
        ? chunk.fromB < to && chunk.endB > from
        : chunk.fromA < to && chunk.endA > from);
      const other = side === "modified" ? "original" : "modified";
      const doc = docFor(other);
      if (!hits.length || !doc) return undefined;
      const first = hits[0]!, last = hits.at(-1)!;
      const start = other === "original" ? first.fromA : first.fromB;
      const end = Math.min(other === "original" ? last.endA : last.endB, doc.length);
      return annotationSpan(doc, other, start, end) ?? undefined;
    };
    const sideExtensions = (side: "original" | "modified"): Extension[] => [
      extensions,
      commentHighlightsExtension(commentHighlights.filter((item) => !item.side || item.side === side)),
      ...(props.onAnnotate ? [annotationExtension({ side, onSelect: selectAnnotation, counterpart: counterpartFor })] : []),
    ];
    // Inline, both sides are in the one document, so a comment is placed by the
    // row it landed on rather than by the document's own line numbers.
    const locateInline = (target: EditorView, item: Pick<CommentHighlight, "from" | "to" | "startColumn" | "endColumn" | "side">) => {
      const rows = inlineRowsOf(target.state);
      if (!rows) return null;
      const side = item.side ?? "modified";
      const from = inlineDocLine(rows, side, item.from);
      const to = inlineDocLine(rows, side, item.to);
      return from && to ? commentRange(target, { ...item, from, to }) : null;
    };
    const readInline = (target: EditorView): AnnotationReading | null => {
      const range = target.state.selection.main;
      const rows = inlineRowsOf(target.state);
      if (range.empty || !rows) return null;
      const doc = target.state.doc;
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(Math.max(range.from, range.to - 1)).number;
      const belongs = (number: number, side: "original" | "modified") => {
        const row = rows[number - 1];
        return Boolean(row) && (side === "original" ? row!.kind !== "added" : row!.kind !== "removed");
      };
      const spanFor = (side: "original" | "modified", from: number, to: number, columns: boolean): AnnotationSpan | undefined => {
        const numbers: number[] = [];
        for (let number = from; number <= to && number <= rows.length; number++) if (belongs(number, side)) numbers.push(number);
        if (!numbers.length) return undefined;
        const head = doc.line(numbers[0]!);
        const tail = doc.line(numbers.at(-1)!);
        const lineOf = (number: number) => {
          const row = rows[number - 1]!;
          return (side === "original" ? row.original : row.modified) ?? 1;
        };
        return {
          side,
          from: lineOf(numbers[0]!),
          to: lineOf(numbers.at(-1)!),
          startColumn: columns && head.number === first ? range.from - head.from + 1 : 1,
          endColumn: columns && tail.number === last ? Math.min(range.to, tail.to) - tail.from + 1 : tail.length + 1,
          excerpt: numbers.map((number) => doc.line(number).text).join("\n"),
        };
      };
      const primarySide = belongs(first, "modified") || !belongs(first, "original") ? "modified" : "original";
      const otherSide = primarySide === "modified" ? "original" : "modified";
      const span = spanFor(primarySide, first, last, true) ?? spanFor(otherSide, first, last, true);
      if (!span) return null;
      const other = span.side === primarySide ? otherSide : primarySide;
      // A selection inside one half of a change still carries the other half,
      // which is the whole run of changed rows it sits in.
      let blockFrom = first, blockTo = last;
      while (blockFrom > 1 && rows[blockFrom - 2]?.kind !== "context") blockFrom--;
      while (blockTo < rows.length && rows[blockTo]?.kind !== "context") blockTo++;
      const through = spanFor(other, first, last, true);
      const counterpart = through ? { ...through, selected: true } : spanFor(other, blockFrom, blockTo, false);
      const coords = selectionEnd(target);
      if (!coords) return null;
      return { span, counterpart, left: coords.left, bottom: coords.bottom };
    };
    const inlineExtensions = (diff: InlineDiff): Extension[] => [
      extensions,
      workspaceInlineDiff(diff.rows),
      codeFolding({ placeholderText: "unchanged lines" }),
      commentHighlightsExtension(commentHighlights, locateInline),
      ...(props.onAnnotate ? [annotationExtension({ side: "modified", onSelect: selectAnnotation, read: readInline })] : []),
    ];
    let inline: InlineDiff | null = null;
    let inlineSource = "";
    if (split) {
      merge = workspaceMergeView({ parent: host, a: { doc: data.original, extensions: sideExtensions("original") }, b: { doc: data.modified, extensions: sideExtensions("modified") }, collapseUnchanged: { margin: 3, minSize: 8 } });
      view = merge.b;
    } else {
      inline = buildInlineDiff(data.original, data.modified, DIFF_CONFIG);
      inlineSource = `${data.original}\u0000${data.modified}`;
      view = new EditorView({ parent: host, doc: inline.doc, extensions: inlineExtensions(inline) });
    }
    // Long stretches of untouched context fold away, as they did when the merge
    // view collapsed them, and a click on the placeholder brings them back.
    const foldContext = (target: EditorView, rows: InlineDiff["rows"]) => {
      const doc = target.state.doc;
      const effects = unchangedRuns(rows).flatMap((run) => {
        if (run.to > doc.lines) return [];
        const from = doc.line(run.from).from;
        const to = doc.line(run.to).to;
        return to > from ? [foldEffect.of({ from: Math.max(0, from - 1), to })] : [];
      });
      if (effects.length) target.dispatch({ effects });
    };
    if (inline) foldContext(view, inline.rows);
    const views = merge ? [merge.a, merge.b] : [view];
    activeView = view;
    const review = savedReview;
    const scroller = merge?.dom ?? view.scrollDOM;
    captureReview = () => ({ layout: layout(), wrap: wrap(), top: scroller.scrollTop, left: scroller.scrollLeft, position: view.state.selection.main.head });
    view.dispatch({ selection: { anchor: Math.min(review.position, view.state.doc.length) } });
    scroller.addEventListener("scroll", publishReview, { passive: true });
    const restoreFrame = requestAnimationFrame(() => {
      if (!disposed) {
        scroller.scrollTop = review.top;
        scroller.scrollLeft = review.left;
        if (reveal?.path === data.path && reveal.nonce !== revealedNonce) {
          revealedNonce = reveal.nonce;
          const target = merge && reveal.side === "original" ? merge.a : view;
          const range = inline ? locateInline(target, reveal) : commentRange(target, reveal);
          if (range) target.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
          selectAnnotation(null);
          target.focus();
        }
        ready = true;
        publishReview();
      }
    });
    createEffect(() => {
      const next = props.comparison;
      if (next.kind !== "text") return;
      // A narrow replacement maps selections and preserves unaffected folds.
      const changesFor = (current: string, value: string) => {
        let from = 0;
        while (from < current.length && from < value.length && current[from] === value[from]) from++;
        let end = current.length, nextEnd = value.length;
        while (end > from && nextEnd > from && current[end - 1] === value[nextEnd - 1]) { end--; nextEnd--; }
        return { from, to: end, insert: value.slice(from, nextEnd) };
      };
      const top = scroller.scrollTop, left = scroller.scrollLeft;
      if (inline) {
        const source = `${next.original}\u0000${next.modified}`;
        if (source !== inlineSource) {
          inlineSource = source;
          inline = buildInlineDiff(next.original, next.modified, DIFF_CONFIG);
          const current = view.state.doc.toString();
          view.dispatch({ changes: changesFor(current, inline.doc), effects: setInlineRows.of(inline.rows) });
          foldContext(view, inline.rows);
          scroller.scrollTop = top;
          scroller.scrollLeft = left;
        }
        setSummary({ added: inline.added, removed: inline.removed, precise: inline.precise });
        return;
      }
      if (!merge) return;
      if (merge.a.state.doc.toString() !== next.original) merge.a.dispatch({ changes: changesFor(merge.a.state.doc.toString(), next.original) });
      if (merge.b.state.doc.toString() !== next.modified) merge.b.dispatch({ changes: changesFor(merge.b.state.doc.toString(), next.modified) });
      scroller.scrollTop = top;
      scroller.scrollLeft = left;
      const chunks = getChunks(view.state)?.chunks ?? [];
      const original = merge.a.state.doc;
      const count = (doc: typeof original, from: number, to: number) => to <= from ? 0 : doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(from).number + 1;
      setSummary({
        added: chunks.reduce((n, chunk) => n + count(view.state.doc, chunk.fromB, chunk.toB), 0),
        removed: chunks.reduce((n, chunk) => n + count(original, chunk.fromA, chunk.toA), 0),
        precise: chunks.every((chunk) => chunk.precise),
      });
    });
    createEffect(() => {
      for (const item of views) item.dispatch({ effects: wrapping.reconfigure(wrap() ? EditorView.lineWrapping : []) });
    });
    const description = workspaceLanguageForFilename(data.path);
    setLanguageName(description?.name ?? "Plain text");
    if (description) void description.load().then((support) => {
      if (!disposed) for (const item of views) item.dispatch({ effects: language.reconfigure(support) });
    }).catch(() => { if (!disposed) setLanguageName("Plain text"); });
    onCleanup(() => {
      selectAnnotation(null);
      untrack(() => {
        savedReview = captureReview();
      });
      scroller.removeEventListener("scroll", publishReview);
      cancelAnimationFrame(restoreFrame);
      disposed = true;
      activeView = undefined;
      if (merge) merge.destroy(); else view.destroy();
    });
  });

  return <section class="workspace-comparison">
    <header class="workspace-preview-header">
      <div class="workspace-preview-file" title={props.comparison.path}><FileTypeIcon name={props.comparison.path} /><span>{props.comparison.path}</span></div>
      {props.headerAction}
      <Show when={props.comparison.kind === "text"}>
        <div class="workspace-editor-header-tools">
          <WorkbenchButton aria-label="Find in comparison" title="Find in comparison (Ctrl+F)" onClick={() => { if (activeView) openSearchPanel(activeView); }}><SearchIcon /></WorkbenchButton>
          <WorkbenchButton aria-label={wrap() ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={wrap()} title={wrap() ? "Disable line wrapping" : "Enable line wrapping"} onClick={() => setWrap(!wrap())}><WrapTextIcon /></WorkbenchButton>
          <WorkbenchButton aria-label={layout() === "split" ? "Show unified diff" : "Show side-by-side diff"} aria-pressed={layout() === "split"} title={layout() === "split" ? "Show unified diff" : "Show side-by-side diff"} onClick={() => setLayout(layout() === "split" ? "unified" : "split")}><Columns2Icon /></WorkbenchButton>
        </div>
      </Show>
    </header>
    <Show when={props.comparison.kind === "text"} fallback={<div class="workspace-panel-empty">{props.comparison.kind === "unavailable" ? props.comparison.message : ""}</div>}>
      <div class="workspace-comparison-content" data-layout={layout()}>
        <div ref={host} class="workspace-comparison-editor workspace-code-editor" />
        <Show when={annotation()}>{(selection) => <WorkspaceAnnotationPopup selection={selection()} onAdd={(note) => props.onAnnotate?.(selection(), note) ?? false} onDismiss={() => selectAnnotation(null)} />}</Show>
      </div>
      <WorkbenchStatus commands={props.comparisonSource}>
        <span class="workspace-comparison-counts" title={summary().precise ? "Changed lines" : "Approximate changed lines"}><span>−{summary().removed}</span><span>+{summary().added}</span></span>
        <WorkbenchButton aria-label="Go to line" title="Go to line (Alt+G)" onClick={() => { if (activeView) gotoLine(activeView); }}>{position()}</WorkbenchButton>
        <span class="workspace-editor-metadata">{languageName()} · Read-only</span>
      </WorkbenchStatus>
    </Show>
  </section>;
}
