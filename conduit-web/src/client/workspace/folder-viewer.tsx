import { PaneHeader, Segmented, SheetFill, ToolContent, ToolKept } from "@/components/ui";
import { batch, createEffect, createSignal, on, Show, type Accessor, type JSX } from "solid-js";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import type { FileEntry } from "./file-documents";
import type { FileSlotHandle } from "./workspace-file-slot";
import { createFiles, FilesView } from "./workspace-files";
import { createSourceControl, SourceControlModes, SourceControlView } from "./workspace-source-control";
import { createWorkspacePoll } from "./workspace-poll";
import type { DiffScope } from "./workspace-review-source";
import { readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE } from "./workspace-panel-storage";
import { cachedWorkspace, createRequestScope } from "./workspace-shared";
import type { DirectoryListing, WorkspaceSettings } from "./workspace-types";

export type FolderMode = "files" | "changes";

/**
 * The folder viewer (DESIGN.md "Places and panes"): a tree and the file it opens, with the workspace's changes as its
 * other mode. Its state outlives either mode. One per host: the dock's follows the focused pane's workspace, a pane's
 * keeps its own. The host owns the mode, as the dock's phone strip chooses it too.
 */
export function createFolderViewer(options: {
  projectId: Accessor<string>; sourceControlEnabled: Accessor<boolean>; chatId: Accessor<string | null>;
  settings: WorkspaceSettings; settingsScope: string; mode: Accessor<FolderMode>; setMode: (mode: FolderMode) => void;
  shown: Accessor<boolean>; initialDirectory?: Accessor<DirectoryListing | undefined>;
}) {
  const requests = createRequestScope(options.projectId);
  const sourceControl = createSourceControl({ projectId: options.projectId, enabled: options.sourceControlEnabled, chatId: options.chatId, requests, settings: options.settings, settingsScope: options.settingsScope });
  const files = createFiles({ projectId: options.projectId, requests, settings: options.settings, settingsScope: options.settingsScope });
  const filesShown = () => options.shown() && options.mode() === "files";
  const changesShown = () => options.shown() && options.mode() === "changes" && options.sourceControlEnabled();
  const poll = createWorkspacePoll({ projectId: options.projectId, requests, files, sourceControl, sourceControlEnabled: options.sourceControlEnabled,
    hasInitialDirectory: Boolean(options.initialDirectory), shown: options.shown, filesShown, diffShown: changesShown });
  let loaded = "";
  createEffect(on(() => [options.projectId(), options.shown(), options.mode(), sourceControl.mode()] as const, ([projectId, shown]) => {
    if (!shown) return;
    if (loaded !== projectId) {
      if (loaded) requests.reset();
      loaded = projectId;
      const cached = cachedWorkspace(projectId);
      batch(() => {
        files.restoreFromCache(cached, options.initialDirectory?.());
        sourceControl.setDiff(cached?.diff || null);
      });
    }
    if (filesShown() && !files.directories()[""] && !files.filesLoading()) void files.loadDirectory("", false);
    if (options.sourceControlEnabled()) {
      const current = sourceControl.diff();
      const patch = changesShown() && sourceControl.mode() === "patch", history = changesShown() && sourceControl.mode() === "graph";
      if (!current || (patch && !current.diff) || (history && !current.commits)) void sourceControl.loadDiff(patch, history, Boolean(current));
    }
  }));
  return {
    requests, files, sourceControl, poll, mode: options.mode, setMode: options.setMode,
    /** A change reviewed in Changes, the open file's unsaved edit asked about first. */
    review: async (scope: DiffScope, path: string) => {
      if (!(await files.confirmDiscard(path, "Discard unsaved changes and review this file?"))) return;
      sourceControl.showReview(scope);
      options.setMode("changes");
      await sourceControl.refreshReview(path);
    },
    openWorking: async (path: string) => {
      if (await files.openInSlot("primary", path)) options.setMode("files");
    },
  };
}
export type FolderViewer = ReturnType<typeof createFolderViewer>;

export function FolderModes(props: { viewer: FolderViewer; sourceControlEnabled: boolean }) {
  return <>
    <Segmented arrows label="Folder viewer" value={props.viewer.mode()} onChange={props.viewer.setMode}
      options={[{ value: "files", label: "Files" }, { value: "changes", label: "Changes", disabled: !props.sourceControlEnabled }]} />
    <Show when={props.viewer.mode() === "changes" && props.sourceControlEnabled}><SourceControlModes control={props.viewer.sourceControl} /></Show>
  </>;
}

