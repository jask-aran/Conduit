import { batch, createEffect, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js";
import { BoxesIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, FileCode2Icon, FolderIcon, GitBranchIcon, GitCompareArrowsIcon, RefreshCwIcon, XIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import { api, asList } from "../api/client";
import { ownsWorkspaceRequest, type WorkspaceRequest } from "./request-ownership";

interface TreeEntry { name: string; path: string; type: "directory" | "file" | "other"; }
interface FilePreview { path: string; size: number; content: string; }
interface GitCommit { graph: string; hash: string; shortHash: string; subject: string; author: string; authoredAt: string; }
interface DiffPayload { repository: boolean; branch?: string; upstream?: string | null; ahead?: number; behind?: number; commits?: GitCommit[]; files: { status: string; path: string }[]; diff: string; }
type PanelTab = "files" | "diff" | "artifacts";
type ArtifactMode = "outputs" | "interactive";

interface WorkspaceCacheEntry {
  directories: Record<string, TreeEntry[]>;
  diff: DiffPayload | null;
}

const MAX_CACHED_WORKSPACES = 6;
const workspaceCache = new Map<string, WorkspaceCacheEntry>();

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

export default function WorkspacePanel(props: { projectId: Accessor<string>; chatId: Accessor<string>; open: Accessor<boolean>; onClose: () => void }) {
  let projectGeneration = 0;
  let requestVersion = 0;
  let projectController = new AbortController();
  const requests = new Map<string, WorkspaceRequest>();
  const requestControllers = new Map<number, AbortController>();
  const [pending, setPending] = createSignal(new Map<number, { foreground: boolean }>());
  const storageKey = () => `conduit:workspace-panel:${props.chatId()}:tab`;
  const [tab, setTab] = createSignal<PanelTab>((localStorage.getItem(storageKey()) as PanelTab) || "files");
  const [directories, setDirectories] = createSignal<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [preview, setPreview] = createSignal<FilePreview | null>(null);
  const [diff, setDiff] = createSignal<DiffPayload | null>(null);
  const [error, setError] = createSignal("");
  const widthKey = () => `conduit:workspace-panel:${props.chatId()}:width`;
  const [width, setWidth] = createSignal(Math.max(320, Math.min(620, Number(localStorage.getItem(widthKey())) || 420)));
  const [artifactMode, setArtifactMode] = createSignal<ArtifactMode>("outputs");
  const detailOpenKey = () => `conduit:workspace-panel:${props.chatId()}:${tab()}:detail-open`;
  const detailHeightKey = () => `conduit:workspace-panel:${props.chatId()}:${tab()}:detail-height`;
  const detailOpenFor = (nextTab: PanelTab) => localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${nextTab}:detail-open`) ?? (nextTab === "diff" ? "false" : "true");
  const [detailOpen, setDetailOpen] = createSignal(detailOpenFor(tab()) === "true");
  const [detailHeight, setDetailHeight] = createSignal(Math.max(160, Number(localStorage.getItem(detailHeightKey())) || 360));
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

  const selectTab = (next: PanelTab) => {
    setDetailOpen(detailOpenFor(next) === "true");
    setDetailHeight(Math.max(160, Number(localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${next}:detail-height`)) || 360));
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
    const move = (moveEvent: PointerEvent) => {
      const next = Math.max(160, Math.min(window.innerHeight - 230, startHeight + startY - moveEvent.clientY));
      setDetailHeight(next);
      localStorage.setItem(detailHeightKey(), String(next));
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); document.body.classList.remove("workspace-detail-resizing"); stopDetailResize = undefined; };
    stopDetailResize = stop;
    document.body.classList.add("workspace-detail-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  const resizeDetailByKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = Math.max(160, Math.min(window.innerHeight - 230, detailHeight() + (event.key === "ArrowUp" ? 20 : -20)));
    setDetailHeight(next);
    localStorage.setItem(detailHeightKey(), String(next));
  };
  const loadDirectory = async (directory = "", background = false) => {
    const { request, controller } = startRequest(`directory:${directory}`, !background);
    setError("");
    try {
      const payload = await api<{ entries: TreeEntry[] }>(`/v0/projects/${encodeURIComponent(request.projectId)}/tree?path=${encodeURIComponent(directory)}`, { signal: controller.signal });
      if (!ownsRequest(request)) return;
      setDirectories((current) => {
        const next = { ...current, [directory]: asList<TreeEntry>(payload.entries) };
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
  const saveWidth = (next: number) => {
    const value = Math.max(300, Math.min(Math.floor(window.innerWidth * 0.65), next));
    setWidth(value);
    localStorage.setItem(widthKey(), String(value));
  };
  let stopResize: (() => void) | undefined;
  const startResize = (event: PointerEvent) => {
    if (matchMedia("(max-width: 760px)").matches) return;
    stopResize?.();
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width();
    const move = (moveEvent: PointerEvent) => saveWidth(startWidth + startX - moveEvent.clientX);
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); document.body.classList.remove("workspace-resizing"); stopResize = undefined; };
    stopResize = stop;
    document.body.classList.add("workspace-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  onCleanup(() => { resetRequestScope(); stopResize?.(); stopDetailResize?.(); document.body.classList.remove("workspace-resizing"); document.body.classList.remove("workspace-detail-resizing"); });

  let loadedProjectId = "";
  createEffect(on(() => props.chatId(), () => {
    const nextTab = (localStorage.getItem(storageKey()) as PanelTab) || "files";
    batch(() => {
      setDetailOpen(detailOpenFor(nextTab) === "true");
      setDetailHeight(Math.max(160, Number(localStorage.getItem(`conduit:workspace-panel:${props.chatId()}:${nextTab}:detail-height`)) || 360));
      setWidth(Math.max(320, Math.min(620, Number(localStorage.getItem(widthKey())) || 420)));
      setTab(nextTab);
    });
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

  const Tree = (treeProps: { directory: string; depth?: number }) => <For each={directories()[treeProps.directory] || []}>{(entry) => <div>
    <button class="workspace-tree-row" style={{ "padding-left": `${10 + (treeProps.depth || 0) * 14}px` }} data-selected={preview()?.path === entry.path} onClick={() => entry.type === "directory" ? void toggleDirectory(entry.path) : entry.type === "file" ? void loadFile(entry.path) : undefined}>
      <Show when={entry.type === "directory"} fallback={<FileCode2Icon />}><ChevronRightIcon class="workspace-tree-chevron" data-open={expanded().has(entry.path)} /><FolderIcon /></Show><span>{entry.name}</span>
    </button>
    <Show when={entry.type === "directory" && expanded().has(entry.path)}><Tree directory={entry.path} depth={(treeProps.depth || 0) + 1} /></Show>
  </div>}</For>;

  return <aside class="workspace-panel" classList={{ "workspace-panel-open": props.open() }} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} style={{ "--workspace-panel-width": `${width()}px` }}>
    <div class="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuemin="300" aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") saveWidth(width() + 20); if (event.key === "ArrowRight") saveWidth(width() - 20); }} />
    <header class="workspace-panel-header"><div><strong>Workspace</strong><small>Read-only project context</small></div><Button variant="ghost" size="icon-sm" aria-label="Close workspace panel" onClick={props.onClose}><XIcon /></Button></header>
    <div class="workspace-panel-tabs" role="tablist" aria-label="Workspace views">
      <button role="tab" aria-selected={tab() === "files"} onClick={() => { selectTab("files"); if (!directories()[""]) void loadDirectory(); }}><FolderIcon />Files</button>
      <button role="tab" aria-selected={tab() === "diff"} onClick={() => selectTab("diff")}><GitCompareArrowsIcon />Source Control</button>
      <button role="tab" aria-selected={tab() === "artifacts"} onClick={() => selectTab("artifacts")}><BoxesIcon />Artifacts</button>
    </div>
    <Show when={error()}><div class="workspace-panel-error">{error()}</div></Show>
    <Show when={tab() === "files"}>
      <div class="workspace-files"><nav aria-label="Project files" class="workspace-tree"><Tree directory="" /></nav>
        <div class="workspace-detail-toggle"><button aria-expanded={detailOpen()} onClick={toggleDetail}><ChevronDownIcon data-open={detailOpen()} /><span>File preview</span><Show when={preview()}><small>{preview()!.path} · {preview()!.size.toLocaleString()} bytes</small></Show></button></div>
        <Show when={detailOpen()}><><div class="workspace-detail-resize-handle" role="separator" aria-label="Resize file preview" aria-orientation="horizontal" aria-valuemin="160" aria-valuemax={Math.max(160, window.innerHeight - 230)} aria-valuenow={detailHeight()} tabIndex={0} onPointerDown={startDetailResize} onKeyDown={resizeDetailByKey} /><section class="workspace-preview" aria-label="File preview" style={{ height: `${detailHeight()}px` }}><Show when={preview()} fallback={<div class="workspace-panel-empty">Select a text file to preview it.</div>}>{(file) => <pre><code>{file().content}</code></pre>}</Show></section></></Show>
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
      <Show when={detailOpen()}><><div class="workspace-detail-resize-handle" role="separator" aria-label="Resize working tree patch" aria-orientation="horizontal" aria-valuemin="160" aria-valuemax={Math.max(160, window.innerHeight - 230)} aria-valuenow={detailHeight()} tabIndex={0} onPointerDown={startDetailResize} onKeyDown={resizeDetailByKey} /><div class="workspace-patch" style={{ height: `${detailHeight()}px` }}><Show when={diff()?.diff} fallback={<div class="workspace-panel-empty">{diff()?.repository ? "Working tree is clean." : "Diff is available for Git projects."}</div>}>{(content) => <pre class="workspace-diff-content"><code>{content()}</code></pre>}</Show></div></></Show>
    </section></Show>
    <Show when={tab() === "artifacts"}><section class="workspace-artifacts">
      <div class="workspace-artifact-modes" role="radiogroup" aria-label="Artifact modality"><button role="radio" aria-checked={artifactMode() === "outputs"} onClick={() => setArtifactMode("outputs")}>Outputs</button><button role="radio" aria-checked={artifactMode() === "interactive"} onClick={() => setArtifactMode("interactive")}>Interactive UI</button></div>
      <div class="workspace-panel-empty"><div><BoxesIcon /><strong>{artifactMode() === "outputs" ? "No artifacts in the loaded transcript" : "Interactive artifacts are not enabled"}</strong><p>{artifactMode() === "outputs" ? "Code blocks and file outputs will appear here as transcript artifact projection lands." : "This boundary is reserved for sandboxed, explicitly trusted generated interfaces."}</p></div></div>
    </section></Show>
    <Show when={loading()}><div class="workspace-panel-loading"><Spinner /><span>Loading workspace</span></div></Show>
  </aside>;
}
