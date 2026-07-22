import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { BoxesIcon, ChevronRightIcon, CopyIcon, FileCode2Icon, FolderIcon, GitBranchIcon, GitCompareArrowsIcon, RefreshCwIcon, XIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import { api, asList } from "../api/client";

interface TreeEntry { name: string; path: string; type: "directory" | "file" | "other"; }
interface FilePreview { path: string; size: number; content: string; }
interface GitCommit { graph: string; hash: string; shortHash: string; subject: string; author: string; authoredAt: string; }
interface DiffPayload { repository: boolean; branch?: string; upstream?: string | null; ahead?: number; behind?: number; commits?: GitCommit[]; files: { status: string; path: string }[]; diff: string; }
type PanelTab = "files" | "diff" | "artifacts";
type ArtifactMode = "outputs" | "interactive";

export default function WorkspacePanel(props: { projectId: string; chatId: string; onClose: () => void }) {
  const storageKey = () => `conduit:workspace-panel:${props.chatId}:tab`;
  const [tab, setTab] = createSignal<PanelTab>((localStorage.getItem(storageKey()) as PanelTab) || "files");
  const [directories, setDirectories] = createSignal<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [preview, setPreview] = createSignal<FilePreview | null>(null);
  const [diff, setDiff] = createSignal<DiffPayload | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const widthKey = () => `conduit:workspace-panel:${props.chatId}:width`;
  const [width, setWidth] = createSignal(Math.max(320, Math.min(620, Number(localStorage.getItem(widthKey())) || 420)));
  const [artifactMode, setArtifactMode] = createSignal<ArtifactMode>("outputs");

  const selectTab = (next: PanelTab) => { setTab(next); localStorage.setItem(storageKey(), next); };
  const loadDirectory = async (directory = "") => {
    setLoading(true); setError("");
    try {
      const payload = await api<{ entries: TreeEntry[] }>(`/v0/projects/${encodeURIComponent(props.projectId)}/tree?path=${encodeURIComponent(directory)}`);
      setDirectories((current) => ({ ...current, [directory]: asList<TreeEntry>(payload.entries) }));
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  const toggleDirectory = async (directory: string) => {
    const next = new Set(expanded());
    if (next.has(directory)) next.delete(directory);
    else { next.add(directory); if (!directories()[directory]) await loadDirectory(directory); }
    setExpanded(next);
  };
  const loadFile = async (file: string) => {
    setLoading(true); setError("");
    try { setPreview(await api<FilePreview>(`/v0/projects/${encodeURIComponent(props.projectId)}/file?path=${encodeURIComponent(file)}`)); }
    catch (cause) { setPreview(null); setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  const loadDiff = async () => {
    setLoading(true); setError("");
    try { setDiff(await api<DiffPayload>(`/v0/projects/${encodeURIComponent(props.projectId)}/diff`)); }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  const copy = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };
  const saveWidth = (next: number) => {
    const value = Math.max(300, Math.min(Math.floor(window.innerWidth * 0.65), next));
    setWidth(value);
    localStorage.setItem(widthKey(), String(value));
  };
  const startResize = (event: PointerEvent) => {
    if (matchMedia("(max-width: 760px)").matches) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width();
    const move = (moveEvent: PointerEvent) => saveWidth(startWidth + startX - moveEvent.clientX);
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); document.body.classList.remove("workspace-resizing"); };
    document.body.classList.add("workspace-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  onCleanup(() => document.body.classList.remove("workspace-resizing"));

  createEffect(() => {
    void props.projectId;
    setDirectories({}); setExpanded(new Set<string>()); setPreview(null); setDiff(null); setError("");
    if (tab() === "files") void loadDirectory();
    if (tab() === "diff") void loadDiff();
  });

  const Tree = (treeProps: { directory: string; depth?: number }) => <For each={directories()[treeProps.directory] || []}>{(entry) => <div>
    <button class="workspace-tree-row" style={{ "padding-left": `${10 + (treeProps.depth || 0) * 14}px` }} data-selected={preview()?.path === entry.path} onClick={() => entry.type === "directory" ? void toggleDirectory(entry.path) : entry.type === "file" ? void loadFile(entry.path) : undefined}>
      <Show when={entry.type === "directory"} fallback={<FileCode2Icon />}><ChevronRightIcon class="workspace-tree-chevron" data-open={expanded().has(entry.path)} /><FolderIcon /></Show><span>{entry.name}</span>
    </button>
    <Show when={entry.type === "directory" && expanded().has(entry.path)}><Tree directory={entry.path} depth={(treeProps.depth || 0) + 1} /></Show>
  </div>}</For>;

  return <aside class="workspace-panel" aria-label="Workspace panel" style={{ width: `${width()}px` }}>
    <div class="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuemin="300" aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") saveWidth(width() + 20); if (event.key === "ArrowRight") saveWidth(width() - 20); }} />
    <header class="workspace-panel-header"><div><strong>Workspace</strong><small>Read-only project context</small></div><Button variant="ghost" size="icon-sm" aria-label="Close workspace panel" onClick={props.onClose}><XIcon /></Button></header>
    <div class="workspace-panel-tabs" role="tablist" aria-label="Workspace views">
      <button role="tab" aria-selected={tab() === "files"} onClick={() => { selectTab("files"); if (!directories()[""]) void loadDirectory(); }}><FolderIcon />Files</button>
      <button role="tab" aria-selected={tab() === "diff"} onClick={() => { selectTab("diff"); if (!diff()) void loadDiff(); }}><GitCompareArrowsIcon />Diff</button>
      <button role="tab" aria-selected={tab() === "artifacts"} onClick={() => selectTab("artifacts")}><BoxesIcon />Artifacts</button>
    </div>
    <Show when={error()}><div class="workspace-panel-error">{error()}</div></Show>
    <Show when={tab() === "files"}>
      <div class="workspace-files"><nav aria-label="Project files" class="workspace-tree"><Tree directory="" /></nav>
        <section class="workspace-preview" aria-label="File preview"><Show when={preview()} fallback={<div class="workspace-panel-empty">Select a text file to preview it.</div>}>{(file) => <><header><span>{file().path}</span><small>{file().size.toLocaleString()} bytes</small></header><pre><code>{file().content}</code></pre></>}</Show></section>
      </div>
    </Show>
    <Show when={tab() === "diff"}><section class="workspace-diff">
      <div class="workspace-status-strip"><div><GitBranchIcon /><strong>{diff()?.repository ? diff()?.branch : "Not a Git repository"}</strong><Show when={diff()?.upstream}><small>{diff()?.upstream}</small></Show><Show when={diff()?.ahead || diff()?.behind}><span>↑{diff()?.ahead || 0} ↓{diff()?.behind || 0}</span></Show></div><div><Button variant="ghost" size="icon-sm" aria-label="Copy branch name" disabled={!diff()?.branch} onClick={() => copy(diff()?.branch)}><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Refresh Git status" onClick={() => void loadDiff()}><RefreshCwIcon /></Button></div></div>
      <Show when={diff()?.repository}><div class="workspace-git-summary"><span>{diff()?.files.length || 0} changed {(diff()?.files.length || 0) === 1 ? "file" : "files"}</span><span>{diff()?.commits?.length || 0} recent commits</span></div></Show>
      <Show when={diff()?.repository && diff()!.files.length}><div class="workspace-changes"><For each={diff()!.files}>{(file) => <div><code>{file.status}</code><span>{file.path}</span></div>}</For></div></Show>
      <Show when={diff()?.repository && diff()?.commits?.length}><div class="workspace-git-graph" aria-label="Recent commits"><For each={diff()!.commits}>{(commit) => <div class="workspace-commit"><code class="workspace-graph-rail">{commit.graph || "*"}</code><button title={`${commit.author} · ${new Date(commit.authoredAt).toLocaleString()}`} onClick={() => copy(commit.hash)}><span>{commit.subject}</span><code>{commit.shortHash}</code></button></div>}</For></div></Show>
      <Show when={diff()?.diff} fallback={<div class="workspace-panel-empty">{diff()?.repository ? "Working tree is clean." : "Diff is available for Git projects."}</div>}>{(content) => <details class="workspace-patch"><summary>Working tree patch</summary><pre class="workspace-diff-content"><code>{content()}</code></pre></details>}</Show>
    </section></Show>
    <Show when={tab() === "artifacts"}><section class="workspace-artifacts">
      <div class="workspace-artifact-modes" role="radiogroup" aria-label="Artifact modality"><button role="radio" aria-checked={artifactMode() === "outputs"} onClick={() => setArtifactMode("outputs")}>Outputs</button><button role="radio" aria-checked={artifactMode() === "interactive"} onClick={() => setArtifactMode("interactive")}>Interactive UI</button></div>
      <div class="workspace-panel-empty"><div><BoxesIcon /><strong>{artifactMode() === "outputs" ? "No artifacts in the loaded transcript" : "Interactive artifacts are not enabled"}</strong><p>{artifactMode() === "outputs" ? "Code blocks and file outputs will appear here as transcript artifact projection lands." : "This boundary is reserved for sandboxed, explicitly trusted generated interfaces."}</p></div></div>
    </section></Show>
    <Show when={loading()}><div class="workspace-panel-loading"><Spinner /><span>Loading workspace</span></div></Show>
  </aside>;
}
