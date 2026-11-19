import { Icons, Empty, IconButton } from "@/components/ui";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { createEffect, createResource, createSignal, Index, lazy, onCleanup, Show, Suspense, type JSX } from "solid-js";

import { FileViewer as Viewer } from "@/components/ui/file";
import { FileScope, FileChanges } from "@/components/ui/viewer";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import type { FileEntry } from "./file-documents";
import type { ComparisonPayload } from "./workspace-comparison";
import WorkspaceFileSlot, { type FileSlotHandle, type FileSummary } from "./workspace-file-slot";
import { reportError } from "./workspace-shared";
import type { DiffPayload, GitChangedFile, WorkspaceVersion } from "./workspace-types";

const WorkspaceComparison = lazy(() => import("./workspace-comparison"));
const POLL_INTERVAL_MS = 1_500;
const TOLD_POLL_INTERVAL_MS = 10_000;
// A device away is waited for (conduit:device-online), and asked about this often meanwhile.
const DEVICE_AWAY_POLL_MS = 30_000;
const entryKey = (entry: FileEntry) => `${entry.projectId}:${entry.path}`;
const hasUnstaged = (file?: GitChangedFile) => Boolean(file && (file.status === "??" || file.status[1] !== " "));
const hasStaged = (file?: GitChangedFile) => Boolean(file && file.status[0] !== " " && file.status[0] !== "?");

export default function FileViewer(props: {
  entries: FileEntry[];
  closable: boolean;
  wrap: (index: number) => boolean;
  onToggleWrap: (index: number) => void;
  commentChatId: string | null;
  onFocusEntry: (index: number) => void;
  onCloseEntry: (index: number) => void;
  onSetMode: (index: number, mode: FileEntry["mode"]) => void;
  paneActions?: () => JSX.Element;
  onLoaded?: (index: number, file: FileSummary | null) => void;
  ref: (index: number, handle: FileSlotHandle | undefined) => void;
  reveal?: { entry: FileEntry; request: ReviewNavigationRequest } | null;
}) {
  const { confirm: confirmDialog } = createDecisionScope(() => props.entries.map(entryKey).join("|"));
  const handles: (FileSlotHandle | undefined)[] = [];
  const [visible, setVisible] = createSignal(document.visibilityState === "visible");
  const noteVisibility = () => setVisible(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", noteVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", noteVisibility));
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
  createEffect(() => {
    if (!visible()) return;
    const places = new Map<string, string[]>();
    props.entries.forEach((entry) => places.set(entry.projectId, [...(places.get(entry.projectId) ?? []), entry.path]));
    const entries = props.entries;
    // Each place's pending probe, cleared with the effect: one per place, not one per probe ever armed.
    const stops: Array<() => void> = [];
    let cancelled = false;
    const listeners: Array<(event: Event) => void> = [];
    for (const [projectId, paths] of places) {
      let version: number | null = null;
      let told = false;
      let away = false;
      let probing = false;
      let again = false;
      let timer = 0;
      const probe = async () => {
        window.clearTimeout(timer);
        if (probing) { again = true; return; }
        probing = true;
        try {
          const query = new URLSearchParams({ paths: JSON.stringify(paths) });
          const payload = await api<WorkspaceVersion>(`/v0/projects/${encodeURIComponent(projectId)}/workspace/version?${query}`);
          if (cancelled) return;
          if (away || (version !== null && version !== payload.version)) {
            entries.forEach((entry, index) => {
              if (entry.projectId === projectId && (away || payload.changedPaths === null || payload.changedPaths.includes(entry.path))) void handles[index]?.reload();
            });
            void loadStatus(projectId);
          }
          version = payload.version;
          told = payload.told === true;
          away = false;
        } catch (cause) {
          away = (cause as { error?: string } | null)?.error === "device_offline";
        } finally { probing = false; }
        if (cancelled) return;
        if (again) { again = false; return void probe(); }
        timer = window.setTimeout(probe, away ? DEVICE_AWAY_POLL_MS : told ? TOLD_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
      };
      stops.push(() => window.clearTimeout(timer));
      const onChanged = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes(projectId)) void probe(); };
      const onDeviceOnline = () => { if (away) void probe(); };
      window.addEventListener("conduit:workspace-changed", onChanged);
      window.addEventListener("conduit:device-online", onDeviceOnline);
      listeners.push(onChanged, onDeviceOnline);
      void probe();
    }
    onCleanup(() => {
      cancelled = true;
      stops.forEach((stop) => stop());
      listeners.forEach((listener) => { window.removeEventListener("conduit:workspace-changed", listener); window.removeEventListener("conduit:device-online", listener); });
    });
  });
  const leaveContents = async (index: number) => !handles[index]?.hasUnsavedChanges() || (await confirmDialog("Discard unsaved changes to this file?"));
  const closeEntry = async (index: number) => {
    if (handles[index]?.hasUnsavedChanges() && !(await confirmDialog("Discard unsaved changes and close this file?"))) return;
    handles[index]?.discardChanges();
    props.onCloseEntry(index);
  };
  const deleteFile = async (entry: FileEntry) => {
    if (!(await confirmDialog(`Delete "${entry.path}"? This action cannot be undone.`))) return;
    try {
      await api<void>(`/v0/projects/${encodeURIComponent(entry.projectId)}/file?path=${encodeURIComponent(entry.path)}`, { method: "DELETE" });
      toast.success(`Deleted ${entry.path}`);
    } catch (cause) {
      reportError((cause as Error).message);
    }
  };
  return <Viewer>
    <Index each={props.entries}>{(entry, index) =>
      <Show when={entry().mode} fallback={
        <WorkspaceFileSlot
          projectId={entry().projectId}
          path={entry().path}
          slot={index === 0 ? "primary" : "secondary"}
          focused={false}
          closable={props.closable}
          busy={false}
          wrap={props.wrap(index)}
          onToggleWrap={() => props.onToggleWrap(index)}
          annotationChatId={props.commentChatId}
          gitFile={statuses()[entryKey(entry())]}
          onShowDiff={async (staged) => { if ((await leaveContents(index))) props.onSetMode(index, staged ? "staged" : "changes"); }}
          headerEnd={props.paneActions?.()}
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
        <ChangesEntry entry={entry()} closable={props.closable} mode={mode()} status={statuses()[entryKey(entry())]} focused={false} end={props.paneActions?.()}
          onFocus={() => props.onFocusEntry(index)} onClose={() => props.onCloseEntry(index)} onSetMode={(next) => props.onSetMode(index, next)}
          ref={(handle) => { handles[index] = handle; props.ref(index, handle); }} />
      }</Show>
    }</Index>
  </Viewer>;
}

