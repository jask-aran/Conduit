import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js";
import { BoxesIcon, Columns2Icon, CheckIcon, ChevronsUpIcon, ChevronDownIcon, ChevronRightIcon, CirclePlusIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, FileDiffIcon, FilePlusIcon, FolderIcon, FolderPlusIcon, GitBranchIcon, GitCommitHorizontalIcon, GitCompareArrowsIcon, Maximize2Icon, Minimize2Icon, MoveIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PencilIcon, PinIcon, PinOffIcon, RefreshCwIcon, SearchIcon, SendIcon, TerminalIcon, Trash2Icon, Undo2Icon, UploadIcon, XIcon } from "lucide-solid";
import { toast } from "solid-sonner";
import { Button, ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Spinner } from "@/components/primitives";
import { api, asList } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { COMMAND_IDS } from "../commands/command-registry";
import { focusFirst, isMobileLayout, restoreFocus } from "../navigation/mobile-layout";
import { ownsWorkspaceRequest, type WorkspaceRequest } from "./request-ownership";
import { TerminalPane } from "../remotes/terminal-pane";
import { dispatchPanelGeometryMotion, PANEL_MOTION_DURATION_MS } from "../panel-motion";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { FileTypeIcon, FolderTypeIcon } from "./file-type-icon";
import WorkspaceFileSlot, { type FileSlotHandle, type FileSummary } from "./workspace-file-slot";
import { readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE, writeSetting } from "./workspace-panel-storage";
import "./workspace.css";

interface TreeEntry { name: string; path: string; type: "directory" | "file" | "other"; }
interface DirectoryListing { entries: TreeEntry[]; truncated: boolean; cursor?: string | null; total?: number | null; oversize?: boolean; }
interface FileWriteResult { path: string; size: number; modifiedAt: number; revision: string; }
interface WorkspaceVersion { version: number; changedPaths: string[] | null; }
interface MovedEntry { path: string; destination: string; type: TreeEntry["type"]; }
interface GitActionResult { ok: true; output?: string; }
interface GitCommit { graph: string; hash: string; shortHash: string; subject: string; author: string; authoredAt: string; }
interface GitRef { name: string; hash: string; upstream: string | null; kind: "local" | "remote" | "tag"; }
interface DiffPayload { repository: boolean; branch?: string; upstream?: string | null; ahead?: number; behind?: number; commits?: GitCommit[]; refs?: GitRef[]; files: { status: string; path: string }[]; diff: string; }
interface GitCommitDetail { hash: string; content: string; }
type PanelTab = "files" | "diff" | "artifacts" | "terminal";
type ArtifactMode = "outputs" | "interactive";
type GitAction = "stage" | "stage-all" | "unstage" | "unstage-all" | "commit" | "fetch" | "pull" | "push";
type FileSlotId = "primary" | "secondary";
type OpenFiles = { primary: string | null; secondary: string | null };
type UploadTarget = { kind: "directory"; path: string } | { kind: "replacement"; path: string };

const PANEL_TABS = ["files", "diff", "artifacts", "terminal"] satisfies PanelTab[];

function isPanelTab(value: string): value is PanelTab {
  return value === "files" || value === "diff" || value === "artifacts" || value === "terminal";
}

interface WorkspaceCacheEntry {
  directories: Record<string, DirectoryListing>;
  diff: DiffPayload | null;
  expanded: Set<string>;
  treeScrollTop: number;
}

const MAX_CACHED_WORKSPACES = 6;
const workspaceCache = new Map<string, WorkspaceCacheEntry>();
const MIN_DETAIL_HEIGHT = 32;
const MIN_SOURCE_DETAIL_HEIGHT = 96;
const MIN_WORKSPACE_PANE_WIDTH = 240;
const WORKSPACE_SPLIT_GUTTER_WIDTH = 9;
const WIDE_FILES_MIN_WIDTH = 720;
const DEFAULT_TREE_WIDTH = 160;
const MIN_TREE_WIDTH = 128;
const MAX_TREE_WIDTH = 320;
const FILE_POLL_INTERVAL_MS = 1_500;

function directoryListingsEqual(left: DirectoryListing | undefined, right: DirectoryListing): boolean {
  return Boolean(left
    && left.truncated === right.truncated
    && left.cursor === right.cursor && left.total === right.total && left.oversize === right.oversize
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return entry.name === other?.name && entry.path === other.path && entry.type === other.type;
    }));
}

function errorCode(cause: unknown): string {
  return cause && typeof cause === "object" && "error" in cause && typeof cause.error === "string" ? cause.error : "";
}

function CommitHistory(props: { commits: GitCommit[]; refs: GitRef[]; branch?: string; onCopy: (hash: string) => void; onInspect: (commit: GitCommit) => void; labelled?: boolean }) {
  return <section class="workspace-history">
    <Show when={props.labelled}><header><div><GitCommitHorizontalIcon /><span>History</span></div><small>{props.commits.length} recent</small></header></Show>
    <div class="workspace-history-list">
      <For each={props.commits}>{(commit) =>
        <div class="workspace-commit">
          <code class="workspace-graph-rail" aria-hidden="true">{commit.graph || "*"}</code>
          <ContextMenu>
          <ContextMenuTrigger as="button" type="button" title={`Copy ${commit.hash} · ${commit.author} · ${new Date(commit.authoredAt).toLocaleString()}`} onClick={() => props.onCopy(commit.hash)}>
            <div class="workspace-commit-copy"><span>{commit.subject}</span><Show when={props.refs.some((ref) => ref.hash === commit.hash)}><div class="workspace-commit-refs"><For each={props.refs.filter((ref) => ref.hash === commit.hash)}>{(ref) => <code data-kind={ref.kind} data-current={ref.kind === "local" && ref.name === props.branch}>{ref.kind === "local" && ref.name === props.branch ? `HEAD · ${ref.name}` : ref.name}</code>}</For></div></Show></div>
            <small>{commit.author}</small>
            <code>{commit.shortHash}</code>
          </ContextMenuTrigger>
          <ContextMenuContent shortcutScope="workspace-panel" class="w-48 workspace-file-menu"><ContextMenuGroup>
            <ContextMenuItem onSelect={() => props.onInspect(commit)}><EyeIcon />Inspect commit</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onCopy(commit.hash)}><CopyIcon />Copy commit ID</ContextMenuItem>
          </ContextMenuGroup></ContextMenuContent>
          </ContextMenu>
        </div>
      }</For>
    </div>
  </section>;
}

function PatchView(props: { content: string }) {
  const [page, setPage] = createSignal(0);
  const lines = createMemo(() => props.content.split("\n"));
  createEffect(on(() => props.content, () => setPage(0)));
  return <><Show when={lines().length > 400}><div>
    <button type="button" disabled={page() === 0} onClick={() => setPage(page() - 1)}>Previous lines</button>
    <span> · Lines {page() * 400 + 1}–{Math.min((page() + 1) * 400, lines().length)} of {lines().length} · </span>
    <button type="button" disabled={(page() + 1) * 400 >= lines().length} onClick={() => setPage(page() + 1)}>Next lines</button>
  </div></Show><pre class="workspace-diff-content"><code><For each={lines().slice(page() * 400, (page() + 1) * 400)}>{(line) =>
    <span class="workspace-patch-line" data-kind={line.startsWith("+") && !line.startsWith("+++") ? "addition" : line.startsWith("-") && !line.startsWith("---") ? "deletion" : line.startsWith("@@") ? "hunk" : line.startsWith("# ") || line.startsWith("diff ") ? "heading" : "context"}>{line || " "}</span>
  }</For></code></pre></>;
}

