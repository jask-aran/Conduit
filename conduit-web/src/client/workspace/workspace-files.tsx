import { FileTypeIcon, FolderTypeIcon } from "@/components/ui/file-marks";
import { Icons } from "@/components/ui";
import { createDecisionScope } from "@/components/decision-dialog";
import { unitPx } from "../layout-geometry";
import { batch, createMemo, createSignal, For, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import { ChevronsUpIcon, FilePlusIcon, FolderUpIcon, MoveIcon } from "lucide-solid";
import { toast } from "@/components/notifications";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, Menu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/menus";
import { Rule } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/controls";
import { SplitEdge } from "@/components/ui/editor";
import { api, asList } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import type { ReviewNavigationRequest } from "../chat/review-navigation";
import { isMobileLayout } from "../navigation/mobile-layout";
import { PaneEmpty, ToolBar, ToolButton, ToolFilter, ToolNotice, Tree as TreeList, TreeRow } from "@/components/ui/pane";

import WorkspaceFileSlot, { preloadWorkspaceEditor, type FileSlotHandle, type FileSummary } from "./workspace-file-slot";
import { readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE, writeSetting } from "./workspace-panel-storage";
import { cacheWorkspace, copyText, peekCachedWorkspace, reportError, wasAborted, type RequestScope, type WorkspaceCacheEntry } from "./workspace-shared";
import type { DirectoryListing, FileSlotId, FileWriteResult, GitChangedFile, MovedEntry, OpenFiles, TreeEntry, UploadTarget, WorkspaceSettings } from "./workspace-types";
import "./workspace.css";

// In the unit (layout-geometry): the width at which Files lays its tree beside the file, and the tree's own widths.
const WIDE_FILES_MIN_UNITS = 56.25, WIDE_FILES_EXPANDED_UNITS = 40.625;
const DEFAULT_TREE_UNITS = 12, MIN_TREE_UNITS = 10, MAX_TREE_UNITS = 25;

function directoryListingsEqual(left: DirectoryListing | undefined, right: DirectoryListing): boolean {
  return Boolean(left
    && left.truncated === right.truncated
    && left.cursor === right.cursor && left.total === right.total && left.oversize === right.oversize
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return entry.name === other?.name && entry.path === other.path && entry.type === other.type;
    }));
}

