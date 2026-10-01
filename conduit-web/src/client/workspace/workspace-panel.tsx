import { batch, createEffect, createSignal, For, on, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import { MIN_MAIN_PANE_WIDTH, MIN_SPLIT_PANE_WIDTH } from "../layout-geometry";
import { Columns2Icon, FolderIcon, GitCompareArrowsIcon, Maximize2Icon, MessageSquareIcon, Minimize2Icon, PanelRightIcon, TerminalIcon, XIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import { COMMAND_IDS } from "../commands/command-registry";
import { focusFirst, isMobileLayout, restoreFocus } from "../navigation/mobile-layout";
import type { Connectivity } from "../state/runtime";
import { dispatchPanelGeometryMotion } from "../panel-motion";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE, writeSetting } from "./workspace-panel-storage";
import "./workspace.css";
import type { DiffScope } from "./workspace-review-source";
import { REVIEW_NAVIGATION_EVENT, type ReviewNavigationRequest } from "../chat/review-navigation";
import { TURN_ARTIFACT_NAVIGATION_EVENT, type TurnArtifactNavigationRequest } from "../chat/turn-artifact-navigation";
import { cachedWorkspace, cacheWorkspace, createRequestScope, reportError } from "./workspace-shared";
import { createFiles, FileBesideView, FilesView } from "./workspace-files";
import { createSourceControl, SourceControlModes, SourceControlView } from "./workspace-source-control";
import { ChatModes, ChatView, createChatReview } from "./workspace-chat-view";
import { TerminalView } from "./workspace-terminal-view";
import { createWorkspacePoll } from "./workspace-poll";
import type { DirectoryListing, FileSlotId, PanelTab, SplitView, WorkspaceSettings } from "./workspace-types";
import { readToolDrag, TOOL_DRAG_TYPE, WORKSPACE_TOOL_LABELS } from "./workspace-rail";
import type { FileEntry } from "./file-documents";

/*
 * The workspace panel, the dock: the chrome around the four workspace views
 * (Files, Source Control, Chat review, Terminal), one at a time -- its header,
 * its width, opening and closing, phone focus and shortcuts -- and the
 * navigation between the views. On a desktop the rail beside it chooses the
 * view, and a view moved into the main pane is drawn in its split (through a
 * portal, so its state stays here), as is a file or a terminal opened beside;
 * a phone keeps the tabs in its header. Each view and its state live in
 * their own files, so a view can be shown outside the dock
 * (docs/design/panes-and-rail.md).
 */

const PANEL_TABS = ["files", "chat", "terminal", "diff"] satisfies PanelTab[];

function panelTab(value: string): PanelTab | null {
  if (value === "artifacts") return "chat";
  return value === "files" || value === "diff" || value === "chat" || value === "terminal" ? value : null;
}

const MIN_WORKSPACE_PANE_WIDTH = 240;

export default function WorkspacePanel(props: { connectivity?: () => Connectivity; projectId: Accessor<string>; projectName: Accessor<string>; sourceControlEnabled: Accessor<boolean>; workingRoot: Accessor<string>; chatId: Accessor<string>; artifactChatId?: Accessor<string | null>; commentChatId?: Accessor<string | null>; historyAvailable?: Accessor<boolean>; open: Accessor<boolean>; expanded: Accessor<boolean>; focusRequest: Accessor<number>; onFocusRequestComplete?: () => void; requestedTab?: Accessor<{ tab: PanelTab; terminalId?: string; nonce: number } | null>; onRequestOpen?: () => void; onToggleExpanded: () => void; onClose: () => void; onTabChange?: (tab: PanelTab) => void; splitView?: Accessor<SplitView | null>; splitHost?: Accessor<HTMLElement | undefined>; onOpenBeside?: (view: SplitView) => void; onMoveToDock?: (view: SplitView) => void; onCloseSplit?: (focus?: boolean) => void; bindSplit?: (release: (toDock: boolean) => boolean) => () => void; shortcuts: ShortcutManager; onBrowseDirectory?: (path: string) => void; onBrowseParent?: () => void; requestedFile?: Accessor<{ path: string } | null>; settingsScope?: Accessor<string>; initialDirectory?: Accessor<DirectoryListing>; onOpenFile?: (entry: FileEntry, options: { beside: boolean; edit: boolean; reveal?: ReviewNavigationRequest }) => void; openFiles?: Accessor<Map<string, "focused" | "shown">>; documentShown?: Accessor<boolean>; minWidth?: Accessor<number>; overlay?: Accessor<boolean>; documentHost?: (element: HTMLElement | undefined) => void }) {
  let panelRoot: HTMLElement | undefined;
  let resizeHandle: HTMLDivElement | undefined;
  let panelMotionId = 0;
  let mobileReturnFocus: HTMLElement | null = null;
  let mobileWasOpen = false;
  const panelScope = () => WORKSPACE_PANEL_GLOBAL_SCOPE;
  const projectScope = () => WORKSPACE_PANEL_GLOBAL_SCOPE;
  const fileScope = () => props.settingsScope ? props.projectId() : props.chatId();
  const readPanelSetting = (name: string, legacyScope = props.chatId()) => {
    const globalValue = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, name);
    if (globalValue !== null) return globalValue;
    const legacyValue = readSetting(legacyScope, name);
    if (legacyValue !== null) writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, name, legacyValue);
    return legacyValue;
  };
  const readGeometrySetting = (name: string) => readPanelSetting(name, props.settingsScope?.() || props.projectId());
  const settings: WorkspaceSettings = { panel: (name) => readPanelSetting(name), geometry: readGeometrySetting, fileScope };
  const storedTab = () => {
    const value = readPanelSetting("tab") || "";
    return panelTab(value) ?? "files";
  };
  const [tab, setTab] = createSignal<PanelTab>(storedTab());
  // The comment a chip asked to reveal, carried down to whichever view shows it.
  const [reviewReveal, setReviewReveal] = createSignal<ReviewNavigationRequest | null>(null);
  const [width, setWidth] = createSignal(Math.max(MIN_WORKSPACE_PANE_WIDTH, Math.min(496, Number(readGeometrySetting("width")) || 336)));
  const [shellWidth, setShellWidth] = createSignal(props.open() ? width() : 0);
  const [shellGap, setShellGap] = createSignal(props.open() && !isMobileLayout() ? 8 : 0);
  const [terminalFocusRequest, setTerminalFocusRequest] = createSignal(0);
  // Review comments ride the composer, which a dashboard has before its chat
  // exists, so they follow the loaded chat rather than the panel's own scope.
  const commentChatId = () => props.commentChatId?.() ?? props.artifactChatId?.() ?? null;

  const tabVisible = (candidate: PanelTab) => (candidate !== "diff" || props.sourceControlEnabled()) && tab() === candidate;
  // A view is in the dock or in the main pane's split, never both.
  const inSplit = (candidate: PanelTab) => props.splitView?.() === candidate && Boolean(props.splitHost?.()) && (candidate !== "diff" || props.sourceControlEnabled());
  // The file opened beside is Files' second slot, shown in the split.
  const fileBeside = () => props.splitView?.() === "file" && Boolean(props.splitHost?.());
  const dockShows = (candidate: PanelTab) => tabVisible(candidate) && !inSplit(candidate);
  const shown = (candidate: PanelTab) => (props.open() && dockShows(candidate)) || inSplit(candidate);

  const requests = createRequestScope(props.projectId);
  const sourceControl = createSourceControl({ projectId: props.projectId, enabled: props.sourceControlEnabled, chatId: () => props.artifactChatId?.() ?? null, requests, settings, settingsScope: panelScope() });
  createEffect(() => {
    if (props.sourceControlEnabled()) return;
    if (tab() === "diff") setTab("files");
  });
  const chat = createChatReview({ projectId: props.projectId, chatId: () => props.artifactChatId?.() ?? null, historyAvailable: () => Boolean(props.historyAvailable?.()),
    visible: () => shown("chat"), gitFiles: () => sourceControl.diff()?.files ?? [], settings, settingsScope: panelScope() });
  // Where panes can hold a file viewer, Files is the navigator and opens files there (6d-2).
  const openFileDocument = (path: string, beside: boolean, edit: boolean, reveal?: ReviewNavigationRequest) => {
    if (!props.onOpenFile) return false;
    props.onOpenFile({ projectId: props.projectId(), path }, { beside, edit, reveal });
    return true;
  };
  const files = createFiles({ projectId: props.projectId, requests, settings, settingsScope: projectScope(), openElsewhere: openFileDocument });
  const poll = createWorkspacePoll({ projectId: props.projectId, requests, files, sourceControl, sourceControlEnabled: props.sourceControlEnabled,
    hasInitialDirectory: Boolean(props.initialDirectory),
    shown: () => shown("files") || fileBeside() || shown("diff") || shown("chat"),
    filesShown: () => shown("files") || fileBeside(), diffShown: () => shown("diff") });
  // The second slot lives only while the split holds it: anything else there
  // lets it go, and it going (closed, removed, another chat's files) closes
  // the split. Leaving asks first when it has an edit (bindSplit).
  createEffect(() => {
    const view = props.splitView?.();
    const path = files.openPaths().secondary;
    if (view !== "file" && path) files.setSlotPath("secondary", null);
    else if (view === "file" && !path) props.onCloseSplit?.(false);
  });
  const releaseFileBeside = (toDock: boolean) => {
    const path = files.openPaths().secondary;
    if (!path) return true;
    if (files.slotHandles.get("secondary")?.hasUnsavedChanges() && !window.confirm(toDock ? "Discard unsaved changes and move this file to the dock?" : "Discard unsaved changes and close this file?")) return false;
    return toDock ? files.openInSlot("primary", path) : true;
  };
  const unbindSplit = props.bindSplit?.(releaseFileBeside);
  onCleanup(() => unbindSplit?.());
  const openFileBeside = (path: string) => {
    if (openFileDocument(path, true, false)) return;
    if (!props.onOpenBeside) return files.openFile(path);
    batch(() => {
      props.onOpenBeside!("file");
      files.openInSlot("secondary", path);
    });
  };

  let panelWasOpen = false;
  const animatePanelGeometry = (open: boolean) => {
    const mobile = isMobileLayout();
    // A width saved while there was more room opens at what fits now.
    const targetWidth = open ? (mobile ? width() : clampWidth(width())) : 0;
    const targetGap = open && !mobile ? 8 : 0;
    batch(() => {
      setShellWidth(targetWidth);
      setShellGap(targetGap);
    });
  };

  const selectTab = (next: PanelTab) => {
    setTab(next);
    writeSetting(panelScope(), "tab", next);
  };
  createEffect(() => props.onTabChange?.(tab()));
  const tabLabel = (candidate: PanelTab) => WORKSPACE_TOOL_LABELS[candidate];
  const setPaneTab = (next: PanelTab) => {
    const resolved = next === "diff" && !props.sourceControlEnabled() ? "files" : next;
    if (!inSplit(resolved)) selectTab(resolved);
  };
  const focusSplit = () => queueMicrotask(() => {
    const content = props.splitHost?.()?.querySelector<HTMLElement>(".workspace-panel-content");
    focusFirst(content);
    if (!content?.contains(document.activeElement)) content?.focus({ preventScroll: true });
  });
  const focusTabControl = (next: PanelTab) => {
    const control = panelRoot?.querySelector<HTMLElement>(`[data-workspace-tab="${next}"]`);
    // On a desktop the rail stands in for the tabs, so focus lands in the
    // view, or on the view itself while it has nothing to focus yet.
    if (control?.getClientRects().length) return control.focus({ preventScroll: true });
    const content = panelRoot?.querySelector<HTMLElement>(".workspace-panel-content");
    focusFirst(content);
    if (!content?.contains(document.activeElement)) content?.focus({ preventScroll: true });
  };
  const focusTabDefault = (next: PanelTab) => {
    if (next === "files") {
      if (!files.directories()[""]) void files.loadDirectory();
      // The filter lives in the file navigator, which a narrow panel folds
      // away; focus on a hidden input goes nowhere, so the open file takes it
      // then, and the tab only when there is none.
      queueMicrotask(() => {
        if (!files.focusDefault()) focusTabControl("files");
      });
      return;
    }
    queueMicrotask(() => {
      focusTabControl(next);
      if (next === "terminal") setTerminalFocusRequest((request) => request + 1);
    });
  };
  const tabIcon = (candidate: PanelTab) => candidate === "files" ? <FolderIcon />
    : candidate === "diff" ? <GitCompareArrowsIcon />
    : candidate === "chat" ? <MessageSquareIcon />
    : <TerminalIcon />;
  // A phone has no rail, so its header keeps a strip of the views.
  const tabStrip = () => (
    <div class="workspace-panel-tabs-space" ref={(element) => {
      const observer = new ResizeObserver(() => {
        element.removeAttribute("data-icons-only");
        const tabs = element.firstElementChild;
        if (tabs && tabs.scrollWidth > element.clientWidth) element.setAttribute("data-icons-only", "true");
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    }}>
      <div class="workspace-panel-tabs" role="toolbar" aria-label="Workspace views">
        <For each={PANEL_TABS}>{(item) => {
          const disabled = () => item === "diff" && !props.sourceControlEnabled();
          return <button type="button" role="tab" data-workspace-tab={item} disabled={disabled()} aria-label={disabled() ? `${tabLabel(item)}: ${props.onBrowseDirectory ? "open a Git folder" : "unavailable for Chats and managed projects"}` : tabLabel(item)} title={disabled() ? (props.onBrowseDirectory ? "Open a Git folder to use Source Control" : "Source Control is available only for Workspaces") : tabLabel(item)} aria-selected={tab() === item} onClick={() => changePaneTab(item)}>{tabIcon(item)}<span>{tabLabel(item)}</span></button>;
        }}</For>
      </div>
    </div>
  );
  const changePaneTab = (next: PanelTab) => {
    setPaneTab(next);
    focusTabDefault(next);
  };
  // The header holds the view's name and its modes. When they stop fitting,
  // the modes drop their labels, then the name goes: measured, not a width.
  const fitHeader = (element: HTMLElement) => {
    const fit = () => {
      element.removeAttribute("data-compact");
      if (element.scrollWidth <= element.clientWidth) return;
      element.setAttribute("data-compact", "labels");
      if (element.scrollWidth > element.clientWidth) element.setAttribute("data-compact", "name");
    };
    // Its width changing, or what it holds: another view's name and modes.
    const resized = new ResizeObserver(fit);
    const changed = new MutationObserver(fit);
    resized.observe(element);
    changed.observe(element, { childList: true, subtree: true, characterData: true });
    onCleanup(() => { resized.disconnect(); changed.disconnect(); });
  };
  // A key the leader lists must do something here: Source Control only with
  // a repository, the split only while the panel is wide enough to split.
  const workspaceShortcutAvailable = () => !document.querySelector(
    '.command-dialog[data-state="open"], .settings-dialog[data-state="open"], .conduit-modal[data-state="open"], .external-link-dialog[data-state="open"]',
  );
  const selectShortcutTab = (next: PanelTab) => {
    if (inSplit(next)) return focusSplit();
    setPaneTab(next);
    focusTabDefault(next);
  };
  const focusWorkspaceSurface = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".workspace-dock-document")) return;
    // The terminal is its own pointer surface: preventDefault here suppresses
    // the compatibility mouse events, so xterm never sees the mousedown and
    // loses click-to-position, drag selection, and mouse reporting to the TUI.
    // It focuses itself on click, so it needs nothing from this handler.
    if (target?.closest("button,a,input,textarea,select,[contenteditable='true'],[role='button'],[role='link'],[role='option'],[role='treeitem'],[role='menu'],[role^='menuitem'],[data-shortcut-exclusive='terminal']")) return;
    event.preventDefault();
    queueMicrotask(() => focusTabDefault(tab()));
  };
  const releaseShortcutHandlers = [
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceFiles, "workspace-panel", () => selectShortcutTab("files"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceSourceControl, "workspace-panel", () => selectShortcutTab("diff"), { when: () => props.sourceControlEnabled() && workspaceShortcutAvailable() }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceChat, "workspace-panel", () => selectShortcutTab("chat"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceTerminal, "workspace-panel", () => selectShortcutTab("terminal"), { when: workspaceShortcutAvailable }),
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceOpenBeside, "workspace-panel", () => openFocusedBeside(), { when: () => Boolean(props.onOpenBeside && focusedBeside()) && workspaceShortcutAvailable() }),
  ];
  onCleanup(() => releaseShortcutHandlers.forEach((release) => release()));

  // Moving between views: a file to its review, a review back to the working
  // file, and a comment chip or turn artifact to whichever view shows it.
  // Beside, the review opens in the main pane's split rather than the dock.
  const openSourceControlReview = async (scope: DiffScope, path: string, beside = false) => {
    if (!files.confirmDiscard(path, "Discard unsaved changes and review this file?")) return;
    sourceControl.showReview(scope);
    if (beside && props.onOpenBeside) props.onOpenBeside("diff");
    else {
      if (!inSplit("diff")) props.onRequestOpen?.();
      setPaneTab("diff");
    }
    await sourceControl.refreshReview(path);
  };
  const inspectFileDiff = (path: string, staged: boolean, beside?: boolean) => void openSourceControlReview(staged ? "staged" : "changes", path, beside);
  const showFileDiff = (slot: FileSlotId, staged: boolean, beside?: boolean) => {
    const path = files.openPaths()[slot];
    if (path) { files.setFocusedSlot(slot); void openSourceControlReview(staged ? "staged" : "changes", path, beside); }
  };
  // The leader's Open beside: the file or change the keyboard is on.
  const focusedBeside = () => {
    const row = document.activeElement instanceof HTMLElement && panelRoot?.contains(document.activeElement) ? document.activeElement : null;
    if (row?.matches('[role="treeitem"]:not([aria-expanded])') && row.dataset.path) return { kind: "file" as const, path: row.dataset.path };
    if (row?.matches("[data-change-path]")) return { kind: "diff" as const, path: row.dataset.changePath!, staged: row.dataset.staged === "true" };
    return null;
  };
  const openFocusedBeside = () => {
    const target = focusedBeside();
    if (target?.kind === "file") openFileBeside(target.path);
    else if (target) inspectFileDiff(target.path, target.staged, true);
  };
  const openWorkingFile = (path: string) => {
    if (openFileDocument(path, false, false)) return;
    if (!files.openInSlot("primary", path)) return;
    if (inSplit("files")) return focusSplit();
    props.onRequestOpen?.();
    if (!tabVisible("files")) setPaneTab("files");
    queueMicrotask(() => focusTabDefault("files"));
  };
  const resolveReviewNavigation = (event: Event) => {
    const request = (event as CustomEvent<ReviewNavigationRequest>).detail;
    if (!request || request.chatId !== commentChatId()) return;
    const target: PanelTab = request.scope === "file" ? "files" : request.scope === "changes" || request.scope === "staged" || request.scope === "head" ? "diff" : "chat";
    // A file's comment goes to a pane's file viewer, which needs no dock.
    if (!inSplit(target) && !(request.scope === "file" && props.onOpenFile)) props.onRequestOpen?.();
    setReviewReveal(request);
    if (request.scope === "file") {
      if (openFileDocument(request.path, false, false, request)) return;
      openWorkingFile(request.path);
      return;
    }
    if (request.scope === "changes" || request.scope === "staged" || request.scope === "head") {
      if (!props.sourceControlEnabled()) return reportError("Source control is unavailable for this workspace.");
      void openSourceControlReview(request.scope, request.path);
      return;
    }
    chat.selectMode("changes");
    setPaneTab("chat");
    chat.review.setScope(request.scope === "session" ? "chat" : "turn");
    void chat.review.refresh(request.path);
  };
  window.addEventListener(REVIEW_NAVIGATION_EVENT, resolveReviewNavigation);
  onCleanup(() => window.removeEventListener(REVIEW_NAVIGATION_EVENT, resolveReviewNavigation));
  const resolveTurnArtifactNavigation = (event: Event) => {
    const request = (event as CustomEvent<TurnArtifactNavigationRequest>).detail;
    if (!request || request.chatId !== props.artifactChatId?.()) return;
    if (!inSplit("chat")) props.onRequestOpen?.();
    setReviewReveal(null);
    chat.selectMode("changes");
    setPaneTab("chat");
    chat.review.setScope("turn", request.checkpointId);
    void chat.review.refresh(request.path);
  };
  window.addEventListener(TURN_ARTIFACT_NAVIGATION_EVENT, resolveTurnArtifactNavigation);
  onCleanup(() => window.removeEventListener(TURN_ARTIFACT_NAVIGATION_EVENT, resolveTurnArtifactNavigation));

  // Over the panes, the dock takes no room from them, so nothing beneath it moves.
  const panelMotion = (detail: Parameters<typeof dispatchPanelGeometryMotion>[0]) => { if (!props.overlay?.()) dispatchPanelGeometryMotion(detail); };
  // The panel takes room from the main pane only down to its minimum.
  const room = () => {
    if (props.overlay?.()) return Infinity;
    const main = document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
    if (!main || isMobileLayout()) return Infinity;
    // Every pane gives way down to its document's minimum.
    const panes = [...document.querySelectorAll<HTMLElement>(".chat-main, [data-pane-slot]")];
    const slack = panes.reduce((sum, pane) => sum + pane.getBoundingClientRect().width - (parseFloat(getComputedStyle(pane).minWidth) || MIN_MAIN_PANE_WIDTH), 0);
    return slack + (props.open() ? shellWidth() + shellGap() : 0) - 8;
  };
  // Whatever the dock shows declares its minimum (a docked chat a pane's); a tool, the dock's own.
  const minWidth = () => props.minWidth?.() ?? MIN_WORKSPACE_PANE_WIDTH;
  const clampWidth = (next: number) => Math.max(minWidth(), Math.min(Math.floor(window.innerWidth * 0.65), room(), next));
  createEffect(on(minWidth, () => { if (props.open()) animatePanelGeometry(true); }, { defer: true }));
  // Every atomic width commit has to announce itself. The transcript learns its
  // own width only from geometry motion, so a commit that skips the event
  // leaves it laid out for the panel's previous size until something unrelated
  // nudges it. The drag has its own begin/change/end; this is for the commits
  // that land in one step -- keyboard resize and the project-change reset.
  const commitWidth = (next: number) => {
    const value = clampWidth(next);
    const startSize = shellWidth() + shellGap();
    batch(() => {
      setWidth(value);
      if (props.open()) setShellWidth(value);
    });
    if (!props.open()) return value;
    const targetSize = value + shellGap();
    if (Math.abs(targetSize - startSize) > 0.5) {
      const id = ++panelMotionId;
      panelMotion({ phase: "begin", id, source: "workspace", size: startSize, targetSize, duration: 0 });
      panelMotion({ phase: "end", id, source: "workspace", size: targetSize });
    }
    return value;
  };
  const saveWidth = (next: number) => {
    writeSetting(projectScope(), "width", String(commitWidth(next)));
  };
  let stopResize: (() => void) | undefined;
  // The window narrowing or the sidebar opening takes room from the main
  // pane; the panel gives it back down to the main pane's minimum.
  onMount(() => {
    const main = document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
    if (!main) return;
    const observer = new ResizeObserver(() => {
      if (!props.open() || isMobileLayout() || stopResize) return;
      const fitted = clampWidth(width());
      if (fitted < shellWidth() - 0.5) commitWidth(fitted);
    });
    observer.observe(main);
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    const open = props.open();
    if (open !== panelWasOpen) {
      if (!open && !props.splitView?.()) requests.reset();
      animatePanelGeometry(open);
    }
    panelWasOpen = open;
  });
  createEffect(() => {
    const open = props.open() && isMobileLayout();
    if (open && !mobileWasOpen) {
      mobileReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      queueMicrotask(() => focusFirst(panelRoot));
    } else if (!open && mobileWasOpen) {
      const previous = mobileReturnFocus;
      mobileReturnFocus = null;
      queueMicrotask(() => restoreFocus(previous, [".composer textarea", 'button[aria-label="Toggle workspace panel"]', ".mobile-sidebar-trigger"]));
    }
    mobileWasOpen = open;
  });
  const startResize = (event: PointerEvent) => {
    if (isMobileLayout()) return;
    stopResize?.();
    event.preventDefault();
    resizeHandle?.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = width();
    let pendingWidth = startWidth;
    let frame = 0;
    let stopped = false;
    const id = ++panelMotionId;
    // Open/close uses CSS width transition; resize must not, or the shell lags
    // the pointer and the gutter/transcript fight the ease.
    panelRoot?.setAttribute("data-edge-instant", "true");
    if (panelRoot) panelRoot.style.transition = "none";
    panelMotion({ phase: "begin", id, source: "workspace", size: startWidth + shellGap() });
    const apply = () => {
      frame = 0;
      const nextWidth = clampWidth(pendingWidth);
      // Resize edge is layout truth: shell and surface stay equal every frame so
      // chat-main stays adjacent and the flex slot cannot outgrow the surface.
      batch(() => {
        setWidth(nextWidth);
        setShellWidth(nextWidth);
      });
      panelMotion({ phase: "change", id, source: "workspace", size: nextWidth + shellGap() });
    };
    const move = (moveEvent: PointerEvent) => {
      pendingWidth = startWidth + startX - moveEvent.clientX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      const nextWidth = clampWidth(pendingWidth);
      batch(() => {
        setWidth(nextWidth);
        setShellWidth(nextWidth);
      });
      writeSetting(projectScope(), "width", String(nextWidth));
      panelMotion({ phase: "end", id, source: "workspace", size: nextWidth + shellGap() });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      resizeHandle?.removeEventListener("lostpointercapture", stop);
      if (resizeHandle?.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      panelRoot?.removeAttribute("data-edge-instant");
      panelRoot?.style.removeProperty("transition");
      stopResize = undefined;
    };
    stopResize = stop;
    // No class on body: the captured handle keeps its cursor, and its inherited
    // cursor and user-select restyled the whole page at each end of the drag.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
    resizeHandle?.addEventListener("lostpointercapture", stop, { once: true });
  };
  onCleanup(() => {
    requests.reset();
    stopResize?.();
    document.body.classList.remove("workspace-detail-resizing");
    document.body.classList.remove("workspace-tree-resizing");
    document.body.classList.remove("workspace-split-resizing");
  });

  let loadedProjectId = "";
  let geometryProjectId = "";
  createEffect(on(() => [props.chatId(), props.projectId()] as const, () => {
    const nextTab = storedTab();
    const projectChanged = geometryProjectId !== projectScope();
    if (projectChanged) {
      geometryProjectId = projectScope();
      stopResize?.();
    }
    let pendingWidthCommit: number | null = null;
    batch(() => {
      sourceControl.restore();
      if (projectChanged) {
        pendingWidthCommit = Number(readGeometrySetting("width")) || 336;
        files.restoreGeometry();
      }
      setTab(nextTab);
      files.restoreOpenFiles();
    });
    if (pendingWidthCommit != null) commitWidth(pendingWidthCommit);
  }));
  createEffect(on(() => props.requestedTab?.(), (next) => {
    if (next) selectShortcutTab(next.tab);
  }));
  createEffect(on(() => props.focusRequest(), (request, previous) => {
    if (request && request !== previous && props.open()) {
      focusTabDefault(tab());
      queueMicrotask(() => {
        if (panelRoot?.contains(document.activeElement)) props.onFocusRequestComplete?.();
      });
    }
  }));
  createEffect(on(
    () => [props.projectId(), tab(), props.open(), sourceControl.mode(), props.splitView?.(), props.splitHost?.()] as const,
    ([projectId]) => {
      if (!shown("files") && !shown("diff") && !shown("chat") && !shown("terminal")) return;
      const projectChanged = loadedProjectId !== projectId;
      if (projectChanged) {
        if (loadedProjectId) requests.reset();
        loadedProjectId = projectId;
        const cached = cachedWorkspace(projectId);
        batch(() => {
          files.restoreFromCache(cached, props.initialDirectory?.());
          sourceControl.setDiff(cached?.diff || null);
        });
      }
      const filesVisible = shown("files");
      const diffVisible = shown("diff");
      const chatVisible = shown("chat");
      if (filesVisible && !files.directories()[""] && !files.filesLoading()) void files.loadDirectory("", false);
      if (diffVisible || (filesVisible && props.sourceControlEnabled())) {
        const includePatch = sourceControl.mode() === "patch";
        const includeHistory = sourceControl.mode() === "graph";
        const current = sourceControl.diff();
        const needsPatch = diffVisible && includePatch;
        const needsHistory = diffVisible && includeHistory;
        if (!current || (needsPatch && !current.diff) || (needsHistory && !current.commits)) void sourceControl.loadDiff(needsPatch, needsHistory, Boolean(current));
      }
      if (chatVisible && chat.mode() === "history") void chat.loadHistory();
    }));

  createEffect(on(() => props.initialDirectory?.(), (listing) => {
    if (!listing) return;
    files.setDirectories((current) => ({ ...current, "": listing }));
    cacheWorkspace(props.projectId(), { directories: files.directories() });
  }));

  createEffect(on(() => [props.projectId(), props.requestedFile?.(), props.open()] as const, ([, file, open]) => {
    if (file && open) files.openFile(file.path);
  }));

  // A view's header, in the dock or the split: its name, its modes, and moving
  // it between the two. The header is its drag handle.
  const viewLabel = (view: SplitView) => view === "file" ? files.openPaths().secondary?.split("/").pop() || "File"
    : view.startsWith("shell:") ? "Terminal" : tabLabel(view as PanelTab);
  const closeSplitView = (view: SplitView) => {
    if (view === "file") {
      files.closeSlot("secondary");
      if (files.openPaths().secondary) return;
    }
    props.onCloseSplit?.();
  };
  const toolHeader = (tool: Accessor<SplitView>, where: "dock" | "split") => (
    <header ref={fitHeader} class="workspace-panel-header" draggable={!isMobileLayout()}
      onDragStart={(event) => { event.dataTransfer?.setData(TOOL_DRAG_TYPE, JSON.stringify({ tool: tool(), from: where })); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; document.body.dataset.toolDrag = where; }}
      onDragEnd={() => delete document.body.dataset.toolDrag}>
      <strong title={tool() === "file" ? files.openPaths().secondary ?? "" : props.workingRoot()}>{viewLabel(tool())}</strong>
      {/* The dock follows places (6d-1): it says which one it shows. */}
      <Show when={where === "dock"}><span class="workspace-panel-place" title={props.workingRoot()}>{props.projectName()}</span></Show>
      <Show when={tool() === "diff" && props.sourceControlEnabled()}><SourceControlModes control={sourceControl} /></Show>
      <Show when={tool() === "chat"}><ChatModes control={chat} historyAvailable={Boolean(props.historyAvailable?.())} /></Show>
      {where === "dock" ? tabStrip() : null}
      <div class="workspace-panel-header-actions">
        <Show when={where === "dock"} fallback={<>
          <Button variant="ghost" size="icon-sm" title="Move to dock" aria-label={`Move ${viewLabel(tool())} to the dock`} onClick={() => props.onMoveToDock?.(tool())}><PanelRightIcon /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Close ${viewLabel(tool())}`} onClick={() => closeSplitView(tool())}><XIcon /></Button>
        </>}>
          <Show when={props.onOpenBeside && !(tool() === "files" && props.onOpenFile)}><Button variant="ghost" size="icon-sm" class="workspace-move-toggle" title="Move to main pane" aria-label={`Move ${viewLabel(tool())} to the main pane`} onClick={() => props.onOpenBeside?.(tool())}><Columns2Icon /></Button></Show>
          <Button variant="ghost" size="icon-sm" class="workspace-expand-toggle" title={props.expanded() ? "Restore" : "Maximise"} aria-label={props.expanded() ? "Restore workspace panel" : "Maximise workspace panel"} aria-pressed={props.expanded()} onClick={props.onToggleExpanded}>
            <Show when={props.expanded()} fallback={<Maximize2Icon />}><Minimize2Icon /></Show>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close workspace panel" onClick={props.onClose}><XIcon /></Button>
        </Show>
      </div>
    </header>
  );
  const toolView = (tool: PanelTab, where: "dock" | "split") => tool === "files"
    ? <FilesView control={files} expanded={where === "dock" && props.expanded()} projectId={props.projectId()} workingRoot={props.workingRoot()}
      sourceControlEnabled={props.sourceControlEnabled()} gitFiles={sourceControl.diff()?.files ?? []} commentChatId={commentChatId()} reveal={reviewReveal()}
      stale={poll.stale()} onRetryPoll={poll.retry} onSaved={() => void sourceControl.loadDiff(false, false)} onShowDiff={showFileDiff}
      onOpenBeside={props.onOpenBeside || props.onOpenFile ? openFileBeside : undefined} onBrowseDirectory={props.onBrowseDirectory} onBrowseParent={props.onBrowseParent}
      navigatorOnly={Boolean(props.onOpenFile)} openInPane={props.openFiles ? (path) => props.openFiles!().get(`${props.projectId()}:${path}`) : undefined} />
    : tool === "diff" ? <SourceControlView control={sourceControl} stale={poll.stale()} onRetryPoll={poll.retry} chatAvailable={Boolean(props.artifactChatId?.())}
      commentChatId={commentChatId()} reveal={reviewReveal()} onInspectFile={inspectFileDiff} onOpenWorkingFile={openWorkingFile} />
    : tool === "chat" ? <ChatView control={chat} historyAvailable={Boolean(props.historyAvailable?.())} chatId={props.artifactChatId?.() ?? null}
      commentChatId={commentChatId()} reveal={reviewReveal()} onOpenWorkingFile={openWorkingFile} />
    : <TerminalView computer={props.settingsScope?.() === "computer"} projectId={props.projectId()} projectName={props.projectName()}
      workingRoot={props.workingRoot()} terminalId={props.requestedTab?.()?.terminalId} focusRequest={terminalFocusRequest()} connectivity={props.connectivity}
      onOpenBeside={where === "dock" && props.onOpenBeside ? (id) => props.onOpenBeside!(`shell:${id}`) : undefined} />;
  const splitView = (view: SplitView) => view === "file"
    ? <FileBesideView control={files} projectId={props.projectId()} sourceControlEnabled={props.sourceControlEnabled()} gitFiles={sourceControl.diff()?.files ?? []}
      commentChatId={commentChatId()} reveal={reviewReveal()} onSaved={() => void sourceControl.loadDiff(false, false)} onShowDiff={showFileDiff} />
    : view.startsWith("shell:") ? <TerminalView computer={props.settingsScope?.() === "computer"} projectId={props.projectId()} projectName={props.projectName()}
      workingRoot={props.workingRoot()} terminalId={view.slice("shell:".length)} focusRequest={0} connectivity={props.connectivity} />
    : toolView(view as PanelTab, "split");
  // A view dragged from the split onto the dock docks.
  const dockDrop = {
    onDragOver: (event: DragEvent) => { if (document.body.dataset.toolDrag === "split" && event.dataTransfer?.types.includes(TOOL_DRAG_TYPE)) event.preventDefault(); },
    onDrop: (event: DragEvent) => { const drag = readToolDrag(event); if (drag?.from === "split") { event.preventDefault(); props.onMoveToDock?.(drag.tool); } },
  };

  return <>
    <Show when={props.open()}>
      <button type="button" class="mobile-panel-backdrop" data-mobile-backdrop="workspace" data-for="workspace" aria-label="Dismiss workspace panel" onClick={props.onClose} />
    </Show>
    <aside ref={panelRoot} class="workspace-panel" data-region="workspace-panel" classList={{ "workspace-panel-open": props.open() || shellWidth() > 0.5, "workspace-panel-expanded": props.expanded(), "workspace-panel-overlay": Boolean(props.overlay?.()) }} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} {...dockDrop} style={{ "--workspace-panel-width": `${width()}px`, "--workspace-shell-width": `${shellWidth()}px`, width: `${shellWidth()}px`, "margin-right": `${shellGap()}px` }}>
    <div ref={resizeHandle} class="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuemin={minWidth()} aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") saveWidth(width() + 16); if (event.key === "ArrowRight") saveWidth(width() - 16); }} />
    <div class="workspace-panel-surface" classList={{ "workspace-panel-documented": Boolean(props.documentShown?.()) }} onPointerDown={focusWorkspaceSurface}>
    {toolHeader(tab, "dock")}
    <main class="workspace-panel-content" tabIndex={-1}>
      <For each={PANEL_TABS}>{(tool) => <Show when={dockShows(tool)}>{toolView(tool, "dock")}</Show>}</For>
    </main>
    {/* A pane's document moved into the dock draws here, over the tools. */}
    <div class="workspace-dock-document" ref={(element) => { props.documentHost?.(element); onCleanup(() => props.documentHost?.(undefined)); }} />
    <Show when={requests.loading()}><div class="workspace-panel-loading"><Spinner /><span>Loading workspace</span></div></Show>
    </div>
  </aside>
    <Show when={props.splitHost?.() && props.splitView?.() && !/^(chat|page|files):/.test(props.splitView()!) && props.splitView()}>{(tool) =>
      <Portal mount={props.splitHost!()!}>
        <div class="workspace-split-surface">
          {toolHeader(tool, "split")}
          <main class="workspace-panel-content" tabIndex={-1}>{splitView(tool())}</main>
        </div>
      </Portal>
    }</Show>
  </>;
}
