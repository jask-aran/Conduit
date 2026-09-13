import { batch, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { api } from "../api/client";
import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";
import { createReviewController } from "./workspace-review-controller";
import type { WorkspaceReviewFile } from "./workspace-review";

export type DiffScope = "chat" | "turn" | "head" | "changes" | "staged";
export const diffScopes = [
  { value: "chat", label: "This chat" },
  { value: "turn", label: "Selected turn" },
  { value: "head", label: "Uncommitted" },
  { value: "changes", label: "Unstaged" },
  { value: "staged", label: "Staged" },
] satisfies { value: DiffScope; label: string }[];

export function isDiffScope(value: string): value is DiffScope {
  return diffScopes.some((scope) => scope.value === value);
}

interface Checkpoint { id: string; turnId: string | null; createdAt: string; }
interface TurnFiles extends Checkpoint { files: { path: string; status: string; available: boolean }[]; }
interface GitFile { path: string; status: string; stagedCounts?: { added: number; removed: number } | null; workingCounts?: { added: number; removed: number } | null; headCounts?: { added: number; removed: number } | null; }

/** One comparison owner for every entry point. Checkpoint identity survives new turns. */
export function createWorkspaceReview(props: { projectId: Accessor<string>; chatId: Accessor<string | null>; gitFiles: Accessor<GitFile[]> }) {
  const review = createReviewController();
  const views = new Map<string, ComparisonViewState>();
  const [scope, setCurrentScope] = createSignal<DiffScope>("head");
  const [timeline, setTimeline] = createSignal<Checkpoint[]>([]);
  const [checkpointId, setCheckpointId] = createSignal<string | null>(null);
  const [turnFiles, setTurnFiles] = createSignal<TurnFiles | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal("");
  let request: AbortController | undefined;
  const cancel = () => { request?.abort(); request = undefined; review.cancel(); setLoading(false); };
  const setScope = (next: DiffScope, checkpoint: string | null = null) => {
    cancel();
    batch(() => {
      setCurrentScope(next);
      setCheckpointId(next === "chat" || next === "turn" ? checkpoint : null);
      setTurnFiles(null);
      setLoadError("");
      review.select(null);
    });
  };
  const turnIndex = createMemo(() => checkpointId() ? timeline().findIndex((turn) => turn.id === checkpointId()) : 0);
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
      case "chat": return checkpointId() ? `Chat start → Turn ${timeline().length - turnIndex()}` : "Chat start → Latest turn";
      case "turn": return turnIndex() > 0 ? "Turn start → Next turn start" : "Turn start → Working copy";
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
        const query = new URLSearchParams({ chatId, baseline: current });
        const turns = await api<Checkpoint[]>(`${base}?${new URLSearchParams({ chatId, timeline: "1" })}`, { signal: controller.signal });
        if (!owns()) return;
        setTimeline(turns);
        const checkpoint = checkpointId();
        if (checkpoint) query.set("checkpointId", checkpoint);
        const result = await api<TurnFiles | null>(`${base}?${query}`, { signal: controller.signal });
        if (!owns()) return;
        setTurnFiles(result);
      }
      if (!owns()) return;
      const path = files().some((file) => file.path === preferredPath) ? preferredPath : files()[0]?.path;
      if (path) await loadComparison(path);
      else review.select(null);
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
  return { ...review, setViewState, select, refresh, cancel, scope, setScope, timeline, turnIndex, checkpointId, rangeLabel, sourceKey, files,
    loading: () => loading() || review.busy(), error: () => loadError() || review.error() };
}
