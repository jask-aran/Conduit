import { WorkbenchButton, WorkbenchStatus } from "./workspace-workbench";
import { MergeView, getChunks, getOriginalDoc, originalDocChangeEffect } from "@codemirror/merge";
import { workspaceMergeView, workspaceUnifiedMerge } from "./workspace-diff-setup";
import { ChangeSet, Compartment, EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { Columns2Icon, SearchIcon, WrapTextIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import { readSetting, writeSetting, WORKSPACE_PANEL_GLOBAL_SCOPE } from "./workspace-panel-storage";
import { workspaceReadOnlySetup } from "./workspace-editor-base";
import { workspaceLanguageForFilename } from "./workspace-languages";
import { FileTypeIcon } from "./file-type-icon";
import { annotationExtension, annotationSpan, paintAnnotationRange, commentHighlightsExtension, commentRange, WorkspaceAnnotationPopup, type AnnotationReading, type AnnotationSelection, type AnnotationSpan, type CommentHighlight } from "./workspace-annotate";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import "./workspace-comparison.css";

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

/** Walks an element point down to the text node the browser actually selected. */
function descend(node: Node, offset: number): [Node, number] {
  let target = node, at = offset;
  while (target.nodeType === Node.ELEMENT_NODE && target.childNodes.length) {
    const past = at >= target.childNodes.length;
    const child = target.childNodes[Math.min(at, target.childNodes.length - 1)]!;
    target = child;
    at = past ? (child.nodeType === Node.TEXT_NODE ? child.textContent!.length : child.childNodes.length) : 0;
  }
  return [target, at];
}

/** Offset of a point inside a deleted chunk, within that chunk's original text. */
function deletedOffset(widget: Element, node: Node, offset: number): number {
  let total = 0;
  for (const line of widget.querySelectorAll(".cm-deletedLine")) {
    if (line.contains(node)) {
      const range = line.ownerDocument.createRange();
      range.selectNodeContents(line);
      range.setEnd(node, offset);
      return total + range.toString().length;
    }
    if (node.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_PRECEDING) total += (line.textContent?.length ?? 0) + 1;
  }
  return Math.max(0, total - 1);
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
      workspaceReadOnlySetup,
      EditorState.readOnly.of(true),
      EditorView.contentAttributes.of({ "aria-label": `${data.path} comparison` }),
      language.of([]), wrapping.of([]),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          setPosition(`Ln ${line.number}, Col ${head - line.from + 1}`);
          publishReview();
        }
      }),
      EditorView.domEventHandlers({ focus: (_event, view) => { activeView = view; } }),
    ];
    let merge: MergeView | undefined;
    let view: EditorView;
    const docFor = (side: "original" | "modified"): Text | undefined => side === "original"
      ? (merge ? merge.a.state.doc : getOriginalDoc(view.state))
      : (merge ? merge.b.state.doc : view.state.doc);
    const chunksNow = () => getChunks((merge?.b ?? view).state)?.chunks ?? [];
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
      ...(props.onAnnotate ? [annotationExtension({ side, onSelect: selectAnnotation, counterpart: counterpartFor, read: split ? undefined : readDeletedSelection })] : []),
    ];
    /**
     * In the unified layout the removed lines are widgets, not document text, so
     * the editor's own selection cannot describe a drag that touches them.
     */
    const readDeletedSelection = (target: EditorView): AnnotationReading | null | undefined => {
      const clear = <T,>(result: T): T => {
        paintAnnotationRange(target, null);
        return result;
      };
      const selection = target.dom.ownerDocument.getSelection();
      if (!selection || selection.rangeCount === 0) return undefined;
      const range = selection.getRangeAt(0);
      if (!target.contentDOM.contains(range.commonAncestorContainer)) return clear(undefined);
      const chunks = chunksNow();
      const widgets = Array.from(target.contentDOM.querySelectorAll(".cm-deletedChunk"));
      const locate = (node: Node, offset: number) => {
        const [leaf, at] = descend(node, offset);
        const element = leaf.nodeType === Node.TEXT_NODE ? leaf.parentElement : leaf as Element;
        const widget = element?.closest(".cm-deletedChunk") ?? null;
        const chunk = widget ? chunks[widgets.indexOf(widget)] : undefined;
        if (chunk) return { chunk, offset: deletedOffset(widget!, leaf, at) };
        // A point the editor cannot place, such as a widget it did not build.
        try {
          return widget ? {} : { pos: target.posAtDOM(leaf, at) };
        } catch {
          return {};
        }
      };
      const start = locate(range.startContainer, range.startOffset);
      const end = locate(range.endContainer, range.endOffset);
      if (!start.chunk && !end.chunk) return clear(undefined);
      if (start.pos === undefined && !start.chunk) return clear(undefined);
      if (end.pos === undefined && !end.chunk) return clear(undefined);
      if (range.collapsed) return clear(null);
      const original = docFor("original");
      const originalFrom = start.chunk ? start.chunk.fromA + (start.offset ?? 0) : end.chunk!.fromA;
      const originalTo = end.chunk ? end.chunk.fromA + (end.offset ?? 0) : start.chunk!.endA;
      const modifiedFrom = start.chunk ? start.chunk.fromB : start.pos!;
      const modifiedTo = end.chunk ? end.chunk.fromB : end.pos!;
      const removed = original ? annotationSpan(original, "original", originalFrom, originalTo) : null;
      const added = annotationSpan(target.state.doc, "modified", modifiedFrom, modifiedTo);
      const span = added ?? removed;
      if (!span) return clear(null);
      paintAnnotationRange(target, added ? { from: modifiedFrom, to: modifiedTo } : null);
      const counterpart = added
        ? removed ?? counterpartFor("modified", modifiedFrom, modifiedTo)
        : counterpartFor("original", originalFrom, originalTo);
      const rect = range.getBoundingClientRect();
      return { span, counterpart: counterpart ?? undefined, left: rect.left, bottom: rect.bottom };
    };
    const options = { collapseUnchanged: { margin: 3, minSize: 8 } };
    if (split) {
      merge = workspaceMergeView({ parent: host, a: { doc: data.original, extensions: sideExtensions("original") }, b: { doc: data.modified, extensions: sideExtensions("modified") }, ...options });
      view = merge.b;
    } else {
      view = new EditorView({ parent: host, doc: data.modified, extensions: [sideExtensions("modified"), workspaceUnifiedMerge(data.original, options)] });
    }
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
          const range = commentRange(target, reveal);
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
      if (merge) {
        if (merge.a.state.doc.toString() !== next.original) merge.a.dispatch({ changes: changesFor(merge.a.state.doc.toString(), next.original) });
        if (merge.b.state.doc.toString() !== next.modified) merge.b.dispatch({ changes: changesFor(merge.b.state.doc.toString(), next.modified) });
      } else {
        const original = getOriginalDoc(view.state);
        const effects = original && original.toString() !== next.original
          ? [originalDocChangeEffect(view.state, ChangeSet.of(changesFor(original.toString(), next.original), original.length))]
          : [];
        const changed = view.state.doc.toString() !== next.modified;
        if (changed || effects.length) view.dispatch({ changes: changed ? changesFor(view.state.doc.toString(), next.modified) : undefined, effects });
      }
      scroller.scrollTop = top;
      scroller.scrollLeft = left;
      const chunks = getChunks(view.state)?.chunks ?? [];
      const original = merge?.a.state.doc ?? getOriginalDoc(view.state);
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
