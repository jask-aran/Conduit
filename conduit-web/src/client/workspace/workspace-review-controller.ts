import { batch, createSignal, onCleanup, untrack } from "solid-js";
import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";

export interface ReviewSource {
  isCurrent: () => boolean;
  load: (path: string, signal: AbortSignal) => Promise<ComparisonPayload | null>;
}

const initialView = (): ComparisonViewState => ({ layout: "unified", file: false, wrap: false, top: 0, left: 0, position: 0 });

function sameComparison(previous: ComparisonPayload | null, next: ComparisonPayload | null) {
  if (!previous || !next) return previous === next;
  if (previous.path !== next.path || previous.oldPath !== next.oldPath || previous.scope !== next.scope) return false;
  return previous.kind === "text" && next.kind === "text"
    ? previous.original === next.original && previous.modified === next.modified
    : previous.kind === "unavailable" && next.kind === "unavailable" && previous.message === next.message;
}

/** Source adapters own ranges and APIs; this controller owns review state. */
export function createReviewController(onError?: (message: string) => void) {
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);
  const [comparison, setComparison] = createSignal<ComparisonPayload | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [viewState, setViewState] = createSignal(initialView());
  let request: AbortController | undefined;
  const cancel = () => { request?.abort(); request = undefined; setBusy(false); };
  const select = (path: string | null) => {
    if (selectedPath() === path) return;
    cancel();
    batch(() => {
      setSelectedPath(path);
      setComparison(null);
      setError("");
      setViewState(initialView());
    });
  };
  const reconcile = (files: readonly { path: string }[]) => {
    const current = selectedPath();
    select(current && files.some((file) => file.path === current) ? current : files[0]?.path ?? null);
    return selectedPath();
  };
  const refresh = async (source: ReviewSource) => {
    const path = selectedPath();
    cancel();
    if (!path) return;
    const controller = new AbortController();
    request = controller;
    const owns = () => request === controller && !controller.signal.aborted && selectedPath() === path && source.isCurrent();
    setBusy(!untrack(comparison));
    setError("");
    try {
      const result = await source.load(path, controller.signal);
      if (owns()) setComparison((previous) => sameComparison(previous, result) ? previous : result);
    } catch (cause) {
      if (owns()) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        onError?.(message);
      }
    } finally {
      if (request === controller) { request = undefined; setBusy(false); }
    }
  };
  onCleanup(cancel);
  return { selectedPath, comparison, busy, error, viewState, setViewState, select, reconcile, refresh, cancel };
}
