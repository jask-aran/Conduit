import { WorkbenchButton, WorkbenchStatus, FileRepresentationControl } from "./workspace-workbench";
import { MergeView, unifiedMergeView, getChunks, goToNextChunk, goToPreviousChunk, getOriginalDoc, originalDocChangeEffect } from "@codemirror/merge";
import { ChangeSet, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { ChevronDownIcon, ChevronUpIcon, Columns2Icon, PencilIcon, PencilOffIcon, Rows2Icon, SearchIcon, WrapTextIcon, XIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import { workspaceReadOnlySetup } from "./workspace-editor-base";
import { workspaceLanguageForFilename } from "./workspace-languages";
import { FileTypeIcon } from "./file-type-icon";
import "./workspace-comparison.css";

export type ComparisonPayload = {
  path: string;
  oldPath: string;
  scope: "changes" | "staged" | "head" | "turn" | "session";
} & ({ kind: "text"; original: string; modified: string } | { kind: "unavailable"; message: string });

export interface ComparisonViewState {
  layout: "unified" | "split";
  file: boolean;
  wrap: boolean;
  top: number;
  left: number;
  position: number;
}

export default function WorkspaceComparison(props: { comparison: ComparisonPayload; viewState: ComparisonViewState; inFiles?: boolean; header?: JSX.Element; footerControl?: JSX.Element; onViewStateChange?: (state: ComparisonViewState) => void; onShowFile?: () => void; onClose?: () => void; onOpenFile: (source: string, position: number, state: ComparisonViewState) => void }) {
  let host!: HTMLDivElement;
  let activeView: EditorView | undefined;
  let captureReview = () => ({ ...props.viewState });
  const [layout, setLayout] = createSignal<"unified" | "split">(props.viewState.layout);
  const [file, setFile] = createSignal(props.viewState.file);
  const [wrap, setWrap] = createSignal(props.viewState.wrap);
  const [summary, setSummary] = createSignal({ added: 0, removed: 0, precise: true });
  const [languageName, setLanguageName] = createSignal("Plain text");

  let savedReview = { ...props.viewState };
  const identity = createMemo(() => `${props.comparison.kind}:\u0000${props.comparison.path}`);
  createEffect(() => {
    identity();
    const data = untrack(() => props.comparison);
    const split = layout() === "split" && !file();
    const showFile = file();
    if (data.kind !== "text") return;
    let disposed = false;
    const language = new Compartment();
    const wrapping = new Compartment();
    const extensions: Extension[] = [
      workspaceReadOnlySetup,
      EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorView.contentAttributes.of({ "aria-label": `${data.path} comparison` }),
      language.of([]), wrapping.of([]),
      EditorView.domEventHandlers({ focus: (_event, view) => { activeView = view; } }),
    ];
    const options = { highlightChanges: true, gutter: true, collapseUnchanged: { margin: 3, minSize: 8 }, diffConfig: { scanLimit: 500, timeout: 40 } };
    let merge: MergeView | undefined;
    let view: EditorView;
    if (split) {
      merge = new MergeView({ parent: host, a: { doc: data.original, extensions }, b: { doc: data.modified, extensions }, ...options });
      view = merge.b;
    } else {
      view = new EditorView({ parent: host, doc: data.modified, extensions: [extensions, showFile ? [] : unifiedMergeView({ original: data.original, ...options, mergeControls: false, syntaxHighlightDeletions: true })] });
    }
    const views = merge ? [merge.a, merge.b] : [view];
    activeView = view;
    const review = savedReview;
    const scroller = merge?.dom ?? view.scrollDOM;
    captureReview = () => ({ layout: layout(), file: file(), wrap: wrap(), top: scroller.scrollTop, left: scroller.scrollLeft, position: view.state.selection.main.head });
    view.dispatch({ selection: { anchor: Math.min(review.position, view.state.doc.length) } });
    const restoreFrame = requestAnimationFrame(() => {
      if (!disposed) { scroller.scrollTop = review.top; scroller.scrollLeft = review.left; }
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
        const original = showFile ? undefined : getOriginalDoc(view.state);
        const effects = original && original.toString() !== next.original
          ? [originalDocChangeEffect(view.state, ChangeSet.of(changesFor(original.toString(), next.original), original.length))]
          : [];
        const changed = view.state.doc.toString() !== next.modified;
        if (changed || effects.length) view.dispatch({ changes: changed ? changesFor(view.state.doc.toString(), next.modified) : undefined, effects });
      }
      scroller.scrollTop = top;
      scroller.scrollLeft = left;
      const chunks = getChunks(view.state)?.chunks ?? [];
      if (!showFile) {
        const original = merge?.a.state.doc ?? getOriginalDoc(view.state);
        const count = (doc: typeof original, from: number, to: number) => to <= from ? 0 : doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(from).number + 1;
        setSummary({
          added: chunks.reduce((n, chunk) => n + count(view.state.doc, chunk.fromB, chunk.toB), 0),
          removed: chunks.reduce((n, chunk) => n + count(original, chunk.fromA, chunk.toA), 0),
          precise: chunks.every((chunk) => chunk.precise),
        });
      }
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
      untrack(() => {
        savedReview = captureReview();
        props.onViewStateChange?.(savedReview);
      });
      cancelAnimationFrame(restoreFrame);
      disposed = true;
      activeView = undefined;
      if (merge) merge.destroy(); else view.destroy();
    });
  });

  const move = (forward: boolean) => {
    if (!activeView) return;
    (forward ? goToNextChunk : goToPreviousChunk)(activeView);
    activeView.focus();
  };
  return <section class="workspace-comparison" data-in-files={props.inFiles}>
    <Show when={props.header} fallback={
    <header class="workspace-comparison-header">
      <FileTypeIcon name={props.comparison.path} />
      <span class="workspace-comparison-path" title={props.comparison.oldPath !== props.comparison.path ? `${props.comparison.oldPath} → ${props.comparison.path}` : props.comparison.path}>{props.comparison.path}</span>
      <Show when={props.comparison.kind === "text"}>
        <span class="workspace-comparison-counts" title={summary().precise ? "Changed lines" : "Approximate changes: detailed comparison reached its work limit"}><span>−{summary().removed}</span><span>+{summary().added}</span></span>
      </Show>
      <WorkbenchButton type="button" class="workspace-comparison-open" title={props.inFiles ? "Edit the current working copy" : "Open this comparison in Files"} aria-label={props.inFiles ? "Edit working file" : "Open in Files"} onClick={() => {
        const view = activeView;
        props.onOpenFile(view?.state.doc.toString() ?? "", view ? view.state.selection.main.head || view.viewport.from : 0, captureReview());
      }}><PencilIcon /><span>{props.inFiles ? "Edit working file" : "Open in Files"}</span></WorkbenchButton>
      <Show when={props.onClose}><WorkbenchButton type="button" class="workspace-comparison-open" aria-label="Close comparison" title="Close comparison" onClick={() => props.onClose?.()}><XIcon /></WorkbenchButton></Show>
    </header>
    }>{props.header}</Show>
    <Show when={props.comparison.kind === "text"} fallback={<div class="workspace-panel-empty">{props.comparison.kind === "unavailable" ? props.comparison.message : ""}</div>}>
      <div ref={host} class="workspace-comparison-content workspace-code-editor" data-layout={file() ? "file" : layout()} />
      <WorkbenchStatus commands={<>
          <Show when={props.inFiles}><WorkbenchButton type="button" class="workspace-editor-mode" aria-label="Edit file" title="Edit working file" onClick={() => { const view = activeView; props.onOpenFile(view?.state.doc.toString() ?? "", view?.state.selection.main.head ?? 0, captureReview()); }}><PencilOffIcon />Preview</WorkbenchButton></Show>
          <FileRepresentationControl diff={!file()} onFile={() => props.onShowFile ? props.onShowFile() : setFile(true)} onDiff={() => setFile(false)} />
          <WorkbenchButton type="button" aria-label="Find or replace" title="Find in focused version (Ctrl+F)" onClick={() => { if (activeView) openSearchPanel(activeView); }}><SearchIcon /></WorkbenchButton>
          <Show when={!file()}><WorkbenchButton type="button" aria-label="Unified diff" aria-pressed={layout() === "unified"} disabled={file()} onClick={() => setLayout("unified")}><Rows2Icon /></WorkbenchButton>
          <WorkbenchButton type="button" aria-label="Side-by-side diff" aria-pressed={layout() === "split"} disabled={file()} onClick={() => setLayout("split")}><Columns2Icon /></WorkbenchButton>
          <WorkbenchButton type="button" aria-label="Previous change" disabled={file()} onClick={() => move(false)}><ChevronUpIcon /></WorkbenchButton>
          <WorkbenchButton type="button" aria-label="Next change" disabled={file()} onClick={() => move(true)}><ChevronDownIcon /></WorkbenchButton></Show>
        </>}><span class="workspace-editor-metadata">{{ changes: "Index → Working copy", staged: "HEAD → Index", head: "HEAD → Working copy", turn: "Turn start → Working copy", session: "Chat start → Working copy" }[props.comparison.scope]}</span>{props.footerControl}<WorkbenchButton type="button" aria-label="Wrap lines" aria-pressed={wrap()} onClick={() => setWrap(!wrap())}><WrapTextIcon /></WorkbenchButton><span class="workspace-editor-metadata">{languageName()} · Read-only</span>
      </WorkbenchStatus>
    </Show>
  </section>;
}
