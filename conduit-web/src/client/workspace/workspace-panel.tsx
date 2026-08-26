import { batch, createEffect, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js";
import { BoxesIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, FileCode2Icon, FolderIcon, GitBranchIcon, GitCompareArrowsIcon, Maximize2Icon, Minimize2Icon, RefreshCwIcon, TerminalIcon, XIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import { api, asList } from "../api/client";
import { focusFirst, isMobileLayout, restoreFocus } from "../navigation/mobile-layout";
import { ownsWorkspaceRequest, type WorkspaceRequest } from "./request-ownership";
import { TerminalPane } from "../remotes/terminal-pane";
import { dispatchPanelGeometryMotion, PANEL_MOTION_DURATION_MS } from "../panel-motion";
import "./workspace.css";

interface TreeEntry { name: string; path: string; type: "directory" | "file" | "other"; }
interface DirectoryListing { entries: TreeEntry[]; truncated: boolean; }
interface FilePreview { path: string; size: number; content: string; }
interface GitCommit { graph: string; hash: string; shortHash: string; subject: string; author: string; authoredAt: string; }
interface DiffPayload { repository: boolean; branch?: string; upstream?: string | null; ahead?: number; behind?: number; commits?: GitCommit[]; files: { status: string; path: string }[]; diff: string; }
type PanelTab = "files" | "diff" | "artifacts" | "terminal";
type ArtifactMode = "outputs" | "interactive";

interface WorkspaceCacheEntry {
  directories: Record<string, DirectoryListing>;
  diff: DiffPayload | null;
}

const MAX_CACHED_WORKSPACES = 6;
const workspaceCache = new Map<string, WorkspaceCacheEntry>();
const COMPACT_UI_MIGRATION_KEY = "conduit:compact-ui-v2";

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
  const current = workspaceCache.get(projectId) || { directories: {}, diff: null };
  workspaceCache.delete(projectId);
  workspaceCache.set(projectId, { ...current, ...patch });
  while (workspaceCache.size > MAX_CACHED_WORKSPACES) workspaceCache.delete(workspaceCache.keys().next().value!);
}

export default function WorkspacePanel(props: { projectId: Accessor<string>; chatId: Accessor<string>; open: Accessor<boolean>; expanded: Accessor<boolean>; requestedTab?: Accessor<{ tab: PanelTab; nonce: number } | null>; onToggleExpanded: () => void; onClose: () => void }) {
  migrateWorkspaceGeometry();
  let projectGeneration = 0;
  let requestVersion = 0;
  let projectController = new AbortController();
  const requests = new Map<string, WorkspaceRequest>();
  const requestControllers = new Map<number, AbortController>();
  let panelRoot: HTMLElement | undefined;
  let panelSurface: HTMLDivElement | undefined;
  let resizeHandle: HTMLDivElement | undefined;
  let panelEdgeMotionId: number | null = null;
  let panelMotionId = 0;
  let panelEdgeRaf = 0;
  let panelSurfaceMotion: Animation | null = null;
  let mobileReturnFocus: HTMLElement | null = null;
  let mobileWasOpen = false;
  const [pending, setPending] = createSignal(new Map<number, { foreground: boolean }>());
  const storageKey = () => `conduit:workspace-panel:${props.chatId()}:tab`;
  const [tab, setTab] = createSignal<PanelTab>((localStorage.getItem(storageKey()) as PanelTab) || "files");
  const [directories, setDirectories] = createSignal<Record<string, DirectoryListing>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [preview, setPreview] = createSignal<FilePreview | null>(null);
  const [diff, setDiff] = createSignal<DiffPayload | null>(null);
  const [error, setError] = createSignal("");
  const widthKey = () => `conduit:workspace-panel:${props.chatId()}:width`;
  const [width, setWidth] = createSignal(Math.max(256, Math.min(496, Number(localStorage.getItem(widthKey())) || 336)));
  const [shellWidth, setShellWidth] = createSignal(props.open() ? width() : 0);
  const [shellGap, setShellGap] = createSignal(props.open() && !isMobileLayout() ? 8 : 0);
  const [artifactMode, setArtifactMode] = createSignal<ArtifactMode>("outputs");
  const detailOpenKey = () => `conduit:workspace-panel:${props.chatId()}:${tab()}:detail-open`;
  const detailHeightKey = () => `conduit:workspace-panel:${props.chatId()}:${tab()}:detail-height`;
  const detailOpenFor = (nextTab: PanelTab) => localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${nextTab}:detail-open`) ?? (nextTab === "diff" ? "false" : "true");
  const [detailOpen, setDetailOpen] = createSignal(detailOpenFor(tab()) === "true");
  const [detailHeight, setDetailHeight] = createSignal(Math.max(128, Number(localStorage.getItem(detailHeightKey())) || 288));
  const hasPending = (operation?: string) => [...pending().keys()].some((version) => !operation || requests.get(operation)?.version === version);
  const diffLoading = () => hasPending("diff");
  const filesLoading = () => [...requests.keys()].some((operation) => operation.startsWith("directory:") && hasPending(operation));
  const loading = () => [...pending().values()].some((entry) => entry.foreground);

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
    setDetailHeight(Math.max(128, Number(localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${next}:detail-height`)) || 288));
    setTab(next);
    localStorage.setItem(storageKey(), next);
  };
  const toggleDetail = () => {
    const next = !detailOpen();
    setDetailOpen(next);
    localStorage.setItem(detailOpenKey(), String(next));
    if (next && tab() === "diff") void loadDiff(true, true);
  };
  let stopDetailResize: (() => void) | undefined;
  const startDetailResize = (event: PointerEvent) => {
    stopDetailResize?.();
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = detailHeight();
    let pendingHeight = startHeight;
    let frame = 0;
    const clampHeight = (value: number) => Math.max(128, Math.min(window.innerHeight - 184, value));
    const apply = () => {
      frame = 0;
      setDetailHeight(clampHeight(pendingHeight));
    };
    const move = (moveEvent: PointerEvent) => {
      pendingHeight = startHeight + startY - moveEvent.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      const next = clampHeight(pendingHeight);
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
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = Math.max(128, Math.min(window.innerHeight - 184, detailHeight() + (event.key === "ArrowUp" ? 16 : -16)));
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
  };
  const loadFile = async (file: string) => {
    const { request, controller } = startRequest("file", true);
    setError("");
    try {
      const payload = await api<FilePreview>(`/v0/projects/${encodeURIComponent(request.projectId)}/file?path=${encodeURIComponent(file)}`, { signal: controller.signal });
      if (ownsRequest(request)) setPreview(payload);
    } catch (cause) {
      if (ownsRequest(request) && !wasAborted(cause)) { setPreview(null); setError((cause as Error).message); }
    } finally {
      finishRequest(request);
    }
  };
  const loadDiff = async (includePatch = false, reuse = false, background = false) => {
    if (diffLoading()) return;
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
  const copy = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };
  const clampWidth = (next: number) => Math.max(240, Math.min(Math.floor(window.innerWidth * 0.65), next));
  const saveWidth = (next: number) => {
    const value = clampWidth(next);
    batch(() => {
      setWidth(value);
      if (props.open()) setShellWidth(value);
    });
    localStorage.setItem(widthKey(), String(value));
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
  onCleanup(() => { resetRequestScope(); cancelPanelEdgeMotion(); clearPanelSurfaceMotion(); stopResize?.(); stopDetailResize?.(); document.body.classList.remove("workspace-resizing"); document.body.classList.remove("workspace-detail-resizing"); });

  let loadedProjectId = "";
  createEffect(on(() => props.chatId(), () => {
    stopResize?.();
    const nextTab = (localStorage.getItem(storageKey()) as PanelTab) || "files";
    batch(() => {
      setDetailOpen(detailOpenFor(nextTab) === "true");
      setDetailHeight(Math.max(128, Number(localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${nextTab}:detail-height`)) || 288));
      const nextWidth = Math.max(256, Math.min(496, Number(localStorage.getItem(widthKey())) || 336));
      setWidth(nextWidth);
      if (props.open()) setShellWidth(nextWidth);
      setTab(nextTab);
    });
  }));
  createEffect(on(() => props.requestedTab?.(), (next) => {
    if (next) selectTab(next.tab);
  }));
  createEffect(on(
    () => [props.projectId(), tab(), props.open()] as const,
    ([projectId, activeTab, open]) => {
      if (!open) return;
      const projectChanged = loadedProjectId !== projectId;
      if (projectChanged) {
        if (loadedProjectId) resetRequestScope();
        loadedProjectId = projectId;
        const cached = cachedWorkspace(projectId);
        batch(() => {
          setDirectories(cached?.directories || {});
          setExpanded(new Set<string>());
          setPreview(null);
          setDiff(cached?.diff || null);
          setError("");
        });
      }
      if (activeTab === "files" && !directories()[""] && !filesLoading()) void loadDirectory("", false);
      if (activeTab === "diff") {
        const includePatch = detailOpenFor("diff") === "true";
        const current = diff();
        if ((!current || (includePatch && !current.diff)) && !diffLoading()) void loadDiff(includePatch, false, Boolean(current));
      }
    }));

  const Tree = (treeProps: { directory: string; depth?: number }) => <>
    <For each={directories()[treeProps.directory]?.entries || []}>{(entry) => <div>
    <button class="workspace-tree-row" style={{ "padding-left": `${8 + (treeProps.depth || 0) * 11.2}px` }} data-selected={preview()?.path === entry.path} onClick={() => entry.type === "directory" ? void toggleDirectory(entry.path) : entry.type === "file" ? void loadFile(entry.path) : undefined}>
      <Show when={entry.type === "directory"} fallback={<FileCode2Icon />}><ChevronRightIcon class="workspace-tree-chevron" data-open={expanded().has(entry.path)} /><FolderIcon /></Show><span>{entry.name}</span>
    </button>
    <Show when={entry.type === "directory" && expanded().has(entry.path)}><Tree directory={entry.path} depth={(treeProps.depth || 0) + 1} /></Show>
  </div>}</For>
    <Show when={directories()[treeProps.directory]?.truncated}><div class="workspace-tree-notice">Showing a bounded selection of 500 items from this directory.</div></Show>
  </>;

  return <>
    <Show when={props.open()}>
      <button type="button" class="mobile-panel-backdrop" data-mobile-backdrop="workspace" data-for="workspace" aria-label="Dismiss workspace panel" onClick={props.onClose} />
    </Show>
    <aside ref={panelRoot} class="workspace-panel" classList={{ "workspace-panel-open": props.open() || shellWidth() > 0.5, "workspace-panel-expanded": props.expanded() }} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} style={{ "--workspace-panel-width": `${width()}px`, "--workspace-shell-width": `${shellWidth()}px`, width: `${shellWidth()}px`, "margin-right": `${shellGap()}px` }}>
    <div ref={resizeHandle} class="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuemin="240" aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") saveWidth(width() + 16); if (event.key === "ArrowRight") saveWidth(width() - 16); }} />
    <div ref={panelSurface} class="workspace-panel-surface">
    <header class="workspace-panel-header">
      <strong>Workspace</strong>
      <Button variant="ghost" size="icon-sm" class="workspace-expand-toggle" title={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-label={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-pressed={props.expanded()} onClick={props.onToggleExpanded}>
        <Show when={props.expanded()} fallback={<Maximize2Icon />}><Minimize2Icon /></Show>
      </Button>
      <div class="workspace-panel-tabs" role="tablist" aria-label="Workspace views">
        <button role="tab" aria-label="Files" aria-selected={tab() === "files"} onClick={() => { selectTab("files"); if (!directories()[""]) void loadDirectory(); }}><FolderIcon /><span>Files</span></button>
        <button role="tab" aria-label="Source Control" aria-selected={tab() === "diff"} onClick={() => selectTab("diff")}><GitCompareArrowsIcon /><span>Source Control</span></button>
        <button role="tab" aria-label="Artifacts" aria-selected={tab() === "artifacts"} onClick={() => selectTab("artifacts")}><BoxesIcon /><span>Artifacts</span></button>
        <button role="tab" aria-label="Terminal" aria-selected={tab() === "terminal"} onClick={() => selectTab("terminal")}><TerminalIcon /><span>Terminal</span></button>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Close workspace panel" onClick={props.onClose}><XIcon /></Button>
    </header>
    <Show when={error()}><div class="workspace-panel-error">{error()}</div></Show>
    <Show when={tab() === "files"}>
      <div class="workspace-files"><nav aria-label="Project files" class="workspace-tree"><Tree directory="" /></nav>
        <div class="workspace-detail-toggle"><button aria-expanded={detailOpen()} onClick={toggleDetail}><ChevronDownIcon data-open={detailOpen()} /><span>File preview</span><Show when={preview()}><small>{preview()!.path} · {preview()!.size.toLocaleString()} bytes</small></Show></button></div>
        <Show when={detailOpen()}><><div class="workspace-detail-resize-handle" role="separator" aria-label="Resize file preview" aria-orientation="horizontal" aria-valuemin="128" aria-valuemax={Math.max(128, window.innerHeight - 184)} aria-valuenow={detailHeight()} tabIndex={0} onPointerDown={startDetailResize} onKeyDown={resizeDetailByKey} /><section class="workspace-preview" aria-label="File preview" style={{ height: `${detailHeight()}px` }}><Show when={preview()} fallback={<div class="workspace-panel-empty">Select a text file to preview it.</div>}>{(file) => <pre><code>{file().content}</code></pre>}</Show></section></></Show>
      </div>
    </Show>
    <Show when={tab() === "diff"}><section class="workspace-diff">
      <div class="workspace-diff-overview">
      <div class="workspace-status-strip"><div><GitBranchIcon /><strong>{diff() ? diff()!.repository ? diff()!.branch : "Not a Git repository" : "Loading Git status…"}</strong><Show when={diff()?.upstream}><small>{diff()?.upstream}</small></Show><Show when={diff()?.ahead || diff()?.behind}><span>↑{diff()?.ahead || 0} ↓{diff()?.behind || 0}</span></Show></div><div><Button variant="ghost" size="icon-sm" aria-label="Copy branch name" disabled={!diff()?.branch} onClick={() => copy(diff()?.branch)}><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Refresh Git status" disabled={diffLoading()} onClick={() => void loadDiff(detailOpen())}><RefreshCwIcon /></Button></div></div>
      <Show when={diff()?.repository}><div class="workspace-git-summary"><span>{diff()?.files.length || 0} changed {(diff()?.files.length || 0) === 1 ? "file" : "files"}</span><span>{diff()?.commits?.length || 0} recent commits</span></div></Show>
      <Show when={diff()?.repository && diff()!.files.length}><div class="workspace-changes"><For each={diff()!.files}>{(file) => <div><code>{file.status}</code><span>{file.path}</span></div>}</For></div></Show>
      <Show when={diff()?.repository && diff()?.commits?.length}><div class="workspace-git-graph" aria-label="Recent commits"><For each={diff()!.commits}>{(commit) => <div class="workspace-commit"><code class="workspace-graph-rail">{commit.graph || "*"}</code><button title={`${commit.author} · ${new Date(commit.authoredAt).toLocaleString()}`} onClick={() => copy(commit.hash)}><span>{commit.subject}</span><code>{commit.shortHash}</code></button></div>}</For></div></Show>
      </div>
      <div class="workspace-detail-toggle"><button aria-expanded={detailOpen()} onClick={toggleDetail}><ChevronDownIcon data-open={detailOpen()} /><span>Working tree patch</span><small>{diff()?.files.length || 0} changed</small></button></div>
      <Show when={detailOpen()}><><div class="workspace-detail-resize-handle" role="separator" aria-label="Resize working tree patch" aria-orientation="horizontal" aria-valuemin="128" aria-valuemax={Math.max(128, window.innerHeight - 184)} aria-valuenow={detailHeight()} tabIndex={0} onPointerDown={startDetailResize} onKeyDown={resizeDetailByKey} /><div class="workspace-patch" style={{ height: `${detailHeight()}px` }}><Show when={diff()?.diff} fallback={<div class="workspace-panel-empty">{diff()?.repository ? "Working tree is clean." : "Diff is available for Git projects."}</div>}>{(content) => <pre class="workspace-diff-content"><code>{content()}</code></pre>}</Show></div></></Show>
    </section></Show>
    <Show when={tab() === "artifacts"}><section class="workspace-artifacts">
      <div class="workspace-artifact-modes" role="radiogroup" aria-label="Artifact modality"><button role="radio" aria-checked={artifactMode() === "outputs"} onClick={() => setArtifactMode("outputs")}>Outputs</button><button role="radio" aria-checked={artifactMode() === "interactive"} onClick={() => setArtifactMode("interactive")}>Interactive UI</button></div>
      <div class="workspace-panel-empty"><div><BoxesIcon /><strong>{artifactMode() === "outputs" ? "No artifacts in the loaded transcript" : "Interactive artifacts are not enabled"}</strong><p>{artifactMode() === "outputs" ? "Code blocks and file outputs will appear here as transcript artifact projection lands." : "This boundary is reserved for sandboxed, explicitly trusted generated interfaces."}</p></div></div>
    </section></Show>
    <Show when={tab() === "terminal"}><TerminalPane projectId={props.projectId()} /></Show>
    <Show when={loading()}><div class="workspace-panel-loading"><Spinner /><span>Loading workspace</span></div></Show>
    </div>
  </aside>
  </>;
}
