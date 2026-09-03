import { batch, createEffect, createMemo, createSignal, For, lazy, on, onCleanup, Show, Suspense, type Accessor } from "solid-js";
import { BoxesIcon, CheckIcon, ChevronsUpIcon, ChevronDownIcon, ChevronRightIcon, CirclePlusIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, FileDiffIcon, FolderIcon, GitBranchIcon, GitCommitHorizontalIcon, GitCompareArrowsIcon, Maximize2Icon, Minimize2Icon, PanelLeftCloseIcon, PanelLeftOpenIcon, PencilIcon, PinIcon, PinOffIcon, RefreshCwIcon, SaveIcon, SearchIcon, SendIcon, TerminalIcon, Undo2Icon, UploadIcon, WrapTextIcon, XIcon } from "lucide-solid";
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
import { FileTypeIcon } from "./file-type-icon";
import "./workspace.css";

interface TreeEntry { name: string; path: string; type: "directory" | "file" | "other"; }
interface DirectoryListing { entries: TreeEntry[]; truncated: boolean; }
interface FilePreview { path: string; size: number; revision: string; content: string; }
interface FileWriteResult { path: string; size: number; revision: string; }
interface GitActionResult { ok: true; output?: string; }
interface GitCommit { graph: string; hash: string; shortHash: string; subject: string; author: string; authoredAt: string; }
interface GitRef { name: string; hash: string; upstream: string | null; kind: "local" | "remote" | "tag"; }
interface DiffPayload { repository: boolean; branch?: string; upstream?: string | null; ahead?: number; behind?: number; commits?: GitCommit[]; refs?: GitRef[]; files: { status: string; path: string }[]; diff: string; }
type PanelTab = "files" | "diff" | "artifacts" | "terminal";
type ArtifactMode = "outputs" | "interactive";
type GitAction = "stage" | "stage-all" | "unstage" | "unstage-all" | "commit" | "fetch" | "pull" | "push";

function isPanelTab(value: string): value is PanelTab {
  return value === "files" || value === "diff" || value === "artifacts" || value === "terminal";
}

interface WorkspaceCacheEntry {
  directories: Record<string, DirectoryListing>;
  diff: DiffPayload | null;
  expanded: Set<string>;
  preview: FilePreview | null;
  treeScrollTop: number;
}

const MAX_CACHED_WORKSPACES = 6;
const workspaceCache = new Map<string, WorkspaceCacheEntry>();
const COMPACT_UI_MIGRATION_KEY = "conduit:compact-ui-v2";
const MIN_DETAIL_HEIGHT = 32;
const WIDE_FILES_MIN_WIDTH = 720;
const DEFAULT_TREE_WIDTH = 160;
const MIN_TREE_WIDTH = 128;
const MAX_TREE_WIDTH = 320;
const WRAP_LINES_KEY = "conduit:workspace:wrap-lines";
const WorkspaceEditor = lazy(() => import("./workspace-editor"));

function CommitHistory(props: { commits: GitCommit[]; refs: GitRef[]; branch?: string; onCopy: (hash: string) => void; labelled?: boolean }) {
  return <section class="workspace-history">
    <Show when={props.labelled}><header><div><GitCommitHorizontalIcon /><span>History</span></div><small>{props.commits.length} recent</small></header></Show>
    <div class="workspace-history-list">
      <For each={props.commits}>{(commit) =>
        <div class="workspace-commit">
          <code class="workspace-graph-rail" aria-hidden="true">{commit.graph || "*"}</code>
          <button type="button" title={`Copy ${commit.hash} · ${commit.author} · ${new Date(commit.authoredAt).toLocaleString()}`} onClick={() => props.onCopy(commit.hash)}>
            <div class="workspace-commit-copy"><span>{commit.subject}</span><Show when={props.refs.some((ref) => ref.hash === commit.hash)}><div class="workspace-commit-refs"><For each={props.refs.filter((ref) => ref.hash === commit.hash)}>{(ref) => <code data-kind={ref.kind} data-current={ref.kind === "local" && ref.name === props.branch}>{ref.kind === "local" && ref.name === props.branch ? `HEAD · ${ref.name}` : ref.name}</code>}</For></div></Show></div>
            <small>{commit.author}</small>
            <code>{commit.shortHash}</code>
          </button>
        </div>
      }</For>
    </div>
  </section>;
}

function PatchView(props: { content: string }) {
  return <pre class="workspace-diff-content"><code><For each={props.content.split("\n")}>{(line) =>
    <span class="workspace-patch-line" data-kind={line.startsWith("+") && !line.startsWith("+++") ? "addition" : line.startsWith("-") && !line.startsWith("---") ? "deletion" : line.startsWith("@@") ? "hunk" : line.startsWith("# ") || line.startsWith("diff ") ? "heading" : "context"}>{line || " "}</span>
  }</For></code></pre>;
}

function storedPaths(key: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
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

function migrateWorkspaceGeometry() {
  if (localStorage.getItem(COMPACT_UI_MIGRATION_KEY) === "true") return;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !/^conduit:workspace-panel:.*:(width|detail-height)$/.test(key)) continue;
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value) && value > 0) localStorage.setItem(key, String(Math.round(value * 8) / 10));
  }
  localStorage.setItem(COMPACT_UI_MIGRATION_KEY, "true");
}

function cachedWorkspace(projectId: string) {
  const cached = workspaceCache.get(projectId);
  if (!cached) return null;
  workspaceCache.delete(projectId);
  workspaceCache.set(projectId, cached);
  return cached;
}