function ChangesEntry(props: {
  entry: FileEntry;
  closable: boolean;
  mode: "changes" | "staged";
  status?: GitChangedFile;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSetMode: (mode: FileEntry["mode"]) => void;
  end?: JSX.Element;
  ref: (handle: FileSlotHandle) => void;
}) {
  const [comparison, { refetch }] = createResource(() => [props.entry.projectId, props.entry.path, props.mode] as const, ([projectId, path, scope]) =>
    api<ComparisonPayload | null>(`/v0/projects/${encodeURIComponent(projectId)}/diff?compare=1&scope=${scope}&path=${encodeURIComponent(path)}`)
      .catch((cause: unknown): ComparisonPayload => ({ path, oldPath: path, scope, kind: "unavailable", message: (cause as { message?: string })?.message || "These changes could not be loaded." })));
  props.ref({ path: () => props.entry.path, hasUnsavedChanges: () => false, reload: async () => { await refetch(); }, edit: () => { props.onSetMode(undefined); return false; }, save: async () => {}, discardChanges: () => {} });
  const other = () => props.mode === "changes" ? (hasStaged(props.status) ? "staged" as const : null) : (hasUnstaged(props.status) ? "changes" as const : null);
  const actions = <>
    <IconButton kind="file" type="button" aria-label="Show the file" title="Show the file" onClick={() => props.onSetMode(undefined)}><Icons.FileText /></IconButton>
    <Show when={other()}>{(next) => <IconButton kind="file" type="button" aria-label={next() === "staged" ? "Review staged changes" : "Review unstaged changes"} title={next() === "staged" ? "Review staged changes" : "Review unstaged changes"} onClick={() => props.onSetMode(next())}>{next() === "staged" ? <Icons.GitCompareArrows /> : <Icons.FileDiff />}</IconButton>}</Show>
    <Show when={props.closable}><IconButton kind="file" type="button" close aria-label="Close file" title="Close file" onClick={() => props.onClose()}><Icons.Close /></IconButton></Show>
  </>;
  return <FileChanges tabIndex={-1} focused={props.focused} aria-label={`${props.entry.path} ${props.mode === "staged" ? "staged changes" : "changes"}`} onFocusIn={() => props.onFocus()} onPointerDown={() => props.onFocus()}>
    <Suspense>
      <Show when={comparison()} fallback={<Empty>{comparison.loading ? "Loading changes…" : "No changes to show."}</Empty>}>{(payload) =>
        <WorkspaceComparison comparison={payload()} sourceKey={`${props.entry.projectId}:${props.entry.path}:${props.mode}`} viewState={{ layout: "unified", wrap: false, top: 0, left: 0, position: 0 }}
          headerAction={<><FileScope>{props.mode === "staged" ? "Staged" : "Changes"}</FileScope>{actions}</>} headerEnd={props.end} />
      }</Show>
    </Suspense>
  </FileChanges>;
}