function storedPaths(scopeId: string, name: string) {
  try {
    const value: unknown = JSON.parse(readSetting(scopeId, name) || "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  const value = bytes / 1024 ** (unit + 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

function cachedWorkspace(projectId: string) {
  const cached = workspaceCache.get(projectId);
  if (!cached) return null;
  workspaceCache.delete(projectId);
  workspaceCache.set(projectId, cached);
  return cached;
}

function cacheWorkspace(projectId: string, patch: Partial<WorkspaceCacheEntry>) {
  const current = workspaceCache.get(projectId) || { directories: {}, diff: null, expanded: new Set<string>(), treeScrollTop: 0 };
  workspaceCache.delete(projectId);
  workspaceCache.set(projectId, { ...current, ...patch });
  while (workspaceCache.size > MAX_CACHED_WORKSPACES) workspaceCache.delete(workspaceCache.keys().next().value!);
}

export default function WorkspacePanel(props: { projectId: Accessor<string>; projectName: Accessor<string>; sourceControlEnabled: Accessor<boolean>; workingRoot: Accessor<string>; chatId: Accessor<string>; open: Accessor<boolean>; expanded: Accessor<boolean>; focusRequest: Accessor<number>; requestedTab?: Accessor<{ tab: PanelTab; terminalId?: string; nonce: number } | null>; onToggleExpanded: () => void; onClose: () => void; shortcuts: ShortcutManager }) {
  let projectGeneration = 0;
  let requestVersion = 0;
  let projectController = new AbortController();
  const requests = new Map<string, WorkspaceRequest>();
  const requestControllers = new Map<number, AbortController>();
  let panelRoot: HTMLElement | undefined;
  let panelSurface: HTMLDivElement | undefined;
  let resizeHandle: HTMLDivElement | undefined;
  let detailHost: HTMLElement | undefined;
  let sourceDetailHost: HTMLElement | undefined;
  let filesHost: HTMLElement | undefined;
  let treeElement: HTMLElement | undefined;
  let treeResizeHandle: HTMLDivElement | undefined;
  let splitHost: HTMLElement | undefined;
  let fileFilterInput: HTMLInputElement | undefined;
  let fileUploadInput: HTMLInputElement | undefined;
  let filesResizeObserver: ResizeObserver | undefined;
  let splitResizeObserver: ResizeObserver | undefined;
  let panelEdgeMotionId: number | null = null;
  let panelMotionId = 0;
  let panelEdgeRaf = 0;
  let treeScrollRaf = 0;
  let treeTypeaheadTimer = 0;
  let treeTypeahead = "";
  let panelSurfaceMotion: Animation | null = null;
  let mobileReturnFocus: HTMLElement | null = null;
  let mobileWasOpen = false;
  const [pending, setPending] = createSignal(new Map<number, { foreground: boolean }>());
  const panelScope = () => props.chatId();
  const projectScope = () => props.projectId();
  const storedTab = () => {
    const value = readSetting(panelScope(), "tab") || "";
    return isPanelTab(value) ? value : "files";
  };
  const storedSecondary = () => {
    const stored = readSetting(panelScope(), "secondary-tab") || "";
    return isPanelTab(stored) ? stored : null;
  };
  const [tab, setTab] = createSignal<PanelTab>(storedTab());
  const [secondaryTab, setSecondaryTab] = createSignal<PanelTab | null>(storedSecondary());
  const [directories, setDirectories] = createSignal<Record<string, DirectoryListing>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [fileFilter, setFileFilter] = createSignal("");
  const [treeFocusPath, setTreeFocusPath] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [keptVisible, setKeptVisible] = createSignal(new Set<string>());
  const [filesWide, setFilesWide] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [uploadTarget, setUploadTarget] = createSignal<UploadTarget>({ kind: "directory", path: "" });
  const [primaryFile, setPrimaryFile] = createSignal<FileSummary | null>(null);
  const [openPaths, setOpenPaths] = createSignal<OpenFiles>({ primary: readSetting(panelScope(), "file"), secondary: readSetting(panelScope(), "file-secondary") });
  const [focusedSlot, setFocusedSlot] = createSignal<FileSlotId>("primary");
  const slotHandles = new Map<FileSlotId, FileSlotHandle>();
  const [wrapLines, setWrapLines] = createSignal(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "wrap-lines") === "true");
  const [diff, setDiff] = createSignal<DiffPayload | null>(null);
  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = createSignal(false);
  const [commitMessage, setCommitMessage] = createSignal("");
  const [gitAction, setGitAction] = createSignal("");
  const [stagedOpen, setStagedOpen] = createSignal(true);
  const [changesOpen, setChangesOpen] = createSignal(true);
  const [documentVisible, setDocumentVisible] = createSignal(document.visibilityState === "visible");
  const [networkOnline, setNetworkOnline] = createSignal(navigator.onLine);
  const [workspaceStale, setWorkspaceStale] = createSignal(false);
  const [pollRetry, setPollRetry] = createSignal(0);
  // Foreground failures surface as toasts; background refreshes stay silent so a
  // failing file cannot spam the corner every poll.
  const reportError = (message: string) => { if (message) toast.error(message); };
  const storedOpenFiles = (): OpenFiles => ({ primary: readSetting(panelScope(), "file"), secondary: readSetting(panelScope(), "file-secondary") });
  const [width, setWidth] = createSignal(Math.max(MIN_WORKSPACE_PANE_WIDTH, Math.min(496, Number(readSetting(projectScope(), "width")) || 336)));
  const [shellWidth, setShellWidth] = createSignal(props.open() ? width() : 0);
  const [shellGap, setShellGap] = createSignal(props.open() && !isMobileLayout() ? 8 : 0);
  const [treeWidth, setTreeWidth] = createSignal(Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, Number(readSetting(projectScope(), "tree-width")) || DEFAULT_TREE_WIDTH)));
  const [treeCollapsed, setTreeCollapsed] = createSignal(readSetting(projectScope(), "tree-collapsed") === "true");
  const [splitRatio, setSplitRatio] = createSignal(Math.max(0, Math.min(100, Number(readSetting(projectScope(), "split-ratio")) || 50)));
  const [splitWidth, setSplitWidth] = createSignal(0);
  const [fileSplitRatio, setFileSplitRatio] = createSignal(Math.max(25, Math.min(75, Number(readSetting(projectScope(), "file-split-ratio")) || 50)));
  const [artifactMode, setArtifactMode] = createSignal<ArtifactMode>("outputs");
  const [terminalFocusRequest, setTerminalFocusRequest] = createSignal(0);
  const detailOpenName = () => `${tab()}:detail-open`;
  const detailHeightName = () => `${tab()}:detail-height`;
  const sourceDetailOpenName = "diff:source-detail-open";
  const sourceDetailHeightName = "diff:source-detail-height";
  const detailOpenFor = (nextTab: PanelTab) => readSetting(panelScope(), `${nextTab}:detail-open`) ?? (nextTab === "diff" ? "false" : "true");
  const [detailOpen, setDetailOpen] = createSignal(detailOpenFor(tab()) === "true");
  const [diffDetailOpen, setDiffDetailOpen] = createSignal(detailOpenFor("diff") === "true");
  const [fileDiffMode, setFileDiffMode] = createSignal(false);
  const [selectedDiff, setSelectedDiff] = createSignal<{ path: string; staged: boolean } | null>(null);
  const [fileDiffText, setFileDiffText] = createSignal("");
  const [fileDiffBusy, setFileDiffBusy] = createSignal(false);
  const inspectFileDiff = (path: string, staged: boolean) => {
    setSelectedDiff({ path, staged });
    setFileDiffMode(true);
    setSourceDetailVisible(true);
  };
  createEffect(on(() => props.projectId(), () => { setSelectedDiff(null); setFileDiffMode(false); }));
  createEffect(() => {
    const selected = selectedDiff();
    const projectId = props.projectId();
    diff();
    if (!fileDiffMode() || !selected) return;
    const controller = new AbortController();
    setFileDiffBusy(true);
    setFileDiffText("");
    void api<{ diff: string }>(`/v0/projects/${encodeURIComponent(projectId)}/diff?path=${encodeURIComponent(selected.path)}&staged=${selected.staged ? "1" : "0"}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setFileDiffText(result.diff || "No tracked changes in this section. Untracked files can be viewed in Files."); })
      .catch((cause) => { if (!controller.signal.aborted) setFileDiffText((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setFileDiffBusy(false); });
    onCleanup(() => controller.abort());
  });
  const [sourceDetailOpen, setSourceDetailOpen] = createSignal(readSetting(panelScope(), sourceDetailOpenName) === "true");
  const [detailHeight, setDetailHeight] = createSignal(Math.max(128, Number(readSetting(panelScope(), detailHeightName())) || 288));
  const [sourceDetailHeight, setSourceDetailHeight] = createSignal(Math.max(MIN_SOURCE_DETAIL_HEIGHT, Number(readSetting(panelScope(), sourceDetailHeightName)) || 224));
  const hasPending = (operation?: string) => [...pending().keys()].some((version) => !operation || requests.get(operation)?.version === version);
  const diffLoading = () => hasPending("diff");
  const filesLoading = () => [...requests.keys()].some((operation) => operation.startsWith("directory:") && hasPending(operation));
  const loading = () => [...pending().values()].some((entry) => entry.foreground);
  const stagedFiles = createMemo(() => (diff()?.files || []).filter((file) => file.status[0] !== " " && file.status[0] !== "?"));
  const unstagedFiles = createMemo(() => (diff()?.files || []).filter((file) => file.status[1] !== " " || file.status === "??"));

  const ownsRequest = (request: WorkspaceRequest) => ownsWorkspaceRequest({
    projectId: props.projectId(),
    generation: projectGeneration,
    operation: request.operation,
    version: requests.get(request.operation)?.version || -1,
  }, request);
  const finishRequest = (request: WorkspaceRequest) => {
    if (requests.get(request.operation)?.version === request.version) requests.delete(request.operation);
    requestControllers.delete(request.version);
    setPending((current) => {
      const next = new Map(current);
      next.delete(request.version);
      return next;
    });
  };
  const startRequest = (operation: string, foreground: boolean) => {
    requests.get(operation) && requestControllers.get(requests.get(operation)!.version)?.abort();
    const controller = new AbortController();
    projectController.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const request: WorkspaceRequest = { projectId: props.projectId(), generation: projectGeneration, operation, version: ++requestVersion };
    requests.set(operation, request);
    requestControllers.set(request.version, controller);
    setPending((current) => new Map(current).set(request.version, { foreground }));
    return { request, controller };
  };
  const resetRequestScope = () => {
    projectController.abort();
    projectController = new AbortController();
    projectGeneration += 1;
    requests.clear();
    requestControllers.clear();
    setPending(new Map());
  };
  const wasAborted = (cause: unknown) => (cause as { name?: string })?.name === "AbortError";
  const updateDocumentVisibility = () => setDocumentVisible(document.visibilityState === "visible");
  const updateNetworkOnline = () => setNetworkOnline(true);
  const updateNetworkOffline = () => setNetworkOnline(false);
  document.addEventListener("visibilitychange", updateDocumentVisibility);
  window.addEventListener("online", updateNetworkOnline);
  window.addEventListener("offline", updateNetworkOffline);
  // The lazy panel can mount already open when invoked from the shortcut.
  // Its first visible state still needs the same entrance animation.
  let panelWasOpen = false;
  const cancelPanelEdgeMotion = () => {
    if (panelEdgeRaf) {
      cancelAnimationFrame(panelEdgeRaf);
      panelEdgeRaf = 0;
    }
    panelRoot?.removeAttribute("data-edge-instant");
  };
  const surfaceTranslateX = () => {
    if (!panelSurface) return 0;
    const transform = getComputedStyle(panelSurface).transform;
    if (transform === "none") return 0;
    return new DOMMatrixReadOnly(transform).m41;
  };
  const cancelPanelSurfaceMotion = () => {
    const current = panelSurfaceMotion ? surfaceTranslateX() : null;
    panelSurfaceMotion?.cancel();
    panelSurfaceMotion = null;
    return current;
  };
  const clearPanelSurfaceMotion = () => {
    panelSurfaceMotion?.cancel();
    panelSurfaceMotion = null;
    panelSurface?.style.removeProperty("transform");
    panelSurface?.style.removeProperty("opacity");
    panelSurface?.style.removeProperty("will-change");
  };
  const settlePanelEdgeMotion = () => {
    if (panelEdgeMotionId == null) return;
    const id = panelEdgeMotionId;
    cancelPanelEdgeMotion();
    panelEdgeMotionId = null;
    clearPanelSurfaceMotion();
    dispatchPanelGeometryMotion({
      phase: "end",
      id,
      source: "workspace",
      size: shellWidth() + shellGap(),
    });
  };
  const animatePanelGeometry = (open: boolean) => {
    const mobile = isMobileLayout();
    const startWidth = shellWidth();
    const startGap = shellGap();
    const targetWidth = open ? width() : 0;
    const targetGap = open && !mobile ? 8 : 0;
    const startSize = startWidth + startGap;
    const targetSize = targetWidth + targetGap;
    // A direct maximized open slides the full surface, not the docked width.
    const surfaceWidth = open && props.expanded() && panelRoot?.parentElement
      ? panelRoot.parentElement.clientWidth - targetGap
      : panelSurface?.getBoundingClientRect().width || width();
    const currentSurfaceX = cancelPanelSurfaceMotion();
    cancelPanelEdgeMotion();
    clearPanelSurfaceMotion();
    if (mobile) {
      panelEdgeMotionId = null;
      batch(() => {
        setShellWidth(targetWidth);
        setShellGap(targetGap);
      });
      return;
    }
    if (!panelRoot || !panelSurface || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      panelEdgeMotionId = null;
      panelRoot?.setAttribute("data-edge-instant", "true");
      batch(() => {
        setShellWidth(targetWidth);
        setShellGap(targetGap);
      });
      requestAnimationFrame(() => panelRoot?.removeAttribute("data-edge-instant"));
      return;
    }
    const id = ++panelMotionId;
    panelEdgeMotionId = id;
    const startSurfaceX = currentSurfaceX ?? (panelWasOpen ? 0 : surfaceWidth);
    const targetSurfaceX = open ? 0 : surfaceWidth;
    panelRoot.setAttribute("data-edge-instant", "true");
    dispatchPanelGeometryMotion({
      phase: "begin",
      id,
      source: "workspace",
      size: startSize,
      targetSize,
      duration: PANEL_MOTION_DURATION_MS,
      easing: "ease",
    });
    panelSurface.style.opacity = "1";
    panelSurface.style.willChange = "transform";
    panelSurface.style.transform = `translateX(${startSurfaceX}px)`;
    batch(() => {
      setShellWidth(targetWidth);
      setShellGap(targetGap);
    });
    const animation = panelSurface.animate([
      { transform: `translateX(${startSurfaceX}px)` },
      { transform: `translateX(${targetSurfaceX}px)` },
    ], {
      duration: PANEL_MOTION_DURATION_MS,
      easing: "ease",
      fill: "forwards",
    });
    panelSurfaceMotion = animation;
    animation.onfinish = () => {
      if (panelSurfaceMotion !== animation || panelEdgeMotionId !== id) return;
      panelSurfaceMotion = null;
      panelEdgeMotionId = null;
      panelSurface.style.removeProperty("transform");
      panelSurface.style.removeProperty("opacity");
      panelSurface.style.removeProperty("will-change");
      dispatchPanelGeometryMotion({
        phase: "end",
        id,
        source: "workspace",
        size: targetSize,
        targetSize,
      });
      panelRoot.removeAttribute("data-edge-instant");
    };
  };

  const selectTab = (next: PanelTab) => {
    setDetailOpen(detailOpenFor(next) === "true");
    setDetailHeight(Math.max(MIN_DETAIL_HEIGHT, Number(readSetting(panelScope(), `${next}:detail-height`)) || 288));
    setTab(next);
    writeSetting(panelScope(), "tab", next);
  };
  const splitActive = () => props.expanded() && secondaryTab() !== null;
  const saveSecondaryTab = (next: PanelTab | null) => {
    setSecondaryTab(next);
    writeSetting(panelScope(), "secondary-tab", next);
  };
  const toggleSplit = () => {
    if (!props.expanded()) return;
    if (splitActive()) {
      saveSecondaryTab(null);
      focusTabDefault(tab());
      return;
    }
    const next: PanelTab = tab() === "files" ? "diff" : "files";
    saveSecondaryTab(next);
    focusTabDefault(next, "right");
  };
  // Keyboard retargets whichever pane holds focus: unlike a click, focus already
  // says which half you are working in.
  const focusedPane = (): "left" | "right" => {
    if (!splitActive()) return "left";
    const active = document.activeElement;
    if (!(active instanceof Element)) return "left";
    const owner = active.closest("[data-pane],[data-position]");
    const side = owner?.getAttribute("data-pane") || owner?.getAttribute("data-position");
    return side === "right" ? "right" : "left";
  };
  createEffect(() => {
    if (props.sourceControlEnabled()) return;
    if (tab() === "diff") setTab("files");
    if (secondaryTab() === "diff") setSecondaryTab("terminal");
    setFileDiffMode(false);
    setSelectedDiff(null);
    setDiff(null);
  });
  const tabVisible = (candidate: PanelTab) => (candidate !== "diff" || props.sourceControlEnabled()) && (tab() === candidate || (props.expanded() && secondaryTab() === candidate));
  const panePosition = (candidate: PanelTab) => tab() === candidate ? "left" : secondaryTab() === candidate ? "right" : undefined;
  const tabLabel = (candidate: PanelTab) => candidate === "files" ? "Files" : candidate === "diff" ? "Source Control" : candidate === "artifacts" ? "Artifacts" : "Terminal";
  const setPaneTab = (side: "left" | "right", next: PanelTab) => {
    if (next === "diff" && !props.sourceControlEnabled()) next = "files";
    if (!splitActive()) {
      selectTab(next);
      return;
    }
    const left = tab();
    const right = secondaryTab() || (left === "files" ? "diff" : "files");
    if (side === "left") {
      if (next === right) saveSecondaryTab(left);
      selectTab(next);
    } else if (next === left) {
      selectTab(right);
      saveSecondaryTab(left);
    } else {
      saveSecondaryTab(next);
    }
  };
  const focusTabControl = (next: PanelTab, side: "left" | "right" = "left") => {
    const control = panelRoot?.querySelector<HTMLElement>(`[data-pane="${side}"][data-workspace-tab="${next}"]`);
    control?.focus({ preventScroll: true });
  };
  const focusTabDefault = (next: PanelTab, side: "left" | "right" = "left") => {
    if (next === "files") {
      if (!directories()[""]) void loadDirectory();
      queueMicrotask(() => fileFilterInput?.focus({ preventScroll: true }));
      return;
    }
    queueMicrotask(() => {
      focusTabControl(next, side);
      if (next === "terminal") setTerminalFocusRequest((request) => request + 1);
    });
  };
  const tabIcon = (candidate: PanelTab) => candidate === "files" ? <FolderIcon />
    : candidate === "diff" ? <GitCompareArrowsIcon />
    : candidate === "artifacts" ? <BoxesIcon />
    : <TerminalIcon />;
  // One strip per pane: the tabs you click always belong to the pane below them,
  // so a split needs no notion of an "active" pane.
  const paneTabs = (side: "left" | "right") => (
    <div class="workspace-panel-tabs-space" ref={(element) => {
      const observer = new ResizeObserver(() => {
        element.removeAttribute("data-icons-only");
        const tabs = element.firstElementChild;
        if (tabs && tabs.scrollWidth > element.clientWidth) element.setAttribute("data-icons-only", "true");
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    }}>
      <div class="workspace-panel-tabs" role="toolbar" aria-label={splitActive() ? `${side === "left" ? "Left" : "Right"} workspace pane views` : "Workspace views"}>
        <For each={PANEL_TABS}>{(item) => {
          const label = () => splitActive() ? `${tabLabel(item)} (${side === "left" ? "left" : "right"} pane)` : tabLabel(item);
          const disabled = () => item === "diff" && !props.sourceControlEnabled();
          return <button type="button" role="tab" data-pane={side} data-workspace-tab={item} disabled={disabled()} aria-label={disabled() ? `${label()}: unavailable for Chats and managed projects` : label()} title={disabled() ? "Source Control is available only for Workspaces" : label()} aria-selected={(side === "left" ? tab() : secondaryTab()) === item} onClick={() => changePaneTab(side, item)}>{tabIcon(item)}<span>{tabLabel(item)}</span></button>;
        }}</For>
      </div>
    </div>
  );
  const changePaneTab = (side: "left" | "right", value: string) => {
    if (!isPanelTab(value)) return;
    setPaneTab(side, value);
    focusTabDefault(value, side);
  };
  const workspaceShortcutAvailable = () => !document.querySelector(
    '.command-dialog[data-state="open"], .settings-dialog[data-state="open"], .conduit-modal[data-state="open"], .external-link-dialog[data-state="open"]',
  );
  const selectShortcutTab = (next: PanelTab) => {
    const side = focusedPane();
    setPaneTab(side, next);
    focusTabDefault(next, side);
  };
  const focusWorkspaceSurface = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button,a,input,textarea,select,[contenteditable='true'],[role='button'],[role='link'],[role='option'],[role='treeitem'],[role='menu'],[role^='menuitem']")) return;
    event.preventDefault();
    queueMicrotask(() => focusTabDefault(tab()));
  };
  const releaseShortcutHandlers = [
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceFiles, "workspace-panel", () => selectShortcutTab("files"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceSourceControl, "workspace-panel", () => selectShortcutTab("diff"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceArtifacts, "workspace-panel", () => selectShortcutTab("artifacts"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceTerminal, "workspace-panel", () => selectShortcutTab("terminal"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceSplit, "workspace-panel", toggleSplit, { when: workspaceShortcutAvailable }),
  ];
  onCleanup(() => releaseShortcutHandlers.forEach((release) => release()));
  const toggleDetail = () => {
    const next = !detailOpen();
    setDetailOpen(next);
    writeSetting(panelScope(), detailOpenName(), String(next));
  };
  const setSourceDetailVisible = (open: boolean) => {
    setSourceDetailOpen(open);
    writeSetting(panelScope(), sourceDetailOpenName, String(open));
  };
  const toggleSourceDetail = () => setSourceDetailVisible(!sourceDetailOpen());
  const selectSourceDetail = (patch: boolean) => {
    setFileDiffMode(false);
    setSourceDetailVisible(true);
    setCommitDetail(null);
    setDiffDetailOpen(patch);
    writeSetting(panelScope(), "diff:detail-open", String(patch));
    if (patch && !diff()?.diff) void loadDiff(true, false, true);
    if (!patch && !diff()?.commits) void loadDiff(false, true, true);
  };
  let stopDetailResize: (() => void) | undefined;
  let stopSourceDetailResize: (() => void) | undefined;
  const maxDetailHeight = () => Math.max(MIN_DETAIL_HEIGHT, (detailHost?.clientHeight || window.innerHeight) -
    (detailHost?.querySelector<HTMLElement>(".workspace-detail-dock-header, .workspace-preview-header")?.offsetHeight || 32) -
    MIN_DETAIL_HEIGHT);
  const clampDetailHeight = (value: number) => Math.max(MIN_DETAIL_HEIGHT, Math.min(maxDetailHeight(), value));
  const startDetailResize = (event: PointerEvent) => {
    stopDetailResize?.();
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = detailHeight();
    let pendingHeight = startHeight;
    let frame = 0;
    const apply = () => {
      frame = 0;
      setDetailHeight(clampDetailHeight(pendingHeight));
    };
    const move = (moveEvent: PointerEvent) => {
      pendingHeight = startHeight + startY - moveEvent.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      const next = clampDetailHeight(pendingHeight);
      setDetailHeight(next);
      writeSetting(panelScope(), detailHeightName(), String(next));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("workspace-detail-resizing");
      stopDetailResize = undefined;
    };
    stopDetailResize = stop;
    document.body.classList.add("workspace-detail-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  const resizeDetailByKey = (event: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? MIN_DETAIL_HEIGHT
      : event.key === "End"
        ? maxDetailHeight()
        : clampDetailHeight(detailHeight() + (event.key === "ArrowUp" ? 16 : -16));
    setDetailHeight(next);
    writeSetting(panelScope(), detailHeightName(), String(next));
  };
  const maxSourceDetailHeight = () => Math.max(MIN_SOURCE_DETAIL_HEIGHT, (sourceDetailHost?.clientHeight || window.innerHeight) - 112);
  const clampSourceDetailHeight = (value: number) => Math.max(MIN_SOURCE_DETAIL_HEIGHT, Math.min(maxSourceDetailHeight(), value));
  const startSourceDetailResize = (event: PointerEvent) => {
    stopSourceDetailResize?.();
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = sourceDetailHeight();
    let pendingHeight = startHeight;
    let frame = 0;
    const apply = () => { frame = 0; setSourceDetailHeight(clampSourceDetailHeight(pendingHeight)); };
    const move = (moveEvent: PointerEvent) => {
      pendingHeight = startHeight + startY - moveEvent.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      const next = clampSourceDetailHeight(pendingHeight);
      setSourceDetailHeight(next);
      writeSetting(panelScope(), sourceDetailHeightName, String(next));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("workspace-detail-resizing");
      stopSourceDetailResize = undefined;
    };
    stopSourceDetailResize = stop;
    document.body.classList.add("workspace-detail-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  const resizeSourceDetailByKey = (event: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? MIN_SOURCE_DETAIL_HEIGHT : event.key === "End"
      ? maxSourceDetailHeight()
      : clampSourceDetailHeight(sourceDetailHeight() + (event.key === "ArrowUp" ? 16 : -16));
    setSourceDetailHeight(next);
    writeSetting(panelScope(), sourceDetailHeightName, String(next));
  };
  const loadDirectory = async (directory = "", background = false, more = false) => {
    if (background && requests.has(`directory:${directory}`)) return false;
    const previous = directories()[directory];
    if (more && !previous?.cursor) return false;
    const { request, controller } = startRequest(`directory:${directory}`, !background);
    try {
      let cursor = more ? previous?.cursor : null;
      let entries = more ? [...(previous?.entries || [])] : [];
      let listing: DirectoryListing;
      do {
        const payload = await api<DirectoryListing>(`/v0/projects/${encodeURIComponent(request.projectId)}/tree?path=${encodeURIComponent(directory)}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`, { signal: controller.signal });
        if (!ownsRequest(request)) return false;
        entries = [...entries, ...asList<TreeEntry>(payload.entries)];
        listing = { ...payload, entries, truncated: payload.truncated === true };
        const nextCursor = payload.cursor;
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      } while (!more && entries.length < (previous?.entries.length || 0));
      if (!ownsRequest(request)) return false;
      let changed = false;
      setDirectories((current) => {
        if (directoryListingsEqual(current[directory], listing)) return current;
        changed = Boolean(current[directory]);
        const next = { ...current, [directory]: listing };
        cacheWorkspace(request.projectId, { directories: next });
        return next;
      });
      return changed;
    } catch (cause) {
      if (ownsRequest(request) && !background && !wasAborted(cause)) reportError((cause as Error).message);
    } finally {
      finishRequest(request);
    }
    return false;
  };
  const toggleDirectory = async (directory: string) => {
    const next = new Set(expanded());
    if (next.has(directory)) next.delete(directory);
    else { next.add(directory); if (!directories()[directory]) await loadDirectory(directory); }
    setExpanded(next);
    cacheWorkspace(props.projectId(), { expanded: next });
  };
  const isFileOpen = (path: string) => openPaths().primary === path || openPaths().secondary === path;
  const slotForPath = (path: string): FileSlotId | null =>
    openPaths().primary === path ? "primary" : openPaths().secondary === path ? "secondary" : null;
  const setSlotPath = (slot: FileSlotId, path: string | null) => {
    setOpenPaths((current) => ({ ...current, [slot]: path }));
    writeSetting(panelScope(), slot === "primary" ? "file" : "file-secondary", path);
  };
  // Only the slot being retargeted can lose a draft, so editing on one side is
  // never discarded by opening a file on the other.
  const openInSlot = (slot: FileSlotId, path: string) => {
    const handle = slotHandles.get(slot);
    if (openPaths()[slot] === path) {
      setFocusedSlot(slot);
      return;
    }
    if (handle?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and open another file?")) return;
    setSlotPath(slot, path);
    setFocusedSlot(slot);
  };
  const openFile = (path: string) => openInSlot(focusedSlot(), path);
  const openFileToSide = (path: string) => openInSlot("secondary", path);
  let pendingEdit: string | null = null;
  const editFile = (path: string) => {
    const slot = slotForPath(path);
    if (slot) {
      setFocusedSlot(slot);
      slotHandles.get(slot)?.edit();
      return;
    }
    pendingEdit = path;
    openFile(path);
  };
  const noteSlotLoaded = (slot: FileSlotId, file: FileSummary | null) => {
    if (slot === "primary") setPrimaryFile(file);
    if (file && pendingEdit === file.path) {
      pendingEdit = null;
      slotHandles.get(slot)?.edit();
    }
  };
  // Closing the left slot promotes the right one so the layout never holds a gap.
  const closeSlot = (slot: FileSlotId) => {
    if (slot === "secondary") {
      if (slotHandles.get("secondary")?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and close this file?")) return;
      setSlotPath("secondary", null);
      setFocusedSlot("primary");
      return;
    }
    const promoted = openPaths().secondary;
    const losesDraft = slotHandles.get("primary")?.hasUnsavedChanges() || (promoted && slotHandles.get("secondary")?.hasUnsavedChanges());
    if (losesDraft && !window.confirm("Discard unsaved changes and close this file?")) return;
    setSlotPath("primary", promoted);
    setSlotPath("secondary", null);
    setFocusedSlot("primary");
  };
  const dropOpenPath = (path: string) => {
    if (openPaths().secondary === path) setSlotPath("secondary", null);
    if (openPaths().primary === path) {
      const promoted = openPaths().secondary;
      setSlotPath("primary", promoted);
      if (promoted) setSlotPath("secondary", null);
      setFocusedSlot("primary");
    }
  };
  const pathIsWithin = (candidate: string | null, parent: string) =>
    Boolean(candidate && (candidate === parent || candidate.startsWith(`${parent}/`)));
  const hasUnsavedPath = (path: string) => [...slotHandles.entries()]
    .some(([slot, handle]) => pathIsWithin(openPaths()[slot], path) && handle.hasUnsavedChanges());
  const remapWorkspacePath = (candidate: string | null, source: string, destination: string) =>
    pathIsWithin(candidate, source) ? `${destination}${candidate!.slice(source.length)}` : candidate;
  const resetFileTree = async () => {
    const nextExpanded = new Set<string>();
    setDirectories({});
    setExpanded(nextExpanded);
    cacheWorkspace(props.projectId(), { directories: {}, expanded: nextExpanded });
    await loadDirectory("", true);
  };
  const remapOpenPaths = (source: string, destination: string) => {
    const current = openPaths();
    setSlotPath("primary", remapWorkspacePath(current.primary, source, destination));
    setSlotPath("secondary", remapWorkspacePath(current.secondary, source, destination));
    const nextKept = new Set([...keptVisible()].map((path) => remapWorkspacePath(path, source, destination) || path));
    setKeptVisible(nextKept);
    writeSetting(projectScope(), "kept-visible", JSON.stringify([...nextKept]));
  };
  const openSlotHandles = () => [...slotHandles.entries()]
    .filter(([slot]) => Boolean(openPaths()[slot]))
    .map(([, handle]) => handle);
  const saveFileSplitRatio = (next: number) => {
    const value = Math.max(25, Math.min(75, Math.round(next)));
    setFileSplitRatio(value);
    writeSetting(projectScope(), "file-split-ratio", String(value));
  };
  const startFileSplitResize = (event: PointerEvent) => {
    const primary = filesHost?.querySelector<HTMLElement>('.workspace-preview[data-slot="primary"]');
    const secondary = filesHost?.querySelector<HTMLElement>('.workspace-preview[data-slot="secondary"]');
    if (!primary || !secondary) return;
    event.preventDefault();
    const left = primary.getBoundingClientRect().left;
    const width = secondary.getBoundingClientRect().right - left;
    if (width <= 0) return;
    const move = (moveEvent: PointerEvent) => saveFileSplitRatio(((moveEvent.clientX - left) / width) * 100);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("workspace-split-resizing");
    };
    document.body.classList.add("workspace-split-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  // Downloading works on any tree entry, open or not, so it stays in the panel.
  const downloadPath = async (path: string) => {
    try {
      const response = await authorizedFetch(httpUrl(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(path)}&download=1`));
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message = body && typeof body === "object" && "message" in body ? String(body.message) : "Download failed";
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = path.split("/").at(-1) || "download";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      reportError((cause as Error).message);
    }
  };
  const chooseUpload = (target: UploadTarget = { kind: "directory", path: "" }) => {
    setUploadTarget(target);
    if (fileUploadInput) {
      fileUploadInput.value = "";
      fileUploadInput.click();
    }
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const target = uploadTarget();
    const replacement = files.item(0);
    if (!replacement) return;
    if (target.kind === "replacement" && !window.confirm(`Replace "${target.path}" with "${replacement.name}"?`)) return;
    setUploading(true);
    try {
      if (target.kind === "replacement") {
        await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(target.path)}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "if-match": "*" },
          body: replacement,
        });
        await loadDirectory(target.path.split("/").slice(0, -1).join("/"), true);
        const reloading = slotForPath(target.path);
        if (reloading) await slotHandles.get(reloading)?.reload();
        toast.success(`Replaced ${target.path}`);
        return;
      }
      for (const file of files) {
        const path = target.path ? `${target.path}/${file.name}` : file.name;
        await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(path)}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        });
      }
      await loadDirectory(target.path, true);
    } catch (cause) {
      reportError((cause as Error).message);
      await loadDirectory(target.kind === "directory" ? target.path : target.path.split("/").slice(0, -1).join("/"), true);
    } finally {
      setUploading(false);
    }
  };
  const deleteFile = async (path: string) => {
    if (!window.confirm(`Delete "${path}"? This action cannot be undone.`)) return;
    setUploading(true);
    try {
      await api<void>(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      await loadDirectory(path.split("/").slice(0, -1).join("/"), true);
      dropOpenPath(path);
      toast.success(`Deleted ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const requestedName = (label: string, initial = "") => {
    const value = window.prompt(label, initial);
    if (value == null) return null;
    const name = value.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      reportError("Enter one file or folder name without slashes");
      return null;
    }
    return name;
  };
  const joinPath = (parent: string, name: string) => parent ? `${parent}/${name}` : name;
  const createFile = async (parent = "") => {
    const name = requestedName("New file name:");
    if (!name) return;
    const path = joinPath(parent, name);
    setUploading(true);
    try {
      await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: new Blob([]),
      });
      await loadDirectory(parent, true);
      openFile(path);
      toast.success(`Created ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await loadDirectory(parent, true);
    } finally {
      setUploading(false);
    }
  };
  const createDirectory = async (parent = "") => {
    const name = requestedName("New folder name:");
    if (!name) return;
    const path = joinPath(parent, name);
    setUploading(true);
    try {
      await api<{ path: string }>(`/v0/projects/${encodeURIComponent(props.projectId())}/directory`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      await loadDirectory(parent, true);
      toast.success(`Created ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await loadDirectory(parent, true);
    } finally {
      setUploading(false);
    }
  };
  const moveEntry = async (entry: TreeEntry, destination: string) => {
    if (destination === entry.path) return;
    if (hasUnsavedPath(entry.path)) {
      reportError("Save or discard changes in this item before moving it");
      return;
    }
    setUploading(true);
    try {
      const moved = await api<MovedEntry>(`/v0/projects/${encodeURIComponent(props.projectId())}/entry`, {
        method: "PATCH",
        body: JSON.stringify({ path: entry.path, destination }),
      });
      remapOpenPaths(moved.path, moved.destination);
      await resetFileTree();
      toast.success(`Moved ${moved.path} to ${moved.destination}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await resetFileTree();
    } finally {
      setUploading(false);
    }
  };
  const renameEntry = (entry: TreeEntry) => {
    const name = requestedName(`Rename "${entry.name}" to:`, entry.name);
    if (!name || name === entry.name) return;
    const parent = entry.path.split("/").slice(0, -1).join("/");
    void moveEntry(entry, joinPath(parent, name));
  };
  const moveEntryToFolder = (entry: TreeEntry) => {
    const currentParent = entry.path.split("/").slice(0, -1).join("/");
    const value = window.prompt(`Move "${entry.name}" to folder (relative to workspace root; leave blank for root):`, currentParent);
    if (value == null) return;
    const parent = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    void moveEntry(entry, joinPath(parent, entry.name));
  };
  const deleteDirectory = async (path: string) => {
    if (hasUnsavedPath(path)) {
      reportError("Save or discard changes in this folder before deleting it");
      return;
    }
    if (!window.confirm(`Delete folder "${path}" and all its contents? This action cannot be undone.`)) return;
    setUploading(true);
    try {
      await api<void>(`/v0/projects/${encodeURIComponent(props.projectId())}/directory?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (pathIsWithin(openPaths().secondary, path)) setSlotPath("secondary", null);
      if (pathIsWithin(openPaths().primary, path)) dropOpenPath(openPaths().primary!);
      await resetFileTree();
      toast.success(`Deleted ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await resetFileTree();
    } finally {
      setUploading(false);
    }
  };
  const refreshFiles = async () => {
    const loaded = Object.keys(directories());
    for (const directory of loaded.length ? loaded : [""]) await loadDirectory(directory, true);
    await Promise.all(openSlotHandles().map((handle) => handle.reload()));
  };
  const visibleWorkspacePaths = () => [...new Set([
    "",
    ...expanded(),
    ...Object.values(openPaths()).filter((path): path is string => Boolean(path)),
  ])];
  const changedDirectory = (directory: string, changedPath: string) => {
    const parent = changedPath.slice(0, Math.max(0, changedPath.lastIndexOf("/")));
    return directory === changedPath || directory === parent;
  };
  const changedFile = (file: string | null, changedPath: string) => Boolean(file
    && (file === changedPath || file.startsWith(`${changedPath}/`)));
  let pollingWorkspace = false;
  let workspacePollFailures = 0;
  let workspaceVersionProjectId = "";
  let workspaceVersion: number | null = null;
  const refreshChangedWorkspace = async (changedPaths: string[] | null, projectId: string) => {
    const visibleDirectories = ["", ...expanded()].filter((directory) => directory === "" || Boolean(directories()[directory]));
    const directoriesToRefresh = changedPaths === null
      ? visibleDirectories
      : visibleDirectories.filter((directory) => changedPaths.some((changedPath) => changedDirectory(directory, changedPath)));
    let treeChanged = false;
    for (const directory of directoriesToRefresh) {
      if (await loadDirectory(directory, true)) treeChanged = true;
    }
    const slotsToRefresh = changedPaths === null
      ? openSlotHandles()
      : [...slotHandles.entries()]
        .filter(([slot]) => changedPaths.some((changedPath) => changedFile(openPaths()[slot], changedPath)))
        .map(([, handle]) => handle);
    await Promise.all(slotsToRefresh.map((handle) => handle.reload()));
    if (props.projectId() !== projectId) return;
    if (treeChanged) toast.info("Workspace files updated");
    await loadDiff(tabVisible("diff") && sourceDetailOpen() && diffDetailOpen(), tabVisible("diff") && sourceDetailOpen() && !diffDetailOpen(), false, true);
  };
  const pollWorkspace = async () => {
    if (pollingWorkspace || uploading()) return true;
    pollingWorkspace = true;
    const projectId = props.projectId();
    if (workspaceVersionProjectId !== projectId) {
      workspaceVersionProjectId = projectId;
      workspaceVersion = null;
      workspacePollFailures = 0;
      setWorkspaceStale(false);
    }
    const { request, controller } = startRequest("workspace-version", false);
    try {
      const query = new URLSearchParams({ paths: JSON.stringify(visibleWorkspacePaths()) });
      const payload = await api<WorkspaceVersion>(`/v0/projects/${encodeURIComponent(projectId)}/workspace/version?${query}`, { signal: controller.signal });
      if (!ownsRequest(request)) return true;
      const initialProbe = workspaceVersion === null;
      const changed = workspaceVersion !== payload.version;
      workspaceVersion = payload.version;
      if ((!initialProbe || Object.keys(directories()).length || diff() || openSlotHandles().length) && changed) {
        await refreshChangedWorkspace(payload.changedPaths, projectId);
      }
      workspacePollFailures = 0;
      setWorkspaceStale(false);
      return true;
    } catch (cause) {
      if (props.projectId() === projectId && !wasAborted(cause)) {
        workspacePollFailures += 1;
        if (workspacePollFailures >= 2) setWorkspaceStale(true);
        console.warn("workspace poll failed", cause);
        return false;
      }
      return true;
    } finally {
      finishRequest(request);
      pollingWorkspace = false;
    }
  };
  const retryWorkspacePoll = () => {
    workspacePollFailures = 0;
    setWorkspaceStale(false);
    setPollRetry((attempt) => attempt + 1);
  };
  const loadDiff = async (includePatch = false, includeHistory = false, reuse = false, background = false) => {
    if (!props.sourceControlEnabled()) return;
    const { request, controller } = startRequest("diff", !background);
    try {
      const endpoint = `/v0/projects/${encodeURIComponent(request.projectId)}/diff`;
      // Show the first status before waiting for history or a full patch.
      if (!diff() && (includePatch || includeHistory)) {
        const overview = await api<DiffPayload>(`${endpoint}?history=0${reuse ? "&reuse=1" : ""}`, { signal: controller.signal });
        if (!ownsRequest(request)) return;
        setDiff(overview);
        cacheWorkspace(request.projectId, { diff: overview });
        if (!overview.repository) return;
        reuse = true;
      }
      const query = new URLSearchParams();
      if (includePatch) query.set("patch", "1");
      if (!includeHistory) query.set("history", "0");
      if (reuse) query.set("reuse", "1");
      const payload = await api<DiffPayload>(`${endpoint}${query.size ? `?${query}` : ""}`, { signal: controller.signal });
      if (ownsRequest(request)) {
        const next = includeHistory ? payload : { ...payload, commits: undefined, refs: undefined };
        setDiff(next);
        cacheWorkspace(request.projectId, { diff: next });
      }
    }
    catch (cause) {
      if (ownsRequest(request) && !wasAborted(cause)) reportError((cause as Error).message);
    }
    finally {
      finishRequest(request);
    }
  };
  const inspectCommit = async (commit: GitCommit) => {
    setFileDiffMode(false);
    setSourceDetailVisible(true);
    setDiffDetailOpen(true);
    writeSetting(panelScope(), "diff:detail-open", "true");
    setCommitDetail(null);
    setCommitDetailLoading(true);
    const { request, controller } = startRequest("commit", true);
    try {
      const payload = await api<GitCommitDetail>(`/v0/projects/${encodeURIComponent(request.projectId)}/commits/${encodeURIComponent(commit.hash)}`, { signal: controller.signal });
      if (ownsRequest(request)) setCommitDetail(payload);
    } catch (cause) {
      if (ownsRequest(request) && !wasAborted(cause)) reportError((cause as Error).message);
    } finally {
      if (ownsRequest(request)) setCommitDetailLoading(false);
      finishRequest(request);
    }
  };
  const runGitAction = async (action: GitAction, path?: string) => {
    if (gitAction()) return;
    if (action === "commit" && !commitMessage().trim()) return;
    if (action === "push" && !window.confirm(`Push ${diff()?.branch || "the current branch"} to its configured remote?`)) return;
    setGitAction(action);
    try {
      await api<GitActionResult>(`/v0/projects/${encodeURIComponent(props.projectId())}/git`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, path, message: action === "commit" ? commitMessage().trim() : undefined }),
      });
      if (action === "commit") setCommitMessage("");
      await loadDiff(sourceDetailOpen() && diffDetailOpen(), sourceDetailOpen() && !diffDetailOpen());
    } catch (cause) {
      reportError((cause as Error).message);
    } finally {
      setGitAction("");
    }
  };
  const copy = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };
  const clampWidth = (next: number) => Math.max(MIN_WORKSPACE_PANE_WIDTH, Math.min(Math.floor(window.innerWidth * 0.65), next));
  // Every atomic width commit has to announce itself. The transcript learns its
  // own width only from geometry motion, so a commit that skips the event
  // leaves it laid out for the panel's previous size until something unrelated
  // nudges it. The drag has its own begin/change/end; this is for the commits
  // that land in one step -- keyboard resize and the project-change reset.
  const commitWidth = (next: number) => {
    const value = clampWidth(next);
    const startSize = shellWidth() + shellGap();
    batch(() => {
      setWidth(value);
      if (props.open()) setShellWidth(value);
    });
    if (!props.open()) return value;
    const targetSize = value + shellGap();
    if (Math.abs(targetSize - startSize) > 0.5) {
      const id = ++panelMotionId;
      dispatchPanelGeometryMotion({ phase: "begin", id, source: "workspace", size: startSize, targetSize, duration: 0 });
      dispatchPanelGeometryMotion({ phase: "end", id, source: "workspace", size: targetSize });
    }
    return value;
  };
  const saveWidth = (next: number) => {
    writeSetting(projectScope(), "width", String(commitWidth(next)));
  };
  let stopResize: (() => void) | undefined;
  createEffect(() => {
    const open = props.open();
    if (open !== panelWasOpen) {
      if (!open) resetRequestScope();
      animatePanelGeometry(open);
    }
    panelWasOpen = open;
  });
  createEffect(() => {
    const open = props.open() && isMobileLayout();
    if (open && !mobileWasOpen) {
      mobileReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      queueMicrotask(() => focusFirst(panelRoot));
    } else if (!open && mobileWasOpen) {
      const previous = mobileReturnFocus;
      mobileReturnFocus = null;
      queueMicrotask(() => restoreFocus(previous, [".composer textarea", 'button[aria-label="Toggle workspace panel"]', ".mobile-sidebar-trigger"]));
    }
    mobileWasOpen = open;
  });
  createEffect(() => {
    const projectId = props.projectId();
    const active = Boolean(projectId) && props.open() && (tabVisible("files") || tabVisible("diff")) && documentVisible() && networkOnline();
    pollRetry();
    if (!active) {
      workspaceVersion = null;
      return;
    }
    let cancelled = false;
    let timer = 0;
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        const success = await pollWorkspace();
        if (!cancelled) schedule(success ? FILE_POLL_INTERVAL_MS : Math.min(30_000, FILE_POLL_INTERVAL_MS * 2 ** workspacePollFailures));
      }, delay);
    };
    schedule(0);
    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });
  const startResize = (event: PointerEvent) => {
    if (isMobileLayout()) return;
    stopResize?.();
    event.preventDefault();
    resizeHandle?.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = width();
    let pendingWidth = startWidth;
    let frame = 0;
    let stopped = false;
    const id = ++panelMotionId;
    settlePanelEdgeMotion();
    // Open/close uses CSS width transition; resize must not, or the shell lags
    // the pointer and the gutter/transcript fight the ease.
    panelRoot?.setAttribute("data-edge-instant", "true");
    if (panelRoot) panelRoot.style.transition = "none";
    dispatchPanelGeometryMotion({ phase: "begin", id, source: "workspace", size: startWidth + shellGap() });
    const apply = () => {
      frame = 0;
      const nextWidth = clampWidth(pendingWidth);
      // Resize edge is layout truth: shell and surface stay equal every frame so
      // chat-main stays adjacent and the flex slot cannot outgrow the surface.
      batch(() => {
        setWidth(nextWidth);
        setShellWidth(nextWidth);
      });
      dispatchPanelGeometryMotion({ phase: "change", id, source: "workspace", size: nextWidth + shellGap() });
    };
    const move = (moveEvent: PointerEvent) => {
      pendingWidth = startWidth + startX - moveEvent.clientX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      const nextWidth = clampWidth(pendingWidth);
      batch(() => {
        setWidth(nextWidth);
        setShellWidth(nextWidth);
      });
      writeSetting(projectScope(), "width", String(nextWidth));
      dispatchPanelGeometryMotion({ phase: "end", id, source: "workspace", size: nextWidth + shellGap() });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      resizeHandle?.removeEventListener("lostpointercapture", stop);
      if (resizeHandle?.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      document.body.classList.remove("workspace-resizing");
      panelRoot?.removeAttribute("data-edge-instant");
      panelRoot?.style.removeProperty("transition");
      stopResize = undefined;
    };
    stopResize = stop;
    document.body.classList.add("workspace-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
    resizeHandle?.addEventListener("lostpointercapture", stop, { once: true });
  };
  onCleanup(() => {
    resetRequestScope();
    cancelPanelEdgeMotion();
    clearPanelSurfaceMotion();
    stopResize?.();
      stopDetailResize?.();
      stopSourceDetailResize?.();
    filesResizeObserver?.disconnect();
    splitResizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", updateDocumentVisibility);
    window.removeEventListener("online", updateNetworkOnline);
    window.removeEventListener("offline", updateNetworkOffline);
    if (treeScrollRaf) cancelAnimationFrame(treeScrollRaf);
    if (treeTypeaheadTimer) window.clearTimeout(treeTypeaheadTimer);
    document.body.classList.remove("workspace-resizing");
    document.body.classList.remove("workspace-detail-resizing");
    document.body.classList.remove("workspace-tree-resizing");
    document.body.classList.remove("workspace-split-resizing");
  });

  let loadedProjectId = "";
  let geometryProjectId = "";
  createEffect(on(() => [props.chatId(), props.projectId()] as const, () => {
    const nextTab = storedTab();
    const projectChanged = geometryProjectId !== props.projectId();
    if (projectChanged) {
      geometryProjectId = props.projectId();
      stopResize?.();
    }
    let pendingWidthCommit: number | null = null;
    batch(() => {
      setDetailOpen(detailOpenFor(nextTab) === "true");
      setDiffDetailOpen(detailOpenFor("diff") === "true");
      setSourceDetailOpen(readSetting(panelScope(), sourceDetailOpenName) === "true");
      setDetailHeight(Math.max(MIN_DETAIL_HEIGHT, Number(readSetting(panelScope(), `${nextTab}:detail-height`)) || 288));
      setSourceDetailHeight(Math.max(MIN_SOURCE_DETAIL_HEIGHT, Number(readSetting(panelScope(), sourceDetailHeightName)) || 224));
      setCommitDetail(null);
      if (projectChanged) {
        pendingWidthCommit = Number(readSetting(projectScope(), "width")) || 336;
        setTreeWidth(Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, Number(readSetting(projectScope(), "tree-width")) || DEFAULT_TREE_WIDTH)));
        setTreeCollapsed(readSetting(projectScope(), "tree-collapsed") === "true");
        setSplitRatio(Math.max(0, Math.min(100, Number(readSetting(projectScope(), "split-ratio")) || 50)));
        setFileSplitRatio(Math.max(25, Math.min(75, Number(readSetting(projectScope(), "file-split-ratio")) || 50)));
        setShowHidden(readSetting(projectScope(), "show-hidden") === "true");
        setKeptVisible(storedPaths(projectScope(), "kept-visible"));
      }
      setTab(nextTab);
      setSecondaryTab(storedSecondary());
      setOpenPaths(storedOpenFiles());
      setFocusedSlot("primary");
    });
    if (pendingWidthCommit != null) commitWidth(pendingWidthCommit);
  }));
  createEffect(on(() => props.requestedTab?.(), (next) => {
    if (next) selectShortcutTab(next.tab);
  }));
  createEffect(on(() => props.focusRequest(), (request, previous) => {
    if (request && request !== previous && props.open()) focusTabDefault(tab());
  }));
  createEffect(on(
    () => [props.projectId(), tab(), secondaryTab(), props.open(), props.expanded(), diffDetailOpen(), sourceDetailOpen()] as const,
    ([projectId, activeTab, companionTab, open, panelExpanded]) => {
      if (!open) return;
      const projectChanged = loadedProjectId !== projectId;
      if (projectChanged) {
        if (loadedProjectId) resetRequestScope();
        loadedProjectId = projectId;
        const cached = cachedWorkspace(projectId);
        batch(() => {
          setDirectories(cached?.directories || {});
          setExpanded(cached?.expanded || new Set<string>());
          setFileFilter("");
          setTreeFocusPath(openPaths().primary || "");
          setDiff(cached?.diff || null);
        });
        queueMicrotask(() => {
          if (treeElement) treeElement.scrollTop = cached?.treeScrollTop || 0;
        });
      }
      const filesVisible = activeTab === "files" || (panelExpanded && companionTab === "files");
      const diffVisible = activeTab === "diff" || (panelExpanded && companionTab === "diff");
      if (filesVisible && !directories()[""] && !filesLoading()) void loadDirectory("", false);
      if (diffVisible) {
        const includePatch = sourceDetailOpen() && diffDetailOpen();
        const includeHistory = sourceDetailOpen() && !diffDetailOpen();
        const current = diff();
        const needsPatch = diffVisible && includePatch;
        const needsHistory = diffVisible && includeHistory;
        if (!current || (needsPatch && !current.diff) || (needsHistory && !current.commits)) void loadDiff(needsPatch, needsHistory, Boolean(current));
      }
    }));

  function entryMatchesFilter(entry: TreeEntry, query: string): boolean {
    const kept = [...keptVisible()].some((path) => path === entry.path || path.startsWith(`${entry.path}/`));
    if (!showHidden() && entry.name.startsWith(".") && !kept) return false;
    if (!query || entry.name.toLowerCase().includes(query)) return true;
    return entry.type === "directory" && (directories()[entry.path]?.entries || []).some((child) => entryMatchesFilter(child, query));
  }
  const visibleEntries = (directory: string) => {
    const query = fileFilter().trim().toLowerCase();
    return (directories()[directory]?.entries || []).filter((entry) => entryMatchesFilter(entry, query));
  };
  const directoryIsOpen = (path: string) => expanded().has(path) || Boolean(fileFilter().trim() && directories()[path]);
  const visibleTreePaths = createMemo(() => {
    const paths: string[] = [];
    const collect = (directory: string) => {
      for (const entry of visibleEntries(directory)) {
        paths.push(entry.path);
        if (entry.type === "directory" && directoryIsOpen(entry.path)) collect(entry.path);
      }
    };
    collect("");
    return paths;
  });
  const treeTabStop = () => {
    const visible = visibleTreePaths();
    if (visible.includes(treeFocusPath())) return treeFocusPath();
    const selected = openPaths()[focusedSlot()];
    return selected && visible.includes(selected) ? selected : visible[0] || "";
  };
  const onTreeKeyDown = (event: KeyboardEvent & { currentTarget: HTMLButtonElement }) => {
    const items = [...(treeElement?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') || [])];
    const index = items.indexOf(event.currentTarget);
    if (index < 0) return;
    const focus = (next: number) => {
      const item = items[next];
      if (item) {
        setTreeFocusPath(item.dataset.path || "");
        item.focus();
      }
    };
    if (event.key === "ArrowDown") focus(Math.min(items.length - 1, index + 1));
    else if (event.key === "ArrowUp") focus(Math.max(0, index - 1));
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(items.length - 1);
    else if (event.key === "ArrowRight") {
      const level = Number(event.currentTarget.getAttribute("aria-level"));
      if (event.currentTarget.getAttribute("aria-expanded") === "false") event.currentTarget.click();
      else if (Number(items[index + 1]?.getAttribute("aria-level")) > level) focus(index + 1);
    } else if (event.key === "ArrowLeft") {
      if (event.currentTarget.getAttribute("aria-expanded") === "true" && expanded().has(event.currentTarget.dataset.path || "")) {
        event.currentTarget.click();
      } else {
        const level = Number(event.currentTarget.getAttribute("aria-level"));
        for (let parent = index - 1; parent >= 0; parent -= 1) {
          const item = items[parent];
          if (item && Number(item.getAttribute("aria-level")) < level) {
            focus(parent);
            break;
          }
        }
      }
    } else if (event.key.length === 1 && event.key !== " " && !event.altKey && !event.ctrlKey && !event.metaKey) {
      treeTypeahead += event.key.toLowerCase();
      window.clearTimeout(treeTypeaheadTimer);
      treeTypeaheadTimer = window.setTimeout(() => { treeTypeahead = ""; }, 500);
      const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      const match = ordered.find((item) => item.dataset.name?.startsWith(treeTypeahead));
      if (match) focus(items.indexOf(match));
      return;
    } else return;
    event.preventDefault();
  };
  const focusTreeBoundary = (last: boolean) => {
    const items = [...(treeElement?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') || [])];
    const item = last ? items.at(-1) : items[0];
    if (!item) return false;
    setTreeFocusPath(item.dataset.path || "");
    item.focus();
    return true;
  };
  const onFileFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (focusTreeBoundary(event.key === "ArrowUp")) event.preventDefault();
      return;
    }
    if (event.key === "Escape" && fileFilter()) {
      event.preventDefault();
      setFileFilter("");
    }
  };
  const saveTreeScroll = (event: Event & { currentTarget: HTMLElement }) => {
    const scrollTop = event.currentTarget.scrollTop;
    const projectId = props.projectId();
    if (treeScrollRaf) cancelAnimationFrame(treeScrollRaf);
    treeScrollRaf = requestAnimationFrame(() => {
      treeScrollRaf = 0;
      cacheWorkspace(projectId, { treeScrollTop: scrollTop });
    });
  };
  const toggleHidden = () => {
    const next = !showHidden();
    setShowHidden(next);
    writeSetting(projectScope(), "show-hidden", String(next));
  };
  const toggleWrapLines = () => {
    const next = !wrapLines();
    setWrapLines(next);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "wrap-lines", String(next));
  };
  const saveTreeWidth = (next: number) => {
    const value = Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, next));
    setTreeWidth(value);
    writeSetting(projectScope(), "tree-width", String(value));
  };
  const toggleTreeCollapsed = () => {
    const next = !treeCollapsed();
    setTreeCollapsed(next);
    writeSetting(projectScope(), "tree-collapsed", String(next));
  };
  const splitRatioBounds = (hostWidth = splitWidth()) => {
    if (hostWidth <= MIN_WORKSPACE_PANE_WIDTH * 2 + WORKSPACE_SPLIT_GUTTER_WIDTH) {
      const middle = hostWidth > 0
        ? ((hostWidth - WORKSPACE_SPLIT_GUTTER_WIDTH) / 2 / hostWidth) * 100
        : 50;
      return { minimum: middle, maximum: middle };
    }
    return {
      minimum: (MIN_WORKSPACE_PANE_WIDTH / hostWidth) * 100,
      maximum: ((hostWidth - WORKSPACE_SPLIT_GUTTER_WIDTH - MIN_WORKSPACE_PANE_WIDTH) / hostWidth) * 100,
    };
  };
  const clampSplitRatio = (next: number, hostWidth = splitWidth()) => {
    const bounds = splitRatioBounds(hostWidth);
    return Math.max(bounds.minimum, Math.min(bounds.maximum, next));
  };
  const saveSplitRatio = (next: number, hostWidth = splitWidth()) => {
    const value = clampSplitRatio(next, hostWidth);
    setSplitRatio(value);
    writeSetting(projectScope(), "split-ratio", String(value));
  };
  createEffect(() => {
    if (!splitActive() || splitWidth() <= 0) return;
    const value = clampSplitRatio(splitRatio());
    if (Math.abs(value - splitRatio()) > 0.001) saveSplitRatio(value);
  });
  const startSplitResize = (event: PointerEvent) => {
    if (!splitHost) return;
    event.preventDefault();
    const bounds = splitHost.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => saveSplitRatio(((moveEvent.clientX - bounds.left) / bounds.width) * 100, bounds.width);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("workspace-split-resizing");
    };
    document.body.classList.add("workspace-split-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  const startTreeResize = (event: PointerEvent) => {
    event.preventDefault();
    treeResizeHandle?.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = treeWidth();
    const move = (moveEvent: PointerEvent) => saveTreeWidth(startWidth + moveEvent.clientX - startX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("workspace-tree-resizing");
    };
    document.body.classList.add("workspace-tree-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  const toggleKeptVisible = (path: string) => {
    const next = new Set(keptVisible());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setKeptVisible(next);
    writeSetting(projectScope(), "kept-visible", JSON.stringify([...next]));
  };
  const collapseTree = () => {
    const next = new Set<string>();
    setExpanded(next);
    cacheWorkspace(props.projectId(), { expanded: next });
  };

  const Tree = (treeProps: { directory: string; depth?: number }) => {
    const depth = () => treeProps.depth || 0;
    return <>
      <For each={visibleEntries(treeProps.directory)}>{(entry, index) => <div class="workspace-tree-node">
        <ContextMenu>
          <ContextMenuTrigger
            as="button"
            type="button"
            role="treeitem"
            aria-expanded={entry.type === "directory" ? directoryIsOpen(entry.path) : undefined}
            aria-level={depth() + 1}
            aria-posinset={index() + 1}
            aria-setsize={visibleEntries(treeProps.directory).length}
            aria-selected={isFileOpen(entry.path)}
            class="workspace-tree-row"
            style={{ "padding-left": `${4 + depth() * 11.2}px` }}
            data-name={entry.name.toLowerCase()}
            data-path={entry.path}
            data-selected={isFileOpen(entry.path)}
            data-focused-file={openPaths()[focusedSlot()] === entry.path}
            tabIndex={treeTabStop() === entry.path ? 0 : -1}
            onFocus={() => setTreeFocusPath(entry.path)}
            onKeyDown={onTreeKeyDown}
            onClick={(event) => entry.type === "directory" ? void toggleDirectory(entry.path) : entry.type === "file" ? (event.altKey ? openFileToSide(entry.path) : openFile(entry.path)) : undefined}
          >
            <Show when={entry.type === "directory"} fallback={<><span class="workspace-tree-chevron-placeholder" /><FileTypeIcon name={entry.name} /></>}>
              <ChevronRightIcon class="workspace-tree-chevron" data-open={directoryIsOpen(entry.path)} /><FolderTypeIcon name={entry.name} expanded={directoryIsOpen(entry.path)} />
            </Show>
            <span>{entry.name}</span>
            <Show when={keptVisible().has(entry.path)}><PinIcon class="workspace-tree-kept" aria-label="Always visible" /></Show>
          </ContextMenuTrigger>
          <ContextMenuContent shortcutScope="workspace-panel" class="w-48 workspace-file-menu">
            <ContextMenuGroup>
              <Show when={entry.type === "file"}>
                <ContextMenuItem onSelect={() => openFile(entry.path)}><FileTypeIcon name={entry.name} />Open preview</ContextMenuItem>
                <ContextMenuItem onSelect={() => openFileToSide(entry.path)}><Columns2Icon />Open as second file</ContextMenuItem>
                <ContextMenuItem onSelect={() => editFile(entry.path)}><PencilIcon />Edit</ContextMenuItem>
                <ContextMenuItem onSelect={() => void downloadPath(entry.path)}><DownloadIcon />Download</ContextMenuItem>

                <ContextMenuItem disabled={uploading()} onSelect={() => chooseUpload({ kind: "replacement", path: entry.path })}><UploadIcon />Replace with upload…</ContextMenuItem>
              </Show>
              <Show when={entry.type === "directory"}>
                <ContextMenuItem disabled={uploading()} onSelect={() => void createFile(entry.path)}><FilePlusIcon />New file…</ContextMenuItem>
                <ContextMenuItem disabled={uploading()} onSelect={() => void createDirectory(entry.path)}><FolderPlusIcon />New folder…</ContextMenuItem>
                <ContextMenuItem onSelect={() => chooseUpload({ kind: "directory", path: entry.path })}><UploadIcon />Upload files here</ContextMenuItem>
              </Show>
              <Show when={entry.type === "file" || entry.type === "directory"}>
                <ContextMenuItem disabled={uploading()} onSelect={() => renameEntry(entry)}><PencilIcon />Rename…</ContextMenuItem>
                <ContextMenuItem disabled={uploading()} onSelect={() => moveEntryToFolder(entry)}><MoveIcon />Move…</ContextMenuItem>
              </Show>
              <ContextMenuItem onSelect={() => copy(entry.path)}><CopyIcon />Copy path</ContextMenuItem>
            </ContextMenuGroup>
            <Show when={entry.name.startsWith(".") || keptVisible().has(entry.path)}>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => toggleKeptVisible(entry.path)}>
                <Show when={keptVisible().has(entry.path)} fallback={<><PinIcon />Keep visible</>}><PinOffIcon />Stop keeping visible</Show>
              </ContextMenuItem>
            </Show>
            <Show when={entry.type === "file"}>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" disabled={uploading()} onSelect={() => void deleteFile(entry.path)}><Trash2Icon />Delete file</ContextMenuItem>
            </Show>
            <Show when={entry.type === "directory"}>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" disabled={uploading()} onSelect={() => void deleteDirectory(entry.path)}><Trash2Icon />Delete folder</ContextMenuItem>
            </Show>
          </ContextMenuContent>
        </ContextMenu>
        <Show when={entry.type === "directory" && directoryIsOpen(entry.path)}>
          <div role="group"><Tree directory={entry.path} depth={depth() + 1} /></div>
        </Show>
      </div>}</For>
      <Show when={directories()[treeProps.directory]?.oversize}><div class="workspace-tree-notice">Directory exceeds the 50,000-entry limit. Open a smaller directory.</div></Show>
      <Show when={directories()[treeProps.directory]?.truncated}><div class="workspace-tree-notice">
        <Show when={fileFilter().trim()}>Filter covers loaded entries only. </Show>
        <span>{directories()[treeProps.directory]?.entries.length} of {directories()[treeProps.directory]?.total ?? "more"} entries loaded. </span>
        <button type="button" disabled={filesLoading()} onClick={() => void loadDirectory(treeProps.directory, false, true)}>Show more</button>
      </div></Show>
    </>;
  };

  return <>
    <Show when={props.open()}>
      <button type="button" class="mobile-panel-backdrop" data-mobile-backdrop="workspace" data-for="workspace" aria-label="Dismiss workspace panel" onClick={props.onClose} />
    </Show>
    <aside ref={panelRoot} class="workspace-panel" data-shortcut-scope="workspace-panel" classList={{ "workspace-panel-open": props.open() || shellWidth() > 0.5, "workspace-panel-expanded": props.expanded() }} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} style={{ "--workspace-panel-width": `${width()}px`, "--workspace-shell-width": `${shellWidth()}px`, width: `${shellWidth()}px`, "margin-right": `${shellGap()}px` }}>
    <div ref={resizeHandle} class="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuemin={MIN_WORKSPACE_PANE_WIDTH} aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") saveWidth(width() + 16); if (event.key === "ArrowRight") saveWidth(width() - 16); }} />
    <div ref={panelSurface} class="workspace-panel-surface" onPointerDown={focusWorkspaceSurface}>
    <header class="workspace-panel-header" data-split={splitActive() ? "true" : undefined} style={{ "--workspace-split-ratio": `${splitRatio()}%` }}>
      <div class="workspace-pane-strip" data-position="left"><strong title={props.workingRoot()}>Workspace</strong>{paneTabs("left")}</div>
      <div class="workspace-pane-strip" data-position="right">
        <Show when={splitActive()}>{paneTabs("right")}</Show>
        <div class="workspace-panel-header-actions">
          <Show when={props.expanded()}>
            <Button variant="ghost" size="icon-sm" class="workspace-split-toggle" title={splitActive() ? "Close second pane" : "Split into two panes"} aria-label={splitActive() ? "Close second pane" : "Split into two panes"} aria-pressed={splitActive()} onClick={toggleSplit}><Columns2Icon /></Button>
          </Show>
          <Button variant="ghost" size="icon-sm" class="workspace-expand-toggle" title={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-label={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-pressed={props.expanded()} onClick={props.onToggleExpanded}>
            <Show when={props.expanded()} fallback={<Maximize2Icon />}><Minimize2Icon /></Show>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close workspace panel" onClick={props.onClose}><XIcon /></Button>
        </div>
      </div>
    </header>
    <main ref={(element) => {
      splitHost = element;
      splitResizeObserver?.disconnect();
      const updateSplitWidth = (nextWidth: number) => {
        setSplitWidth(nextWidth);
      };
      updateSplitWidth(element.clientWidth);
      splitResizeObserver = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentBoxSize?.[0];
        updateSplitWidth(box ? box.inlineSize : element.clientWidth);
      });
      splitResizeObserver.observe(element);
    }} class="workspace-panel-content" data-split={splitActive()} style={{ "--workspace-split-ratio": `${splitRatio()}%` }}>
    <Show when={props.expanded() && secondaryTab()}>
      <div class="workspace-split-resize-handle" role="separator" aria-label="Resize workspace panes" aria-orientation="vertical" aria-valuemin={Math.round(splitRatioBounds().minimum)} aria-valuemax={Math.round(splitRatioBounds().maximum)} aria-valuenow={Math.round(splitRatio())} tabIndex={0} onPointerDown={startSplitResize} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") saveSplitRatio(splitRatio() - 2);
        else if (event.key === "ArrowRight") saveSplitRatio(splitRatio() + 2);
        else if (event.key === "Home") saveSplitRatio(splitRatioBounds().minimum);
        else if (event.key === "End") saveSplitRatio(splitRatioBounds().maximum);
        else return;
        event.preventDefault();
      }} />
    </Show>
    <Show when={tabVisible("files")}>
      <div
        ref={(element) => {
          detailHost = element;
          filesResizeObserver?.disconnect();
          const updateWideState = (width: number) =>
            setFilesWide(!isMobileLayout() && width >= (props.expanded() ? 520 : WIDE_FILES_MIN_WIDTH));
          updateWideState(element.clientWidth);
          // The entry already carries the new size. Reading clientWidth back
          // inside the callback instead forces a synchronous layout, and a
          // panel drag resizes this element every frame: traced at one forced
          // layout per frame for the whole drag, 1.9ms of a 6.94ms budget.
          // .workspace-files has no border or padding, so the content box is
          // the same number clientWidth was reporting.
          filesResizeObserver = new ResizeObserver((entries) => {
            const box = entries[entries.length - 1]?.contentBoxSize?.[0];
            updateWideState(box ? box.inlineSize : element.clientWidth);
          });
          filesResizeObserver.observe(element);
          filesHost = element;
        }}
        class="workspace-files"
        data-position={panePosition("files")}
        data-wide={filesWide()}
        data-files={openPaths().secondary ? "2" : "1"}
        data-tree-collapsed={treeCollapsed()}
        style={{
          "--workspace-tree-width": `${treeWidth()}px`,
          "--workspace-file-a": `${fileSplitRatio()}fr`,
          "--workspace-file-b": `${100 - fileSplitRatio()}fr`,
        }}
      >
        <Show when={filesWide() && treeCollapsed()}>
          <div class="workspace-tree-collapsed-rail"><button type="button" aria-label="Show file tree" title="Show file tree" onClick={toggleTreeCollapsed}><PanelLeftOpenIcon /></button></div>
        </Show>
        <div class="workspace-tree-pane">
          <div class="workspace-tree-tools workspace-tree-search">
            <label class="workspace-tree-filter">
              <SearchIcon />
              <input
                ref={fileFilterInput}
                type="search"
                aria-label="Filter loaded files"
                placeholder="Filter loaded files"
                title="Filter loaded files and folders"
                value={fileFilter()}
                onInput={(event) => setFileFilter(event.currentTarget.value)}
                onKeyDown={onFileFilterKeyDown}
              />
            </label>
          </div>
          <Show when={workspaceStale()}><div class="workspace-freshness-notice" role="status" aria-live="polite"><span>Not updating</span><span aria-hidden="true">·</span><button type="button" onClick={retryWorkspacePoll}>Retry</button></div></Show>
          <nav ref={(element) => {
            treeElement = element;
            queueMicrotask(() => { element.scrollTop = workspaceCache.get(props.projectId())?.treeScrollTop || 0; });
          }} aria-label="Project files" role="tree" aria-busy={filesLoading()} class="workspace-tree" onScroll={saveTreeScroll}>
            <Tree directory="" />
            <Show when={directories()[""] && !directories()[""]?.oversize && visibleEntries("").length === 0}><div class="workspace-tree-empty">{fileFilter() ? "No loaded files match this filter." : "No files to show."}</div></Show>
          </nav>
          <div class="workspace-tree-tools workspace-tree-actions" role="toolbar" aria-label="File tree actions">
            <button type="button" aria-label="New file" title="Create a file in the workspace root" disabled={uploading()} onClick={() => void createFile()}><FilePlusIcon /></button>
            <button type="button" aria-label="New folder" title="Create a folder in the workspace root" disabled={uploading()} onClick={() => void createDirectory()}><FolderPlusIcon /></button>
            <button type="button" aria-label="Collapse all folders" title="Collapse all folders" onClick={collapseTree}><ChevronsUpIcon /></button>
            <button type="button" aria-label={showHidden() ? "Hide hidden files" : "Show hidden files"} title={showHidden() ? "Hide hidden files" : "Show hidden files"} aria-pressed={showHidden()} onClick={toggleHidden}>
              <Show when={showHidden()} fallback={<EyeOffIcon />}><EyeIcon /></Show>
            </button>
            <button type="button" aria-label="Upload files" title="Upload files to workspace root" disabled={uploading()} onClick={() => chooseUpload()}><Show when={uploading()} fallback={<UploadIcon />}><Spinner /></Show></button>
            <button type="button" aria-label="Refresh files" title="Refresh files" disabled={filesLoading()} onClick={() => void refreshFiles()}><RefreshCwIcon /></button>
            <Show when={filesWide()}><button type="button" aria-label="Hide file tree" title="Hide file tree" onClick={toggleTreeCollapsed}><PanelLeftCloseIcon /></button></Show>
            <input ref={fileUploadInput} class="workspace-file-input" type="file" multiple={uploadTarget().kind === "directory"} onChange={(event) => void uploadFiles(event.currentTarget.files)} />
          </div>
        </div>
        <Show when={filesWide()}>
          <div
            ref={treeResizeHandle}
            class="workspace-tree-resize-handle"
            role="separator"
            aria-label="Resize file tree"
            aria-orientation="vertical"
            aria-valuemin={MIN_TREE_WIDTH}
            aria-valuemax={MAX_TREE_WIDTH}
            aria-valuenow={treeWidth()}
            tabIndex={0}
            onPointerDown={startTreeResize}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") saveTreeWidth(treeWidth() - 8);
              if (event.key === "ArrowRight") saveTreeWidth(treeWidth() + 8);
            }}
          />
        </Show>
        <Show when={!filesWide() && !detailOpen()}>
          <div class="workspace-detail-dock-header">
            <button type="button" class="workspace-detail-disclosure" aria-expanded={false} onClick={toggleDetail}><ChevronDownIcon data-open={false} /><span>File preview</span></button>
          </div>
        </Show>
        <Show when={filesWide() || detailOpen()}><>
          <WorkspaceFileSlot
            projectId={props.projectId()}
            path={openPaths().primary}
            slot="primary"
            focused={focusedSlot() === "primary" && Boolean(openPaths().secondary)}
            closable={Boolean(openPaths().primary)}
            busy={uploading()}
            wrap={wrapLines()}
            headerPrefix={!filesWide() ? <div class="workspace-detail-dock-prefix">
              <div class="workspace-detail-resize-handle" role="separator" aria-label="Resize file preview" aria-orientation="horizontal" aria-valuemin={MIN_DETAIL_HEIGHT} aria-valuemax={maxDetailHeight()} aria-valuenow={detailHeight()} tabIndex={0} onPointerDown={startDetailResize} onKeyDown={resizeDetailByKey} />
              <button type="button" class="workspace-detail-disclosure" aria-expanded={detailOpen()} onClick={toggleDetail}><ChevronDownIcon data-open={detailOpen()} /><span>File preview</span></button>
            </div> : undefined}
            height={filesWide() ? undefined : `${detailHeight() / (openPaths().secondary ? 2 : 1)}px`}
            onToggleWrap={toggleWrapLines}
            onFocus={() => setFocusedSlot("primary")}
            onClose={() => closeSlot("primary")}
            onError={reportError}
            onRemoved={(path, announce) => { dropOpenPath(path); if (announce) toast.info(`${path} was removed`); }}
            onReplace={(path) => chooseUpload({ kind: "replacement", path })}
            onDelete={(path) => void deleteFile(path)}
            onLoaded={(file) => noteSlotLoaded("primary", file)}
            ref={(handle) => slotHandles.set("primary", handle)}
            onDispose={() => slotHandles.delete("primary")}
          />
          <Show when={openPaths().secondary}>
            <Show when={filesWide()}><div class="workspace-file-split-handle" role="separator" aria-label="Resize open files" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow={fileSplitRatio()} tabIndex={0} onPointerDown={startFileSplitResize} onKeyDown={(event) => {
              if (event.key === "ArrowLeft") saveFileSplitRatio(fileSplitRatio() - 2);
              else if (event.key === "ArrowRight") saveFileSplitRatio(fileSplitRatio() + 2);
              else if (event.key === "Home") saveFileSplitRatio(25);
              else if (event.key === "End") saveFileSplitRatio(75);
              else return;
              event.preventDefault();
            }} /></Show>
            <WorkspaceFileSlot
              projectId={props.projectId()}
              path={openPaths().secondary}
              slot="secondary"
              focused={focusedSlot() === "secondary"}
              closable
              busy={uploading()}
              wrap={wrapLines()}
              height={filesWide() ? undefined : `${detailHeight() / 2}px`}
              onToggleWrap={toggleWrapLines}
              onFocus={() => setFocusedSlot("secondary")}
              onClose={() => closeSlot("secondary")}
              onError={reportError}
              onRemoved={(path, announce) => { dropOpenPath(path); if (announce) toast.info(`${path} was removed`); }}
              onReplace={(path) => chooseUpload({ kind: "replacement", path })}
              onDelete={(path) => void deleteFile(path)}
              onLoaded={(file) => noteSlotLoaded("secondary", file)}
              ref={(handle) => slotHandles.set("secondary", handle)}
              onDispose={() => slotHandles.delete("secondary")}
            />
          </Show>
        </></Show>
      </div>
    </Show>
    <Show when={tabVisible("diff")}><section ref={(element) => { sourceDetailHost = element; }} class="workspace-diff" data-position={panePosition("diff")}>
      <div class="workspace-diff-overview">
      <div class="workspace-status-strip">
        <div><GitBranchIcon /><strong>{diff() ? diff()!.repository ? diff()!.branch : "Not a Git repository" : "Loading Git status…"}</strong><Show when={diff()?.upstream}><small>{diff()?.upstream}</small></Show></div>
        <div><Show when={diff()?.ahead || diff()?.behind}><span class="workspace-sync-state">↑ {diff()?.ahead || 0} ↓ {diff()?.behind || 0}</span></Show><Button variant="ghost" size="icon-sm" aria-label="Copy branch name" disabled={!diff()?.branch} onClick={() => copy(diff()?.branch)}><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Refresh Git status" disabled={diffLoading()} onClick={() => void loadDiff(sourceDetailOpen() && diffDetailOpen(), sourceDetailOpen() && !diffDetailOpen())}><RefreshCwIcon /></Button></div>
      </div>
      <Show when={workspaceStale()}><div class="workspace-freshness-notice" role="status" aria-live="polite"><span>Not updating</span><span aria-hidden="true">·</span><button type="button" onClick={retryWorkspacePoll}>Retry</button></div></Show>
      <Show when={diff()?.repository}>
        <form class="workspace-commit-composer" onSubmit={(event) => { event.preventDefault(); void runGitAction("commit"); }}>
          <textarea aria-label="Commit message" placeholder="Message (Ctrl+Enter to commit)" rows="1" value={commitMessage()} onInput={(event) => { const input = event.currentTarget; setCommitMessage(input.value); input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button type="submit" disabled={!commitMessage().trim() || !stagedFiles().length || Boolean(gitAction())}><Show when={gitAction() === "commit"} fallback={<CheckIcon />}><Spinner /></Show><span>Commit</span><small>{stagedFiles().length || ""}</small></button>
        </form>
        <div class="workspace-change-ledger">
          <section class="workspace-change-section" data-open={stagedOpen()}>
            <header><button type="button" class="workspace-change-disclosure" aria-expanded={stagedOpen()} onClick={() => setStagedOpen((open) => !open)}><ChevronRightIcon /><CheckIcon /><span>Staged changes</span><small>{stagedFiles().length}</small></button><button type="button" aria-label="Unstage all" title="Unstage all" disabled={!stagedFiles().length || Boolean(gitAction())} onClick={() => void runGitAction("unstage-all")}><Undo2Icon /></button></header>
            <Show when={stagedOpen()}><Show when={stagedFiles().length} fallback={<div class="workspace-clean-state">No staged changes</div>}>
              <div class="workspace-changes"><For each={stagedFiles()}>{(file) =>
<div class="workspace-change-row"><button type="button" title={`Inspect changes in ${file.path}`} onClick={() => inspectFileDiff(file.path, true)}><code data-status={file.status[0]}>{file.status[0]}</code><span>{file.path}</span></button><button type="button" class="workspace-change-action" aria-label={`Unstage ${file.path}`} title="Unstage" disabled={Boolean(gitAction())} onClick={() => void runGitAction("unstage", file.path)}><Undo2Icon /></button></div>
              }</For></div>
            </Show></Show>
          </section>
          <section class="workspace-change-section" data-open={changesOpen()}>
            <header><button type="button" class="workspace-change-disclosure" aria-expanded={changesOpen()} onClick={() => setChangesOpen((open) => !open)}><ChevronRightIcon /><FileDiffIcon /><span>Changes</span><small>{unstagedFiles().length}</small></button><button type="button" aria-label="Stage all" title="Stage all" disabled={!unstagedFiles().length || Boolean(gitAction())} onClick={() => void runGitAction("stage-all")}><CirclePlusIcon /></button></header>
            <Show when={changesOpen()}><Show when={unstagedFiles().length} fallback={<div class="workspace-clean-state">Working tree clean</div>}>
              <div class="workspace-changes"><For each={unstagedFiles()}>{(file) =>
                <div class="workspace-change-row"><button type="button" title={`Inspect changes in ${file.path}`} onClick={() => inspectFileDiff(file.path, false)}><code data-status={file.status[1] === " " ? "?" : file.status[1]}>{file.status[1] === " " ? "?" : file.status[1]}</code><span>{file.path}</span></button><button type="button" class="workspace-change-action" aria-label={`Stage ${file.path}`} title="Stage" disabled={Boolean(gitAction())} onClick={() => void runGitAction("stage", file.path)}><CirclePlusIcon /></button></div>
              }</For></div>
            </Show></Show>
          </section>
        </div>
      </Show>
      </div>
      <section class="workspace-source-workbench" data-open={sourceDetailOpen()} style={sourceDetailOpen() ? { height: `${sourceDetailHeight()}px` } : undefined}>
        <header class="workspace-detail-dock-header">
          <Show when={sourceDetailOpen()}><div class="workspace-source-resize-handle" role="separator" aria-label="Resize details" aria-orientation="horizontal" aria-valuemin={MIN_SOURCE_DETAIL_HEIGHT} aria-valuemax={maxSourceDetailHeight()} aria-valuenow={sourceDetailHeight()} tabIndex={0} onPointerDown={startSourceDetailResize} onKeyDown={resizeSourceDetailByKey} /></Show>
          <button type="button" class="workspace-detail-disclosure" aria-expanded={sourceDetailOpen()} onClick={toggleSourceDetail}><ChevronDownIcon data-open={sourceDetailOpen()} /><span>Details</span></button>
          <div class="workspace-source-modes" role="tablist" aria-label="Source Control detail">
            <button type="button" role="tab" aria-selected={!fileDiffMode() && !diffDetailOpen()} onClick={() => selectSourceDetail(false)}><GitCommitHorizontalIcon />Graph</button>
            <button type="button" role="tab" aria-selected={!fileDiffMode() && diffDetailOpen()} onClick={() => selectSourceDetail(true)}><FileDiffIcon />Patch</button>
            <button type="button" role="tab" aria-selected={fileDiffMode()} onClick={() => { setFileDiffMode(true); setSourceDetailVisible(true); }}><GitCompareArrowsIcon />Diff</button>
          </div>
          <small>{diffDetailOpen() ? `${diff()?.files.length || 0} changed` : `${diff()?.commits?.length || 0} recent`}</small>
          <div class="workspace-source-actions">
            <button type="button" aria-label="Fetch all remotes" title="Fetch all remotes" disabled={Boolean(gitAction())} onClick={() => void runGitAction("fetch")}><Show when={gitAction() === "fetch"} fallback={<RefreshCwIcon />}><Spinner /></Show><span>Fetch</span></button>
            <button type="button" aria-label="Pull current branch" title="Pull current branch (fast-forward only)" disabled={!diff()?.upstream || Boolean(gitAction())} onClick={() => void runGitAction("pull")}><DownloadIcon /><span>Pull</span></button>
            <button type="button" aria-label="Push current branch" title="Push current branch" disabled={!diff()?.upstream || Boolean(gitAction())} onClick={() => void runGitAction("push")}><SendIcon /><span>Push</span></button>
          </div>
        </header>
        <Show when={sourceDetailOpen() && fileDiffMode()}><div class="workspace-patch">
          <Show when={selectedDiff()} fallback={<div class="workspace-panel-empty">Select a file in Changes or Staged changes.</div>}>
            <header>{selectedDiff()?.path} · {selectedDiff()?.staged ? "Staged" : "Working tree"}</header>
            <Show when={!fileDiffBusy()} fallback={<div role="status">Loading diff…</div>}><PatchView content={fileDiffText()} /></Show>
          </Show>
        </div></Show>
        <Show when={sourceDetailOpen() && !fileDiffMode()}><Show when={diffDetailOpen()} fallback={<Show when={Boolean(diff()?.commits?.length)} fallback={<div class="workspace-panel-empty">No commit history available.</div>}><CommitHistory commits={diff()?.commits || []} refs={diff()?.refs || []} branch={diff()?.branch} onCopy={copy} onInspect={inspectCommit} /></Show>}>
          <div class="workspace-patch"><Show when={commitDetailLoading()} fallback={<Show when={commitDetail()} fallback={<Show when={diff()?.diff} fallback={<div class="workspace-panel-empty">{diff()?.repository ? "Working tree is clean." : "Diff is available for Git projects."}</div>}>{(content) => <PatchView content={content()} />}</Show>}>{(detail) => <PatchView content={detail().content} />}</Show>}><div class="workspace-panel-empty">Loading commit…</div></Show></div>
        </Show></Show>
      </section>
    </section></Show>
    <Show when={tabVisible("artifacts")}><section class="workspace-artifacts" data-position={panePosition("artifacts")}>
      <div class="workspace-artifact-modes" role="radiogroup" aria-label="Artifact modality"><button role="radio" aria-checked={artifactMode() === "outputs"} onClick={() => setArtifactMode("outputs")}>Outputs</button><button role="radio" aria-checked={artifactMode() === "interactive"} onClick={() => setArtifactMode("interactive")}>Interactive UI</button></div>
      <div class="workspace-panel-empty"><div><BoxesIcon /><strong>{artifactMode() === "outputs" ? "No artifacts in the loaded transcript" : "Interactive artifacts are not enabled"}</strong><p>{artifactMode() === "outputs" ? "Code blocks and file outputs will appear here as transcript artifact projection lands." : "This boundary is reserved for sandboxed, explicitly trusted generated interfaces."}</p></div></div>
    </section></Show>
    <Show when={tabVisible("terminal")}><section class="workspace-terminal-slot" data-position={panePosition("terminal")}><TerminalPane projectId={props.projectId()} projectName={props.projectName()} terminalId={props.requestedTab?.()?.terminalId} focusRequest={terminalFocusRequest()} /></section></Show>
    </main>
    <Show when={loading()}><div class="workspace-panel-loading"><Spinner /><span>Loading workspace</span></div></Show>
    </div>
  </aside>
  </>;
}
