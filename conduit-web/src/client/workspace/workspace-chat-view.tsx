import { createEffect, createMemo, createSignal, For, on, Show, type Accessor } from "solid-js";
import { ChevronDownIcon, HistoryIcon, ListCollapseIcon, WrapTextIcon } from "lucide-solid";
import { api } from "../api/client";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import { readSetting, writeSetting, WORKSPACE_PANEL_GLOBAL_SCOPE } from "./workspace-panel-storage";
import { reportError } from "./workspace-shared";
import { ComparisonSourceControls } from "./workspace-comparison-source";
import { WorkspaceDiffView } from "./workspace-diff-view";
import { createWorkspaceReview, diffScopes, type DiffScope } from "./workspace-review-source";
import { WorkbenchButton } from "./workspace-workbench";
import type { ChatMode, GitChangedFile, HistoryNode, HistoryTree, WorkspaceSettings } from "./workspace-types";
import "./workspace.css";

const chatScopes = diffScopes.filter((scope) => scope.value === "chat" || scope.value === "turn");

function historyEntryLabel(node: HistoryNode): string {
  if (node.label) return node.label;
  return node.entry.display || node.entry.type.replaceAll("_", " ");
}

function historyLength(node: HistoryNode): number {
  return 1 + Math.max(0, ...node.children.map(historyLength));
}

function primaryHistoryIndex(nodes: HistoryNode[], activePath: Set<string>): number {
  const activeIndex = nodes.findIndex((node) => activePath.has(node.entry.id));
  return Math.max(0, activeIndex >= 0
    ? activeIndex
    : nodes.reduce((best, node, index) => historyLength(node) > historyLength(nodes[best]!) ? index : best, 0));
}

