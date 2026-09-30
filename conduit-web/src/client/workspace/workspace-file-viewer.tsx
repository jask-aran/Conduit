import { createEffect, createResource, createSignal, Index, lazy, onCleanup, Show, Suspense, type JSX } from "solid-js";
import { ArrowLeftRightIcon, Columns2Icon, FileDiffIcon, FileTextIcon, GitCompareArrowsIcon, XIcon } from "lucide-solid";
import { MenuItem } from "@/components/primitives";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import { toast } from "solid-sonner";
import { api } from "../api/client";
import type { FileEntry } from "./file-documents";
import type { ComparisonPayload } from "./workspace-comparison";
import WorkspaceFileSlot, { type FileSlotHandle, type FileSummary } from "./workspace-file-slot";
import { reportError } from "./workspace-shared";
import type { DiffPayload, GitChangedFile } from "./workspace-types";
import { WorkbenchButton } from "./workspace-workbench";

const WorkspaceComparison = lazy(() => import("./workspace-comparison"));
const POLL_INTERVAL_MS = 1_500;
const entryKey = (entry: FileEntry) => `${entry.projectId}:${entry.path}`;
const hasUnstaged = (file?: GitChangedFile) => Boolean(file && (file.status === "??" || file.status[1] !== " "));
const hasStaged = (file?: GitChangedFile) => Boolean(file && file.status[0] !== " " && file.status[0] !== "?");

/**
 * A pane's file viewer (docs/design/panes-and-rail.md, 6d-2): one file, or
 * two side by side -- denser than a pane each. Each entry is an editor slot
 * of its own, with its own load, draft and save, or the file's unstaged or
 * staged changes (6d-3); the viewer keeps them fresh against the
 * workspace's version, as the dock's Files does for its slot.
 */
