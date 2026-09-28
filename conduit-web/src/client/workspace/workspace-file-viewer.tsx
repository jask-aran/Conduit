import { createEffect, createSignal, Index, onCleanup, Show } from "solid-js";
import { Columns2Icon } from "lucide-solid";
import { toast } from "solid-sonner";
import { api } from "../api/client";
import type { FileEntry } from "./file-documents";
import WorkspaceFileSlot, { type FileSlotHandle, type FileSummary } from "./workspace-file-slot";
import { reportError } from "./workspace-shared";
import { WorkbenchButton } from "./workspace-workbench";

const POLL_INTERVAL_MS = 1_500;

/**
 * A pane's file viewer (docs/design/panes-and-rail.md, 6d-2): one file, or
 * two side by side -- denser than a pane each. Each entry is an editor slot
 * of its own, with its own load, draft and save; the viewer keeps them fresh
 * against the workspace's version, as the dock's Files does for its slot.
 */
export default function FileViewer(props: {
  entries: FileEntry[];
  /** The entry the navigator's next file replaces. */
  focused: number;
  wrap: boolean;
  onToggleWrap: () => void;
  commentChatId: string | null;
  onFocusEntry: (index: number) => void;
  /** Open the file again beside itself, in this pane. */
  onSplit: () => void;
  onCloseEntry: (index: number) => void;
  onLoaded?: (index: number, file: FileSummary | null) => void;
  ref: (index: number, handle: FileSlotHandle | undefined) => void;
}) {
  const handles: (FileSlotHandle | undefined)[] = [];
  const [visible, setVisible] = createSignal(document.visibilityState === "visible");
  const noteVisibility = () => setVisible(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", noteVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", noteVisibility));
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
          }
          version = payload.version;
        } catch {}
        if (!cancelled) timers.push(window.setTimeout(probe, POLL_INTERVAL_MS));
      };
      void probe();
    }
    onCleanup(() => { cancelled = true; timers.forEach((timer) => window.clearTimeout(timer)); });
  });
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
  return <div class="workspace-files workspace-file-viewer" data-count={props.entries.length}>
    <Index each={props.entries}>{(entry, index) =>
      <WorkspaceFileSlot
        projectId={entry().projectId}
        path={entry().path}
        slot={index === 0 ? "primary" : "secondary"}
        focused={props.entries.length > 1 && props.focused === index}
        closable
        busy={false}
        wrap={props.wrap}
        onToggleWrap={props.onToggleWrap}
        annotationChatId={props.commentChatId}
        headerSuffix={<Show when={props.entries.length === 1}><WorkbenchButton type="button" class="workspace-preview-action" aria-label="Open this file again beside" title="Split" onClick={() => props.onSplit()}><Columns2Icon /></WorkbenchButton></Show>}
        onFocus={() => props.onFocusEntry(index)}
        onClose={() => closeEntry(index)}
        onError={reportError}
        onRemoved={(path, announce) => { props.onCloseEntry(index); if (announce) toast.info(`${path} was removed`); }}
        onDelete={() => void deleteFile(entry())}
        onLoaded={(file) => props.onLoaded?.(index, file)}
        ref={(handle) => { handles[index] = handle; props.ref(index, handle); }}
        onDispose={() => { handles[index] = undefined; props.ref(index, undefined); }}
      />
    }</Index>
  </div>;
}
