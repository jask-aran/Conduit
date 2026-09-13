import { WorkbenchButton, WorkbenchStatus } from "./workspace-workbench";
import { MergeView, unifiedMergeView, getChunks, goToNextChunk, goToPreviousChunk, getOriginalDoc, originalDocChangeEffect } from "@codemirror/merge";
import { ChangeSet, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, WrapTextIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/primitives";
import { readSetting, writeSetting, WORKSPACE_PANEL_GLOBAL_SCOPE } from "./workspace-panel-storage";
import { workspaceReadOnlySetup } from "./workspace-editor-base";
import { workspaceLanguageForFilename } from "./workspace-languages";
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

export default function WorkspaceComparison(props: { comparison: ComparisonPayload; sourceKey: string; viewState: ComparisonViewState; inFiles?: boolean; header?: JSX.Element; statusPrefix?: JSX.Element; comparisonSource?: JSX.Element; comparisonLabel?: JSX.Element; onViewStateChange?: (state: ComparisonViewState) => void; wrap?: boolean; onToggleWrap?: () => void }) {
  let host!: HTMLDivElement;
  let activeView: EditorView | undefined;
  let captureReview = () => ({ ...props.viewState });
  const [layout, setLayout] = createSignal<"unified" | "split">(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-layout") === "split" ? "split" : props.viewState.layout);
  createEffect(() => writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "diff-layout", layout()));
  const [wrap, setWrap] = createSignal(props.viewState.wrap);
  createEffect(() => { if (props.wrap !== undefined) setWrap(props.wrap); });
  const [position, setPosition] = createSignal("Ln 1, Col 1");
  const [summary, setSummary] = createSignal({ added: 0, removed: 0, precise: true });
  const [languageName, setLanguageName] = createSignal("Plain text");

  let savedReview = { ...props.viewState };
  const identity = createMemo(() => `${props.sourceKey}:\u0000${props.comparison.kind}:\u0000${props.comparison.path}`);
  let renderedIdentity = "";
  createEffect(() => {
    const nextIdentity = identity();
    if (renderedIdentity !== nextIdentity) {
      savedReview = { ...untrack(() => props.viewState) };
      renderedIdentity = nextIdentity;
    }
    const data = untrack(() => props.comparison);
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
      EditorState.readOnly.of(true), EditorView.editable.of(false),
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
    const options = { highlightChanges: true, gutter: true, collapseUnchanged: { margin: 3, minSize: 8 }, diffConfig: { scanLimit: 500, timeout: 40 } };
    let merge: MergeView | undefined;
    let view: EditorView;
    if (split) {
      merge = new MergeView({ parent: host, a: { doc: data.original, extensions }, b: { doc: data.modified, extensions }, ...options });
      view = merge.b;
    } else {
      view = new EditorView({ parent: host, doc: data.modified, extensions: [extensions, unifiedMergeView({ original: data.original, ...options, mergeControls: false, syntaxHighlightDeletions: true })] });
    }
    const views = merge ? [merge.a, merge.b] : [view];
    activeView = view;
    const review = savedReview;
    const scroller = merge?.dom ?? view.scrollDOM;
    captureReview = () => ({ layout: layout(), wrap: wrap(), top: scroller.scrollTop, left: scroller.scrollLeft, position: view.state.selection.main.head });
    view.dispatch({ selection: { anchor: Math.min(review.position, view.state.doc.length) } });
    scroller.addEventListener("scroll", publishReview, { passive: true });
    const restoreFrame = requestAnimationFrame(() => {
      if (!disposed) { scroller.scrollTop = review.top; scroller.scrollLeft = review.left; ready = true; publishReview(); }
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

  const move = (forward: boolean) => {
    if (!activeView) return;
    (forward ? goToNextChunk : goToPreviousChunk)(activeView);
    activeView.focus();
  };
  const rangeLabel = () => props.comparisonLabel ?? { changes: "Index → Working copy", staged: "HEAD → Index", head: "HEAD → Working copy", turn: "Turn start → Working copy", session: "Chat start → Working copy" }[props.comparison.scope];
  return <section class="workspace-comparison" data-in-files={props.inFiles}>
    <header class="workspace-preview-header">
      <Show when={props.header} fallback={<span class="workspace-comparison-path">{props.comparison.path}</span>}>{props.header}</Show>
      <Show when={props.comparison.kind === "text"}>
        <Menu>
          <MenuTrigger class="workspace-document-menu" aria-label="Comparison view options">View<ChevronDownIcon /></MenuTrigger>
          <MenuContent>
            <MenuRadioGroup value={layout()} onChange={(value) => { if (value === "unified" || value === "split") setLayout(value); }}>
              <MenuRadioItem value="unified">Unified diff</MenuRadioItem>
              <MenuRadioItem value="split">Side-by-side diff</MenuRadioItem>
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </Show>
    </header>
    <Show when={props.comparison.kind === "text"}>
      <div class="workspace-comparison-context">
        <span class="workspace-comparison-counts" title={summary().precise ? "Changed lines" : "Approximate changed lines"}><span>−{summary().removed}</span><span>+{summary().added}</span></span>
      </div>
    </Show>
    <Show when={props.comparison.kind === "text"} fallback={<div class="workspace-panel-empty">{props.comparison.kind === "unavailable" ? props.comparison.message : ""}</div>}>
      <div ref={host} class="workspace-comparison-content workspace-code-editor" data-layout={layout()} />
      <WorkbenchStatus commands={<>
        {props.statusPrefix}
        {props.comparisonSource}
        <WorkbenchButton aria-label="Find in comparison" title="Find in comparison (Ctrl+F)" onClick={() => { if (activeView) openSearchPanel(activeView); }}><SearchIcon /></WorkbenchButton>
        <WorkbenchButton aria-label="Previous change" title="Previous change" onClick={() => move(false)}><ChevronUpIcon /></WorkbenchButton>
        <WorkbenchButton aria-label="Next change" title="Next change" onClick={() => move(true)}><ChevronDownIcon /></WorkbenchButton>
      </>}>
        <span class="workspace-editor-metadata" title="Comparison endpoints">{rangeLabel()}</span>
        <WorkbenchButton aria-label="Go to line" title="Go to line (Alt+G)" onClick={() => { if (activeView) gotoLine(activeView); }}>{position()}</WorkbenchButton>
        <WorkbenchButton aria-label={wrap() ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={wrap()} title={wrap() ? "Disable line wrapping" : "Enable line wrapping"} onClick={() => props.onToggleWrap ? props.onToggleWrap() : setWrap(!wrap())}><WrapTextIcon /></WorkbenchButton>
        <span class="workspace-editor-metadata">{languageName()} · Read-only</span>
      </WorkbenchStatus>
    </Show>
  </section>;
}
