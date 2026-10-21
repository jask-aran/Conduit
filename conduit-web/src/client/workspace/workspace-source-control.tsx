import { FileTypeIcon, FolderTypeIcon } from "@/components/ui/file-marks";
import { Icons } from "@/components/ui";
import { createDecisionScope } from "@/components/decision-dialog";
import { createEffect, createMemo, createSignal, For, on, Show, type Accessor } from "solid-js";
import { CirclePlusIcon, GitCommitHorizontalIcon, SendIcon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/menus";
import { Spinner } from "@/components/ui/controls";
import { api } from "../api/client";
import type { ReviewNavigationRequest } from "../chat/review-navigation";

import { writeSetting } from "./workspace-panel-storage";
import { cacheWorkspace, copyText, reportError, wasAborted, type RequestScope } from "./workspace-shared";
import { ComparisonSourceControls } from "./workspace-comparison-source";
import { WorkspaceDiffView } from "./workspace-diff-view";
import { createWorkspaceReview, diffScopes, type DiffScope } from "./workspace-review-source";
import type { DiffPayload, GitAction, GitActionResult, GitChangedFile, GitCommit, GitCommitDetail, GitRef, SourceControlMode, WorkspaceSettings } from "./workspace-types";
import { Button, Segmented } from "@/components/ui/controls";
import { ToolLine, CommitBox, ChangeLedger, ChangeSection, ChangeList, ChangeItem, ChangeEmpty, CommitRow, CommitList, PatchLines } from "@/components/ui/source";
import { ChangeRow } from "@/components/ui/dashboard";
import { ToolBar, ToolButton, ToolNotice, PaneEmpty } from "@/components/ui/pane";
import "./workspace.css";

const sourceControlScopes = diffScopes.filter((scope) => scope.value === "head" || scope.value === "changes" || scope.value === "staged");

function isSourceControlMode(value: string | null): value is SourceControlMode {
  return value === "changes" || value === "review" || value === "graph" || value === "patch";
}

function changeDetails(file: GitChangedFile, staged: boolean) {
  const name = file.path.replace(/\/$/, "").split("/").at(-1) ?? file.path;
  const directory = file.path.replace(/\/$/, "").split("/").slice(0, -1).join("/");
  const status = file.status === "??" ? "U" : file.status[staged ? 0 : 1] ?? "";
  const statusLabels: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", U: "Unmerged", T: "Type changed" };
  const counts = staged ? file.stagedCounts : file.workingCounts;
  return { name, directory, status, statusTitle: file.status === "??" ? "Untracked" : statusLabels[status] ?? status,
    conflict: file.status !== "??" && file.status.includes("U"), added: counts?.added, removed: counts?.removed };
}

function CommitHistory(props: { commits: GitCommit[]; refs: GitRef[]; branch?: string; onCopy: (hash: string) => void; onInspect: (commit: GitCommit) => void; labelled?: boolean }) {
  return <>
    <Show when={props.labelled}><ToolLine icon={<GitCommitHorizontalIcon />} title="History" detail={`${props.commits.length} recent`} /></Show>
    <CommitList>
      <For each={props.commits}>{(commit) =>
        <ContextMenu>
          <ContextMenuTrigger as={CommitRow} graph={commit.graph || "*"} subject={commit.subject}
            refs={props.refs.filter((ref) => ref.hash === commit.hash).map((ref) => ({ label: ref.kind === "local" && ref.name === props.branch ? `HEAD · ${ref.name}` : ref.name, current: ref.kind === "local" && ref.name === props.branch, kind: ref.kind }))}
            author={commit.author} hash={commit.shortHash}
            title={`Copy ${commit.hash} · ${commit.author} · ${new Date(commit.authoredAt).toLocaleString()}`} onClick={() => props.onCopy(commit.hash)} />
          <ContextMenuContent><MenuSection>
            <MenuRow onSelect={() => props.onInspect(commit)} icon={<Icons.Preview />}>Inspect commit</MenuRow>
            <MenuRow onSelect={() => props.onCopy(commit.hash)} icon={<Icons.Copy />}>Copy commit ID</MenuRow>
          </MenuSection></ContextMenuContent>
        </ContextMenu>
      }</For>
    </CommitList>
  </>;
}

function PatchView(props: { content: string }) {
  const [page, setPage] = createSignal(0);
  const lines = createMemo(() => props.content.split("\n"));
  createEffect(on(() => props.content, () => setPage(0)));
  return <><Show when={lines().length > 400}><div>
    <Button variant="ghost" size="sm" disabled={page() === 0} onClick={() => setPage(page() - 1)}>Previous lines</Button>
    <span> · Lines {page() * 400 + 1}–{Math.min((page() + 1) * 400, lines().length)} of {lines().length} · </span>
    <Button variant="ghost" size="sm" disabled={(page() + 1) * 400 >= lines().length} onClick={() => setPage(page() + 1)}>Next lines</Button>
  </div></Show><PatchLines lines={lines().slice(page() * 400, (page() + 1) * 400)} /></>;
}

/**
 * Source Control's state for one project: Git status, its mode, the commit
 * being written, and its review. It outlives the view, so switching away and
 * back keeps a half-written message and the file under review.
 */
export function createSourceControl(options: { projectId: Accessor<string>; enabled: Accessor<boolean>; chatId: Accessor<string | null>; requests: RequestScope; settings: WorkspaceSettings; settingsScope: string }) {
  const { confirm: confirmDialog } = createDecisionScope(options.projectId);
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
    if (action === "push" && !(await confirmDialog(`Push ${diff()?.branch || "the current branch"} to its configured remote?`))) return;
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
  return <Segmented arrows label="Source Control" value={props.control.mode()} onChange={props.control.selectMode} options={[
    { value: "changes", label: "Changes", icon: <Icons.Check />, title: "Changes" },
    { value: "review", label: "Review", icon: <Icons.GitCompareArrows />, title: "Review" },
    { value: "graph", label: "Graph", icon: <GitCommitHorizontalIcon />, title: "Graph" },
    { value: "patch", label: "Patch", icon: <Icons.FileDiff />, title: "Patch" },
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
      <ToolBar>
        <small>{c.mode() === "graph" ? `${c.diff()?.commits?.length || 0} recent` : `${c.diff()?.files.length || 0} changed`}</small>
          <ToolButton aria-label="Fetch all remotes" title="Fetch all remotes" disabled={Boolean(c.gitAction())} onClick={() => void c.runGitAction("fetch")}><Show when={c.gitAction() === "fetch"} fallback={<Icons.Refresh />}><Spinner /></Show></ToolButton>
          <ToolButton aria-label="Pull current branch" title="Pull current branch (fast-forward only)" disabled={!c.diff()?.upstream || Boolean(c.gitAction())} onClick={() => void c.runGitAction("pull")}><Icons.Download /></ToolButton>
          <ToolButton aria-label="Push current branch" title="Push current branch" disabled={!c.diff()?.upstream || Boolean(c.gitAction())} onClick={() => void c.runGitAction("push")}><SendIcon /></ToolButton>
      </ToolBar>
      <Show when={c.mode() === "changes"}>
      <div class="workspace-diff-overview">
      <ToolLine icon={<Icons.GitBranch />} title={c.diff() ? c.diff()!.repository ? c.diff()!.branch : "Not a Git repository" : "Loading Git status…"} detail={c.diff()?.upstream} end={<>
        <Show when={c.diff()?.ahead || c.diff()?.behind}><span>↑ {c.diff()?.ahead || 0} ↓ {c.diff()?.behind || 0}</span></Show>
        <ToolButton label="Copy branch name" disabled={!c.diff()?.branch} onClick={() => copyText(c.diff()?.branch)}><Icons.Copy /></ToolButton>
        <ToolButton label="Refresh Git status" disabled={c.diffLoading()} onClick={() => void c.loadDiff(c.mode() === "patch", c.mode() === "graph")}><Icons.Refresh /></ToolButton>
      </>} />
      <Show when={props.stale}><ToolNotice tone="warn" live action={{ label: "Retry", onClick: () => props.onRetryPoll() }}><span>Not updating</span><span aria-hidden="true">·</span></ToolNotice></Show>
      <Show when={c.diff()?.repository}>
        <CommitBox value={c.commitMessage()} placeholder="Message (Ctrl+Enter to commit)" count={c.stagedFiles().length}
          busy={c.gitAction() === "commit"} busyIcon={<Spinner />} icon={<Icons.Check />}
          disabled={!c.commitMessage().trim() || !c.stagedFiles().length || Boolean(c.gitAction())}
          onInput={c.setCommitMessage} onSubmit={() => void c.runGitAction("commit")} />
        <ChangeLedger>
          <ChangeSection open={c.stagedOpen()} label="Staged changes" count={c.stagedFiles().length} onToggle={() => c.setStagedOpen((open) => !open)}
            action={<ToolButton label="Unstage all" disabled={!c.stagedFiles().length || Boolean(c.gitAction())} onClick={() => void c.runGitAction("unstage-all")}><Icons.Undo /></ToolButton>}>
            <Show when={c.stagedFiles().length} fallback={<ChangeEmpty>No staged changes</ChangeEmpty>}>
              <ChangeList><For each={c.stagedFiles()}>{(file) =>
                <ChangeItem action={<ToolButton label={`Unstage ${file.path}`} title="Unstage" disabled={Boolean(c.gitAction())} onClick={() => void c.runGitAction("unstage", file.path)}><Icons.Undo /></ToolButton>}>
                  <ChangeRow {...changeDetails(file, true)} title={`Inspect changes in ${file.path}`} data-change-path={file.path} data-staged="true"
                    onClick={(event) => props.onInspectFile(file.path, true, event.altKey)}
                    icon={file.path.endsWith("/") ? <FolderTypeIcon name={changeDetails(file, true).name} expanded={false} /> : <FileTypeIcon name={changeDetails(file, true).name} />} />
                </ChangeItem>
              }</For></ChangeList>
            </Show>
          </ChangeSection>
          <ChangeSection open={c.changesOpen()} label="Changes" count={c.unstagedFiles().length} onToggle={() => c.setChangesOpen((open) => !open)}
            action={<ToolButton label="Stage all" disabled={!c.unstagedFiles().length || Boolean(c.gitAction())} onClick={() => void c.runGitAction("stage-all")}><CirclePlusIcon /></ToolButton>}>
            <Show when={c.unstagedFiles().some((file) => file.status === "??" && file.path.endsWith("/"))}><ToolNotice>Untracked folders are grouped. Staging a folder includes its contents.</ToolNotice></Show>
            <Show when={c.unstagedFiles().length} fallback={<ChangeEmpty>Working tree clean</ChangeEmpty>}>
              <ChangeList><For each={c.unstagedFiles()}>{(file) =>
                <ChangeItem action={<ToolButton label={`Stage ${file.path}`} title="Stage" disabled={Boolean(c.gitAction())} onClick={() => void c.runGitAction("stage", file.path)}><CirclePlusIcon /></ToolButton>}>
                  <ChangeRow {...changeDetails(file, false)} title={`Inspect changes in ${file.path}`} data-change-path={file.path} data-staged="false"
                    onClick={(event) => props.onInspectFile(file.path, false, event.altKey)}
                    icon={file.path.endsWith("/") ? <FolderTypeIcon name={changeDetails(file, false).name} expanded={false} /> : <FileTypeIcon name={changeDetails(file, false).name} />} />
                </ChangeItem>
              }</For></ChangeList>
            </Show>
          </ChangeSection>
        </ChangeLedger>
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
        <Show when={c.mode() === "graph" || c.mode() === "patch"}><Show when={c.mode() === "patch"} fallback={<Show when={Boolean(c.diff()?.commits?.length)} fallback={<PaneEmpty>No commit history available.</PaneEmpty>}><CommitHistory commits={c.diff()?.commits || []} refs={c.diff()?.refs || []} branch={c.diff()?.branch} onCopy={copyText} onInspect={(commit) => void c.inspectCommit(commit)} /></Show>}>
          <div class="workspace-patch"><Show when={c.commitDetailLoading()} fallback={<Show when={c.commitDetail()} fallback={<Show when={c.diff()?.diff} fallback={<PaneEmpty>{c.diff()?.repository ? "Working tree is clean." : "Diff is available for Git projects."}</PaneEmpty>}>{(content) => <PatchView content={content()} />}</Show>}>{(detail) => <PatchView content={detail().content} />}</Show>}><PaneEmpty>Loading commit…</PaneEmpty></Show></div>
        </Show></Show>
    </section>;
}
