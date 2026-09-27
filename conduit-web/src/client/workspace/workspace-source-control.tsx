import { createEffect, createMemo, createSignal, For, on, Show, type Accessor } from "solid-js";
import { CheckIcon, ChevronRightIcon, CirclePlusIcon, CopyIcon, DownloadIcon, EyeIcon, FileDiffIcon, GitBranchIcon, GitCommitHorizontalIcon, GitCompareArrowsIcon, RefreshCwIcon, SendIcon, Undo2Icon } from "lucide-solid";
import { Button, ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import { FileTypeIcon, FolderTypeIcon } from "./file-type-icon";
import { writeSetting } from "./workspace-panel-storage";
import { cacheWorkspace, copyText, reportError, wasAborted, type RequestScope } from "./workspace-shared";
import { ComparisonSourceControls } from "./workspace-comparison-source";
import { WorkspaceDiffView } from "./workspace-diff-view";
import { createWorkspaceReview, diffScopes, type DiffScope } from "./workspace-review-source";
import type { DiffPayload, GitAction, GitActionResult, GitChangedFile, GitCommit, GitCommitDetail, GitRef, SourceControlMode, WorkspaceSettings } from "./workspace-types";
import { Segmented } from "../settings/settings-controls";
import "./workspace.css";

const sourceControlScopes = diffScopes.filter((scope) => scope.value === "head" || scope.value === "changes" || scope.value === "staged");

function isSourceControlMode(value: string | null): value is SourceControlMode {
  return value === "changes" || value === "review" || value === "graph" || value === "patch";
}

function GitFileLabel(props: { file: GitChangedFile; staged: boolean }) {
  const name = () => props.file.path.replace(/\/$/, "").split("/").at(-1) ?? props.file.path;
  const directory = () => props.file.path.replace(/\/$/, "").split("/").slice(0, -1).join("/");
  const status = () => props.file.status === "??" ? "U" : props.file.status[props.staged ? 0 : 1] ?? "";
  const statusLabels: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", U: "Unmerged", T: "Type changed" };
  const counts = () => props.staged ? props.file.stagedCounts : props.file.workingCounts;
  return <>
    <Show when={props.file.path.endsWith("/")} fallback={<FileTypeIcon name={name()} />}><FolderTypeIcon name={name()} expanded={false} /></Show>
    <span class="workspace-change-name">{name()}</span>
    <span class="workspace-change-directory">{directory()}</span>
    <Show when={counts()} fallback={<small class="workspace-change-counts" title="Line counts unavailable for this entry">—</small>}>{(count) =>
      <small class="workspace-change-counts" aria-label={`${count().added} added, ${count().removed} removed`}><span class="workspace-git-removed">−{count().removed}</span><span class="workspace-git-added">+{count().added}</span></small>
    }</Show>
    <code data-status={status()} data-conflict={props.file.status !== "??" && props.file.status.includes("U")} title={props.file.status === "??" ? "Untracked" : statusLabels[status()] ?? status()}>{status()}</code>
  </>;
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

/**
 * Source Control's state for one project: Git status, its mode, the commit
 * being written, and its review. It outlives the view, so switching away and
 * back keeps a half-written message and the file under review.
 */
export function createSourceControl(options: { projectId: Accessor<string>; enabled: Accessor<boolean>; chatId: Accessor<string | null>; requests: RequestScope; settings: WorkspaceSettings; settingsScope: string }) {
  const { requests, settings } = options;
  const [diff, setDiff] = createSignal<DiffPayload | null>(null);
  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = createSignal(false);
  const [commitMessage, setCommitMessage] = createSignal("");
  const [gitAction, setGitAction] = createSignal("");
  const [stagedOpen, setStagedOpen] = createSignal(true);
  const [changesOpen, setChangesOpen] = createSignal(true);
  const review = createWorkspaceReview({ projectId: options.projectId, chatId: options.chatId, gitFiles: () => diff()?.files ?? [],
    scopes: sourceControlScopes.map((scope) => scope.value), scopeKey: "diff:review-scope" });
  const storedMode = (): SourceControlMode => {
    const stored = settings.panel("diff:mode");
    if (isSourceControlMode(stored)) return stored;
    if (settings.panel("diff:source-detail-open") !== "true") return "changes";
    return (settings.panel("diff:detail-open") ?? "false") === "true" ? "patch" : "graph";
  };
  const [mode, setMode] = createSignal<SourceControlMode>(storedMode());
  const diffLoading = () => requests.hasPending("diff");
  const stagedFiles = createMemo(() => (diff()?.files || []).filter((file) => file.status[0] !== " " && file.status[0] !== "?"));
  const unstagedFiles = createMemo(() => (diff()?.files || []).filter((file) => file.status[1] !== " " || file.status === "??"));

  let diffLoadPromise: Promise<void> | undefined;
  requests.onReset(() => { diffLoadPromise = undefined; });
  const loadDiff = (includePatch = false, includeHistory = false, reuse = false, background = false): Promise<void> => {
    if (!options.enabled()) return Promise.resolve();
    if (diffLoadPromise && !includePatch && !includeHistory) return diffLoadPromise;
    const load = async () => {
      const { request, controller } = requests.start("diff", !background);
      try {
      const endpoint = `/v0/projects/${encodeURIComponent(request.projectId)}/diff`;
      // Show the first status before waiting for history or a full patch.
      if (!diff() && (includePatch || includeHistory)) {
        const overview = await api<DiffPayload>(`${endpoint}?history=0${reuse ? "&reuse=1" : ""}`, { signal: controller.signal });
        if (!requests.owns(request)) return;
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
      if (requests.owns(request)) {
        const next = includeHistory ? payload : { ...payload, commits: undefined, refs: undefined };
        setDiff(next);
        cacheWorkspace(request.projectId, { diff: next });
      }
      } catch (cause) {
        if (requests.owns(request) && !wasAborted(cause)) reportError((cause as Error).message);
      } finally {
        requests.finish(request);
      }
    };
    const promise = load().finally(() => { if (diffLoadPromise === promise) diffLoadPromise = undefined; });
    diffLoadPromise = promise;
    return promise;
  };
  const selectMode = (next: SourceControlMode) => {
    setMode(next);
    writeSetting(options.settingsScope, "diff:mode", next);
    setCommitDetail(null);
    if (next === "review") void review.refresh();
    if (next === "patch" && !diff()?.diff) void loadDiff(true, false, true);
    if (next === "graph" && !diff()?.commits) void loadDiff(false, true, true);
  };
  const inspectCommit = async (commit: GitCommit) => {
    selectMode("patch");
    setCommitDetail(null);
    setCommitDetailLoading(true);
    const { request, controller } = requests.start("commit", true);
    try {
      const payload = await api<GitCommitDetail>(`/v0/projects/${encodeURIComponent(request.projectId)}/commits/${encodeURIComponent(commit.hash)}`, { signal: controller.signal });
      if (requests.owns(request)) setCommitDetail(payload);
    } catch (cause) {
      if (requests.owns(request) && !wasAborted(cause)) reportError((cause as Error).message);
    } finally {
      if (requests.owns(request)) setCommitDetailLoading(false);
      requests.finish(request);
    }
  };
  const runGitAction = async (action: GitAction, path?: string) => {
    if (gitAction()) return;
    if (action === "commit" && !commitMessage().trim()) return;
    if (action === "push" && !window.confirm(`Push ${diff()?.branch || "the current branch"} to its configured remote?`)) return;
    setGitAction(action);
    try {
      await api<GitActionResult>(`/v0/projects/${encodeURIComponent(options.projectId())}/git`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, path, message: action === "commit" ? commitMessage().trim() : undefined }),
      });
      if (action === "commit") setCommitMessage("");
      await loadDiff(mode() === "patch", mode() === "graph");
    } catch (cause) {
      reportError((cause as Error).message);
    } finally {
      setGitAction("");
    }
  };
  const openReviewScope = (scope: DiffScope, _path?: string, checkpoint: string | null = null) => {
    if (scope !== "head" && scope !== "changes" && scope !== "staged") return;
    review.setScope(scope, checkpoint);
    void review.refresh();
  };
  createEffect(() => {
    if (options.enabled()) return;
    setMode("changes");
    setDiff(null);
  });
  // A review belongs to one project: moving to another drops what is on screen.
  createEffect(on(options.projectId, (projectId, previous) => {
    if (previous !== undefined && previous !== projectId) review.reset();
  }));

  return {
    diff,
    setDiff,
    mode,
    selectMode,
    review,
    loadDiff,
    diffLoading,
    stagedFiles,
    unstagedFiles,
    commitDetail,
    commitDetailLoading,
    commitMessage,
    setCommitMessage,
    gitAction,
    runGitAction,
    stagedOpen,
    setStagedOpen,
    changesOpen,
    setChangesOpen,
    inspectCommit,
    openReviewScope,
    /** Back to the stored mode, with no commit open: a new chat or project. */
    restore: () => {
      setMode(storedMode());
      setCommitDetail(null);
    },
    /** Switch to Review on `scope`; the caller shows the view, then `refreshReview`. */
    showReview: (scope: DiffScope) => {
      setMode("review");
      writeSetting(options.settingsScope, "diff:mode", "review");
      setCommitDetail(null);
      review.setScope(scope);
    },
    refreshReview: async (path: string) => {
      if (!diff()) await loadDiff(false, false);
      await review.refresh(path);
    },
  };
}
export type SourceControl = ReturnType<typeof createSourceControl>;

