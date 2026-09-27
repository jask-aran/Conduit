import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { toast } from "solid-sonner";
import { api } from "../api/client";
import type { Files } from "./workspace-files";
import { cacheWorkspace, wasAborted, type RequestScope } from "./workspace-shared";
import type { SourceControl } from "./workspace-source-control";
import type { WorkspaceVersion } from "./workspace-types";

const FILE_POLL_INTERVAL_MS = 1_500;

/**
 * Asks the server what changed in the project while a view that shows it is
 * open, and refreshes only that: the loaded folders and open files a change
 * touched, and Git status while it is on screen. Failures back off, and two in
 * a row mark the views "Not updating" until a retry.
 */
export function createWorkspacePoll(options: {
  projectId: Accessor<string>;
  requests: RequestScope;
  files: Files;
  sourceControl: SourceControl;
  sourceControlEnabled: Accessor<boolean>;
  /** The Computer page brings its own first listing and does not poll. */
  hasInitialDirectory: boolean;
  /** A view that shows the project is open. */
  shown: Accessor<boolean>;
  filesShown: Accessor<boolean>;
  diffShown: Accessor<boolean>;
}) {
  const { requests, files, sourceControl } = options;
  const [documentVisible, setDocumentVisible] = createSignal(document.visibilityState === "visible");
  const [networkOnline, setNetworkOnline] = createSignal(navigator.onLine);
  const [stale, setStale] = createSignal(false);
  const [retryCount, setRetryCount] = createSignal(0);
  const updateDocumentVisibility = () => setDocumentVisible(document.visibilityState === "visible");
  const updateNetworkOnline = () => setNetworkOnline(true);
  const updateNetworkOffline = () => setNetworkOnline(false);
  document.addEventListener("visibilitychange", updateDocumentVisibility);
  window.addEventListener("online", updateNetworkOnline);
  window.addEventListener("offline", updateNetworkOffline);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", updateDocumentVisibility);
    window.removeEventListener("online", updateNetworkOnline);
    window.removeEventListener("offline", updateNetworkOffline);
  });

  let polling = false;
  let failures = 0;
  let versionProjectId = "";
  let version: number | null = null;
  const refreshChanged = async (changedPaths: string[] | null, projectId: string) => {
    const treeChanged = await files.refreshChanged(changedPaths);
    if (options.projectId() !== projectId) return;
    if (treeChanged) toast.info("Workspace files updated");
    if (options.sourceControlEnabled() && (options.diffShown() || options.filesShown())) {
      const mode = sourceControl.mode();
      await sourceControl.loadDiff(options.diffShown() && mode === "patch", options.diffShown() && mode === "graph", false, true);
    } else {
      // Hidden Git data is stale; refresh it only when Source Control opens.
      sourceControl.setDiff(null);
      cacheWorkspace(projectId, { diff: null });
    }
  };
  const poll = async () => {
    if (polling || files.uploading()) return true;
    polling = true;
    const projectId = options.projectId();
    if (versionProjectId !== projectId) {
      versionProjectId = projectId;
      version = null;
      failures = 0;
      setStale(false);
    }
    const { request, controller } = requests.start("workspace-version", false);
    try {
      const query = new URLSearchParams({ paths: JSON.stringify(files.visiblePaths()) });
      const payload = await api<WorkspaceVersion>(`/v0/projects/${encodeURIComponent(projectId)}/workspace/version?${query}`, { signal: controller.signal });
      if (!requests.owns(request)) return true;
      const initialProbe = version === null;
      const changed = version !== payload.version;
      version = payload.version;
      if ((!initialProbe || (!options.hasInitialDirectory && (files.hasContent() || sourceControl.diff()))) && changed) {
        await refreshChanged(payload.changedPaths, projectId);
      }
      failures = 0;
      setStale(false);
      return true;
    } catch (cause) {
      if (options.projectId() === projectId && !wasAborted(cause)) {
        failures += 1;
        if (failures >= 2) setStale(true);
        console.warn("workspace poll failed", cause);
        return false;
      }
      return true;
    } finally {
      requests.finish(request);
      polling = false;
    }
  };
  createEffect(() => {
    const projectId = options.projectId();
    const active = !options.hasInitialDirectory && Boolean(projectId) && options.shown() && documentVisible() && networkOnline();
    retryCount();
    if (!active) {
      version = null;
      return;
    }
    let cancelled = false;
    let timer = 0;
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        const success = await poll();
        if (!cancelled) schedule(success ? FILE_POLL_INTERVAL_MS : Math.min(30_000, FILE_POLL_INTERVAL_MS * 2 ** failures));
      }, delay);
    };
    schedule(0);
    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  return {
    stale,
    retry: () => {
      failures = 0;
      setStale(false);
      setRetryCount((attempt) => attempt + 1);
    },
  };
}