function historyEntryTime(entry: HistoryNode["entry"]): string {
  const at = new Date(entry.timestamp);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * The longest chain of tool entries starting at this node. Sequential tool
 * calls are nested one per level rather than listed as siblings, so the run is
 * found by walking down; a fork or a non-tool entry ends it.
 */
function historyToolRun(node: HistoryNode): HistoryNode[] {
  if (node.entry.kind !== "tool" || node.entry.hidden) return [];
  const run = [node];
  let current = node;
  for (;;) {
    let next: HistoryNode | undefined = current.children.length === 1 ? current.children[0] : undefined;
    // Pi threads hidden assistant and system entries between visible tool
    // calls. They are never drawn, so walk straight through them: a run the
    // reader sees as consecutive has to be one run here too.
    while (next?.entry.hidden && next.children.length === 1) next = next.children[0];
    if (!next || next.entry.hidden || next.entry.kind !== "tool") break;
    run.push(next);
    current = next;
  }
  return run;
}

/**
 * A run of tool calls, folded into one line the reader can open.
 *
 * The button in the header is the blunt instrument: it flips every run at once
 * and forgets whatever was opened by hand, which is what makes it read as
 * "collapse all" rather than as a setting arguing with each row. This is the
 * fine one -- open this run, leave the rest alone.
 */
function HistoryToolRun(props: {
  run: HistoryNode[]; activePath: Set<string>; leafId: string | null; connected: boolean;
  open: boolean; onToggle: () => void;
}) {
  // The run stands for a span of time, so it carries the last stamp in it.
  const last = () => props.run[props.run.length - 1]!;
  const active = () => props.run.some((node) => props.activePath.has(node.entry.id));
  const leaf = () => props.run.some((node) => props.leafId === node.entry.id);
  const detail = () => props.run.map((node) => historyEntryLabel(node)).join("\n");
  return <button type="button" class="workspace-history-row workspace-history-run" data-kind="tool"
    data-collapsed={props.open ? undefined : "true"} data-active={active()} data-leaf={leaf()}
    aria-expanded={props.open} title={detail()} onClick={props.onToggle}>
      <Show when={props.connected}><span class="workspace-history-branch-tick" aria-hidden="true" /></Show>
      <Show when={historyEntryTime(last().entry)}>{(time) => <time class="workspace-history-time" datetime={last().entry.timestamp}>{time()}</time>}</Show>
      <span class="workspace-history-text">
        <ChevronDownIcon class="workspace-history-run-chevron" data-open={props.open ? "true" : "false"} aria-hidden="true" />
        {`${props.run.length} tool calls`}
      </span>
    </button>;
}

function HistoryNodeRow(props: { node: HistoryNode; activePath: Set<string>; leafId: string | null; connected: boolean }) {
  const node = () => props.node;
  const time = () => historyEntryTime(node().entry);
  return <div class="workspace-history-row" data-kind={node().entry.kind} data-discarded={node().entry.discarded ? "true" : undefined} data-active={props.activePath.has(node().entry.id)} data-leaf={props.leafId === node().entry.id} title={`${node().entry.discarded ? "Interrupted, not kept · " : ""}${time() ? `${new Date(node().entry.timestamp).toLocaleString()} · ` : ""}${historyEntryLabel(node())}`}>
      <Show when={props.connected}><span class="workspace-history-branch-tick" aria-hidden="true" /></Show>
      <Show when={time()}><time class="workspace-history-time" datetime={node().entry.timestamp}>{time()}</time></Show>
      <span class="workspace-history-text"><Show when={node().entry.kind === "user" || node().entry.kind === "assistant"} fallback={historyEntryLabel(node())}><strong>{node().entry.kind}:</strong>{` ${historyEntryLabel(node()).replace(/^\w+:\s*/, "")}`}</Show></span>
    </div>;
}

function HistoryNodes(props: { nodes: HistoryNode[]; activePath: Set<string>; leafId: string | null; connected?: boolean; depth?: number; collapseTools?: boolean; openRuns?: Set<string>; onToggleRun?: (id: string) => void }) {
  const primary = () => primaryHistoryIndex(props.nodes, props.activePath);
  const depth = () => props.depth ?? 0;
  const content = (node: HistoryNode, connected: boolean, level: number) => {
    const run = props.collapseTools ? historyToolRun(node) : [];
    if (run.length > 1) {
      // The run is named after the entry it starts at, so opening one survives
      // the tree being reprojected around it.
      const runId = run[0]!.entry.id;
      const open = () => Boolean(props.openRuns?.has(runId));
      return <>
        <HistoryToolRun run={run} activePath={props.activePath} leafId={props.leafId} connected={connected}
          open={open()} onToggle={() => props.onToggleRun?.(runId)} />
        <Show when={open()}>
          <For each={run}>{(step) =>
            <HistoryNodeRow node={step} activePath={props.activePath} leafId={props.leafId} connected={connected} />
          }</For>
        </Show>
        <HistoryNodes nodes={run[run.length - 1]!.children} activePath={props.activePath} leafId={props.leafId} connected={connected} depth={level} collapseTools={props.collapseTools} openRuns={props.openRuns} onToggleRun={props.onToggleRun} />
      </>;
    }
    return <>
      <Show when={!node.entry.hidden}><HistoryNodeRow node={node} activePath={props.activePath} leafId={props.leafId} connected={connected} /></Show>
      <HistoryNodes nodes={node.children} activePath={props.activePath} leafId={props.leafId} connected={connected} depth={level} collapseTools={props.collapseTools} openRuns={props.openRuns} onToggleRun={props.onToggleRun} />
    </>;
  };
  // Nesting is published as a depth rather than as padding on the wrapper: the
  // timestamp column has to stay at the far left, so only the text and the
  // tree lines may move right.
  return <For each={props.nodes}>{(node, index) => <Show when={index() !== primary()} fallback={content(node, Boolean(props.connected), depth())}>
    <div class="workspace-history-branch" style={{ "--history-depth": String(depth() + 1) }}>
      <span class="workspace-history-branch-rail" aria-hidden="true" />
      <div class="workspace-history-branch-content">{content(node, true, depth() + 1)}</div>
    </div>
  </Show>}</For>;
}

/**
 * Chat review's state for the open chat: its history tree and its agent
 * changes. Both follow the chat rather than the project, because they are
 * projections of it.
 */
export function createChatReview(options: {
  projectId: Accessor<string>;
  chatId: Accessor<string | null>;
  historyAvailable: Accessor<boolean>;
  /** Whether the view is showing; history loads only then. */
  visible: Accessor<boolean>;
  gitFiles: Accessor<GitChangedFile[]>;
  settings: WorkspaceSettings;
  settingsScope: string;
}) {
  const review = createWorkspaceReview({ projectId: options.projectId, chatId: options.chatId, gitFiles: options.gitFiles,
    scopes: chatScopes.map((scope) => scope.value), scopeKey: "chat:review-scope" });
  // History wraps independently of the editors: one is prose, the other code.
  const [historyWrap, setHistoryWrap] = createSignal(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "history-wrap") === "true");
  const toggleHistoryWrap = () => {
    const next = !historyWrap();
    setHistoryWrap(next);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "history-wrap", String(next));
    stickHistoryToBottom();
  };
  const [collapseTools, setCollapseTools] = createSignal(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "history-collapse-tools") === "true");
  // Runs the reader has opened by hand. Not persisted: it is a way of looking
  // at the chat in front of you, not a preference about every chat.
  const [openRuns, setOpenRuns] = createSignal<Set<string>>(new Set());
  const toggleRun = (id: string) => setOpenRuns((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  /**
   * Collapse all, or expand all.
   *
   * It takes everything with it rather than reading what the reader has opened
   * one run at a time: a button that had to work out whether "collapse all"
   * meant anything from the current mix would sometimes do nothing when
   * pressed, which is worse than blunt.
   */
  const toggleCollapseTools = () => {
    const next = !collapseTools();
    setCollapseTools(next);
    setOpenRuns(new Set<string>());
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "history-collapse-tools", String(next));
    stickHistoryToBottom();
  };
  const storedMode = (): ChatMode => options.settings.panel("chat:mode") === "changes" ? "changes" : "history";
  const [mode, setMode] = createSignal<ChatMode>(storedMode());
  const selectMode = (next: ChatMode) => {
    setMode(next);
    writeSetting(options.settingsScope, "chat:mode", next);
  };
  const [historyTree, setHistoryTree] = createSignal<HistoryTree | null>(null);
  const [historyLoading, setHistoryLoading] = createSignal(false);
  let historyChatId: string | null = null;
  let historyScroller: HTMLDivElement | undefined;
  // Newest entries are at the bottom, so the list follows them — but only for a
  // reader who is already there. Scrolling up to read is never interrupted.
  let historyPinned = true;
  const HISTORY_BOTTOM_SLACK = 24;
  const trackHistoryScroll = () => {
    const element = historyScroller;
    if (!element) return;
    historyPinned = element.scrollHeight - element.scrollTop - element.clientHeight <= HISTORY_BOTTOM_SLACK;
  };
  const stickHistoryToBottom = () => {
    // After the rows this update produced are in the DOM.
    queueMicrotask(() => {
      const element = historyScroller;
      if (element?.isConnected && historyPinned) element.scrollTop = element.scrollHeight;
    });
  };
  // `token` identifies one load attempt. Comparing the promise itself would
  // read the binding from inside its own initializer, and comparing chatId
  // would let a finished load clear a newer load of the same chat.
  let historyLoad: { chatId: string; token: object; promise: Promise<void> } | null = null;
  const loadHistory = async () => {
    const chatId = options.chatId();
    if (!chatId || !options.historyAvailable()) {
      historyChatId = null;
      setHistoryTree(null);
      return;
    }
    if (historyLoad?.chatId === chatId) return historyLoad.promise;
    const initialLoad = historyChatId !== chatId || !historyTree();
    if (initialLoad) {
      historyPinned = true;
      setHistoryLoading(true);
    }
    const token = {};
    const promise = (async () => {
      try {
        const result = await api<HistoryTree>(`/v0/chats/${encodeURIComponent(chatId)}/history`, { cache: "no-store" });
        if (options.chatId() === chatId) {
          historyChatId = chatId;
          setHistoryTree(result);
        }
      } catch (cause) {
        reportError((cause as Error).message);
      } finally {
        if (options.chatId() === chatId) setHistoryLoading(false);
        if (historyLoad?.token === token) historyLoad = null;
      }
    })();
    historyLoad = { chatId, token, promise };
    return promise;
  };
  // A tree belongs to one chat. The effect that reloads the panel watches the
  // project and the tabs but not the chat, so stepping from a chat to its
  // project's dashboard -- same project, no chat -- left the previous chat's
  // history sitting on screen under a heading that no longer described it.
  createEffect(on(options.chatId, (chatId, previous) => {
    if (previous !== undefined && chatId === previous) return;
    if (!chatId) {
      historyChatId = null;
      setHistoryTree(null);
      return;
    }
    if (mode() === "history" && options.visible()) void loadHistory();
  }));
  createEffect(on(historyTree, stickHistoryToBottom));
  const historyActivePath = createMemo(() => {
    const result = new Set<string>();
    const tree = historyTree();
    if (!tree?.leafId) return result;
    const parents = new Map<string, string | null>();
    const pending = [...tree.tree];
    while (pending.length) {
      const node = pending.pop()!;
      parents.set(node.entry.id, node.entry.parentId);
      pending.push(...node.children);
    }
    let current: string | null = tree.leafId;
    while (current) {
      result.add(current);
      current = parents.get(current) || null;
    }
    return result;
  });
  const openReviewScope = (scope: DiffScope, _path?: string, checkpoint: string | null = null) => {
    if (scope !== "chat" && scope !== "turn") return;
    review.setScope(scope, checkpoint);
    void review.refresh();
  };
  const showAgentChanges = () => {
    selectMode("changes");
    openReviewScope(review.scope() === "turn" ? "turn" : "chat", undefined, review.checkpointId());
  };
  // A review belongs to one project and chat. Moving to either a different
  // project or a different chat drops what is on screen before reloading, and
  // a context with no chat at all leaves the view blank. The one exception is
  // stepping from a chat to its own project's dashboard, which keeps showing
  // the chat that was just open.
  createEffect(on(
    () => [options.projectId(), options.chatId(), mode(), options.visible()] as const,
    ([projectId, chatId, currentMode, visible], previous) => {
      const movedProject = previous ? previous[0] !== projectId : false;
      const movedChat = previous ? previous[1] !== chatId : false;
      if (movedChat && !movedProject && !chatId) return;
      if (movedChat || movedProject) review.reset();
      if (!visible || currentMode !== "changes" || !chatId) return;
      if (review.scope() !== "chat" && review.scope() !== "turn") review.setScope("chat");
      void review.refresh();
    },
  ));

  return {
    review,
    mode,
    selectMode,
    showAgentChanges,
    openReviewScope,
    loadHistory,
    historyTree,
    historyLoading,
    historyActivePath,
    historyWrap,
    toggleHistoryWrap,
    collapseTools,
    toggleCollapseTools,
    openRuns,
    toggleRun,
    trackHistoryScroll,
    bindHistoryScroller: (element: HTMLDivElement) => { historyScroller = element; stickHistoryToBottom(); },
  };
}
export type ChatReview = ReturnType<typeof createChatReview>;

