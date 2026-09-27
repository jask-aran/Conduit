import { createSignal, type Accessor } from "solid-js";
import { toast } from "solid-sonner";
import { ownsWorkspaceRequest, type WorkspaceRequest } from "./request-ownership";
import type { DiffPayload, DirectoryListing } from "./workspace-types";

// Foreground failures surface as toasts; background refreshes stay silent so a
// failing file cannot spam the corner every poll.
export const reportError = (message: string) => { if (message) toast.error(message); };
export const copyText = (value?: string) => { if (value) void navigator.clipboard.writeText(value); };
export const wasAborted = (cause: unknown) => (cause as { name?: string })?.name === "AbortError";

/**
 * One project's requests. Each operation keeps only its latest request; a
 * response is applied only while it still owns its operation and the project
 * has not changed underneath it (request-ownership). Resetting the scope
 * aborts everything in flight, which is what moving to another project does.
 */
export function createRequestScope(projectId: Accessor<string>) {
  let generation = 0;
  let requestVersion = 0;
  let controller = new AbortController();
  const requests = new Map<string, WorkspaceRequest>();
  const requestControllers = new Map<number, AbortController>();
  const resetListeners: (() => void)[] = [];
  const [pending, setPending] = createSignal(new Map<number, { foreground: boolean }>());
  const hasPending = (operation?: string) => [...pending().keys()].some((version) => !operation || requests.get(operation)?.version === version);
  const owns = (request: WorkspaceRequest) => ownsWorkspaceRequest({
    projectId: projectId(),
    generation,
    operation: request.operation,
    version: requests.get(request.operation)?.version || -1,
  }, request);
  const finish = (request: WorkspaceRequest) => {
    if (requests.get(request.operation)?.version === request.version) requests.delete(request.operation);
    requestControllers.delete(request.version);
    setPending((current) => {
      const next = new Map(current);
      next.delete(request.version);
      return next;
    });
  };
  const start = (operation: string, foreground: boolean) => {
    requests.get(operation) && requestControllers.get(requests.get(operation)!.version)?.abort();
    const requestController = new AbortController();
    controller.signal.addEventListener("abort", () => requestController.abort(), { once: true });
    const request: WorkspaceRequest = { projectId: projectId(), generation, operation, version: ++requestVersion };
    requests.set(operation, request);
    requestControllers.set(request.version, requestController);
    setPending((current) => new Map(current).set(request.version, { foreground }));
    return { request, controller: requestController };
  };
  const reset = () => {
    controller.abort();
    resetListeners.forEach((listener) => listener());
    controller = new AbortController();
    generation += 1;
    requests.clear();
    requestControllers.clear();
    setPending(new Map());
  };
  return {
    start,
    finish,
    owns,
    reset,
    /** Runs whenever the scope is reset, for state that belongs to a request in flight. */
    onReset: (listener: () => void) => { resetListeners.push(listener); },
    hasPending,
    /** Whether any operation whose name starts with `prefix` is still running. */
    hasPendingPrefix: (prefix: string) => [...requests.keys()].some((operation) => operation.startsWith(prefix) && hasPending(operation)),
    isRunning: (operation: string) => requests.has(operation),
    /** A foreground request is in flight: the panel shows it is loading. */
    loading: () => [...pending().values()].some((entry) => entry.foreground),
  };
}
export type RequestScope = ReturnType<typeof createRequestScope>;

export interface WorkspaceCacheEntry {
  directories: Record<string, DirectoryListing>;
  diff: DiffPayload | null;
  expanded: Set<string>;
  treeScrollTop: number;
}

// The last few projects' trees and Git state, so returning to one shows it
// at once while it refreshes.
const MAX_CACHED_WORKSPACES = 6;
const workspaceCache = new Map<string, WorkspaceCacheEntry>();

export function cachedWorkspace(projectId: string) {
  const cached = workspaceCache.get(projectId);
  if (!cached) return null;
  workspaceCache.delete(projectId);
  workspaceCache.set(projectId, cached);
  return cached;
}

/** The cached entry without marking it recently used. */
export const peekCachedWorkspace = (projectId: string) => workspaceCache.get(projectId);

export function cacheWorkspace(projectId: string, patch: Partial<WorkspaceCacheEntry>) {
  const current = workspaceCache.get(projectId) || { directories: {}, diff: null, expanded: new Set<string>(), treeScrollTop: 0 };
  workspaceCache.delete(projectId);
  workspaceCache.set(projectId, { ...current, ...patch });
  while (workspaceCache.size > MAX_CACHED_WORKSPACES) workspaceCache.delete(workspaceCache.keys().next().value!);
}