function cacheWorkspace(projectId: string, patch: Partial<WorkspaceCacheEntry>) {
  const current = workspaceCache.get(projectId) || { directories: {}, diff: null, expanded: new Set<string>(), preview: null, treeScrollTop: 0 };
  workspaceCache.delete(projectId);
  workspaceCache.set(projectId, { ...current, ...patch });
  while (workspaceCache.size > MAX_CACHED_WORKSPACES) workspaceCache.delete(workspaceCache.keys().next().value!);
}

export default function WorkspacePanel(props: { projectId: Accessor<string>; chatId: Accessor<string>; open: Accessor<boolean>; expanded: Accessor<boolean>; requestedTab?: Accessor<{ tab: PanelTab; terminalId?: string; nonce: number } | null>; onToggleExpanded: () => void; onClose: () => void; shortcuts: ShortcutManager }) {
  migrateWorkspaceGeometry();
  let projectGeneration = 0;
  let requestVersion = 0;
  let projectController = new AbortController();
  const requests = new Map<string, WorkspaceRequest>();
  const requestControllers = new Map<number, AbortController>();
  let panelRoot: HTMLElement | undefined;
  let panelSurface: HTMLDivElement | undefined;
  let resizeHandle: HTMLDivElement | undefined;
  let detailHost: HTMLElement | undefined;
  let treeElement: HTMLElement | undefined;
  let treeResizeHandle: HTMLDivElement | undefined;
  let splitHost: HTMLElement | undefined;
  let fileFilterInput: HTMLInputElement | undefined;
  let fileUploadInput: HTMLInputElement | undefined;
  let filesResizeObserver: ResizeObserver | undefined;
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
  const storageKey = () => `conduit:workspace-panel:${props.chatId()}:tab`;
  const [tab, setTab] = createSignal<PanelTab>((localStorage.getItem(storageKey()) as PanelTab) || "files");
  const [secondaryTab, setSecondaryTab] = createSignal<PanelTab | null>(null);
  const [directories, setDirectories] = createSignal<Record<string, DirectoryListing>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [preview, setPreview] = createSignal<FilePreview | null>(null);
  const [fileFilter, setFileFilter] = createSignal("");
  const [treeFocusPath, setTreeFocusPath] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [keptVisible, setKeptVisible] = createSignal(new Set<string>());
  const [filesWide, setFilesWide] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [uploadDirectory, setUploadDirectory] = createSignal("");
  const [wrapLines, setWrapLines] = createSignal(localStorage.getItem(WRAP_LINES_KEY) === "true");
  const [diff, setDiff] = createSignal<DiffPayload | null>(null);
  const [commitMessage, setCommitMessage] = createSignal("");
  const [gitAction, setGitAction] = createSignal("");
  const [stagedOpen, setStagedOpen] = createSignal(true);
  const [changesOpen, setChangesOpen] = createSignal(true);
  const [error, setError] = createSignal("");
  const widthKey = () => `conduit:workspace-panel:${props.projectId()}:width`;
  const showHiddenKey = () => `conduit:workspace-panel:${props.projectId()}:show-hidden`;
  const keptVisibleKey = () => `conduit:workspace-panel:${props.projectId()}:kept-visible`;
  const treeWidthKey = () => `conduit:workspace-panel:${props.projectId()}:tree-width`;
  const treeCollapsedKey = () => `conduit:workspace-panel:${props.projectId()}:tree-collapsed`;
  const splitRatioKey = () => `conduit:workspace-panel:${props.projectId()}:split-ratio`;
  const [width, setWidth] = createSignal(Math.max(256, Math.min(496, Number(localStorage.getItem(widthKey())) || 336)));
  const [shellWidth, setShellWidth] = createSignal(props.open() ? width() : 0);
  const [shellGap, setShellGap] = createSignal(props.open() && !isMobileLayout() ? 8 : 0);
  const [treeWidth, setTreeWidth] = createSignal(Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, Number(localStorage.getItem(treeWidthKey())) || DEFAULT_TREE_WIDTH)));
  const [treeCollapsed, setTreeCollapsed] = createSignal(localStorage.getItem(treeCollapsedKey()) === "true");
  const [splitRatio, setSplitRatio] = createSignal(Math.max(25, Math.min(75, Number(localStorage.getItem(splitRatioKey())) || 50)));
  const [artifactMode, setArtifactMode] = createSignal<ArtifactMode>("outputs");
  const detailOpenKey = () => `conduit:workspace-panel:${props.chatId()}:${tab()}:detail-open`;
  const detailHeightKey = () => `conduit:workspace-panel:${props.chatId()}:${tab()}:detail-height`;
  const detailOpenFor = (nextTab: PanelTab) => localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${nextTab}:detail-open`) ?? (nextTab === "diff" ? "false" : "true");
  const [detailOpen, setDetailOpen] = createSignal(detailOpenFor(tab()) === "true");
  const [diffDetailOpen, setDiffDetailOpen] = createSignal(detailOpenFor("diff") === "true");
  const [detailHeight, setDetailHeight] = createSignal(Math.max(128, Number(localStorage.getItem(detailHeightKey())) || 288));
  const hasPending = (operation?: string) => [...pending().keys()].some((version) => !operation || requests.get(operation)?.version === version);
  const diffLoading = () => hasPending("diff");
  const filesLoading = () => [...requests.keys()].some((operation) => operation.startsWith("directory:") && hasPending(operation));
  const loading = () => [...pending().values()].some((entry) => entry.foreground);
  const hasUnsavedChanges = () => Boolean(preview() && draft() !== preview()!.content);
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
  let panelWasOpen = props.open();
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
    const surfaceWidth = panelSurface?.getBoundingClientRect().width || width();
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
    setDetailHeight(Math.max(MIN_DETAIL_HEIGHT, Number(localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${next}:detail-height`)) || 288));
    setTab(next);
    localStorage.setItem(storageKey(), next);
  };
  const tabVisible = (candidate: PanelTab) => tab() === candidate || (props.expanded() && secondaryTab() === candidate);
  const panePosition = (candidate: PanelTab) => tab() === candidate ? "left" : secondaryTab() === candidate ? "right" : undefined;
  const tabLabel = (candidate: PanelTab) => candidate === "files" ? "Files" : candidate === "diff" ? "Source Control" : candidate === "artifacts" ? "Artifacts" : "Terminal";
  const setPaneTab = (side: "left" | "right", next: PanelTab) => {
    const left = tab();
    const right = secondaryTab() || (left === "files" ? "diff" : "files");
    if (side === "left") {
      if (next === right) setSecondaryTab(left);
      selectTab(next);
    } else if (next === left) {
      selectTab(right);
      setSecondaryTab(left);
    } else {
      setSecondaryTab(next);
    }
  };
  const changePaneTab = (side: "left" | "right", value: string) => {
    if (isPanelTab(value)) setPaneTab(side, value);
  };
  const activateTab = (next: PanelTab) => {
    if (!props.expanded()) {
      setSecondaryTab(null);
      selectTab(next);
      return;
    }
    if (next === tab()) {
      setSecondaryTab(null);
      return;
    }
    setSecondaryTab(secondaryTab() === next ? null : next);
  };
  const selectFilesTab = () => {
    activateTab("files");
    if (!directories()[""]) void loadDirectory();
    queueMicrotask(() => fileFilterInput?.focus());
  };
  const workspaceShortcutAvailable = () => !document.querySelector(
    '.command-dialog[data-state="open"], .settings-dialog[data-state="open"], .conduit-modal[data-state="open"], .external-link-dialog[data-state="open"]',
  );
  const focusTabControl = (next: PanelTab) => {
    const control = props.expanded()
      ? panelRoot?.querySelector<HTMLSelectElement>('select[aria-label="Left workspace pane"]')
      : panelRoot?.querySelector<HTMLElement>(`[data-workspace-tab="${next}"]`);
    control?.focus({ preventScroll: true });
  };
  const selectShortcutTab = (next: PanelTab) => {
    if (props.expanded()) setPaneTab("left", next);
    else selectTab(next);
    if (next === "files" && !directories()[""]) void loadDirectory();
    queueMicrotask(() => focusTabControl(next));
  };
  const releaseShortcutHandlers = [
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceFiles, "workspace-panel", () => selectShortcutTab("files"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceSourceControl, "workspace-panel", () => selectShortcutTab("diff"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceArtifacts, "workspace-panel", () => selectShortcutTab("artifacts"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceTerminal, "workspace-panel", () => selectShortcutTab("terminal"), { when: workspaceShortcutAvailable }),
  ];
  onCleanup(() => releaseShortcutHandlers.forEach((release) => release()));
  const toggleDetail = () => {
    const next = !detailOpen();
    setDetailOpen(next);
    localStorage.setItem(detailOpenKey(), String(next));
  };
  const selectSourceDetail = (patch: boolean) => {
    setDiffDetailOpen(patch);
    localStorage.setItem(`conduit:workspace-panel:${props.chatId()}:diff:detail-open`, String(patch));
    if (patch && !diff()?.diff) void loadDiff(true, true);
  };
  let stopDetailResize: (() => void) | undefined;
  const maxDetailHeight = () => Math.max(MIN_DETAIL_HEIGHT, (detailHost?.clientHeight || window.innerHeight) -
    (detailHost?.querySelector<HTMLElement>(".workspace-detail-toggle")?.offsetHeight || 32) -
    (detailHost?.querySelector<HTMLElement>(".workspace-detail-resize-handle")?.offsetHeight || 12) -
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
      localStorage.setItem(detailHeightKey(), String(next));
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
    localStorage.setItem(detailHeightKey(), String(next));
  };
  const loadDirectory = async (directory = "", background = false) => {
    const { request, controller } = startRequest(`directory:${directory}`, !background);
    setError("");
    try {
      const payload = await api<{ entries?: unknown; truncated?: boolean }>(`/v0/projects/${encodeURIComponent(request.projectId)}/tree?path=${encodeURIComponent(directory)}`, { signal: controller.signal });
      if (!ownsRequest(request)) return;
      setDirectories((current) => {
        const next = { ...current, [directory]: { entries: asList<TreeEntry>(payload.entries), truncated: payload.truncated === true } };
        cacheWorkspace(request.projectId, { directories: next });
        return next;
      });
    } catch (cause) {
      if (ownsRequest(request) && !wasAborted(cause)) setError((cause as Error).message);
    } finally {
      finishRequest(request);
    }
  };
  const toggleDirectory = async (directory: string) => {
    const next = new Set(expanded());
    if (next.has(directory)) next.delete(directory);
    else { next.add(directory); if (!directories()[directory]) await loadDirectory(directory); }
    setExpanded(next);
    cacheWorkspace(props.projectId(), { expanded: next });
  };
  const loadFile = async (file: string, background = false) => {
    const { request, controller } = startRequest("file", !background);
    setError("");
    try {
      const payload = await api<FilePreview>(`/v0/projects/${encodeURIComponent(request.projectId)}/file?path=${encodeURIComponent(file)}`, { signal: controller.signal });
      if (ownsRequest(request)) {
        batch(() => {
          setPreview(payload);
          setDraft(payload.content);
        });
        cacheWorkspace(request.projectId, { preview: payload });
        return payload;
      }
    } catch (cause) {
      if (ownsRequest(request) && !wasAborted(cause)) {
        batch(() => {
          setPreview(null);
          setDraft("");
          setEditing(false);
        });
        cacheWorkspace(request.projectId, { preview: null });
        setError((cause as Error).message);
      }
    } finally {
      finishRequest(request);
    }
    return null;
  };
  const openFile = async (file: string) => {
    if (preview()?.path === file) return preview();
    if (preview()?.path !== file && hasUnsavedChanges() && !window.confirm("Discard unsaved changes and open another file?")) return null;
    setEditing(false);
    return loadFile(file);
  };
  const editFile = async (file = preview()?.path) => {
    if (!file) return;
    const opened = preview()?.path === file ? preview() : await openFile(file);
    if (!opened) return;
    setEditing(true);
  };
  const saveFile = async () => {
    const file = preview();
    if (!file || !hasUnsavedChanges() || saving()) return;
    setSaving(true);
    setError("");
    try {
      const written = await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(file.path)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "if-match": file.revision },
        body: draft(),
      });
      const next = { ...file, ...written, content: draft() };
      setPreview(next);
      cacheWorkspace(props.projectId(), { preview: next });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const downloadFile = async (file = preview()?.path) => {
    if (!file) return;
    setError("");
    try {
      const response = await authorizedFetch(httpUrl(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(file)}&download=1`));
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message = body && typeof body === "object" && "message" in body ? String(body.message) : "Download failed";
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.split("/").at(-1) || "download";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const chooseUpload = (directory = "") => {
    setUploadDirectory(directory);
    if (fileUploadInput) {
      fileUploadInput.value = "";
      fileUploadInput.click();
    }
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const directory = uploadDirectory();
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        const target = directory ? `${directory}/${file.name}` : file.name;
        await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(props.projectId())}/file?path=${encodeURIComponent(target)}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        });
      }
      await loadDirectory(directory, true);
    } catch (cause) {
      setError((cause as Error).message);
      await loadDirectory(directory, true);
    } finally {
      setUploading(false);
    }
  };
  const refreshFiles = async () => {
    const loaded = Object.keys(directories());
    for (const directory of loaded.length ? loaded : [""]) await loadDirectory(directory, true);
    const selected = preview()?.path;
    if (selected && !hasUnsavedChanges()) await loadFile(selected, true);
  };
  const loadDiff = async (includePatch = false, reuse = false, background = false) => {
    const { request, controller } = startRequest("diff", !background);
    setError("");
    try {
      const query = new URLSearchParams();
      if (includePatch) query.set("patch", "1");
      if (reuse) query.set("reuse", "1");
      const payload = await api<DiffPayload>(`/v0/projects/${encodeURIComponent(request.projectId)}/diff${query.size ? `?${query}` : ""}`, { signal: controller.signal });
      if (ownsRequest(request)) {
        setDiff(payload);
        cacheWorkspace(request.projectId, { diff: payload });
      }
    }
    catch (cause) {
      if (ownsRequest(request) && !wasAborted(cause)) setError((cause as Error).message);
    }
    finally {
      finishRequest(request);
    }
  };
  const runGitAction = async (action: GitAction, path?: string) => {
    if (gitAction()) return;
    if (action === "commit" && !commitMessage().trim()) return;
    if (action === "push" && !window.confirm(`Push ${diff()?.branch || "the current branch"} to its configured remote?`)) return;
    setGitAction(action);
    setError("");
    try {
      await api<GitActionResult>(`/v0/projects/${encodeURIComponent(props.projectId())}/git`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, path, message: action === "commit" ? commitMessage().trim() : undefined }),
      });
      if (action === "commit") setCommitMessage("");
      await loadDiff(diffDetailOpen());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setGitAction("");
    }
  };
  const copy = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };
  const clampWidth = (next: number) => Math.max(240, Math.min(Math.floor(window.innerWidth * 0.65), next));
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
    localStorage.setItem(widthKey(), String(commitWidth(next)));
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
    if (props.expanded() && !secondaryTab()) setSecondaryTab(tab() === "files" ? "diff" : "files");
    if (!props.expanded()) setSecondaryTab(null);
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
  const startResize = (event: PointerEvent) => {
    if (isMobileLayout()) return;
    stopResize?.();
    event.preventDefault();
    resizeHandle?.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = width();
    const resizeStorageKey = widthKey();
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
      localStorage.setItem(resizeStorageKey, String(nextWidth));
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
    filesResizeObserver?.disconnect();
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
    const nextTab = (localStorage.getItem(storageKey()) as PanelTab) || "files";
    const projectChanged = geometryProjectId !== props.projectId();
    if (projectChanged) {
      geometryProjectId = props.projectId();
      stopResize?.();
    }
    let pendingWidthCommit: number | null = null;
    batch(() => {
      setDetailOpen(detailOpenFor(nextTab) === "true");
      setDiffDetailOpen(detailOpenFor("diff") === "true");
      setDetailHeight(Math.max(MIN_DETAIL_HEIGHT, Number(localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${nextTab}:detail-height`)) || 288));
      if (projectChanged) {
        pendingWidthCommit = Number(localStorage.getItem(widthKey())) || 336;
        setTreeWidth(Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, Number(localStorage.getItem(treeWidthKey())) || DEFAULT_TREE_WIDTH)));
        setTreeCollapsed(localStorage.getItem(treeCollapsedKey()) === "true");
        setSplitRatio(Math.max(25, Math.min(75, Number(localStorage.getItem(splitRatioKey())) || 50)));
        setShowHidden(localStorage.getItem(showHiddenKey()) === "true");
        setKeptVisible(storedPaths(keptVisibleKey()));
      }
      setTab(nextTab);
    });
    if (pendingWidthCommit != null) commitWidth(pendingWidthCommit);
  }));
  createEffect(on(() => props.requestedTab?.(), (next) => {
    if (next) selectTab(next.tab);
  }));
  createEffect(on(
    () => [props.projectId(), tab(), secondaryTab(), props.open(), props.expanded(), diffDetailOpen()] as const,
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
          setPreview(cached?.preview || null);
          setDraft(cached?.preview?.content || "");
          setEditing(false);
          setFileFilter("");
          setTreeFocusPath(cached?.preview?.path || "");
          setDiff(cached?.diff || null);
          setError("");
        });
        queueMicrotask(() => {
          if (treeElement) treeElement.scrollTop = cached?.treeScrollTop || 0;
        });
      }
      const filesVisible = activeTab === "files" || (panelExpanded && companionTab === "files");
      const diffVisible = activeTab === "diff" || (panelExpanded && companionTab === "diff");
      if (filesVisible && !directories()[""] && !filesLoading()) void loadDirectory("", false);
      if (diffVisible) {
        const includePatch = diffDetailOpen();
        const current = diff();
        const needsPatch = diffVisible && includePatch;
        if (!current || (needsPatch && !current.diff)) void loadDiff(needsPatch, false, Boolean(current));
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
    const selected = preview()?.path;
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
    localStorage.setItem(showHiddenKey(), String(next));
  };
  const toggleWrapLines = () => {
    const next = !wrapLines();
    setWrapLines(next);
    localStorage.setItem(WRAP_LINES_KEY, String(next));
  };
  const saveTreeWidth = (next: number) => {
    const value = Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, next));
    setTreeWidth(value);
    localStorage.setItem(treeWidthKey(), String(value));
  };
  const toggleTreeCollapsed = () => {
    const next = !treeCollapsed();
    setTreeCollapsed(next);
    localStorage.setItem(treeCollapsedKey(), String(next));
  };
  const saveSplitRatio = (next: number) => {
    const value = Math.max(25, Math.min(75, next));
    setSplitRatio(value);
    localStorage.setItem(splitRatioKey(), String(value));
  };
  const startSplitResize = (event: PointerEvent) => {
    if (!splitHost) return;
    event.preventDefault();
    const bounds = splitHost.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => saveSplitRatio(((moveEvent.clientX - bounds.left) / bounds.width) * 100);
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
    localStorage.setItem(keptVisibleKey(), JSON.stringify([...next]));
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
            aria-selected={preview()?.path === entry.path}
            class="workspace-tree-row"
            style={{ "padding-left": `${4 + depth() * 11.2}px` }}
            data-name={entry.name.toLowerCase()}
            data-path={entry.path}
            data-selected={preview()?.path === entry.path}
            tabIndex={treeTabStop() === entry.path ? 0 : -1}
            onFocus={() => setTreeFocusPath(entry.path)}
            onKeyDown={onTreeKeyDown}
            onClick={() => entry.type === "directory" ? void toggleDirectory(entry.path) : entry.type === "file" ? void openFile(entry.path) : undefined}
          >
            <Show when={entry.type === "directory"} fallback={<><span class="workspace-tree-chevron-placeholder" /><FileTypeIcon name={entry.name} /></>}>
              <ChevronRightIcon class="workspace-tree-chevron" data-open={directoryIsOpen(entry.path)} /><FolderIcon />
            </Show>
            <span>{entry.name}</span>
            <Show when={keptVisible().has(entry.path)}><PinIcon class="workspace-tree-kept" aria-label="Always visible" /></Show>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-48 workspace-file-menu">
            <ContextMenuGroup>
              <Show when={entry.type === "file"}>
                <ContextMenuItem onSelect={() => void openFile(entry.path)}><FileTypeIcon name={entry.name} />Open preview</ContextMenuItem>
                <ContextMenuItem onSelect={() => void editFile(entry.path)}><PencilIcon />Edit</ContextMenuItem>
                <ContextMenuItem onSelect={() => void downloadFile(entry.path)}><DownloadIcon />Download</ContextMenuItem>
              </Show>
              <Show when={entry.type === "directory"}>
                <ContextMenuItem onSelect={() => chooseUpload(entry.path)}><UploadIcon />Upload files here</ContextMenuItem>
              </Show>
              <ContextMenuItem onSelect={() => copy(entry.path)}><CopyIcon />Copy path</ContextMenuItem>
            </ContextMenuGroup>
            <Show when={entry.name.startsWith(".") || keptVisible().has(entry.path)}>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => toggleKeptVisible(entry.path)}>
                <Show when={keptVisible().has(entry.path)} fallback={<><PinIcon />Keep visible</>}><PinOffIcon />Stop keeping visible</Show>
              </ContextMenuItem>
            </Show>
          </ContextMenuContent>
        </ContextMenu>
        <Show when={entry.type === "directory" && directoryIsOpen(entry.path)}>
          <div role="group"><Tree directory={entry.path} depth={depth() + 1} /></div>
        </Show>
      </div>}</For>
      <Show when={directories()[treeProps.directory]?.truncated}><div class="workspace-tree-notice">Showing a bounded selection of 500 items from this directory.</div></Show>
    </>;
  };

  return <>
    <Show when={props.open()}>
      <button type="button" class="mobile-panel-backdrop" data-mobile-backdrop="workspace" data-for="workspace" aria-label="Dismiss workspace panel" onClick={props.onClose} />
    </Show>
    <aside ref={panelRoot} class="workspace-panel" data-shortcut-scope="workspace" classList={{ "workspace-panel-open": props.open() || shellWidth() > 0.5, "workspace-panel-expanded": props.expanded() }} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} style={{ "--workspace-panel-width": `${width()}px`, "--workspace-shell-width": `${shellWidth()}px`, width: `${shellWidth()}px`, "margin-right": `${shellGap()}px` }}>
    <div ref={resizeHandle} class="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuemin="240" aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") saveWidth(width() + 16); if (event.key === "ArrowRight") saveWidth(width() - 16); }} />
    <div ref={panelSurface} class="workspace-panel-surface">
    <header class="workspace-panel-header">
      <strong>Workspace</strong>
      <Button variant="ghost" size="icon-sm" class="workspace-expand-toggle" title={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-label={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-pressed={props.expanded()} onClick={props.onToggleExpanded}>
        <Show when={props.expanded()} fallback={<Maximize2Icon />}><Minimize2Icon /></Show>
      </Button>
      <Show when={props.expanded()} fallback={<div class="workspace-panel-tabs" role="toolbar" aria-label="Workspace views">
        <button type="button" role="tab" data-workspace-tab="files" aria-label="Files" aria-selected={tab() === "files"} onClick={selectFilesTab}><FolderIcon /><span>Files</span></button>
        <button type="button" role="tab" data-workspace-tab="diff" aria-label="Source Control" aria-selected={tab() === "diff"} onClick={() => activateTab("diff")}><GitCompareArrowsIcon /><span>Source Control</span></button>
        <button type="button" role="tab" data-workspace-tab="artifacts" aria-label="Artifacts" aria-selected={tab() === "artifacts"} onClick={() => activateTab("artifacts")}><BoxesIcon /><span>Artifacts</span></button>
        <button type="button" role="tab" data-workspace-tab="terminal" aria-label="Terminal" aria-selected={tab() === "terminal"} onClick={() => activateTab("terminal")}><TerminalIcon /><span>Terminal</span></button>
      </div>}>
        <div class="workspace-pane-selectors" aria-label="Expanded workspace panes">
          <label><span>Left</span><select aria-label="Left workspace pane" value={tab()} onChange={(event) => changePaneTab("left", event.currentTarget.value)}><For each={["files", "diff", "artifacts", "terminal"] satisfies PanelTab[]}>{(item) => <option value={item}>{tabLabel(item)}</option>}</For></select></label>
          <label><span>Right</span><select aria-label="Right workspace pane" value={secondaryTab() || "diff"} onChange={(event) => changePaneTab("right", event.currentTarget.value)}><For each={["files", "diff", "artifacts", "terminal"] satisfies PanelTab[]}>{(item) => <option value={item}>{tabLabel(item)}</option>}</For></select></label>
        </div>
      </Show>
      <Button variant="ghost" size="icon-sm" aria-label="Close workspace panel" onClick={props.onClose}><XIcon /></Button>
    </header>
    <Show when={error()}><div class="workspace-panel-error">{error()}</div></Show>
    <main ref={splitHost} class="workspace-panel-content" data-split={props.expanded() && secondaryTab() !== null} style={{ "--workspace-split-ratio": `${splitRatio()}%` }}>
    <Show when={props.expanded() && secondaryTab()}>
      <div class="workspace-split-resize-handle" role="separator" aria-label="Resize workspace panes" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow={splitRatio()} tabIndex={0} onPointerDown={startSplitResize} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") saveSplitRatio(splitRatio() - 2);
        else if (event.key === "ArrowRight") saveSplitRatio(splitRatio() + 2);
        else if (event.key === "Home") saveSplitRatio(25);
        else if (event.key === "End") saveSplitRatio(75);
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
            setFilesWide(!isMobileLayout() && width >= (props.expanded() ? 480 : WIDE_FILES_MIN_WIDTH));
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
        }}
        class="workspace-files"
        data-position={panePosition("files")}
        data-wide={filesWide()}
        data-tree-collapsed={treeCollapsed()}
        style={{ "--workspace-tree-width": `${treeWidth()}px` }}
      >
        <Show when={filesWide() && treeCollapsed()}>
          <div class="workspace-tree-collapsed-rail"><button type="button" aria-label="Show file tree" title="Show file tree" onClick={toggleTreeCollapsed}><PanelLeftOpenIcon /></button></div>
        </Show>
        <div class="workspace-tree-pane">
          <div class="workspace-tree-tools">
            <label class="workspace-tree-filter">
              <SearchIcon />
              <input
                ref={fileFilterInput}
                type="search"
                aria-label="Filter files"
                placeholder="Filter files"
                title="Filter loaded files and folders"
                value={fileFilter()}
                onInput={(event) => setFileFilter(event.currentTarget.value)}
                onKeyDown={onFileFilterKeyDown}
              />
            </label>
            <button type="button" aria-label="Collapse all folders" title="Collapse all folders" onClick={collapseTree}><ChevronsUpIcon /></button>
            <button type="button" aria-label={showHidden() ? "Hide hidden files" : "Show hidden files"} title={showHidden() ? "Hide hidden files" : "Show hidden files"} aria-pressed={showHidden()} onClick={toggleHidden}>
              <Show when={showHidden()} fallback={<EyeOffIcon />}><EyeIcon /></Show>
            </button>
            <button type="button" aria-label="Upload files" title="Upload files to workspace root" disabled={uploading()} onClick={() => chooseUpload()}><Show when={uploading()} fallback={<UploadIcon />}><Spinner /></Show></button>
            <button type="button" aria-label="Refresh files" title="Refresh files" disabled={filesLoading()} onClick={() => void refreshFiles()}><RefreshCwIcon /></button>
            <Show when={filesWide()}><button type="button" aria-label="Hide file tree" title="Hide file tree" onClick={toggleTreeCollapsed}><PanelLeftCloseIcon /></button></Show>
            <input ref={fileUploadInput} class="workspace-file-input" type="file" multiple onChange={(event) => void uploadFiles(event.currentTarget.files)} />
          </div>
          <nav ref={(element) => {
            treeElement = element;
            queueMicrotask(() => { element.scrollTop = workspaceCache.get(props.projectId())?.treeScrollTop || 0; });
          }} aria-label="Project files" role="tree" aria-busy={filesLoading()} class="workspace-tree" onScroll={saveTreeScroll}>
            <Tree directory="" />
            <Show when={directories()[""] && visibleEntries("").length === 0}><div class="workspace-tree-empty">{fileFilter() ? "No loaded files match this filter." : "No files to show."}</div></Show>
          </nav>
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
        <Show when={!filesWide()}>
          <div class="workspace-detail-toggle"><button aria-expanded={detailOpen()} onClick={toggleDetail}><ChevronDownIcon data-open={detailOpen()} /><span>File preview</span><Show when={preview()}><small>{preview()!.path} · {formatFileSize(preview()!.size)}</small></Show></button></div>
        </Show>
        <Show when={filesWide() || detailOpen()}><>
          <Show when={!filesWide()}><div class="workspace-detail-resize-handle" role="separator" aria-label="Resize file preview" aria-orientation="horizontal" aria-valuemin={MIN_DETAIL_HEIGHT} aria-valuemax={maxDetailHeight()} aria-valuenow={detailHeight()} tabIndex={0} onPointerDown={startDetailResize} onKeyDown={resizeDetailByKey} /></Show>
          <ContextMenu>
          <ContextMenuTrigger as="section" class="workspace-preview" aria-label="File preview" style={{ height: filesWide() ? "auto" : `${detailHeight()}px` }}>
            <Show when={preview()} fallback={<div class="workspace-panel-empty">Select a text file to preview it.</div>}>{(file) => <>
              <header class="workspace-preview-header">
                <div class="workspace-preview-file" title={file().path}><FileTypeIcon name={file().path} /><span>{file().path}</span></div>
                <small>{hasUnsavedChanges() ? "Unsaved" : formatFileSize(file().size)}</small>
                <button type="button" class="workspace-preview-action" aria-label={wrapLines() ? "Disable line wrapping" : "Enable line wrapping"} title={wrapLines() ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={wrapLines()} onClick={toggleWrapLines}><WrapTextIcon /></button>
                <button type="button" class="workspace-preview-action" aria-label={editing() ? "Close editor" : "Edit file"} title={editing() ? "Close editor" : "Edit file"} aria-pressed={editing()} onClick={() => editing() ? setEditing(false) : void editFile()}><Show when={editing()} fallback={<PencilIcon />}><XIcon /></Show></button>
                <button type="button" class="workspace-preview-action" aria-label="Save file" title="Save file (Ctrl+S)" disabled={!hasUnsavedChanges() || saving()} onClick={() => void saveFile()}><Show when={saving()} fallback={<SaveIcon />}><Spinner /></Show></button>
                <button type="button" class="workspace-preview-action" aria-label="Download file" title="Download file" onClick={() => void downloadFile()}><DownloadIcon /></button>
                <button type="button" class="workspace-preview-copy" aria-label="Copy file contents" title="Copy file contents" onClick={() => copy(draft())}><CopyIcon /></button>
              </header>
              <div class="workspace-preview-editor" data-editing={editing()} data-wrap={wrapLines()}>
                <Show when={file().path} keyed>{(path) =>
                  <Suspense fallback={<div class="workspace-panel-empty">Loading preview…</div>}>
                    <WorkspaceEditor path={path} value={draft()} wrap={wrapLines()} editable={editing()} onInput={setDraft} onSave={() => void saveFile()} />
                  </Suspense>
                }</Show>
              </div>
            </>}</Show>
          </ContextMenuTrigger>
          <Show when={preview()}>{(file) =>
            <ContextMenuContent class="w-48 workspace-file-menu">
              <ContextMenuGroup>
                <ContextMenuItem onSelect={() => void editFile()}><PencilIcon />Edit</ContextMenuItem>
                <ContextMenuItem disabled={!hasUnsavedChanges() || saving()} onSelect={() => void saveFile()}><SaveIcon />Save</ContextMenuItem>
                <ContextMenuItem onSelect={() => void downloadFile()}><DownloadIcon />Download</ContextMenuItem>
                <ContextMenuItem onSelect={() => copy(draft())}><CopyIcon />Copy contents</ContextMenuItem>
                <ContextMenuItem onSelect={() => copy(file().path)}><CopyIcon />Copy path</ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuContent>
          }</Show>
          </ContextMenu>
        </></Show>
      </div>
    </Show>
    <Show when={tabVisible("diff")}><section ref={(element) => { detailHost = element; }} class="workspace-diff" data-position={panePosition("diff")}>
      <div class="workspace-diff-overview">
      <div class="workspace-status-strip">
        <div><GitBranchIcon /><strong>{diff() ? diff()!.repository ? diff()!.branch : "Not a Git repository" : "Loading Git status…"}</strong><Show when={diff()?.upstream}><small>{diff()?.upstream}</small></Show></div>
        <div><Show when={diff()?.ahead || diff()?.behind}><span class="workspace-sync-state">↑ {diff()?.ahead || 0} ↓ {diff()?.behind || 0}</span></Show><Button variant="ghost" size="icon-sm" aria-label="Copy branch name" disabled={!diff()?.branch} onClick={() => copy(diff()?.branch)}><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Refresh Git status" disabled={diffLoading()} onClick={() => void loadDiff(diffDetailOpen())}><RefreshCwIcon /></Button></div>
      </div>
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
                <div class="workspace-change-row"><button type="button" title={`Open ${file.path}`} onClick={() => { if (props.expanded()) setPaneTab(panePosition("diff") === "left" ? "right" : "left", "files"); else selectTab("files"); void openFile(file.path); }}><code data-status={file.status[0]}>{file.status[0]}</code><span>{file.path}</span></button><button type="button" class="workspace-change-action" aria-label={`Unstage ${file.path}`} title="Unstage" disabled={Boolean(gitAction())} onClick={() => void runGitAction("unstage", file.path)}><Undo2Icon /></button></div>
              }</For></div>
            </Show></Show>
          </section>
          <section class="workspace-change-section" data-open={changesOpen()}>
            <header><button type="button" class="workspace-change-disclosure" aria-expanded={changesOpen()} onClick={() => setChangesOpen((open) => !open)}><ChevronRightIcon /><FileDiffIcon /><span>Changes</span><small>{unstagedFiles().length}</small></button><button type="button" aria-label="Stage all" title="Stage all" disabled={!unstagedFiles().length || Boolean(gitAction())} onClick={() => void runGitAction("stage-all")}><CirclePlusIcon /></button></header>
            <Show when={changesOpen()}><Show when={unstagedFiles().length} fallback={<div class="workspace-clean-state">Working tree clean</div>}>
              <div class="workspace-changes"><For each={unstagedFiles()}>{(file) =>
                <div class="workspace-change-row"><button type="button" title={`Open ${file.path}`} onClick={() => { if (props.expanded()) setPaneTab(panePosition("diff") === "left" ? "right" : "left", "files"); else selectTab("files"); void openFile(file.path); }}><code data-status={file.status[1] === " " ? "?" : file.status[1]}>{file.status[1] === " " ? "?" : file.status[1]}</code><span>{file.path}</span></button><button type="button" class="workspace-change-action" aria-label={`Stage ${file.path}`} title="Stage" disabled={Boolean(gitAction())} onClick={() => void runGitAction("stage", file.path)}><CirclePlusIcon /></button></div>
              }</For></div>
            </Show></Show>
          </section>
        </div>
      </Show>
      </div>
      <section class="workspace-source-workbench">
        <header>
          <div class="workspace-source-modes" role="tablist" aria-label="Source Control detail">
            <button type="button" role="tab" aria-selected={!diffDetailOpen()} onClick={() => selectSourceDetail(false)}><GitCommitHorizontalIcon />Graph</button>
            <button type="button" role="tab" aria-selected={diffDetailOpen()} onClick={() => selectSourceDetail(true)}><FileDiffIcon />Patch</button>
          </div>
          <small>{diffDetailOpen() ? `${diff()?.files.length || 0} changed` : `${diff()?.commits?.length || 0} recent`}</small>
          <div class="workspace-source-actions">
            <button type="button" aria-label="Fetch all remotes" title="Fetch all remotes" disabled={Boolean(gitAction())} onClick={() => void runGitAction("fetch")}><Show when={gitAction() === "fetch"} fallback={<RefreshCwIcon />}><Spinner /></Show><span>Fetch</span></button>
            <button type="button" aria-label="Pull current branch" title="Pull current branch (fast-forward only)" disabled={!diff()?.upstream || Boolean(gitAction())} onClick={() => void runGitAction("pull")}><DownloadIcon /><span>Pull</span></button>
            <button type="button" aria-label="Push current branch" title="Push current branch" disabled={!diff()?.upstream || Boolean(gitAction())} onClick={() => void runGitAction("push")}><SendIcon /><span>Push</span></button>
          </div>
        </header>
        <Show when={diffDetailOpen()} fallback={<Show when={Boolean(diff()?.commits?.length)} fallback={<div class="workspace-panel-empty">No commit history available.</div>}><CommitHistory commits={diff()?.commits || []} refs={diff()?.refs || []} branch={diff()?.branch} onCopy={copy} /></Show>}>
          <div class="workspace-patch"><Show when={diff()?.diff} fallback={<div class="workspace-panel-empty">{diff()?.repository ? "Working tree is clean." : "Diff is available for Git projects."}</div>}>{(content) => <PatchView content={content()} />}</Show></div>
        </Show>
      </section>
    </section></Show>
    <Show when={tabVisible("artifacts")}><section class="workspace-artifacts" data-position={panePosition("artifacts")}>
      <div class="workspace-artifact-modes" role="radiogroup" aria-label="Artifact modality"><button role="radio" aria-checked={artifactMode() === "outputs"} onClick={() => setArtifactMode("outputs")}>Outputs</button><button role="radio" aria-checked={artifactMode() === "interactive"} onClick={() => setArtifactMode("interactive")}>Interactive UI</button></div>
      <div class="workspace-panel-empty"><div><BoxesIcon /><strong>{artifactMode() === "outputs" ? "No artifacts in the loaded transcript" : "Interactive artifacts are not enabled"}</strong><p>{artifactMode() === "outputs" ? "Code blocks and file outputs will appear here as transcript artifact projection lands." : "This boundary is reserved for sandboxed, explicitly trusted generated interfaces."}</p></div></div>
    </section></Show>
    <Show when={tabVisible("terminal")}><section class="workspace-terminal-slot" data-position={panePosition("terminal")}><TerminalPane projectId={props.projectId()} terminalId={props.requestedTab?.()?.terminalId} /></section></Show>
    </main>
    <Show when={loading()}><div class="workspace-panel-loading"><Spinner /><span>Loading workspace</span></div></Show>
    </div>
  </aside>
  </>;
}