/** Source Control's modes, a segmented switch in the header of whatever holds the view. */
export function SourceControlModes(props: { control: SourceControl }) {
  return <Segmented label="Source Control" value={props.control.mode()} onChange={props.control.selectMode} options={[
    { value: "changes", label: "Changes", icon: <CheckIcon />, title: "Changes" },
    { value: "review", label: "Review", icon: <GitCompareArrowsIcon />, title: "Review" },
    { value: "graph", label: "Graph", icon: <GitCommitHorizontalIcon />, title: "Graph" },
    { value: "patch", label: "Patch", icon: <FileDiffIcon />, title: "Patch" },
  ]} />;
}

export function SourceControlView(props: {
  control: SourceControl;
  stale: boolean;
  onRetryPoll: () => void;
  chatAvailable: boolean;
  commentChatId: string | null;
  reveal: ReviewNavigationRequest | null;
  onInspectFile: (path: string, staged: boolean, beside?: boolean) => void;
  onOpenWorkingFile: (path: string) => void;
}) {
  const c = props.control;
  return <section class="workspace-diff">
      <header class="workspace-detail-dock-header workspace-source-header">
        <small>{c.mode() === "graph" ? `${c.diff()?.commits?.length || 0} recent` : `${c.diff()?.files.length || 0} changed`}</small>
        <div class="workspace-source-actions">
          <button type="button" aria-label="Fetch all remotes" title="Fetch all remotes" disabled={Boolean(c.gitAction())} onClick={() => void c.runGitAction("fetch")}><Show when={c.gitAction() === "fetch"} fallback={<RefreshCwIcon />}><Spinner /></Show><span>Fetch</span></button>
          <button type="button" aria-label="Pull current branch" title="Pull current branch (fast-forward only)" disabled={!c.diff()?.upstream || Boolean(c.gitAction())} onClick={() => void c.runGitAction("pull")}><DownloadIcon /><span>Pull</span></button>
          <button type="button" aria-label="Push current branch" title="Push current branch" disabled={!c.diff()?.upstream || Boolean(c.gitAction())} onClick={() => void c.runGitAction("push")}><SendIcon /><span>Push</span></button>
        </div>
      </header>
      <Show when={c.mode() === "changes"}>
      <div class="workspace-diff-overview">
      <div class="workspace-status-strip">
        <div><GitBranchIcon /><strong>{c.diff() ? c.diff()!.repository ? c.diff()!.branch : "Not a Git repository" : "Loading Git status…"}</strong><Show when={c.diff()?.upstream}><small>{c.diff()?.upstream}</small></Show></div>
        <div><Show when={c.diff()?.ahead || c.diff()?.behind}><span class="workspace-sync-state">↑ {c.diff()?.ahead || 0} ↓ {c.diff()?.behind || 0}</span></Show><Button variant="ghost" size="icon-sm" aria-label="Copy branch name" disabled={!c.diff()?.branch} onClick={() => copyText(c.diff()?.branch)}><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Refresh Git status" disabled={c.diffLoading()} onClick={() => void c.loadDiff(c.mode() === "patch", c.mode() === "graph")}><RefreshCwIcon /></Button></div>
      </div>
      <Show when={props.stale}><div class="workspace-freshness-notice" role="status" aria-live="polite"><span>Not updating</span><span aria-hidden="true">·</span><button type="button" onClick={props.onRetryPoll}>Retry</button></div></Show>
      <Show when={c.diff()?.repository}>
        <form class="workspace-commit-composer" onSubmit={(event) => { event.preventDefault(); void c.runGitAction("commit"); }}>
          <textarea aria-label="Commit message" placeholder="Message (Ctrl+Enter to commit)" rows="1" value={c.commitMessage()} onInput={(event) => { const input = event.currentTarget; c.setCommitMessage(input.value); input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button type="submit" disabled={!c.commitMessage().trim() || !c.stagedFiles().length || Boolean(c.gitAction())}><Show when={c.gitAction() === "commit"} fallback={<CheckIcon />}><Spinner /></Show><span>Commit</span><small>{c.stagedFiles().length || ""}</small></button>
        </form>
        <div class="workspace-change-ledger">
          <section class="workspace-change-section" data-open={c.stagedOpen()}>
            <header><button type="button" class="workspace-change-disclosure" aria-expanded={c.stagedOpen()} onClick={() => c.setStagedOpen((open) => !open)}><ChevronRightIcon /><CheckIcon /><span>Staged changes</span><small>{c.stagedFiles().length}</small></button><button type="button" aria-label="Unstage all" title="Unstage all" disabled={!c.stagedFiles().length || Boolean(c.gitAction())} onClick={() => void c.runGitAction("unstage-all")}><Undo2Icon /></button></header>
            <Show when={c.stagedOpen()}><Show when={c.stagedFiles().length} fallback={<div class="workspace-clean-state">No staged changes</div>}>
              <div class="workspace-changes"><For each={c.stagedFiles()}>{(file) =>
<div class="workspace-change-row"><button type="button" title={`Inspect changes in ${file.path}`} data-change-path={file.path} data-staged="true" onClick={(event) => props.onInspectFile(file.path, true, event.altKey)}><GitFileLabel file={file} staged={true} /></button><button type="button" class="workspace-change-action" aria-label={`Unstage ${file.path}`} title="Unstage" disabled={Boolean(c.gitAction())} onClick={() => void c.runGitAction("unstage", file.path)}><Undo2Icon /></button></div>
              }</For></div>
            </Show></Show>
          </section>
          <section class="workspace-change-section" data-open={c.changesOpen()}>
            <header><button type="button" class="workspace-change-disclosure" aria-expanded={c.changesOpen()} onClick={() => c.setChangesOpen((open) => !open)}><ChevronRightIcon /><FileDiffIcon /><span>Changes</span><small>{c.unstagedFiles().length}</small></button><button type="button" aria-label="Stage all" title="Stage all" disabled={!c.unstagedFiles().length || Boolean(c.gitAction())} onClick={() => void c.runGitAction("stage-all")}><CirclePlusIcon /></button></header>
            <Show when={c.changesOpen() && c.unstagedFiles().some((file) => file.status === "??" && file.path.endsWith("/"))}><div class="workspace-tree-notice">Untracked folders are grouped. Staging a folder includes its contents.</div></Show>
            <Show when={c.changesOpen()}><Show when={c.unstagedFiles().length} fallback={<div class="workspace-clean-state">Working tree clean</div>}>
              <div class="workspace-changes"><For each={c.unstagedFiles()}>{(file) =>
                <div class="workspace-change-row"><button type="button" title={`Inspect changes in ${file.path}`} data-change-path={file.path} data-staged="false" onClick={(event) => props.onInspectFile(file.path, false, event.altKey)}><GitFileLabel file={file} staged={false} /></button><button type="button" class="workspace-change-action" aria-label={`Stage ${file.path}`} title="Stage" disabled={Boolean(c.gitAction())} onClick={() => void c.runGitAction("stage", file.path)}><CirclePlusIcon /></button></div>
              }</For></div>
            </Show></Show>
          </section>
        </div>
      </Show>
      </div>
      </Show>
      <Show when={c.mode() === "review"}><WorkspaceDiffView
        title="Changed files"
        files={c.review.files()}
        selectedPath={c.review.selectedPath()}
        comparison={c.review.comparison()}
        sourceKey={c.review.sourceKey()}
        viewState={c.review.viewState()}
        loading={c.review.loading()}
        error={c.review.error()}
        empty="No uncommitted changes."
        comparisonSource={<ComparisonSourceControls source={c.review} open={c.openReviewScope} scopes={sourceControlScopes} chatAvailable={props.chatAvailable} />}
        annotationChatId={props.commentChatId}
        reveal={props.reveal}
        onSelect={(path) => void c.review.select(path)}
        onOpenWorkingFile={props.onOpenWorkingFile}
        onViewStateChange={c.review.setViewState}
      /></Show>
        <Show when={c.mode() === "graph" || c.mode() === "patch"}><Show when={c.mode() === "patch"} fallback={<Show when={Boolean(c.diff()?.commits?.length)} fallback={<div class="workspace-panel-empty">No commit history available.</div>}><CommitHistory commits={c.diff()?.commits || []} refs={c.diff()?.refs || []} branch={c.diff()?.branch} onCopy={copyText} onInspect={(commit) => void c.inspectCommit(commit)} /></Show>}>
          <div class="workspace-patch"><Show when={c.commitDetailLoading()} fallback={<Show when={c.commitDetail()} fallback={<Show when={c.diff()?.diff} fallback={<div class="workspace-panel-empty">{c.diff()?.repository ? "Working tree is clean." : "Diff is available for Git projects."}</div>}>{(content) => <PatchView content={content()} />}</Show>}>{(detail) => <PatchView content={detail().content} />}</Show>}><div class="workspace-panel-empty">Loading commit…</div></Show></div>
        </Show></Show>
    </section>;
}
