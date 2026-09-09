import { syntaxHighlighting } from "@codemirror/language";
import { MergeView, unifiedMergeView, getChunks, goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { ChevronDownIcon, ChevronUpIcon, Columns2Icon, Rows2Icon, SearchIcon, WrapTextIcon } from "lucide-solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { editorTheme, workspaceHighlightStyle } from "./workspace-editor";
import { workspaceLanguageForFilename } from "./workspace-languages";
import { createWorkspaceSearchPanel } from "./workspace-search-panel";
import { FileTypeIcon } from "./file-type-icon";
import "./workspace-comparison.css";

export type ComparisonPayload = {
  path: string;
  oldPath: string;
  staged: boolean;
} & ({ kind: "text"; original: string; modified: string } | { kind: "unavailable"; message: string });

export default function WorkspaceComparison(props: { comparison: ComparisonPayload }) {
  let host!: HTMLDivElement;
  let activeView: EditorView | undefined;
  const [layout, setLayout] = createSignal<"unified" | "split">("unified");
  const [file, setFile] = createSignal(false);
  const [wrap, setWrap] = createSignal(false);
  const [summary, setSummary] = createSignal({ added: 0, removed: 0, precise: true });
  const [languageName, setLanguageName] = createSignal("Plain text");

  createEffect(() => {
    const data = props.comparison;
    const split = layout() === "split" && !file();
    const showFile = file();
    if (data.kind !== "text") return;
    let disposed = false;
    const language = new Compartment();
    const wrapping = new Compartment();
    const extensions: Extension[] = [
      editorTheme, syntaxHighlighting(workspaceHighlightStyle),
      EditorState.readOnly.of(true), EditorView.editable.of(false),
      EditorView.contentAttributes.of({ "aria-label": `${data.path} comparison` }),
      lineNumbers(), drawSelection(), language.of([]), wrapping.of([]),
      search({ top: false, createPanel: createWorkspaceSearchPanel }), keymap.of(searchKeymap),
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
    const chunks = getChunks(view.state)?.chunks ?? [];
    if (!showFile) {
      const original = merge?.a.state.doc ?? EditorState.create({ doc: data.original }).doc;
      const count = (doc: typeof original, from: number, to: number) => to <= from ? 0 : doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(from).number + 1;
      setSummary({
        added: chunks.reduce((n, chunk) => n + count(view.state.doc, chunk.fromB, chunk.toB), 0),
        removed: chunks.reduce((n, chunk) => n + count(original, chunk.fromA, chunk.toA), 0),
        precise: chunks.every((chunk) => chunk.precise),
      });
    }
    createEffect(() => {
      for (const item of views) item.dispatch({ effects: wrapping.reconfigure(wrap() ? EditorView.lineWrapping : []) });
    });
    const description = workspaceLanguageForFilename(data.path);
    setLanguageName(description?.name ?? "Plain text");
    if (description) void description.load().then((support) => {
      if (!disposed) for (const item of views) item.dispatch({ effects: language.reconfigure(support) });
    }).catch(() => { if (!disposed) setLanguageName("Plain text"); });
    onCleanup(() => {
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
  return <section class="workspace-comparison">
    <header class="workspace-comparison-header">
      <FileTypeIcon name={props.comparison.path} />
      <span class="workspace-comparison-path" title={props.comparison.oldPath !== props.comparison.path ? `${props.comparison.oldPath} → ${props.comparison.path}` : props.comparison.path}>{props.comparison.path}</span>
      <Show when={props.comparison.kind === "text"}>
        <span class="workspace-comparison-counts" title={summary().precise ? "Changed lines" : "Approximate changes: detailed comparison reached its work limit"}><span>−{summary().removed}</span><span>+{summary().added}</span></span>
      </Show>
    </header>
    <Show when={props.comparison.kind === "text"} fallback={<div class="workspace-panel-empty">{props.comparison.kind === "unavailable" ? props.comparison.message : ""}</div>}>
      <div ref={host} class="workspace-comparison-content workspace-code-editor" data-layout={file() ? "file" : layout()} />
      <footer class="workspace-editor-status">
        <div class="workspace-editor-command-group">
          <button type="button" aria-pressed={file()} title="Show compared file version" onClick={() => setFile(true)}>File</button>
          <button type="button" aria-pressed={!file()} title="Show changes" onClick={() => setFile(false)}>Diff</button>
          <button type="button" aria-label="Unified diff" aria-pressed={layout() === "unified"} disabled={file()} onClick={() => setLayout("unified")}><Rows2Icon /></button>
          <button type="button" aria-label="Side-by-side diff" aria-pressed={layout() === "split"} disabled={file()} onClick={() => setLayout("split")}><Columns2Icon /></button>
          <button type="button" aria-label="Find in focused version" title="Find in focused version" onClick={() => { if (activeView) openSearchPanel(activeView); }}><SearchIcon /></button>
          <button type="button" aria-label="Wrap lines" aria-pressed={wrap()} onClick={() => setWrap(!wrap())}><WrapTextIcon /></button>
          <button type="button" aria-label="Previous change" disabled={file()} onClick={() => move(false)}><ChevronUpIcon /></button>
          <button type="button" aria-label="Next change" disabled={file()} onClick={() => move(true)}><ChevronDownIcon /></button>
        </div>
        <div class="workspace-editor-detail-group"><span class="workspace-editor-metadata">{props.comparison.staged ? "HEAD → Index" : "Index → Working copy"} · {languageName()} · Read-only</span></div>
      </footer>
    </Show>
  </section>;
}
