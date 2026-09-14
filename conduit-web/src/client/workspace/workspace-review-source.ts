import { batch, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { api } from "../api/client";
import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";
import { createReviewController } from "./workspace-review-controller";
import { readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE, writeSetting } from "./workspace-panel-storage";
import type { WorkspaceReviewFile } from "./workspace-review";

export type DiffScope = "chat" | "turn" | "head" | "changes" | "staged";
export const diffScopes = [
  { value: "chat", label: "From start" },
  { value: "turn", label: "Single turn change" },
  { value: "head", label: "Uncommitted" },
  { value: "changes", label: "Unstaged" },
  { value: "staged", label: "Staged" },
] satisfies { value: DiffScope; label: string }[];

export function isDiffScope(value: string): value is DiffScope {
  return diffScopes.some((scope) => scope.value === value);
}

const MAX_TURN_PROBES = 25;

interface Checkpoint { id: string; turnId: string | null; createdAt: string; sequence: number; anchorEntryId: string | null; }
interface TurnFiles extends Checkpoint { files: { path: string; status: string; available: boolean }[]; }
interface GitFile { path: string; status: string; stagedCounts?: { added: number; removed: number } | null; workingCounts?: { added: number; removed: number } | null; headCounts?: { added: number; removed: number } | null; }

/** One comparison owner for every entry point. Checkpoint identity survives new turns. */
export type { Checkpoint };

export function createWorkspaceReview(props: { projectId: Accessor<string>; chatId: Accessor<string | null>; gitFiles: Accessor<GitFile[]>; scopes: DiffScope[]; scopeKey: string }) {
  const review = createReviewController();
  const views = new Map<string, ComparisonViewState>();
  // The picker is a reading preference: it outlives the chat and the session.
  const storedScope = (): DiffScope => {
    const value = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, props.scopeKey);
    return value && isDiffScope(value) && props.scopes.includes(value) ? value : props.scopes[0]!;
  };
  const [scope, setCurrentScope] = createSignal<DiffScope>(storedScope());
  const [timeline, setTimeline] = createSignal<Checkpoint[]>([]);
  const [checkpointId, setCheckpointId] = createSignal<string | null>(null);
  const [turnFiles, setTurnFiles] = createSignal<TurnFiles | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal("");
  let request: AbortController | undefined;
  const cancel = () => { request?.abort(); request = undefined; review.cancel(); setLoading(false); };
  const setScope = (next: DiffScope, checkpoint: string | null = null) => {
    cancel();
    if (props.scopes.includes(next)) writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, props.scopeKey, next);
    batch(() => {
      setCurrentScope(next);
      setCheckpointId(next === "chat" || next === "turn" ? checkpoint : null);
      setTurnFiles(null);
      setLoadError("");
      review.select(null);
    });
  };
  /** Drops everything tied to the previous project or chat so nothing stale renders. */
  const reset = () => {
    cancel();
    batch(() => {
      setTimeline([]);
      setCheckpointId(null);
      setTurnFiles(null);
      setLoadError("");
      review.select(null);
    });
  };
  const turnIndex = createMemo(() => checkpointId() ? timeline().findIndex((turn) => turn.id === checkpointId()) : 0);
  /** Turn numbers are stored with the checkpoint, so pruning leaves gaps instead of renumbering. */
  const turnNumber = (index: number) => timeline()[index]?.sequence ?? timeline().length - index;
  const sourceKey = () => JSON.stringify([props.projectId(), props.chatId(), scope(), checkpointId()]);
  const viewKey = (path: string) => JSON.stringify([sourceKey(), path]);
  const setViewState = (state: ComparisonViewState) => {
    review.setViewState(state);
    const path = review.selectedPath();
    if (!path) return;
    const key = viewKey(path);
    views.delete(key);
    views.set(key, state);
    if (views.size > 64) {
      const oldest = views.keys().next().value;
      if (oldest) views.delete(oldest);
    }
  };
  const rangeLabel = createMemo(() => {
    switch (scope()) {
      case "chat": return checkpointId() ? `Chat start → Turn ${turnNumber(turnIndex())}` : "Chat start → Latest turn";
      case "turn": return turnIndex() > 0 ? `Turn ${turnNumber(turnIndex())} → Turn ${turnNumber(turnIndex() - 1)}` : `Turn ${turnNumber(0)} → Working copy`;
      case "head": return "HEAD → Working copy";
      case "changes": return "Index → Working copy";
      case "staged": return "HEAD → Index";
    }
  });
  const files = createMemo<WorkspaceReviewFile[]>(() => {
    const current = scope();
    if (current === "chat" || current === "turn") return turnFiles()?.files ?? [];
    return props.gitFiles().filter((file) => !file.path.endsWith("/") && (current === "head"
      || (current === "staged" ? file.status[0] !== " " && file.status[0] !== "?" : file.status[1] !== " " || file.status === "??")))
      .map((file) => ({ path: file.path,
        status: file.status === "??" ? "U" : (current === "staged" ? file.status[0] : file.status[1]?.trim() || file.status[0]) ?? "M",
        counts: current === "staged" ? file.stagedCounts : current === "changes" ? file.workingCounts : file.headCounts }));
  });
  const fetchTurn = (checkpoint: string | null, signal: AbortSignal) => {
    const query = new URLSearchParams({ chatId: props.chatId() ?? "", baseline: scope() });
    if (checkpoint) query.set("checkpointId", checkpoint);
    return api<TurnFiles | null>(`/v0/projects/${encodeURIComponent(props.projectId())}/turn-artifact?${query}`, { signal });
  };
  const loadComparison = async (path: string) => {
    const projectId = props.projectId();
    const chatId = props.chatId();
    const current = scope();
    const checkpoint = checkpointId();
    if (review.selectedPath() !== path) {
      review.select(path);
      const saved = views.get(viewKey(path));
      if (saved) review.setViewState(saved);
    }
    const query = new URLSearchParams({ path });
    let endpoint: string;
    if (current === "chat" || current === "turn") {
      if (!chatId || !turnFiles()) return;
      query.set("chatId", chatId);
      query.set("baseline", current);
      if (checkpoint) query.set("checkpointId", checkpoint);
      endpoint = "turn-artifact";
    } else {
      query.set("compare", "1");
      query.set("scope", current);
      endpoint = "diff";
    }
    await review.refresh({
      isCurrent: () => props.projectId() === projectId && props.chatId() === chatId && scope() === current && checkpointId() === checkpoint,
      load: (_path, signal) => api<ComparisonPayload | null>(`/v0/projects/${encodeURIComponent(projectId)}/${endpoint}?${query}`, { signal }),
    });
  };
  const refresh = async (preferredPath = review.selectedPath()) => {
    cancel();
    const current = scope();
    const controller = new AbortController();
    request = controller;
    const projectId = props.projectId();
    const chatId = props.chatId();
    const owns = () => request === controller && !controller.signal.aborted && props.projectId() === projectId && props.chatId() === chatId;
    setLoading(true);
    setLoadError("");
    try {
      if (current === "chat" || current === "turn") {
        if (!chatId) throw new Error("Select a chat to review its changes.");
        const base = `/v0/projects/${encodeURIComponent(projectId)}/turn-artifact`;
        const turns = await api<Checkpoint[]>(`${base}?${new URLSearchParams({ chatId, timeline: "1" })}`, { signal: controller.signal });
        if (!owns()) return;
        setTimeline(turns);
        const result = await fetchTurn(checkpointId(), controller.signal);
        if (!owns()) return;
        setTurnFiles(result);
      }
      if (!owns()) return;
      const path = files().some((file) => file.path === preferredPath) ? preferredPath : files()[0]?.path;
      if (path) await loadComparison(path);
      else if (current === "chat" || current === "turn") {
        // Landing on a turn that changed nothing is a dead end: walk to an older one that did.
        review.select(null);
        void stepTurn(1, turnIndex() + 1);
      } else review.select(null);
    } catch (cause) {
      if (owns()) setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === controller) { request = undefined; setLoading(false); }
    }
  };
  /**
   * Moves along the timeline from `from`, in steps of `offset`, until a turn
   * that actually changed something turns up. Turns with no changes are dead
   * ends for the reviewer, so they are stepped over rather than shown; if the
   * walk runs off the end of the timeline the current turn is left alone.
   */
  const stepTurn = async (offset: number, from: number) => {
    const current = scope();
    const chatId = props.chatId();
    if ((current !== "chat" && current !== "turn") || !chatId) return;
    cancel();
    const controller = new AbortController();
    request = controller;
    const projectId = props.projectId();
    const owns = () => request === controller && !controller.signal.aborted
      && props.projectId() === projectId && props.chatId() === chatId && scope() === current;
    setLoading(true);
    setLoadError("");
    try {
      const turns = timeline();
      for (let index = from, probes = 0; index >= 0 && index < turns.length && probes < MAX_TURN_PROBES; index += offset || 1, probes++) {
        const checkpoint = index === 0 ? null : turns[index]!.id;
        const result = await fetchTurn(checkpoint, controller.signal);
        if (!owns()) return;
        if (!result?.files.length) continue;
        const preferred = review.selectedPath();
        batch(() => {
          setCheckpointId(checkpoint);
          setTurnFiles(result);
        });
        const path = files().some((file) => file.path === preferred) ? preferred : files()[0]?.path;
        if (path) await loadComparison(path);
        else review.select(null);
        return;
      }
    } catch (cause) {
      if (owns()) setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === controller) { request = undefined; setLoading(false); }
    }
  };
  const select = async (path: string) => {
    cancel();
    await loadComparison(path);
  };
  onCleanup(cancel);
  return { ...review, setViewState, select, refresh, cancel, reset, stepTurn, scope, setScope, timeline, turnIndex, turnNumber, checkpointId, rangeLabel, sourceKey, files,
    loading: () => loading() || review.busy(), error: () => loadError() || review.error() };
}
