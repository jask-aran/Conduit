import { batch, createEffect, createSignal, For, on, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { MIN_MAIN_PANE_WIDTH } from "../layout-geometry";
import { Columns2Icon, FolderIcon, GitCompareArrowsIcon, Maximize2Icon, MessageSquareIcon, Minimize2Icon, TerminalIcon, XIcon } from "lucide-solid";
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
import { createFiles, FilesView } from "./workspace-files";
import { createSourceControl, SourceControlView } from "./workspace-source-control";
import { ChatView, createChatReview } from "./workspace-chat-view";
import { TerminalView } from "./workspace-terminal-view";
import { createWorkspacePoll } from "./workspace-poll";
import type { DirectoryListing, FileSlotId, PanelTab, WorkspaceSettings } from "./workspace-types";

/*
 * The workspace panel: the chrome around the four workspace views (Files,
 * Source Control, Chat, Terminal) -- its tabs, its own two-pane split, its
 * width, opening and closing, phone focus and shortcuts -- and the navigation
 * between the views. Each view and its state live in their own files, so a
 * view can be shown outside the panel (docs/design/panes-and-rail.md).
 */

const PANEL_TABS = ["files", "chat", "terminal", "diff"] satisfies PanelTab[];

function panelTab(value: string): PanelTab | null {
  if (value === "artifacts") return "chat";
  return value === "files" || value === "diff" || value === "chat" || value === "terminal" ? value : null;
}

const MIN_WORKSPACE_PANE_WIDTH = 240;
const WORKSPACE_SPLIT_GUTTER_WIDTH = 9;

export default function WorkspacePanel(props: { connectivity?: () => Connectivity; projectId: Accessor<string>; projectName: Accessor<string>; sourceControlEnabled: Accessor<boolean>; workingRoot: Accessor<string>; chatId: Accessor<string>; artifactChatId?: Accessor<string | null>; commentChatId?: Accessor<string | null>; historyAvailable?: Accessor<boolean>; open: Accessor<boolean>; expanded: Accessor<boolean>; focusRequest: Accessor<number>; onFocusRequestComplete?: () => void; requestedTab?: Accessor<{ tab: PanelTab; terminalId?: string; nonce: number } | null>; onRequestOpen?: () => void; onToggleExpanded: () => void; onClose: () => void; shortcuts: ShortcutManager; onBrowseDirectory?: (path: string) => void; onBrowseParent?: () => void; requestedFile?: Accessor<{ path: string } | null>; settingsScope?: Accessor<string>; initialDirectory?: Accessor<DirectoryListing> }) {
  let panelRoot: HTMLElement | undefined;
  let resizeHandle: HTMLDivElement | undefined;
  let splitHost: HTMLElement | undefined;
  let splitResizeObserver: ResizeObserver | undefined;
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
  const storedSecondary = () => {
    const stored = readPanelSetting("secondary-tab") || "";
    return panelTab(stored);
  };
  const [tab, setTab] = createSignal<PanelTab>(storedTab());
  const [secondaryTab, setSecondaryTab] = createSignal<PanelTab | null>(storedSecondary());
  // The comment a chip asked to reveal, carried down to whichever view shows it.
  const [reviewReveal, setReviewReveal] = createSignal<ReviewNavigationRequest | null>(null);
  const [width, setWidth] = createSignal(Math.max(MIN_WORKSPACE_PANE_WIDTH, Math.min(496, Number(readGeometrySetting("width")) || 336)));
  const [shellWidth, setShellWidth] = createSignal(props.open() ? width() : 0);
  const [shellGap, setShellGap] = createSignal(props.open() && !isMobileLayout() ? 8 : 0);
  const [splitRatio, setSplitRatio] = createSignal(Math.max(0, Math.min(100, Number(readGeometrySetting("split-ratio")) || 50)));
  const [splitWidth, setSplitWidth] = createSignal(0);
  const [terminalFocusRequest, setTerminalFocusRequest] = createSignal(0);
  // Review comments ride the composer, which a dashboard has before its chat
  // exists, so they follow the loaded chat rather than the panel's own scope.
  const commentChatId = () => props.commentChatId?.() ?? props.artifactChatId?.() ?? null;

  const splitActive = () => props.expanded() && secondaryTab() !== null;
  const tabVisible = (candidate: PanelTab) => (candidate !== "diff" || props.sourceControlEnabled()) && (tab() === candidate || (props.expanded() && secondaryTab() === candidate));
  const panePosition = (candidate: PanelTab) => tab() === candidate ? "left" : secondaryTab() === candidate ? "right" : undefined;

  const requests = createRequestScope(props.projectId);
  const sourceControl = createSourceControl({ projectId: props.projectId, enabled: props.sourceControlEnabled, chatId: () => props.artifactChatId?.() ?? null, requests, settings, settingsScope: panelScope() });
  createEffect(() => {
    if (props.sourceControlEnabled()) return;
    if (tab() === "diff") setTab("files");
    if (secondaryTab() === "diff") setSecondaryTab("terminal");
  });
  const chat = createChatReview({ projectId: props.projectId, chatId: () => props.artifactChatId?.() ?? null, historyAvailable: () => Boolean(props.historyAvailable?.()),
    visible: () => tabVisible("chat"), gitFiles: () => sourceControl.diff()?.files ?? [], settings, settingsScope: panelScope() });
  const files = createFiles({ projectId: props.projectId, requests, settings, settingsScope: projectScope() });
  const poll = createWorkspacePoll({ projectId: props.projectId, requests, files, sourceControl, sourceControlEnabled: props.sourceControlEnabled,
    hasInitialDirectory: Boolean(props.initialDirectory),
    shown: () => props.open() && (tabVisible("files") || tabVisible("diff") || tabVisible("chat")),
    filesShown: () => tabVisible("files"), diffShown: () => tabVisible("diff") });

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
  const saveSecondaryTab = (next: PanelTab | null) => {
    setSecondaryTab(next);
    writeSetting(panelScope(), "secondary-tab", next);
  };
  const toggleSplit = () => {
    if (!props.expanded()) return;
    if (splitActive()) {
      saveSecondaryTab(null);
      focusTabDefault(tab());
      return;
    }
    const next: PanelTab = tab() === "files" ? "diff" : "files";
    saveSecondaryTab(next);
    focusTabDefault(next, "right");
  };
  // Keyboard retargets whichever pane holds focus: unlike a click, focus already
  // says which half you are working in.
  const focusedPane = (): "left" | "right" => {
    if (!splitActive()) return "left";
    const active = document.activeElement;
    if (!(active instanceof Element)) return "left";
    const owner = active.closest("[data-pane],[data-position]");
    const side = owner?.getAttribute("data-pane") || owner?.getAttribute("data-position");
    return side === "right" ? "right" : "left";
  };
  const tabLabel = (candidate: PanelTab) => candidate === "files" ? "Files" : candidate === "diff" ? "Source Control" : candidate === "chat" ? "Chat" : "Terminal";
  const setPaneTab = (side: "left" | "right", next: PanelTab) => {
    if (next === "diff" && !props.sourceControlEnabled()) next = "files";
    if (!splitActive()) {
      selectTab(next);
      return;
    }
    const left = tab();
    const right = secondaryTab() || (left === "files" ? "diff" : "files");
    if (side === "left") {
      if (next === right) saveSecondaryTab(left);
      selectTab(next);
    } else if (next === left) {
      selectTab(right);
      saveSecondaryTab(left);
    } else {
      saveSecondaryTab(next);
    }
  };
  const focusTabControl = (next: PanelTab, side: "left" | "right" = "left") => {
    const control = panelRoot?.querySelector<HTMLElement>(`[data-pane="${side}"][data-workspace-tab="${next}"]`);
    control?.focus({ preventScroll: true });
  };
  const focusTabDefault = (next: PanelTab, side: "left" | "right" = "left") => {
    if (next === "files") {
      if (!files.directories()[""]) void files.loadDirectory();
      // The filter lives in the file navigator, which a narrow panel folds
      // away; focus on a hidden input goes nowhere, so the open file takes it
      // then, and the tab only when there is none.
      queueMicrotask(() => {
        if (!files.focusDefault()) focusTabControl("files", side);
      });
      return;
    }
    queueMicrotask(() => {
      focusTabControl(next, side);
      if (next === "terminal") setTerminalFocusRequest((request) => request + 1);
    });
  };
  const tabIcon = (candidate: PanelTab) => candidate === "files" ? <FolderIcon />
    : candidate === "diff" ? <GitCompareArrowsIcon />
    : candidate === "chat" ? <MessageSquareIcon />
    : <TerminalIcon />;
  // One strip per pane: the tabs you click always belong to the pane below them,
  // so a split needs no notion of an "active" pane.
  const paneTabs = (side: "left" | "right") => (
    <div class="workspace-panel-tabs-space" ref={(element) => {
      const observer = new ResizeObserver(() => {
        element.removeAttribute("data-icons-only");
        const tabs = element.firstElementChild;
        if (tabs && tabs.scrollWidth > element.clientWidth) element.setAttribute("data-icons-only", "true");
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    }}>
      <div class="workspace-panel-tabs" role="toolbar" aria-label={splitActive() ? `${side === "left" ? "Left" : "Right"} workspace pane views` : "Workspace views"}>
        <For each={PANEL_TABS}>{(item) => {
          const label = () => splitActive() ? `${tabLabel(item)} (${side === "left" ? "left" : "right"} pane)` : tabLabel(item);
          const disabled = () => item === "diff" && !props.sourceControlEnabled();
          return <button type="button" role="tab" data-pane={side} data-workspace-tab={item} disabled={disabled()} aria-label={disabled() ? `${label()}: ${props.onBrowseDirectory ? "open a Git folder" : "unavailable for Chats and managed projects"}` : label()} title={disabled() ? (props.onBrowseDirectory ? "Open a Git folder to use Source Control" : "Source Control is available only for Workspaces") : label()} aria-selected={(side === "left" ? tab() : secondaryTab()) === item} onClick={() => changePaneTab(side, item)}>{tabIcon(item)}<span>{tabLabel(item)}</span></button>;
        }}</For>
      </div>
    </div>
  );
  const changePaneTab = (side: "left" | "right", value: string) => {
    const next = panelTab(value);
    if (!next) return;
    setPaneTab(side, next);
    focusTabDefault(next, side);
  };
  // A key the leader lists must do something here: Source Control only with
  // a repository, the split only while the panel is wide enough to split.
  const workspaceShortcutAvailable = () => !document.querySelector(
    '.command-dialog[data-state="open"], .settings-dialog[data-state="open"], .conduit-modal[data-state="open"], .external-link-dialog[data-state="open"]',
  );
  const selectShortcutTab = (next: PanelTab) => {
    const side = focusedPane();
    setPaneTab(side, next);
    focusTabDefault(next, side);
  };
  const focusWorkspaceSurface = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
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
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceSplit, "workspace-panel", toggleSplit, { when: () => props.expanded() && workspaceShortcutAvailable() }),
  ];
  onCleanup(() => releaseShortcutHandlers.forEach((release) => release()));

  // Moving between views: a file to its review, a review back to the working
  // file, and a comment chip or turn artifact to whichever view shows it.
  const openSourceControlReview = async (scope: DiffScope, path: string) => {
    if (!files.confirmDiscard(path, "Discard unsaved changes and review this file?")) return;
    const side = panePosition("files") ?? focusedPane();
    sourceControl.showReview(scope);
    setPaneTab(side, "diff");
    await sourceControl.refreshReview(path);
  };
  const inspectFileDiff = (path: string, staged: boolean) => void openSourceControlReview(staged ? "staged" : "changes", path);
  const showFileDiff = (slot: FileSlotId, staged: boolean) => {
    const path = files.openPaths()[slot];
    if (path) { files.setFocusedSlot(slot); void openSourceControlReview(staged ? "staged" : "changes", path); }
  };
  const openWorkingFile = (path: string) => {
    const diffSide = panePosition("diff") ?? focusedPane();
    if (!files.openInSlot(files.focusedSlot(), path)) return;
    if (!tabVisible("files")) setPaneTab(diffSide, "files");
    const filesSide = panePosition("files") ?? diffSide;
    queueMicrotask(() => focusTabDefault("files", filesSide));
  };
  const resolveReviewNavigation = (event: Event) => {
    const request = (event as CustomEvent<ReviewNavigationRequest>).detail;
    if (!request || request.chatId !== commentChatId()) return;
    props.onRequestOpen?.();
    setReviewReveal(request);
    if (request.scope === "file") {
      openWorkingFile(request.path);
      return;
    }
    if (request.scope === "changes" || request.scope === "staged" || request.scope === "head") {
      if (!props.sourceControlEnabled()) return reportError("Source control is unavailable for this workspace.");
      void openSourceControlReview(request.scope, request.path);
      return;
    }
    const side = panePosition("chat") ?? focusedPane();
    chat.selectMode("changes");
    setPaneTab(side, "chat");
    chat.review.setScope(request.scope === "session" ? "chat" : "turn");
    void chat.review.refresh(request.path);
  };
  window.addEventListener(REVIEW_NAVIGATION_EVENT, resolveReviewNavigation);
  onCleanup(() => window.removeEventListener(REVIEW_NAVIGATION_EVENT, resolveReviewNavigation));
  const resolveTurnArtifactNavigation = (event: Event) => {
    const request = (event as CustomEvent<TurnArtifactNavigationRequest>).detail;
    if (!request || request.chatId !== props.artifactChatId?.()) return;
    props.onRequestOpen?.();
    const side = panePosition("chat") ?? focusedPane();
    setReviewReveal(null);
    chat.selectMode("changes");
    setPaneTab(side, "chat");
    chat.review.setScope("turn", request.checkpointId);
    void chat.review.refresh(request.path);
  };
  window.addEventListener(TURN_ARTIFACT_NAVIGATION_EVENT, resolveTurnArtifactNavigation);
  onCleanup(() => window.removeEventListener(TURN_ARTIFACT_NAVIGATION_EVENT, resolveTurnArtifactNavigation));

  // The panel takes room from the main pane only down to its minimum.
  const room = () => {
    const main = document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
    if (!main || isMobileLayout()) return Infinity;
    return main.getBoundingClientRect().width + (props.open() ? shellWidth() + shellGap() : 0) - 8 - MIN_MAIN_PANE_WIDTH;
  };
  const clampWidth = (next: number) => Math.max(MIN_WORKSPACE_PANE_WIDTH, Math.min(Math.floor(window.innerWidth * 0.65), room(), next));
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
      dispatchPanelGeometryMotion({ phase: "begin", id, source: "workspace", size: startSize, targetSize, duration: 0 });
      dispatchPanelGeometryMotion({ phase: "end", id, source: "workspace", size: targetSize });
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
      if (!open) requests.reset();
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
    dispatchPanelGeometryMotion({ phase: "begin", id, source: "workspace", size: startWidth + shellGap() });
    const apply = () => {
      frame = 0;
      const nextWidth = clampWidth(pendingWidth);
      // Resize edge is layout truth: shell and surface stay equal every frame so
      // chat-main stays adjacent and the flex slot cannot outgrow the surface.
      batch(() => {
        setWidth(nextWidth);
        setShellWidth(nextWidth);
      });
      dispatchPanelGeometryMotion({ phase: "change", id, source: "workspace", size: nextWidth + shellGap() });
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
      dispatchPanelGeometryMotion({ phase: "end", id, source: "workspace", size: nextWidth + shellGap() });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      resizeHandle?.removeEventListener("lostpointercapture", stop);
      if (resizeHandle?.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      document.body.classList.remove("workspace-resizing");
      panelRoot?.removeAttribute("data-edge-instant");
      panelRoot?.style.removeProperty("transition");
      stopResize = undefined;
    };
    stopResize = stop;
    document.body.classList.add("workspace-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
    resizeHandle?.addEventListener("lostpointercapture", stop, { once: true });
  };
  onCleanup(() => {
    requests.reset();
    stopResize?.();
    splitResizeObserver?.disconnect();
    document.body.classList.remove("workspace-resizing");
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
        setSplitRatio(Math.max(0, Math.min(100, Number(readGeometrySetting("split-ratio")) || 50)));
      }
      setTab(nextTab);
      setSecondaryTab(storedSecondary());
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
    () => [props.projectId(), tab(), secondaryTab(), props.open(), props.expanded(), sourceControl.mode()] as const,
    ([projectId, activeTab, companionTab, open, panelExpanded]) => {
      if (!open) return;
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
      const filesVisible = activeTab === "files" || (panelExpanded && companionTab === "files");
      const diffVisible = activeTab === "diff" || (panelExpanded && companionTab === "diff");
      const chatVisible = activeTab === "chat" || (panelExpanded && companionTab === "chat");
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

  const splitRatioBounds = (hostWidth = splitWidth()) => {
    if (hostWidth <= MIN_WORKSPACE_PANE_WIDTH * 2 + WORKSPACE_SPLIT_GUTTER_WIDTH) {
      const middle = hostWidth > 0
        ? ((hostWidth - WORKSPACE_SPLIT_GUTTER_WIDTH) / 2 / hostWidth) * 100
        : 50;
      return { minimum: middle, maximum: middle };
    }
    return {
      minimum: (MIN_WORKSPACE_PANE_WIDTH / hostWidth) * 100,
      maximum: ((hostWidth - WORKSPACE_SPLIT_GUTTER_WIDTH - MIN_WORKSPACE_PANE_WIDTH) / hostWidth) * 100,
    };
  };
  const clampSplitRatio = (next: number, hostWidth = splitWidth()) => {
    const bounds = splitRatioBounds(hostWidth);
    return Math.max(bounds.minimum, Math.min(bounds.maximum, next));
  };
  const saveSplitRatio = (next: number, hostWidth = splitWidth()) => {
    const value = clampSplitRatio(next, hostWidth);
    setSplitRatio(value);
    writeSetting(projectScope(), "split-ratio", String(value));
  };
  createEffect(() => {
    if (!splitActive() || splitWidth() <= 0) return;
    const value = clampSplitRatio(splitRatio());
    if (Math.abs(value - splitRatio()) > 0.001) saveSplitRatio(value);
  });
  const startSplitResize = (event: PointerEvent) => {
    if (!splitHost) return;
    event.preventDefault();
    const bounds = splitHost.getBoundingClientRect();
    let pending = splitRatio();
    let frame = 0;
    let stopped = false;
    const apply = () => {
      frame = 0;
      setSplitRatio(clampSplitRatio(pending, bounds.width));
    };
    const move = (moveEvent: PointerEvent) => {
      pending = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      saveSplitRatio(pending, bounds.width);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      document.body.classList.remove("workspace-split-resizing");
    };
    document.body.classList.add("workspace-split-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
  };

  return <>
    <Show when={props.open()}>
      <button type="button" class="mobile-panel-backdrop" data-mobile-backdrop="workspace" data-for="workspace" aria-label="Dismiss workspace panel" onClick={props.onClose} />
    </Show>
    <aside ref={panelRoot} class="workspace-panel" data-region="workspace-panel" classList={{ "workspace-panel-open": props.open() || shellWidth() > 0.5, "workspace-panel-expanded": props.expanded() }} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} style={{ "--workspace-panel-width": `${width()}px`, "--workspace-shell-width": `${shellWidth()}px`, width: `${shellWidth()}px`, "margin-right": `${shellGap()}px` }}>
    <div ref={resizeHandle} class="workspace-resize-handle" role="separator" aria-label="Resize workspace panel" aria-orientation="vertical" aria-valuemin={MIN_WORKSPACE_PANE_WIDTH} aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") saveWidth(width() + 16); if (event.key === "ArrowRight") saveWidth(width() - 16); }} />
    <div class="workspace-panel-surface" onPointerDown={focusWorkspaceSurface}>
    <header class="workspace-panel-header" data-split={splitActive() ? "true" : undefined} style={{ "--workspace-split-ratio": `${splitRatio()}%` }}>
      <div class="workspace-pane-strip" data-position="left"><strong title={props.workingRoot()}>Workspace</strong>{paneTabs("left")}</div>
      <div class="workspace-pane-strip" data-position="right">
        <Show when={splitActive()}>{paneTabs("right")}</Show>
        <div class="workspace-panel-header-actions">
          <Show when={props.expanded()}>
            <Button variant="ghost" size="icon-sm" class="workspace-split-toggle" title={splitActive() ? "Close second pane" : "Split into two panes"} aria-label={splitActive() ? "Close second pane" : "Split into two panes"} aria-pressed={splitActive()} onClick={toggleSplit}><Columns2Icon /></Button>
          </Show>
          <Button variant="ghost" size="icon-sm" class="workspace-expand-toggle" title={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-label={props.expanded() ? "Restore split view" : "Expand Workspace"} aria-pressed={props.expanded()} onClick={props.onToggleExpanded}>
            <Show when={props.expanded()} fallback={<Maximize2Icon />}><Minimize2Icon /></Show>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close workspace panel" onClick={props.onClose}><XIcon /></Button>
        </div>
      </div>
    </header>
    <main ref={(element) => {
      splitHost = element;
      splitResizeObserver?.disconnect();
      const updateSplitWidth = (nextWidth: number) => {
        setSplitWidth(nextWidth);
      };
      updateSplitWidth(element.clientWidth);
      splitResizeObserver = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentBoxSize?.[0];
        updateSplitWidth(box ? box.inlineSize : element.clientWidth);
      });
      splitResizeObserver.observe(element);
    }} class="workspace-panel-content" data-split={splitActive()} style={{ "--workspace-split-ratio": `${splitRatio()}%` }}>
    <Show when={props.expanded() && secondaryTab()}>
      <div class="workspace-split-resize-handle" role="separator" aria-label="Resize workspace panes" aria-orientation="vertical" aria-valuemin={Math.round(splitRatioBounds().minimum)} aria-valuemax={Math.round(splitRatioBounds().maximum)} aria-valuenow={Math.round(splitRatio())} tabIndex={0} onPointerDown={startSplitResize} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") saveSplitRatio(splitRatio() - 2);
        else if (event.key === "ArrowRight") saveSplitRatio(splitRatio() + 2);
        else if (event.key === "Home") saveSplitRatio(splitRatioBounds().minimum);
        else if (event.key === "End") saveSplitRatio(splitRatioBounds().maximum);
        else return;
        event.preventDefault();
      }} />
    </Show>
    <Show when={tabVisible("files")}>
      <FilesView control={files} position={panePosition("files")} expanded={props.expanded()} projectId={props.projectId()} workingRoot={props.workingRoot()}
        sourceControlEnabled={props.sourceControlEnabled()} gitFiles={sourceControl.diff()?.files ?? []} commentChatId={commentChatId()} reveal={reviewReveal()}
        stale={poll.stale()} onRetryPoll={poll.retry} onSaved={() => void sourceControl.loadDiff(false, false)} onShowDiff={showFileDiff}
        onBrowseDirectory={props.onBrowseDirectory} onBrowseParent={props.onBrowseParent} />
    </Show>
    <Show when={tabVisible("diff")}>
      <SourceControlView control={sourceControl} position={panePosition("diff")} stale={poll.stale()} onRetryPoll={poll.retry} chatAvailable={Boolean(props.artifactChatId?.())}
        commentChatId={commentChatId()} reveal={reviewReveal()} onInspectFile={inspectFileDiff} onOpenWorkingFile={openWorkingFile} />
    </Show>
    <Show when={tabVisible("chat")}>
      <ChatView control={chat} position={panePosition("chat")} historyAvailable={Boolean(props.historyAvailable?.())} chatId={props.artifactChatId?.() ?? null}
        commentChatId={commentChatId()} reveal={reviewReveal()} onOpenWorkingFile={openWorkingFile} />
    </Show>
    <Show when={tabVisible("terminal")}>
      <TerminalView position={panePosition("terminal")} computer={props.settingsScope?.() === "computer"} projectId={props.projectId()} projectName={props.projectName()}
        workingRoot={props.workingRoot()} terminalId={props.requestedTab?.()?.terminalId} focusRequest={terminalFocusRequest()} connectivity={props.connectivity} />
    </Show>
    </main>
    <Show when={requests.loading()}><div class="workspace-panel-loading"><Spinner /><span>Loading workspace</span></div></Show>
    </div>
  </aside>
  </>;
}