function storedPaths(scopeId: string, name: string) {
  try {
    const value: unknown = JSON.parse(readSetting(scopeId, name) || "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

/**
 * Files' state for one project: the tree as loaded so far, the two open file
 * slots -- the view's own, and the file opened beside it in the main pane's
 * split (`secondary`) -- and the navigator's geometry. It outlives the view, so a hidden Files
 * view keeps its drafts, and the change poll can refresh what is open.
 */
export function createFiles(options: {
  projectId: Accessor<string>; requests: RequestScope; settings: WorkspaceSettings; settingsScope: string;
  /**
   * Where a file opens instead of the view's own slot: a pane's file viewer
   * (docs/design/panes-and-rail.md, 6d-2). Answers false where there is none
   * (a phone, a desktop too narrow for a pane), and the slot opens it.
   */
  openElsewhere?: (path: string, beside: boolean, edit: boolean) => boolean;
}) {
  const { confirm: confirmDialog, prompt: promptDialog } = createDecisionScope(options.projectId);
  const { requests, settings } = options;
  const [directories, setDirectories] = createSignal<Record<string, DirectoryListing>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [fileFilter, setFileFilter] = createSignal("");
  const [treeFocusPath, setTreeFocusPath] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [keptVisible, setKeptVisible] = createSignal(new Set<string>());
  const [filesWide, setFilesWide] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [uploadTarget, setUploadTarget] = createSignal<UploadTarget>({ kind: "directory", path: "" });
  const storedOpenFiles = (): OpenFiles => ({ primary: readSetting(settings.fileScope(), "file"), secondary: readSetting(settings.fileScope(), "file-secondary") });
  const [openPaths, setOpenPaths] = createSignal<OpenFiles>(storedOpenFiles());
  const [focusedSlot, setFocusedSlot] = createSignal<FileSlotId>("primary");
  const slotHandles = new Map<FileSlotId, FileSlotHandle>();
  const [wrapLines, setWrapLines] = createSignal(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "wrap-lines") === "true");
  const [treeWidth, setTreeWidth] = createSignal(Math.max(unitPx(MIN_TREE_UNITS), Math.min(unitPx(MAX_TREE_UNITS), Number(settings.geometry("tree-width")) || unitPx(DEFAULT_TREE_UNITS))));
  const [treeCollapsed, setTreeCollapsed] = createSignal(settings.geometry("tree-collapsed") === "true");
  const [navigatorOpen, setNavigatorOpen] = createSignal(false);
  // The view's elements, for focus and scroll that outlast a single render.
  const elements: { host?: HTMLElement; tree?: HTMLElement; filter?: HTMLInputElement; upload?: HTMLInputElement } = {};
  let treeScrollRaf = 0;
  onCleanup(() => { if (treeScrollRaf) cancelAnimationFrame(treeScrollRaf); });
  const filesLoading = () => requests.hasPendingPrefix("directory:");

  const loadDirectory = async (directory = "", background = false, more = false) => {
    if (background && requests.isRunning(`directory:${directory}`)) return false;
    const previous = directories()[directory];
    if (more && !previous?.cursor) return false;
    const { request, controller } = requests.start(`directory:${directory}`, !background);
    try {
      let cursor = more ? previous?.cursor : null;
      let entries = more ? [...(previous?.entries || [])] : [];
      let listing: DirectoryListing;
      do {
        const payload = await api<DirectoryListing>(`/v0/projects/${encodeURIComponent(request.projectId)}/tree?path=${encodeURIComponent(directory)}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`, { signal: controller.signal });
        if (!requests.owns(request)) return false;
        entries = [...entries, ...asList<TreeEntry>(payload.entries)];
        listing = { ...payload, entries, truncated: payload.truncated === true };
        const nextCursor = payload.cursor;
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      } while (!more && entries.length < (previous?.entries.length || 0));
      if (!requests.owns(request)) return false;
      let changed = false;
      setDirectories((current) => {
        if (directoryListingsEqual(current[directory], listing)) return current;
        changed = Boolean(current[directory]);
        const next = { ...current, [directory]: listing };
        cacheWorkspace(request.projectId, { directories: next });
        return next;
      });
      return changed;
    } catch (cause) {
      if (requests.owns(request) && !background && !wasAborted(cause)) reportError((cause as Error).message);
    } finally {
      requests.finish(request);
    }
    return false;
  };
  const toggleDirectory = async (directory: string) => {
    const next = new Set(expanded());
    if (next.has(directory)) next.delete(directory);
    else { next.add(directory); if (!directories()[directory]) await loadDirectory(directory); }
    setExpanded(next);
    cacheWorkspace(options.projectId(), { expanded: next });
  };
  const isFileOpen = (path: string) => openPaths().primary === path || openPaths().secondary === path;
  const slotForPath = (path: string): FileSlotId | null =>
    openPaths().primary === path ? "primary" : openPaths().secondary === path ? "secondary" : null;
  const setSlotPath = (slot: FileSlotId, path: string | null) => {
    setOpenPaths((current) => ({ ...current, [slot]: path }));
    writeSetting(settings.fileScope(), slot === "primary" ? "file" : "file-secondary", path);
  };
  // Only the slot being retargeted can lose a draft, so editing on one side is
  // never discarded by opening a file on the other.
  const openInSlot = async (slot: FileSlotId, path: string) => {
    const handle = slotHandles.get(slot);
    if (openPaths()[slot] === path) {
      setFocusedSlot(slot);
      return true;
    }
    if (handle?.hasUnsavedChanges()) {
      if (!(await confirmDialog("Discard unsaved changes and open another file?", { destructive: true, confirmLabel: "Discard", valid: () => slotHandles.get(slot) === handle }))) return false;
      handle.discardChanges();
    }
    setSlotPath(slot, path);
    setFocusedSlot(slot);
    return true;
  };
  const toggleTreeCollapsed = () => {
    const next = !treeCollapsed();
    setTreeCollapsed(next);
    writeSetting(options.settingsScope, "tree-collapsed", String(next));
  };
  const hideFileNavigator = () => filesWide() ? toggleTreeCollapsed() : setNavigatorOpen(false);
  const showFileNavigator = () => filesWide() ? toggleTreeCollapsed() : setNavigatorOpen(true);
  // The tree opens into the view's own slot; the file beside is opened only
  // by asking for it.
  const openFile = async (path: string) => {
    if (options.openElsewhere?.(path, false, false)) return;
    if ((await openInSlot("primary", path))) setNavigatorOpen(false);
  };
  let pendingEdit: string | null = null;
  const editFile = async (path: string) => {
    if (options.openElsewhere?.(path, false, true)) return;
    const slot = slotForPath(path);
    if (slot) {
      setFocusedSlot(slot);
      slotHandles.get(slot)?.edit();
      return;
    }
    pendingEdit = path;
    await openFile(path);
  };
  const noteSlotLoaded = (slot: FileSlotId, file: FileSummary | null) => {
    if (file && pendingEdit === file.path) {
      pendingEdit = null;
      slotHandles.get(slot)?.edit();
    }
  };
  // The slots sit in different panes, so closing one leaves the other where it is.
  const closeSlot = async (slot: FileSlotId) => {
    const handle = slotHandles.get(slot);
    if (handle?.hasUnsavedChanges() && !(await confirmDialog("Discard unsaved changes and close this file?", { destructive: true, confirmLabel: "Discard", valid: () => slotHandles.get(slot) === handle }))) return;
    setSlotPath(slot, null);
    setFocusedSlot("primary");
  };
  const dropOpenPath = (path: string) => {
    if (openPaths().secondary === path) setSlotPath("secondary", null);
    if (openPaths().primary === path) setSlotPath("primary", null);
    setFocusedSlot("primary");
  };
  const pathIsWithin = (candidate: string | null, parent: string) =>
    Boolean(candidate && (candidate === parent || candidate.startsWith(`${parent}/`)));
  const hasUnsavedPath = (path: string) => [...slotHandles.entries()]
    .some(([slot, handle]) => pathIsWithin(openPaths()[slot], path) && handle.hasUnsavedChanges());
  const remapWorkspacePath = (candidate: string | null, source: string, destination: string) =>
    pathIsWithin(candidate, source) ? `${destination}${candidate!.slice(source.length)}` : candidate;
  const resetFileTree = async () => {
    const nextExpanded = new Set<string>();
    setDirectories({});
    setExpanded(nextExpanded);
    cacheWorkspace(options.projectId(), { directories: {}, expanded: nextExpanded });
    await loadDirectory("", true);
  };
  const remapOpenPaths = (source: string, destination: string) => {
    const current = openPaths();
    setSlotPath("primary", remapWorkspacePath(current.primary, source, destination));
    setSlotPath("secondary", remapWorkspacePath(current.secondary, source, destination));
    const nextKept = new Set([...keptVisible()].map((path) => remapWorkspacePath(path, source, destination) || path));
    setKeptVisible(nextKept);
    writeSetting(options.projectId(), "kept-visible", JSON.stringify([...nextKept]));
  };
  const openSlotHandles = () => [...slotHandles.entries()]
    .filter(([slot]) => Boolean(openPaths()[slot]))
    .map(([, handle]) => handle);
  // Downloading works on any tree entry, open or not, so it stays with the tree.
  const downloadPath = async (path: string) => {
    try {
      const response = await authorizedFetch(httpUrl(`/v0/projects/${encodeURIComponent(options.projectId())}/file?path=${encodeURIComponent(path)}&download=1`));
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message = body && typeof body === "object" && "message" in body ? String(body.message) : "Download failed";
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = path.split("/").at(-1) || "download";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      reportError((cause as Error).message);
    }
  };
  const chooseUpload = (target: UploadTarget = { kind: "directory", path: "" }) => {
    setUploadTarget(target);
    if (elements.upload) {
      elements.upload.value = "";
      elements.upload.click();
    }
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const target = uploadTarget();
    const replacement = files.item(0);
    if (!replacement) return;
    if (target.kind === "replacement" && !(await confirmDialog(`Replace "${target.path}" with "${replacement.name}"?`))) return;
    setUploading(true);
    try {
      if (target.kind === "replacement") {
        await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(options.projectId())}/file?path=${encodeURIComponent(target.path)}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "if-match": "*" },
          body: replacement,
        });
        await loadDirectory(target.path.split("/").slice(0, -1).join("/"), true);
        const reloading = slotForPath(target.path);
        if (reloading) await slotHandles.get(reloading)?.reload();
        toast.success(`Replaced ${target.path}`);
        return;
      }
      for (const file of files) {
        const path = target.path ? `${target.path}/${file.name}` : file.name;
        await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(options.projectId())}/file?path=${encodeURIComponent(path)}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        });
      }
      await loadDirectory(target.path, true);
    } catch (cause) {
      reportError((cause as Error).message);
      await loadDirectory(target.kind === "directory" ? target.path : target.path.split("/").slice(0, -1).join("/"), true);
    } finally {
      setUploading(false);
    }
  };
  const deleteFile = async (path: string) => {
    if (!(await confirmDialog(`Delete "${path}"? This action cannot be undone.`, { destructive: true, confirmLabel: "Delete" }))) return;
    setUploading(true);
    try {
      await api<void>(`/v0/projects/${encodeURIComponent(options.projectId())}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      await loadDirectory(path.split("/").slice(0, -1).join("/"), true);
      dropOpenPath(path);
      toast.success(`Deleted ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const requestedName = async (label: string, initial = "") => {
    const value = (await promptDialog(label, initial));
    if (value == null) return null;
    const name = value.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      reportError("Enter one file or folder name without slashes");
      return null;
    }
    return name;
  };
  const joinPath = (parent: string, name: string) => parent ? `${parent}/${name}` : name;
  const createFile = async (parent = "") => {
    const name = (await requestedName("New file name:"));
    if (!name) return;
    const path = joinPath(parent, name);
    setUploading(true);
    try {
      await api<FileWriteResult>(`/v0/projects/${encodeURIComponent(options.projectId())}/file?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: new Blob([]),
      });
      await loadDirectory(parent, true);
      await openFile(path);
      toast.success(`Created ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await loadDirectory(parent, true);
    } finally {
      setUploading(false);
    }
  };
  const createDirectory = async (parent = "") => {
    const name = (await requestedName("New folder name:"));
    if (!name) return;
    const path = joinPath(parent, name);
    setUploading(true);
    try {
      await api<{ path: string }>(`/v0/projects/${encodeURIComponent(options.projectId())}/directory`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      await loadDirectory(parent, true);
      toast.success(`Created ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await loadDirectory(parent, true);
    } finally {
      setUploading(false);
    }
  };
  const moveEntry = async (entry: TreeEntry, destination: string) => {
    if (destination === entry.path) return;
    if (hasUnsavedPath(entry.path)) {
      reportError("Save or discard changes in this item before moving it");
      return;
    }
    setUploading(true);
    try {
      const moved = await api<MovedEntry>(`/v0/projects/${encodeURIComponent(options.projectId())}/entry`, {
        method: "PATCH",
        body: JSON.stringify({ path: entry.path, destination }),
      });
      remapOpenPaths(moved.path, moved.destination);
      await resetFileTree();
      toast.success(`Moved ${moved.path} to ${moved.destination}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await resetFileTree();
    } finally {
      setUploading(false);
    }
  };
  const renameEntry = async (entry: TreeEntry) => {
    const name = (await requestedName(`Rename "${entry.name}" to:`, entry.name));
    if (!name || name === entry.name) return;
    const parent = entry.path.split("/").slice(0, -1).join("/");
    void moveEntry(entry, joinPath(parent, name));
  };
  const moveEntryToFolder = async (entry: TreeEntry) => {
    const currentParent = entry.path.split("/").slice(0, -1).join("/");
    const value = (await promptDialog(`Move "${entry.name}" to folder (relative to workspace root; leave blank for root):`, currentParent));
    if (value == null) return;
    const parent = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    void moveEntry(entry, joinPath(parent, entry.name));
  };
  const deleteDirectory = async (path: string) => {
    if (hasUnsavedPath(path)) {
      reportError("Save or discard changes in this folder before deleting it");
      return;
    }
    if (!(await confirmDialog(`Delete folder "${path}" and all its contents? This action cannot be undone.`, { destructive: true, confirmLabel: "Delete folder" }))) return;
    setUploading(true);
    try {
      await api<void>(`/v0/projects/${encodeURIComponent(options.projectId())}/directory?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (pathIsWithin(openPaths().secondary, path)) setSlotPath("secondary", null);
      if (pathIsWithin(openPaths().primary, path)) dropOpenPath(openPaths().primary!);
      await resetFileTree();
      toast.success(`Deleted ${path}`);
    } catch (cause) {
      reportError((cause as Error).message);
      await resetFileTree();
    } finally {
      setUploading(false);
    }
  };
  const refreshFiles = async () => {
    const loaded = Object.keys(directories());
    for (const directory of loaded.length ? loaded : [""]) await loadDirectory(directory, true);
    await Promise.all(openSlotHandles().map((handle) => handle.reload()));
  };
  const changedDirectory = (directory: string, changedPath: string) => {
    const parent = changedPath.slice(0, Math.max(0, changedPath.lastIndexOf("/")));
    return directory === changedPath || directory === parent;
  };
  const changedFile = (file: string | null, changedPath: string) => Boolean(file
    && (file === changedPath || file.startsWith(`${changedPath}/`)));
  /** Reload the loaded directories and open files a change touched; `null` means anything may have. */
  const refreshChanged = async (changedPaths: string[] | null) => {
    const visibleDirectories = ["", ...expanded()].filter((directory) => directory === "" || Boolean(directories()[directory]));
    const directoriesToRefresh = changedPaths === null
      ? visibleDirectories
      : visibleDirectories.filter((directory) => changedPaths.some((changedPath) => changedDirectory(directory, changedPath)));
    let treeChanged = false;
    for (const directory of directoriesToRefresh) {
      if (await loadDirectory(directory, true)) treeChanged = true;
    }
    const slotsToRefresh = changedPaths === null
      ? openSlotHandles()
      : [...slotHandles.entries()]
        .filter(([slot]) => changedPaths.some((changedPath) => changedFile(openPaths()[slot], changedPath)))
        .map(([, handle]) => handle);
    await Promise.all(slotsToRefresh.map((handle) => handle.reload()));
    return treeChanged;
  };

  function entryMatchesFilter(entry: TreeEntry, query: string): boolean {
    const kept = [...keptVisible()].some((path) => path === entry.path || path.startsWith(`${entry.path}/`));
    if (!showHidden() && entry.name.startsWith(".") && !kept) return false;
    if (!query || entry.name.toLowerCase().includes(query)) return true;
    return entry.type === "directory" && (directories()[entry.path]?.entries || []).some((child) => entryMatchesFilter(child, query));
  }
  const visibleEntries = (directory: string) => {
    const query = fileFilter().trim().toLowerCase();
    return (directories()[directory]?.entries || []).filter((entry) => entryMatchesFilter(entry, query));
  };
  const directoryIsOpen = (path: string) => expanded().has(path) || Boolean(fileFilter().trim() && directories()[path]);
  const visibleTreePaths = createMemo(() => {
    const paths: string[] = [];
    const collect = (directory: string) => {
      for (const entry of visibleEntries(directory)) {
        paths.push(entry.path);
        if (entry.type === "directory" && directoryIsOpen(entry.path)) collect(entry.path);
      }
    };
    collect("");
    return paths;
  });
  const treeTabStop = () => {
    const visible = visibleTreePaths();
    if (visible.includes(treeFocusPath())) return treeFocusPath();
    const selected = openPaths().primary;
    return selected && visible.includes(selected) ? selected : visible[0] || "";
  };
  const focusTreeBoundary = (last: boolean) => {
    const items = [...(elements.tree?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') || [])];
    const item = last ? items.at(-1) : items[0];
    if (!item) return false;
    setTreeFocusPath(item.dataset.path || "");
    item.focus();
    return true;
  };
  const onFileFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (focusTreeBoundary(event.key === "ArrowUp")) event.preventDefault();
      return;
    }
    if (event.key === "Escape" && fileFilter()) {
      event.preventDefault();
      setFileFilter("");
    }
  };
  const saveTreeScroll = (event: Event & { currentTarget: HTMLElement }) => {
    const scrollTop = event.currentTarget.scrollTop;
    const projectId = options.projectId();
    if (treeScrollRaf) cancelAnimationFrame(treeScrollRaf);
    treeScrollRaf = requestAnimationFrame(() => {
      treeScrollRaf = 0;
      cacheWorkspace(projectId, { treeScrollTop: scrollTop });
    });
  };
  const toggleHidden = () => {
    const next = !showHidden();
    setShowHidden(next);
    writeSetting(options.settingsScope, "show-hidden", String(next));
  };
  const toggleWrapLines = () => {
    const next = !wrapLines();
    setWrapLines(next);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "wrap-lines", String(next));
  };
  const clampTreeWidth = (next: number) => Math.max(unitPx(MIN_TREE_UNITS), Math.min(unitPx(MAX_TREE_UNITS), next));
  const saveTreeWidth = (next: number) => {
    const value = clampTreeWidth(next);
    setTreeWidth(value);
    writeSetting(options.settingsScope, "tree-width", String(value));
  };
  const toggleKeptVisible = (path: string) => {
    const next = new Set(keptVisible());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setKeptVisible(next);
    writeSetting(options.projectId(), "kept-visible", JSON.stringify([...next]));
  };
  const collapseTree = () => {
    const next = new Set<string>();
    setExpanded(next);
    cacheWorkspace(options.projectId(), { expanded: next });
  };

  return {
    elements,
    directories,
    setDirectories,
    expanded,
    fileFilter,
    setFileFilter,
    treeFocusPath,
    setTreeFocusPath,
    showHidden,
    keptVisible,
    filesWide,
    setFilesWide,
    uploading,
    uploadTarget,
    openPaths,
    focusedSlot,
    setFocusedSlot,
    slotHandles,
    wrapLines,
    treeWidth,
    setTreeWidth,
    treeCollapsed,
    navigatorOpen,
    filesLoading,
    loadDirectory,
    toggleDirectory,
    isFileOpen,
    slotForPath,
    openInSlot,
    hideFileNavigator,
    showFileNavigator,
    openFile,
    setSlotPath,
    editFile,
    noteSlotLoaded,
    closeSlot,
    dropOpenPath,
    openSlotHandles,
    downloadPath,
    chooseUpload,
    uploadFiles,
    deleteFile,
    createFile,
    createDirectory,
    renameEntry,
    moveEntryToFolder,
    deleteDirectory,
    refreshFiles,
    refreshChanged,
    visibleEntries,
    directoryIsOpen,
    treeTabStop,
    onFileFilterKeyDown,
    saveTreeScroll,
    toggleHidden,
    toggleWrapLines,
    clampTreeWidth,
    saveTreeWidth,
    toggleTreeCollapsed,
    toggleKeptVisible,
    collapseTree,
    /** The paths whose changes the poll asks about: the root, open folders and open files. */
    visiblePaths: () => [...new Set([
      "",
      ...expanded(),
      ...Object.values(openPaths()).filter((path): path is string => Boolean(path)),
    ])],
    /** Anything loaded that a change could make stale. */
    hasContent: () => Boolean(Object.keys(directories()).length || openSlotHandles().length),
    /** Ask before a navigation replaces this file's unsaved edit; false if the reader keeps it. */
    confirmDiscard: async (path: string, message: string) => {
      const slot = slotForPath(path);
      const handle = slot ? slotHandles.get(slot) : undefined;
      if (handle?.hasUnsavedChanges()) {
        if (!(await confirmDialog(message, { destructive: true, confirmLabel: "Discard", valid: () => Boolean(slot && slotHandles.get(slot) === handle) }))) return false;
        handle.discardChanges();
      }
      return true;
    },
    /** The navigator's geometry as stored, for a new project. */
    restoreGeometry: () => {
      setTreeWidth(Math.max(unitPx(MIN_TREE_UNITS), Math.min(unitPx(MAX_TREE_UNITS), Number(settings.geometry("tree-width")) || unitPx(DEFAULT_TREE_UNITS))));
      setTreeCollapsed(settings.geometry("tree-collapsed") === "true");
      setShowHidden(settings.geometry("show-hidden") === "true");
    },
    /** The open files and kept-visible paths as stored, for a new chat or project. */
    restoreOpenFiles: () => {
      setKeptVisible(storedPaths(options.projectId(), "kept-visible"));
      setOpenPaths(storedOpenFiles());
      setFocusedSlot("primary");
    },
    /** The tree as it was last seen in this project, while it reloads. */
    restoreFromCache: (cached: WorkspaceCacheEntry | null, initialDirectory?: DirectoryListing) => {
      batch(() => {
        setDirectories(initialDirectory ? { ...cached?.directories, "": initialDirectory } : cached?.directories || {});
        setExpanded(cached?.expanded || new Set<string>());
        setFileFilter("");
        setTreeFocusPath(openPaths().primary || "");
      });
      queueMicrotask(() => {
        if (elements.tree) elements.tree.scrollTop = cached?.treeScrollTop || 0;
      });
    },
    /**
     * Focus where Files starts: the filter, else the open file when a narrow
     * view has folded the navigator away. False when neither is showing.
     */
    focusDefault: () => {
      const shown = (element: Element | null | undefined): element is HTMLElement => element instanceof HTMLElement && element.checkVisibility({ visibilityProperty: true });
      const file = [...(elements.host?.querySelectorAll(".cm-content") ?? [])].find(shown);
      if (shown(elements.filter)) elements.filter.focus({ preventScroll: true });
      else if (file) file.focus({ preventScroll: true });
      else return false;
      return true;
    },
  };
}
export type Files = ReturnType<typeof createFiles>;

export function FilesView(props: {
  control: Files;
  /** The panel is expanded, which lowers the width at which the tree sits beside the file. */
  expanded: boolean;
  projectId: string;
  workingRoot: string;
  sourceControlEnabled: boolean;
  gitFiles: GitChangedFile[];
  commentChatId: string | null;
  reveal: ReviewNavigationRequest | null;
  stale: boolean;
  onRetryPoll: () => void;
  onSaved: () => void;
  onShowDiff: (slot: FileSlotId, staged: boolean, beside?: boolean) => void;
  /** Open a file in the other side of the main pane; absent where there is none. */
  onOpenBeside?: (path: string) => void;
  onBrowseDirectory?: (path: string) => void;
  onBrowseParent?: () => void;
  /** Files opens in panes' file viewers: the view is the navigator alone -- the tree and its search. */
  navigatorOnly?: boolean;
  /** A file a pane's viewer shows: its row is bold, heavier in the viewer with the keyboard. */
  openInPane?: (path: string) => "focused" | "shown" | undefined;
}) {
  const c = props.control;
  let treeResizeHandle: HTMLDivElement | undefined;
  let filesResizeObserver: ResizeObserver | undefined;
  let treeTypeaheadTimer = 0;
  let treeTypeahead = "";
  onCleanup(() => {
    filesResizeObserver?.disconnect();
    if (treeTypeaheadTimer) window.clearTimeout(treeTypeaheadTimer);
  });

  const onTreeKeyDown = (event: KeyboardEvent & { currentTarget: HTMLButtonElement }) => {
    const items = [...(c.elements.tree?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') || [])];
    const index = items.indexOf(event.currentTarget);
    if (index < 0) return;
    const focus = (next: number) => {
      const item = items[next];
      if (item) {
        c.setTreeFocusPath(item.dataset.path || "");
        item.focus();
      }
    };
    if (event.key === "Enter" && event.altKey && props.onOpenBeside && event.currentTarget.getAttribute("aria-expanded") === null) props.onOpenBeside(event.currentTarget.dataset.path || "");
    else if (event.key === "ArrowDown") focus(Math.min(items.length - 1, index + 1));
    else if (event.key === "ArrowUp") focus(Math.max(0, index - 1));
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(items.length - 1);
    else if (event.key === "ArrowRight") {
      const level = Number(event.currentTarget.getAttribute("aria-level"));
      if (event.currentTarget.getAttribute("aria-expanded") === "false") event.currentTarget.click();
      else if (Number(items[index + 1]?.getAttribute("aria-level")) > level) focus(index + 1);
    } else if (event.key === "ArrowLeft") {
      if (event.currentTarget.getAttribute("aria-expanded") === "true" && c.expanded().has(event.currentTarget.dataset.path || "")) {
        event.currentTarget.click();
      } else {
        const level = Number(event.currentTarget.getAttribute("aria-level"));
        for (let parent = index - 1; parent >= 0; parent -= 1) {
          const item = items[parent];
          if (item && Number(item.getAttribute("aria-level")) < level) {
            focus(parent);
            break;
          }
        }
      }
    } else if (event.key.length === 1 && event.key !== " " && !event.altKey && !event.ctrlKey && !event.metaKey) {
      treeTypeahead += event.key.toLowerCase();
      window.clearTimeout(treeTypeaheadTimer);
      treeTypeaheadTimer = window.setTimeout(() => { treeTypeahead = ""; }, 500);
      const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      const match = ordered.find((item) => item.dataset.name?.startsWith(treeTypeahead));
      if (match) focus(items.indexOf(match));
      return;
    } else return;
    event.preventDefault();
  };
  const [treeResizing, setTreeResizing] = createSignal(false);
  const startTreeResize = (event: PointerEvent) => {
    event.preventDefault();
    treeResizeHandle?.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = c.treeWidth();
    let pending = startWidth;
    let frame = 0;
    let stopped = false;
    const apply = () => {
      frame = 0;
      c.setTreeWidth(c.clampTreeWidth(pending));
    };
    const move = (moveEvent: PointerEvent) => {
      pending = startWidth + moveEvent.clientX - startX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      c.saveTreeWidth(pending);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      setTreeResizing(false);
    };
    setTreeResizing(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
  };

  // One definition per quick action, rendered three ways: the horizontal
  // toolbar under the tree, the overflow menu it spills into, and the vertical
  // rail shown while the navigator is collapsed.
  interface TreeAction { id: string; label: () => string; title: () => string; icon: () => JSX.Element; disabled?: () => boolean; pressed?: () => boolean; run: () => void }
  const treeActions: TreeAction[] = [
    { id: "new-file", label: () => "New file", title: () => "Create a file in the workspace root", icon: () => <FilePlusIcon />, disabled: c.uploading, run: () => void c.createFile() },
    { id: "new-folder", label: () => "New folder", title: () => "Create a folder in the workspace root", icon: () => <Icons.NewFolder />, disabled: c.uploading, run: () => void c.createDirectory() },
    { id: "collapse", label: () => "Collapse all folders", title: () => "Collapse all folders", icon: () => <ChevronsUpIcon />, run: c.collapseTree },
    { id: "hidden", label: () => c.showHidden() ? "Hide hidden files" : "Show hidden files", title: () => c.showHidden() ? "Hide hidden files" : "Show hidden files", icon: () => <Show when={c.showHidden()} fallback={<Icons.Hide />}><Icons.Preview /></Show>, pressed: c.showHidden, run: c.toggleHidden },
    { id: "upload", label: () => "Upload files", title: () => "Upload files to workspace root", icon: () => <Show when={c.uploading()} fallback={<Icons.Upload />}><Spinner /></Show>, disabled: c.uploading, run: () => c.chooseUpload() },
    { id: "refresh", label: () => "Refresh files", title: () => "Refresh files", icon: () => <Icons.Refresh />, disabled: c.filesLoading, run: () => void c.refreshFiles() },
  ];
  const treeActionButton = (action: TreeAction) =>
    <ToolButton data-tree-action={action.id} aria-label={action.label()} title={action.title()} aria-pressed={action.pressed?.()} disabled={action.disabled?.()} onClick={action.run}>{action.icon()}</ToolButton>;
  const [visibleTreeActions, setVisibleTreeActions] = createSignal(treeActions.length);
  // Buttons are uniform, so one measured button plus the row gap is enough to
  // work out how many fit; the cache is invalidated on a height change, which
  // is what the layout breakpoints move.
  let treeActionsRow: HTMLDivElement | undefined;
  let treeActionMetrics: { unit: number; gap: number; height: number } | null = null;
  const measureTreeActions = (width: number, height: number) => {
    const row = treeActionsRow;
    const first = row?.querySelector("button");
    if (!row || !first) return;
    if (!treeActionMetrics || treeActionMetrics.height !== height) {
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap) || 0;
      treeActionMetrics = { unit: first.offsetWidth + gap, gap, height };
    }
    const { unit, gap } = treeActionMetrics;
    if (unit <= 0) return;
    const fits = Math.floor((width + gap) / unit);
    setVisibleTreeActions(fits >= treeActions.length ? treeActions.length : Math.max(1, fits - 1));
  };

  const Tree = (treeProps: { directory: string; depth?: number }) => {
    const depth = () => treeProps.depth || 0;
    return <>
      <For each={c.visibleEntries(treeProps.directory)}>{(entry, index) => <div>
        <ContextMenu>
          <ContextMenuTrigger
            as={TreeRow}
            role="treeitem"
            aria-expanded={entry.type === "directory" ? c.directoryIsOpen(entry.path) : undefined}
            aria-level={depth() + 1}
            aria-posinset={index() + 1}
            aria-setsize={c.visibleEntries(treeProps.directory).length}
            aria-selected={c.isFileOpen(entry.path)}
            depth={depth()}
            folder={entry.type === "directory"}
            open={c.directoryIsOpen(entry.path)}
            icon={entry.type === "directory" ? <FolderTypeIcon name={entry.name} expanded={c.directoryIsOpen(entry.path)} /> : <FileTypeIcon name={entry.name} />}
            name={entry.name}
            end={c.keptVisible().has(entry.path) ? <Icons.Pin aria-label="Always visible" /> : undefined}
            selected={c.isFileOpen(entry.path)}
            data-name={entry.name.toLowerCase()}
            data-path={entry.path}
            draggable={entry.type !== "directory"}
            data-focused-file={c.openPaths().primary === entry.path}
            data-open-file={entry.type !== "directory" ? props.openInPane?.(entry.path) : undefined}
            tabIndex={c.treeTabStop() === entry.path ? 0 : -1}
            onFocus={() => {
              c.setTreeFocusPath(entry.path);
              if (entry.type === "file") void preloadWorkspaceEditor().catch(() => undefined);
            }}
            onPointerEnter={() => {
              if (entry.type === "file") void preloadWorkspaceEditor().catch(() => undefined);
            }}
            onKeyDown={onTreeKeyDown}
            onDblClick={() => { if (entry.type === "directory") props.onBrowseDirectory?.(entry.path); }}
            onClick={(event) => entry.type === "directory" ? void c.toggleDirectory(entry.path) : entry.type === "file" ? (event.altKey && props.onOpenBeside ? props.onOpenBeside(entry.path) : c.openFile(entry.path)) : undefined}
          />
          <ContextMenuContent>
            <MenuSection>
              <Show when={entry.type === "file"}>
                <MenuRow onSelect={() => c.openFile(entry.path)} icon={<FileTypeIcon name={entry.name} />}>Open preview</MenuRow>
                <Show when={props.onOpenBeside}><MenuRow onSelect={() => props.onOpenBeside?.(entry.path)} icon={<Icons.Split />}>Open beside</MenuRow></Show>
                <MenuRow onSelect={() => c.editFile(entry.path)} icon={<Icons.Edit />}>Edit</MenuRow>
                <MenuRow onSelect={() => void c.downloadPath(entry.path)} icon={<Icons.Download />}>Download</MenuRow>

                <MenuRow disabled={c.uploading()} onSelect={() => c.chooseUpload({ kind: "replacement", path: entry.path })} icon={<Icons.Upload />}>Replace with upload…</MenuRow>
              </Show>
              <Show when={entry.type === "directory"}>
                <Show when={props.onBrowseDirectory}><MenuRow onSelect={() => props.onBrowseDirectory?.(entry.path)} icon={<Icons.Folder />}>Open folder</MenuRow></Show>
                <MenuRow disabled={c.uploading()} onSelect={() => void c.createFile(entry.path)} icon={<FilePlusIcon />}>New file…</MenuRow>
                <MenuRow disabled={c.uploading()} onSelect={() => void c.createDirectory(entry.path)} icon={<Icons.NewFolder />}>New folder…</MenuRow>
                <MenuRow onSelect={() => c.chooseUpload({ kind: "directory", path: entry.path })} icon={<Icons.Upload />}>Upload files here</MenuRow>
              </Show>
              <Show when={entry.type === "file" || entry.type === "directory"}>
                <MenuRow disabled={c.uploading()} onSelect={() => c.renameEntry(entry)} icon={<Icons.Edit />}>Rename…</MenuRow>
                <MenuRow disabled={c.uploading()} onSelect={() => c.moveEntryToFolder(entry)} icon={<MoveIcon />}>Move…</MenuRow>
              </Show>
              <MenuRow onSelect={() => copyText(entry.path)} icon={<Icons.Copy />}>Copy path</MenuRow>
            </MenuSection>
            <Show when={entry.name.startsWith(".") || c.keptVisible().has(entry.path)}>
              <Rule />
              <MenuRow onSelect={() => c.toggleKeptVisible(entry.path)} icon={<Show when={c.keptVisible().has(entry.path)} fallback={<Icons.Pin />}><Icons.PinOff /></Show>}>
                {c.keptVisible().has(entry.path) ? "Stop keeping visible" : "Keep visible"}
              </MenuRow>
            </Show>
            <Show when={entry.type === "file"}>
              <Rule />
              <MenuRow destructive disabled={c.uploading()} onSelect={() => void c.deleteFile(entry.path)} icon={<Icons.Delete />}>Delete file</MenuRow>
            </Show>
            <Show when={entry.type === "directory"}>
              <Rule />
              <MenuRow destructive disabled={c.uploading()} onSelect={() => void c.deleteDirectory(entry.path)} icon={<Icons.Delete />}>Delete folder</MenuRow>
            </Show>
          </ContextMenuContent>
        </ContextMenu>
        <Show when={entry.type === "directory" && c.directoryIsOpen(entry.path)}>
          <div role="group"><Tree directory={entry.path} depth={depth() + 1} /></div>
        </Show>
      </div>}</For>
      <Show when={c.directories()[treeProps.directory]?.oversize}><ToolNotice>Directory exceeds the 50,000-entry limit. Open a smaller directory.</ToolNotice></Show>
      <Show when={c.directories()[treeProps.directory]?.truncated}><ToolNotice action={{ label: "Show more", disabled: c.filesLoading(), onClick: () => void c.loadDirectory(treeProps.directory, false, true) }}>
        <Show when={c.fileFilter().trim()}>Filter covers loaded entries only. </Show>
        <span>{c.directories()[treeProps.directory]?.entries.length} of {c.directories()[treeProps.directory]?.total ?? "more"} entries loaded.</span>
      </ToolNotice></Show>
    </>;
  };

  const gitFile = (path: string | null) => props.sourceControlEnabled ? props.gitFiles.find((file) => file.path === path) : undefined;

  return <div
        ref={(element) => {
          filesResizeObserver?.disconnect();
          const updateWideState = (width: number) =>
            c.setFilesWide(!isMobileLayout() && width >= unitPx(props.expanded ? WIDE_FILES_EXPANDED_UNITS : WIDE_FILES_MIN_UNITS));
          updateWideState(element.clientWidth);
          // The entry already carries the new size. Reading clientWidth back
          // inside the callback instead forces a synchronous layout, and a
          // panel drag resizes this element every frame: traced at one forced
          // layout per frame for the whole drag, 1.9ms of a 6.94ms budget.
          // .workspace-files has no border or padding, so the content box is
          // the same number clientWidth was reporting.
          filesResizeObserver = new ResizeObserver((entries) => {
            const box = entries[entries.length - 1]?.contentBoxSize?.[0];
            updateWideState(box ? box.inlineSize : element.clientWidth);
          });
          filesResizeObserver.observe(element);
          c.elements.host = element;
        }}
        class="workspace-files"
        data-wide={props.navigatorOnly ? "navigator" : c.filesWide()}
        data-doc-project={props.navigatorOnly ? props.projectId : undefined}
        data-tree-collapsed={c.treeCollapsed()}
        data-navigator-open={c.navigatorOpen()}
        style={{
          "--workspace-tree-width": `${c.treeWidth()}px`,
        }}
      >
        <div class="workspace-tree-pane">
          <ToolBar>
            <Show when={!props.navigatorOnly}><ToolButton label="Hide file navigator" onClick={c.hideFileNavigator}><Icons.CollapseFiles /></ToolButton></Show>
            <ToolFilter
                ref={(element) => { c.elements.filter = element; }}
                aria-label="Filter loaded files"
                placeholder="Filter loaded files"
                title="Filter loaded files and folders"
                value={c.fileFilter()}
                onInput={(event) => c.setFileFilter(event.currentTarget.value)}
                onKeyDown={c.onFileFilterKeyDown}
              />
          </ToolBar>
          <Show when={props.stale}><ToolNotice tone="warn" live action={{ label: "Retry", onClick: () => props.onRetryPoll?.() }}><span>Not updating</span><span aria-hidden="true">·</span></ToolNotice></Show>
          <TreeList ref={(element) => {
            c.elements.tree = element;
            queueMicrotask(() => { element.scrollTop = peekCachedWorkspace(props.projectId)?.treeScrollTop || 0; });
          }} aria-label="Project files" aria-busy={c.filesLoading()} onScroll={c.saveTreeScroll}>
            <Show when={props.onBrowseParent}><TreeRow onClick={props.onBrowseParent} title={`Open parent of ${props.workingRoot}`} icon={<FolderUpIcon />} name=".." /></Show>
            <Tree directory="" />
            <Show when={c.directories()[""] && !c.directories()[""]?.oversize && c.visibleEntries("").length === 0}><PaneEmpty>{c.fileFilter() ? "No loaded files match this filter." : "No files to show."}</PaneEmpty></Show>
          </TreeList>
          <ToolBar edge="top" role="toolbar" aria-label="File tree actions" ref={(element) => {
            treeActionsRow = element;
            const observer = new ResizeObserver((entries) => {
              const box = entries[entries.length - 1]?.contentBoxSize?.[0];
              measureTreeActions(box ? box.inlineSize : element.clientWidth, box ? box.blockSize : element.clientHeight);
            });
            observer.observe(element);
            onCleanup(() => { observer.disconnect(); if (treeActionsRow === element) treeActionsRow = undefined; });
          }}>
            <For each={treeActions}>{(action, index) => <Show when={index() < visibleTreeActions()}>{treeActionButton(action)}</Show>}</For>
            <Show when={visibleTreeActions() < treeActions.length}>
              <Menu>
                <MenuControl as={ToolButton} label="More file actions"><Icons.More /></MenuControl>
                <MenuContent>
                  <For each={treeActions.slice(visibleTreeActions())}>{(action) =>
                    <MenuRow icon={action.icon()} disabled={action.disabled?.()} onSelect={action.run}>{action.label()}</MenuRow>
                  }</For>
                </MenuContent>
              </Menu>
            </Show>
            <input ref={(element) => { c.elements.upload = element; }} hidden type="file" multiple={c.uploadTarget().kind === "directory"} onChange={(event) => void c.uploadFiles(event.currentTarget.files)} />
          </ToolBar>
        </div>
        <Show when={!props.navigatorOnly && (c.filesWide() ? c.treeCollapsed() : !c.navigatorOpen())}>
          <ToolBar vertical data-tree-rail="">
            <ToolButton label="Show file navigator" onClick={c.showFileNavigator}><Icons.ExpandFiles /></ToolButton>
            <div role="toolbar" aria-label="File tree actions">
              <For each={treeActions}>{(action) => treeActionButton(action)}</For>
            </div>
          </ToolBar>
        </Show>
        <Show when={!props.navigatorOnly && c.filesWide()}>
          <SplitEdge
            ref={treeResizeHandle}
            resizing={treeResizing()}
            aria-label="Resize file tree"
            aria-valuemin={unitPx(MIN_TREE_UNITS)}
            aria-valuemax={unitPx(MAX_TREE_UNITS)}
            aria-valuenow={c.treeWidth()}
            tabIndex={0}
            onPointerDown={startTreeResize}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") c.saveTreeWidth(c.treeWidth() - 8);
              if (event.key === "ArrowRight") c.saveTreeWidth(c.treeWidth() + 8);
            }}
          />
        </Show>
          <Show when={!props.navigatorOnly}><WorkspaceFileSlot
            projectId={props.projectId}
            path={c.openPaths().primary}
            slot="primary"
            focused={false}
            closable={Boolean(c.openPaths().primary)}
            busy={c.uploading()}
            wrap={c.wrapLines()}
            onToggleWrap={c.toggleWrapLines}
            annotationChatId={props.commentChatId}
            reveal={props.reveal}
            onFocus={() => c.setFocusedSlot("primary")}
            onClose={() => c.closeSlot("primary")}
            onError={reportError}
            onRemoved={(path, announce) => { c.dropOpenPath(path); if (announce) toast.info(`${path} was removed`); }}
            onReplace={(path) => c.chooseUpload({ kind: "replacement", path })}
            onDelete={(path) => void c.deleteFile(path)}
            onLoaded={(file) => c.noteSlotLoaded("primary", file)}
            gitFile={gitFile(c.openPaths().primary)}
            onShowDiff={(staged, beside) => props.onShowDiff("primary", staged, beside)}
            onSaved={() => { if (props.sourceControlEnabled) props.onSaved(); }}
            ref={(handle) => c.slotHandles.set("primary", handle)}
            onDispose={() => c.slotHandles.delete("primary")}
          /></Show>
      </div>;
}

/**
 * The file opened beside: Files' second slot, drawn in the main pane's split
 * rather than beside the first inside the view (docs/design/panes-and-rail.md).
 */
export function FileBesideView(props: {
  control: Files;
  projectId: string;
  sourceControlEnabled: boolean;
  gitFiles: GitChangedFile[];
  commentChatId: string | null;
  reveal: ReviewNavigationRequest | null;
  onSaved: () => void;
  onShowDiff: (slot: FileSlotId, staged: boolean, beside?: boolean) => void;
}) {
  const c = props.control;
  const gitFile = () => props.sourceControlEnabled ? props.gitFiles.find((file) => file.path === c.openPaths().secondary) : undefined;
  return <div class="workspace-files workspace-file-beside">
    <WorkspaceFileSlot
      projectId={props.projectId}
      path={c.openPaths().secondary}
      slot="secondary"
      focused={false}
      closable={false}
      busy={c.uploading()}
      wrap={c.wrapLines()}
      onToggleWrap={c.toggleWrapLines}
      annotationChatId={props.commentChatId}
      reveal={props.reveal}
      onFocus={() => c.setFocusedSlot("secondary")}
      onClose={() => c.closeSlot("secondary")}
      onError={reportError}
      onRemoved={(path, announce) => { c.dropOpenPath(path); if (announce) toast.info(`${path} was removed`); }}
      onReplace={(path) => c.chooseUpload({ kind: "replacement", path })}
      onDelete={(path) => void c.deleteFile(path)}
      onLoaded={(file) => c.noteSlotLoaded("secondary", file)}
      gitFile={gitFile()}
      onShowDiff={(staged, beside) => props.onShowDiff("secondary", staged, beside)}
      onSaved={() => { if (props.sourceControlEnabled) props.onSaved(); }}
      ref={(handle) => c.slotHandles.set("secondary", handle)}
      onDispose={() => c.slotHandles.delete("secondary")}
    />
  </div>;
}