export function ChatView(props: {
  control: ChatReview;
  position?: "left" | "right";
  historyAvailable: boolean;
  chatId: string | null;
  commentChatId: string | null;
  reveal: ReviewNavigationRequest | null;
  onOpenWorkingFile: (path: string) => void;
}) {
  const c = props.control;
  return <section class="workspace-chat-view" data-position={props.position}>
      <div class="workspace-chat-modes" role="radiogroup" aria-label="Chat view"><div><Show when={props.historyAvailable}><button role="radio" aria-checked={c.mode() === "history"} onClick={() => { c.selectMode("history"); void c.loadHistory(); }}>History</button></Show><button role="radio" aria-checked={c.mode() === "changes"} onClick={c.showAgentChanges}>Agent changes</button></div>
        <Show when={c.mode() === "history"}>
          <div class="workspace-history-toolbar">
            <WorkbenchButton class="workspace-history-toggle" aria-label={c.collapseTools() ? "Expand tool calls" : "Collapse sequential tool calls"} aria-pressed={c.collapseTools()} title={c.collapseTools() ? "Expand tool calls" : "Collapse sequential tool calls"} onClick={c.toggleCollapseTools}><ListCollapseIcon /></WorkbenchButton>
            <WorkbenchButton class="workspace-history-toggle" aria-label={c.historyWrap() ? "Disable line wrapping" : "Enable line wrapping"} aria-pressed={c.historyWrap()} title={c.historyWrap() ? "Disable line wrapping" : "Enable line wrapping"} onClick={c.toggleHistoryWrap}><WrapTextIcon /></WorkbenchButton>
          </div>
        </Show></div>
      <Show when={c.mode() === "history"}><Show when={!c.historyLoading()} fallback={<div class="workspace-panel-empty">Loading history…</div>}><Show when={c.historyTree()?.tree.length} fallback={<div class="workspace-panel-empty"><div><HistoryIcon /><Show when={props.chatId} fallback={<><strong>No chat open</strong><p>Open a chat to see its history.</p></>}><strong>No chat history</strong><p>Send a message to start this tree.</p></Show></div></div>}><div class="workspace-chat-history" role="tree" aria-label="Chat history" data-wrap={c.historyWrap() ? "true" : "false"}
          ref={c.bindHistoryScroller} onScroll={c.trackHistoryScroll}><HistoryNodes nodes={c.historyTree()!.tree} activePath={c.historyActivePath()} leafId={c.historyTree()!.leafId} collapseTools={c.collapseTools()} openRuns={c.openRuns()} onToggleRun={c.toggleRun} /></div></Show></Show></Show>
      <Show when={c.mode() === "changes"}><WorkspaceDiffView
        title="Changed files"
        files={c.review.files()}
        selectedPath={c.review.selectedPath()}
        comparison={c.review.comparison()}
        sourceKey={c.review.sourceKey()}
        viewState={c.review.viewState()}
        loading={c.review.loading()}
        error={c.review.error()}
        empty={props.chatId ? "No changes in this scope." : "Open a chat to review agent changes."}
        comparisonSource={<ComparisonSourceControls source={c.review} open={c.openReviewScope} scopes={chatScopes} chatAvailable={Boolean(props.chatId)} />}
        annotationChatId={props.commentChatId}
        reveal={props.reveal}
        onSelect={(path) => void c.review.select(path)}
        onOpenWorkingFile={props.onOpenWorkingFile}
        onViewStateChange={c.review.setViewState}
      /></Show>
    </section>;
}