/** Both modes stay drawn, so switching keeps the tree's place and an open file's edit. */
export function FolderView(props: {
  viewer: FolderViewer; projectId: string; workingRoot: string; sourceControlEnabled: boolean; expanded?: boolean;
  commentChatId: string | null; chatAvailable: boolean; reveal: ReviewNavigationRequest | null;
  /** A file, or a change (`mode`), as a document pane of its own. */
  onOpenDocument?: (path: string, mode?: "changes" | "staged") => void;
  onOpenAs?: (path: string) => void; onBrowseDirectory?: (path: string) => void; onBrowseParent?: () => void;
  openInPane?: (path: string) => "focused" | "shown" | undefined; onHandle?: (handle: FileSlotHandle | undefined) => void;
}) {
  const v = props.viewer;
  const inspect = (path: string, staged: boolean, beside?: boolean) => beside && props.onOpenDocument
    ? props.onOpenDocument(path, staged ? "staged" : "changes") : void v.review(staged ? "staged" : "changes", path);
  createEffect(() => { if (!props.sourceControlEnabled && v.mode() === "changes") v.setMode("files"); });
  return <>
    <ToolKept shown={v.mode() === "files" || !props.sourceControlEnabled}>
      <FilesView control={v.files} expanded={Boolean(props.expanded)} projectId={props.projectId} workingRoot={props.workingRoot}
        sourceControlEnabled={props.sourceControlEnabled} gitFiles={v.sourceControl.diff()?.files ?? []} commentChatId={props.commentChatId} reveal={props.reveal}
        stale={v.poll.stale()} onRetryPoll={v.poll.retry} onSaved={() => void v.sourceControl.loadDiff(false, false)}
        onShowDiff={(slot, staged, beside) => { const path = v.files.openPaths()[slot]; if (path) inspect(path, staged, beside); }}
        onOpenAs={props.onOpenAs} onOpenBeside={props.onOpenDocument} onBrowseDirectory={props.onBrowseDirectory} onBrowseParent={props.onBrowseParent}
        openInPane={props.openInPane} onHandle={props.onHandle} />
    </ToolKept>
    <Show when={props.sourceControlEnabled}>
      <ToolKept shown={v.mode() === "changes"}>
        <SourceControlView control={v.sourceControl} stale={v.poll.stale()} onRetryPoll={v.poll.retry} chatAvailable={props.chatAvailable}
          commentChatId={props.commentChatId} reveal={props.reveal} onInspectFile={inspect} onOpenWorkingFile={(path) => void v.openWorking(path)} />
      </ToolKept>
    </Show>
  </>;
}

/** The folder viewer as a pane of its own: it keeps its workspace, and its open file is remembered per workspace. */
export default function FolderPane(props: {
  projectId: string; projectName: string; workingRoot: string; sourceControlEnabled: boolean; commentChatId: string | null; actions: JSX.Element;
  onOpenFile: (entry: FileEntry, options: { adopt?: boolean }) => void; openFiles: Accessor<Map<string, "focused" | "shown">>; onHandle: (handle: FileSlotHandle | undefined) => void;
}) {
  const [mode, setMode] = createSignal<FolderMode>("files");
  const read = (name: string) => readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, name);
  const viewer = createFolderViewer({ projectId: () => props.projectId, sourceControlEnabled: () => props.sourceControlEnabled, chatId: () => props.commentChatId,
    settings: { panel: read, geometry: read, fileScope: () => `folder:${props.projectId}` }, settingsScope: WORKSPACE_PANEL_GLOBAL_SCOPE, mode, setMode, shown: () => true });
  batch(() => { viewer.files.restoreOpenFiles(); viewer.files.restoreGeometry(); });
  const open = (path: string, mode?: FileEntry["mode"], adopt?: boolean) => props.onOpenFile({ projectId: props.projectId, path, ...(mode ? { mode } : {}) }, { adopt });
  return <SheetFill>
    <PaneHeader kind="tool" fit name="Files" nameTitle={props.workingRoot} place={props.projectName} placeTitle={props.workingRoot}
      modes={<FolderModes viewer={viewer} sourceControlEnabled={props.sourceControlEnabled} />} actions={props.actions} />
    <ToolContent>
      <FolderView viewer={viewer} projectId={props.projectId} workingRoot={props.workingRoot} sourceControlEnabled={props.sourceControlEnabled}
        commentChatId={props.commentChatId} chatAvailable={Boolean(props.commentChatId)} reveal={null} onOpenDocument={open} onOpenAs={(path) => open(path, undefined, true)}
        openInPane={(path) => props.openFiles().get(`${props.projectId}:${path}`)} onHandle={props.onHandle} />
    </ToolContent>
  </SheetFill>;
}