export default function FileViewer(props: {
  entries: FileEntry[];
  /** The entry the navigator's next file replaces. */
  focused: number;
  wrap: (index: number) => boolean;
  onToggleWrap: (index: number) => void;
  commentChatId: string | null;
  onFocusEntry: (index: number) => void;
  /** Open the file again beside itself, in this pane. */
  onSplit: () => void;
  onCloseEntry: (index: number) => void;
  onSetMode: (index: number, mode: FileEntry["mode"]) => void;
  /** Each side's tabs, which head it in place of the file's name (6c). */
  tabs?: (index: number) => JSX.Element;
  /** The pane's own actions, at the end of the last side's header. */
  emptySide?: JSX.Element;
  /** An empty second side shows (the split, before a file fills it). */
  splitEmpty?: boolean;
  /** The empty column sits first (its file was dragged away), the file second. */
  emptyFirst?: boolean;
  /** The first side's share of the width, with two. */
  share?: number;
  onShare?: (share: number) => void;
  paneActions?: () => JSX.Element;
  /** A side's own items in its ⋯ (close it, close its other tabs, move it to a pane). */
  sideMenu?: (index: number) => JSX.Element;
  /** Two sides trade places, from the ⇄ on the rule between them. */
  onSwapSides?: () => void;
  onLoaded?: (index: number, file: FileSummary | null) => void;
  ref: (index: number, handle: FileSlotHandle | undefined) => void;
  /** A review comment to scroll to, when it is on one of the entries. */
  reveal?: { entry: FileEntry; request: ReviewNavigationRequest } | null;
}) {
  const handles: (FileSlotHandle | undefined)[] = [];
  const [visible, setVisible] = createSignal(document.visibilityState === "visible");
  const noteVisibility = () => setVisible(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", noteVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", noteVisibility));
  // Each file's Git status, where its place is a Git workspace: the mark in
  // its header and which changes it can show.
  const [statuses, setStatuses] = createSignal<Record<string, GitChangedFile | undefined>>({});
  // The place's status list, once per place: a path-filtered read returns only its patch.
  const loadStatus = async (projectId: string) => {
    let files: GitChangedFile[] = [];
    try {
      files = (await api<DiffPayload>(`/v0/projects/${encodeURIComponent(projectId)}/diff?history=0&reuse=1`)).files ?? [];
    } catch {}
    setStatuses((current) => {
      const next = { ...current };
      for (const entry of props.entries) if (entry.projectId === projectId) next[entryKey(entry)] = files.find((file) => file.path === entry.path);
      return next;
    });
  };
  createEffect(() => { for (const projectId of new Set(props.entries.map((entry) => entry.projectId))) void loadStatus(projectId); });
  // One version probe per place the entries are in; a change to an entry's
  // path reloads that entry, which keeps a draft it has.
  createEffect(() => {
    if (!visible()) return;
    const places = new Map<string, string[]>();
    props.entries.forEach((entry) => places.set(entry.projectId, [...(places.get(entry.projectId) ?? []), entry.path]));
    const entries = props.entries;
    const timers: number[] = [];
    let cancelled = false;
    for (const [projectId, paths] of places) {
      let version: number | null = null;
      const probe = async () => {
        try {
          const query = new URLSearchParams({ paths: JSON.stringify(paths) });
          const payload = await api<{ version: number; changedPaths: string[] | null }>(`/v0/projects/${encodeURIComponent(projectId)}/workspace/version?${query}`);
          if (cancelled) return;
          if (version !== null && version !== payload.version) {
            entries.forEach((entry, index) => {
              if (entry.projectId === projectId && (payload.changedPaths === null || payload.changedPaths.includes(entry.path))) void handles[index]?.reload();
            });
            void loadStatus(projectId);
          }
          version = payload.version;
        } catch {}
        if (!cancelled) timers.push(window.setTimeout(probe, POLL_INTERVAL_MS));
      };
      void probe();
    }
    onCleanup(() => { cancelled = true; timers.forEach((timer) => window.clearTimeout(timer)); });
  });
  // A header that no longer fits drops the actions its context menu also
  // has, then gathers the rest into its overflow menu, before the file's name
  // goes -- measured, not a width.
  let root: HTMLDivElement | undefined;
  const fitHeaders = () => root?.querySelectorAll<HTMLElement>(".workspace-preview-header").forEach((header) => {
    header.removeAttribute("data-compact");
    // The name needs room for at least the file's own name, measured from its text.
    const name = header.querySelector<HTMLElement>(".workspace-preview-file span");
    // Headed by tabs, every tab is the name: the actions fold before a tab does.
    const tabs = header.querySelector<HTMLElement>(".pane-tabs[data-need]");
    const nameFits = () => {
      if (!name && tabs) return tabs.clientWidth + 1 >= Number(tabs.dataset.need);
      const text = name?.firstChild;
      if (!name || !(text instanceof Text)) return true;
      const range = document.createRange();
      range.setStart(text, text.data.lastIndexOf("/") + 1);
      range.setEnd(text, text.data.length);
      return name.clientWidth + 1 >= range.getBoundingClientRect().width;
    };
    const squeezed = () => header.scrollWidth > header.clientWidth || !nameFits();
    // Actions fold one at a time, lowest data-fold first, into the header's ⋯.
    const foldable = [...header.querySelectorAll<HTMLElement>("[data-fold]")].sort((a, b) => Number(a.dataset.fold) - Number(b.dataset.fold));
    foldable.forEach((element) => element.removeAttribute("data-folded"));
    const gone: string[] = [];
    for (const element of foldable) {
      if (!squeezed()) break;
      element.setAttribute("data-folded", "");
      gone.push(element.dataset.fold!);
    }
    if (header.dataset.foldedActions !== gone.join()) {
      header.dataset.foldedActions = gone.join();
      header.dispatchEvent(new CustomEvent("headerfold", { detail: gone }));
    }
  });
  const resized = new ResizeObserver(fitHeaders);
  const changed = new MutationObserver(fitHeaders);
  onCleanup(() => { resized.disconnect(); changed.disconnect(); });
  const leaveContents = (index: number) => !handles[index]?.hasUnsavedChanges() || window.confirm("Discard unsaved changes to this file?");
  const closeEntry = (index: number) => {
    if (handles[index]?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and close this file?")) return;
    props.onCloseEntry(index);
  };
  const deleteFile = async (entry: FileEntry) => {
    if (!window.confirm(`Delete "${entry.path}"? This action cannot be undone.`)) return;
    try {
      await api<void>(`/v0/projects/${encodeURIComponent(entry.projectId)}/file?path=${encodeURIComponent(entry.path)}`, { method: "DELETE" });
      toast.success(`Deleted ${entry.path}`);
    } catch (cause) {
      reportError((cause as Error).message);
    }
  };
  // Two sides share the width by a rule between them, dragged.
  const sides = () => props.entries.length + (props.splitEmpty ? 1 : 0);
  const share = () => Math.min(0.8, Math.max(0.2, props.share ?? 0.5));
  const dragDivider = (event: PointerEvent) => {
    const divider = event.currentTarget as HTMLElement;
    const box = root!.getBoundingClientRect();
    divider.setPointerCapture(event.pointerId);
    divider.dataset.dragging = "";
    const move = (next: PointerEvent) => props.onShare?.(Math.min(0.8, Math.max(0.2, (next.clientX - box.left) / box.width)));
    const end = () => { delete divider.dataset.dragging; divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", end); divider.removeEventListener("pointercancel", end); };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", end);
    divider.addEventListener("pointercancel", end);
    event.preventDefault();
  };
  const splitButton = () => <Show when={props.entries.length === 1 && !props.splitEmpty}><WorkbenchButton type="button" class="workspace-preview-action" data-fold="1" aria-label="Open this file again beside" title="Split" onClick={() => props.onSplit()}><Columns2Icon /></WorkbenchButton></Show>;
  return <div ref={(element) => { root = element; resized.observe(element); changed.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-need"] }); }} class="workspace-files workspace-file-viewer" data-count={sides()} style={sides() > 1 ? { "--side-a": String(props.emptyFirst ? 1 - share() : share()), "--side-b": String(props.emptyFirst ? share() : 1 - share()) } : undefined}>
    <Index each={props.entries}>{(entry, index) =>
      <Show when={entry().mode} fallback={
        <WorkspaceFileSlot
          projectId={entry().projectId}
          path={entry().path}
          slot={index === 0 ? "primary" : "secondary"}
          focused={sides() > 1 && props.focused === index}
          closable
          busy={false}
          wrap={props.wrap(index)}
          onToggleWrap={() => props.onToggleWrap(index)}
          annotationChatId={props.commentChatId}
          gitFile={statuses()[entryKey(entry())]}
          onShowDiff={(staged) => { if (leaveContents(index)) props.onSetMode(index, staged ? "staged" : "changes"); }}
          headerSuffix={splitButton()}
          headerTabs={props.tabs?.(index)}
          headerEnd={index === props.entries.length - 1 && !(props.splitEmpty && !props.emptyFirst) ? props.paneActions?.() : undefined}
          headerMenuItems={(folded) => <>
            <Show when={props.entries.length === 1 && !props.splitEmpty && folded("1")}><MenuItem onSelect={() => props.onSplit()}><Columns2Icon />Open again beside</MenuItem></Show>
            {props.sideMenu?.(index)}
          </>}
          reveal={props.reveal && props.reveal.entry.projectId === entry().projectId && props.reveal.entry.path === entry().path ? props.reveal.request : null}
          onFocus={() => props.onFocusEntry(index)}
          onClose={() => closeEntry(index)}
          onError={reportError}
          onRemoved={(path, announce) => { props.onCloseEntry(index); if (announce) toast.info(`${path} was removed`); }}
          onDelete={() => void deleteFile(entry())}
          onLoaded={(file) => props.onLoaded?.(index, file)}
          ref={(handle) => { handles[index] = handle; props.ref(index, handle); }}
          onDispose={() => { handles[index] = undefined; props.ref(index, undefined); }}
        />
      }>{(mode) =>
        <ChangesEntry entry={entry()} mode={mode()} status={statuses()[entryKey(entry())]} focused={sides() > 1 && props.focused === index} tabs={props.tabs?.(index)} end={index === props.entries.length - 1 && !(props.splitEmpty && !props.emptyFirst) ? props.paneActions?.() : undefined}
          split={splitButton()} onFocus={() => props.onFocusEntry(index)} onClose={() => props.onCloseEntry(index)} onSetMode={(next) => props.onSetMode(index, next)}
          ref={(handle) => { handles[index] = handle; props.ref(index, handle); }} />
      }</Show>
    }</Index>
    {props.emptySide}
    <Show when={props.entries.length === 2 && props.onSwapSides}><button type="button" class="file-viewer-swap" tabIndex={-1} aria-label="Swap the sides" title="Swap the sides" style={{ left: `${share() * 100}%` }} onClick={() => props.onSwapSides?.()}><ArrowLeftRightIcon /></button></Show>
    <Show when={sides() > 1}><div class="file-viewer-divider" role="separator" aria-orientation="vertical" aria-label="Resize the sides" style={{ left: `${share() * 100}%` }} onPointerDown={dragDivider} onDblClick={() => props.onShare?.(0.5)} /></Show>
  </div>;
}

/** A file's unstaged or staged changes, drawn by the review's comparison (6d-3). */
function ChangesEntry(props: {
  entry: FileEntry;
  mode: "changes" | "staged";
  status?: GitChangedFile;
  focused: boolean;
  split: JSX.Element;
  onFocus: () => void;
  onClose: () => void;
  onSetMode: (mode: FileEntry["mode"]) => void;
  tabs?: JSX.Element;
  end?: JSX.Element;
  ref: (handle: FileSlotHandle) => void;
}) {
  const [comparison, { refetch }] = createResource(() => [props.entry.projectId, props.entry.path, props.mode] as const, ([projectId, path, scope]) =>
    api<ComparisonPayload | null>(`/v0/projects/${encodeURIComponent(projectId)}/diff?compare=1&scope=${scope}&path=${encodeURIComponent(path)}`)
      .catch((cause: unknown): ComparisonPayload => ({ path, oldPath: path, scope, kind: "unavailable", message: (cause as { message?: string })?.message || "These changes could not be loaded." })));
  props.ref({ path: () => props.entry.path, hasUnsavedChanges: () => false, reload: async () => { await refetch(); }, edit: () => props.onSetMode(undefined), save: async () => {}, discardChanges: () => {} });
  const other = () => props.mode === "changes" ? (hasStaged(props.status) ? "staged" as const : null) : (hasUnstaged(props.status) ? "changes" as const : null);
  const actions = <>
    <WorkbenchButton type="button" class="workspace-preview-action" aria-label="Show the file" title="Show the file" onClick={() => props.onSetMode(undefined)}><FileTextIcon /></WorkbenchButton>
    <Show when={other()}>{(next) => <WorkbenchButton type="button" class="workspace-preview-action" aria-label={next() === "staged" ? "Review staged changes" : "Review unstaged changes"} title={next() === "staged" ? "Review staged changes" : "Review unstaged changes"} onClick={() => props.onSetMode(next())}>{next() === "staged" ? <GitCompareArrowsIcon /> : <FileDiffIcon />}</WorkbenchButton>}</Show>
    {props.split}
    <Show when={!props.tabs}><WorkbenchButton type="button" class="workspace-preview-action workspace-preview-close" aria-label="Close file" title="Close file" onClick={() => props.onClose()}><XIcon /></WorkbenchButton></Show>
  </>;
  return <section class="workspace-preview workspace-changes-entry" tabIndex={-1} data-focused={props.focused} aria-label={`${props.entry.path} ${props.mode === "staged" ? "staged changes" : "changes"}`} onFocusIn={() => props.onFocus()} onPointerDown={() => props.onFocus()}>
    <Suspense>
      <Show when={comparison()} fallback={<div class="workspace-panel-empty">{comparison.loading ? "Loading changes…" : "No changes to show."}</div>}>{(payload) =>
        <WorkspaceComparison comparison={payload()} sourceKey={`${props.entry.projectId}:${props.entry.path}:${props.mode}`} viewState={{ layout: "unified", wrap: false, top: 0, left: 0, position: 0 }}
          headerAction={<><span class="workspace-changes-scope">{props.mode === "staged" ? "Staged" : "Changes"}</span>{actions}</>} headerTabs={props.tabs} headerEnd={props.end} />
      }</Show>
    </Suspense>
  </section>;
}
