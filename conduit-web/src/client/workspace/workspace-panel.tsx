import { Icons } from "@/components/ui";
import { Dock, DockDocument, DockSurface, ToolContent, ToolKept, Loading, PaneHeader, Segmented } from "@/components/ui";
import { batch, createEffect, createSignal, For, on, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { minMainPaneWidth } from "../layout-geometry";
import { unitPx } from "@/components/ui/layout";

import { Spinner } from "@/components/ui/controls";
import { whenMotionEnds } from "@/components/ui/motion";
import { HeaderButton } from "@/components/ui/header";
import { Backdrop } from "@/components/ui/overlay";
import { ResizeEdge, type EdgeDrag } from "@/components/ui/pane";
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
import { cacheWorkspace, reportError } from "./workspace-shared";
import { createFolderViewer, FolderModes, FolderView } from "./folder-viewer";
import { SourceControlModes } from "./workspace-source-control";
import { ChatModes, ChatView, createChatReview } from "./workspace-chat-view";
import { TerminalView } from "./workspace-terminal-view";
import type { DirectoryListing, PanelTab, SplitView, WorkspaceSettings } from "./workspace-types";
import { WORKSPACE_TOOL_ICONS, WORKSPACE_TOOL_LABELS } from "./workspace-rail";
import type { FileEntry } from "./file-documents";
import type { FileSlotHandle } from "./workspace-file-slot";

const PANEL_TABS = ["files", "chat", "terminal", "diff", "jbot"] satisfies PanelTab[];

function panelTab(value: string): PanelTab | null {
  if (value === "artifacts") return "chat";
  return value === "files" || value === "diff" || value === "chat" || value === "terminal" || value === "jbot" ? value : null;
}

// In the unit: its least, its most and its first width; the gap is --space-md, the chat's margin.
const MIN_WORKSPACE_PANE_UNITS = 18.75, MAX_WORKSPACE_PANE_UNITS = 38.75, DEFAULT_WORKSPACE_PANE_UNITS = 26.25, DOCK_GAP_UNITS = 0.5;

export default function WorkspacePanel(props: { connectivity?: () => Connectivity; projectId: Accessor<string>; projectName: Accessor<string>; sourceControlEnabled: Accessor<boolean>; workingRoot: Accessor<string>; chatId: Accessor<string>; artifactChatId?: Accessor<string | null>; commentChatId?: Accessor<string | null>; historyAvailable?: Accessor<boolean>; open: Accessor<boolean>; expanded: Accessor<boolean>; focusRequest: Accessor<number>; onFocusRequestComplete?: () => void; requestedTab?: Accessor<{ tab: PanelTab; terminalId?: string; nonce: number } | null>; onRequestOpen?: () => void; onToggleExpanded: () => void; onClose: () => void; onTabChange?: (tab: PanelTab) => void; /** The folder viewer or a terminal leaving the dock for a pane of its own. */ onMoveToRow?: (view: SplitView) => void; /** The folder viewer's open file, for the app to hold the dock's workspace while it has an unsaved edit. */ onFileHandle?: (handle: FileSlotHandle | undefined) => void; shortcuts: ShortcutManager; onBrowseDirectory?: (path: string) => void; onBrowseParent?: () => void; requestedFile?: Accessor<{ path: string } | null>; settingsScope?: Accessor<string>; initialDirectory?: Accessor<DirectoryListing>; onOpenFile?: (entry: FileEntry, options: { beside: boolean; edit: boolean; reveal?: ReviewNavigationRequest; adopt?: boolean }) => void; openFiles?: Accessor<Map<string, "focused" | "shown">>; documentShown?: Accessor<boolean>; minWidth?: Accessor<number>; widthRequest?: Accessor<{ width: number; nonce: number } | null>; overlay?: Accessor<boolean>; documentHost?: (element: HTMLElement | undefined) => void;
  /** Drawn by the app, which holds its session. It stays in the dock: no Maximise, no moving to a pane. */
  jbotView?: () => JSX.Element }) {
  let panelRoot: HTMLElement | undefined;
  let panelMotionId = 0;
  let mobileReturnFocus: HTMLElement | null = null;
  let mobileWasOpen = false;
  const panelScope = () => WORKSPACE_PANEL_GLOBAL_SCOPE;
  const projectScope = () => WORKSPACE_PANEL_GLOBAL_SCOPE;
  const fileScope = () => props.settingsScope ? props.projectId() : props.chatId();
  const readPanelSetting = (name: string) => readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, name);
  const readGeometrySetting = readPanelSetting;
  const settings: WorkspaceSettings = { panel: readPanelSetting, geometry: readGeometrySetting, fileScope };
  const storedTab = () => {
    const value = readPanelSetting("tab") || "";
    return panelTab(value) ?? "files";
  };
  const [tab, setTab] = createSignal<PanelTab>(storedTab());
  const [reviewReveal, setReviewReveal] = createSignal<ReviewNavigationRequest | null>(null);
  const [width, setWidth] = createSignal(Math.max(unitPx(MIN_WORKSPACE_PANE_UNITS), Math.min(unitPx(MAX_WORKSPACE_PANE_UNITS), Number(readGeometrySetting("width")) || unitPx(DEFAULT_WORKSPACE_PANE_UNITS))));
  const [shellWidth, setShellWidth] = createSignal(props.open() ? width() : 0);
  const [shellGap, setShellGap] = createSignal(props.open() && !isMobileLayout() ? unitPx(DOCK_GAP_UNITS) : 0);
  // A pane's document in the dock keeps the width it is open at while the dock's width eases:
  // a transcript re-laid out at each frame's width drops frames.
  const [documentWidth, setDocumentWidth] = createSignal(shellWidth());
  createEffect(() => { const next = shellWidth(); if (next > 0.5) setDocumentWidth(next); });
  const [terminalFocusRequest, setTerminalFocusRequest] = createSignal(0);
  // Review comments ride the composer, which a dashboard has before its chat
  // exists, so they follow the loaded chat rather than the panel's own scope.
  const commentChatId = () => props.commentChatId?.() ?? props.artifactChatId?.() ?? null;

  const tabVisible = (candidate: PanelTab) => (candidate !== "diff" || props.sourceControlEnabled()) && tab() === candidate;
  const shown = (candidate: PanelTab) => props.open() && tabVisible(candidate);

  const viewer = createFolderViewer({ projectId: props.projectId, sourceControlEnabled: props.sourceControlEnabled, chatId: () => props.artifactChatId?.() ?? null, settings, settingsScope: panelScope(),
    mode: () => tab() === "diff" ? "changes" : "files", setMode: (mode) => setPaneTab(mode === "changes" ? "diff" : "files"),
    shown: () => shown("files") || shown("diff"), initialDirectory: props.initialDirectory });
  const { files, sourceControl, requests } = viewer;
  createEffect(() => {
    if (props.sourceControlEnabled()) return;
    if (tab() === "diff") setTab("files");
  });
  const chat = createChatReview({ projectId: props.projectId, chatId: () => props.artifactChatId?.() ?? null, historyAvailable: () => Boolean(props.historyAvailable?.()),
    visible: () => shown("chat"), gitFiles: () => sourceControl.diff()?.files ?? [], settings, settingsScope: panelScope() });
  createEffect(on(() => [props.projectId(), shown("chat")] as const, ([, visible]) => { if (visible && chat.mode() === "history") void chat.loadHistory(); }));
  const openFileDocument = (path: string, beside: boolean, edit: boolean, reveal?: ReviewNavigationRequest, mode?: FileEntry["mode"]) => {
    if (!props.onOpenFile) return false;
    props.onOpenFile({ projectId: props.projectId(), path, ...(mode ? { mode } : {}) }, { beside, edit, reveal });
    return true;
  };
  // Without room for a pane of its own (a phone, a narrow window) it opens in the viewer.
  const openDocument = (path: string, mode?: FileEntry["mode"]) => {
    if (!openFileDocument(path, true, false, undefined, mode)) void (mode ? viewer.review(mode, path) : files.openFile(path));
  };

  let panelWasOpen = false;
  const animatePanelGeometry = (open: boolean) => {
    const mobile = isMobileLayout();
    // A width saved while there was more room opens at what fits now.
    const targetWidth = open ? (mobile ? width() : clampWidth(width())) : 0;
    const targetGap = open && !mobile ? unitPx(DOCK_GAP_UNITS) : 0;
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
  const setPaneTab = (next: PanelTab) => selectTab(next === "diff" && !props.sourceControlEnabled() ? "files" : next);
  const focusTabControl = (next: PanelTab) => {
    const control = panelRoot?.querySelectorAll<HTMLElement>('[aria-label="Workspace views"] > button')[PANEL_TABS.filter((item) => item !== "jbot").indexOf(next as never)];
    // On a desktop the rail stands in for the tabs, so focus lands in the
    // view, or on the view itself while it has nothing to focus yet.
    if (control?.getClientRects().length) return control.focus({ preventScroll: true });
    const content = panelRoot?.querySelector<HTMLElement>(".ui-tool-content");
    focusFirst(content);
    if (!content?.contains(document.activeElement)) content?.focus({ preventScroll: true });
  };
  const focusTabDefault = (next: PanelTab) => {
    // jbot's: its composer, as a chat's pane is entered, never its first message.
    if (next === "jbot") {
      queueMicrotask(() => {
        const field = panelRoot?.querySelector<HTMLElement>(".ui-tool-kept[data-shown] :is(textarea, [contenteditable='true'])");
        if (field) field.focus({ preventScroll: true });
        else panelRoot?.querySelector<HTMLElement>(".ui-tool-content")?.focus({ preventScroll: true });
      });
      return;
    }
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
  const [jbotKept, setJbotKept] = createSignal(false);
  createEffect(() => { if (tabVisible("jbot") && props.open()) setJbotKept(true); });
  // The folder viewer stays drawn once shown, so a summon or another tool over it keeps its open file's edit.
  const [folderKept, setFolderKept] = createSignal(false);
  createEffect(() => { if (tabVisible("files") || tabVisible("diff")) setFolderKept(true); });
  const tabIcon = (candidate: PanelTab) => { const Icon = WORKSPACE_TOOL_ICONS[candidate]; return <Icon />; };
  // A phone has no rail, so its header keeps a strip of the views.
  const [viewIconsOnly, setViewIconsOnly] = createSignal(false);
  const tabStrip = () => (
    <div data-only="phone" ref={(element) => {
      const observer = new ResizeObserver(() => {
        setViewIconsOnly(false);
        const views = element.firstElementChild;
        if (views && views.scrollWidth > element.clientWidth) setViewIconsOnly(true);
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    }}>
      <Segmented label="Workspace views" icons={viewIconsOnly()} value={tab()} onChange={changePaneTab}
        options={PANEL_TABS.filter((item) => item !== "jbot").map((item) => {
          const disabled = item === "diff" && !props.sourceControlEnabled();
          return { value: item, label: tabLabel(item), icon: tabIcon(item), disabled,
            title: disabled ? (props.onBrowseDirectory ? "Open a Git folder to use Source Control" : "Source Control is available only for Workspaces") : tabLabel(item) };
        })} />
    </div>
  );
  const changePaneTab = (next: PanelTab) => {
    setPaneTab(next);
    focusTabDefault(next);
  };
  const workspaceShortcutAvailable = () => !document.querySelector(
    '[role="dialog"][data-state="open"]',
  );
  const selectShortcutTab = (next: PanelTab) => {
    setPaneTab(next);
    focusTabDefault(next);
  };
  const focusWorkspaceSurface = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    // A document in the dock (a docked pane, jbot's chat) takes its clicks as a pane does: the focus lands where the
    // click did, not on its first control (jbot's oldest message, scrolled to the top to show it).
    if (target?.closest(".ui-dock-document, .ui-tool-kept")) return;
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
    props.shortcuts.registerHandler(COMMAND_IDS.workspaceOpenBeside, "workspace-panel", () => openFocusedBeside(), { when: () => canOpenFocusedBeside() && workspaceShortcutAvailable() }),
  ];
  onCleanup(() => releaseShortcutHandlers.forEach((release) => release()));

  const openSourceControlReview = async (scope: DiffScope, path: string) => {
    props.onRequestOpen?.();
    await viewer.review(scope, path);
  };
  const focusedBeside = () => {
    const focused = document.activeElement instanceof HTMLElement && panelRoot?.contains(document.activeElement) ? document.activeElement : null;
    if (focused?.matches('[role="treeitem"]:not([aria-expanded])') && focused.dataset.path) return { path: focused.dataset.path };
    if (focused?.matches("[data-change-path]")) return { path: focused.dataset.changePath!, mode: focused.dataset.staged === "true" ? "staged" as const : "changes" as const };
    return null;
  };
  const canOpenFocusedBeside = () => Boolean(focusedBeside());
  const openFocusedBeside = () => { const target = focusedBeside(); if (target) openDocument(target.path, target.mode); };
  const openWorkingFile = async (path: string) => {
    props.onRequestOpen?.();
    await viewer.openWorking(path);
    queueMicrotask(() => focusTabDefault("files"));
  };
  const resolveReviewNavigation = (event: Event) => {
    const request = (event as CustomEvent<ReviewNavigationRequest>).detail;
    if (!request || request.chatId !== commentChatId()) return;
    // A file's comment goes to a pane's file viewer, which needs no dock.
    if (!(request.scope === "file" && props.onOpenFile)) props.onRequestOpen?.();
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
    props.onRequestOpen?.();
    setReviewReveal(null);
    chat.selectMode("changes");
    setPaneTab("chat");
    chat.review.setScope("turn", request.checkpointId);
    void chat.review.refresh(request.path);
  };
  window.addEventListener(TURN_ARTIFACT_NAVIGATION_EVENT, resolveTurnArtifactNavigation);
  onCleanup(() => window.removeEventListener(TURN_ARTIFACT_NAVIGATION_EVENT, resolveTurnArtifactNavigation));

  // Over the panes, the dock takes no room from them, so nothing beneath it moves.
  // Asked when a motion begins and held for all of it, or a dock going over the panes mid-drag drops the motion's end
  // and the transcript keeps the width it pinned for it.
  const begun = new Set<number>();
  const panelMotion = (detail: Parameters<typeof dispatchPanelGeometryMotion>[0]) => {
    if (detail.phase === "begin" ? props.overlay?.() : !begun.has(detail.id)) return;
    if (detail.phase === "begin") begun.add(detail.id); else if (detail.phase === "end") begun.delete(detail.id);
    dispatchPanelGeometryMotion(detail);
  };
  const room = () => {
    if (props.overlay?.()) return Infinity;
    const main = document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
    if (!main || isMobileLayout()) return Infinity;
    const panes = [...document.querySelectorAll<HTMLElement>(".chat-main, [data-pane-slot]")];
    const slack = panes.reduce((sum, pane) => sum + pane.getBoundingClientRect().width - (parseFloat(getComputedStyle(pane).minWidth) || minMainPaneWidth()), 0);
    return slack + (props.open() ? shellWidth() + shellGap() : 0) - unitPx(DOCK_GAP_UNITS);
  };
  const minWidth = () => props.minWidth?.() ?? unitPx(MIN_WORKSPACE_PANE_UNITS);
  const clampWidth = (next: number) => Math.max(minWidth(), Math.min(Math.floor(window.innerWidth * 0.65), room(), next));
  createEffect(on(minWidth, () => { if (props.open()) animatePanelGeometry(true); }, { defer: true }));
  // Switching between beside and over the panes changes only the dock's layer:
  // it holds its size and place on top while its room in the row eases away
  // (or back), and the panes slide under it, as they do into a closed pane's.
  let stopSwitchWait = () => {};
  createEffect(on(() => Boolean(props.overlay?.()), () => {
    if (!panelRoot) return;
    panelRoot.dataset.layerSwitch = "true";
    stopSwitchWait();
    stopSwitchWait = whenMotionEnds(panelRoot, "width", "--duration-fold", () => { if (panelRoot) delete panelRoot.dataset.layerSwitch; });
  }, { defer: true }));
  onCleanup(() => stopSwitchWait());
  createEffect(on(() => props.widthRequest?.(), (request) => { if (request) queueMicrotask(() => commitWidth(request.width)); }, { defer: true }));
  // The transcript learns its own width only from geometry motion, so a commit that lands in one step
  // (keyboard resize, the project-change reset) announces itself too.
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
      // conventions-ok: mints the motion's id, which panelMotion carries to the transcript
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
      queueMicrotask(() => restoreFocus(previous, ["textarea[data-composer-input]", 'button[aria-label="Toggle workspace panel"]', 'button[aria-label="Toggle Sidebar"]']));
    }
    mobileWasOpen = open;
  });
  const startResize = (_event: PointerEvent, stop: () => void): EdgeDrag | undefined => {
    if (isMobileLayout()) return;
    const startWidth = width();
    let pendingWidth = startWidth;
    // conventions-ok: mints the motion's id, which panelMotion carries to the transcript
    const id = ++panelMotionId;
    // Open/close uses CSS width transition; resize must not, or the shell lags
    // the pointer and the gutter/transcript fight the ease.
    panelRoot?.setAttribute("data-edge-instant", "true");
    if (panelRoot) panelRoot.style.transition = "none";
    panelMotion({ phase: "begin", id, source: "workspace", size: startWidth + shellGap() });
    // Resize edge is layout truth: shell and surface stay equal every frame so
    // chat-main stays adjacent and the flex slot cannot outgrow the surface.
    const apply = (nextWidth: number) => batch(() => {
      setWidth(nextWidth);
      setShellWidth(nextWidth);
    });
    stopResize = stop;
    return {
      move: (dx) => {
        pendingWidth = startWidth - dx;
        const nextWidth = clampWidth(pendingWidth);
        apply(nextWidth);
        panelMotion({ phase: "change", id, source: "workspace", size: nextWidth + shellGap() });
      },
      end: () => {
        const nextWidth = clampWidth(pendingWidth);
        apply(nextWidth);
        writeSetting(projectScope(), "width", String(nextWidth));
        panelMotion({ phase: "end", id, source: "workspace", size: nextWidth + shellGap() });
        panelRoot?.removeAttribute("data-edge-instant");
        panelRoot?.style.removeProperty("transition");
        stopResize = undefined;
      },
    };
  };
  onCleanup(() => {
    requests.reset();
    stopResize?.();
  });

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
        pendingWidthCommit = Number(readGeometrySetting("width")) || unitPx(DEFAULT_WORKSPACE_PANE_UNITS);
        files.restoreGeometry();
      }
      setTab(nextTab);
      files.restoreOpenFiles();
    });
    if (pendingWidthCommit != null) commitWidth(pendingWidthCommit);
  }));
  createEffect(on(() => props.requestedTab?.(), (next) => {
    // Summoning Files brings the folder viewer back in the mode it was left in.
    if (next) selectShortcutTab(next.tab === "files" && tab() === "diff" ? "diff" : next.tab);
  }));
  createEffect(on(() => props.focusRequest(), (request, previous) => {
    if (request && request !== previous && props.open()) {
      focusTabDefault(tab());
      queueMicrotask(() => {
        if (panelRoot?.contains(document.activeElement)) props.onFocusRequestComplete?.();
      });
    }
  }));
  createEffect(on(() => props.initialDirectory?.(), (listing) => {
    if (!listing) return;
    files.setDirectories((current) => ({ ...current, "": listing }));
    cacheWorkspace(props.projectId(), { directories: files.directories() });
  }));

  createEffect(on(() => [props.projectId(), props.requestedFile?.(), props.open()] as const, ([, file, open]) => {
    if (file && open) void viewer.openWorking(file.path);
  }));

  const folder = (tool: PanelTab) => tool === "files" || tool === "diff";
  // A terminal's controls are drawn into its tool header, so it is one row.
  const [termSlot, setTermSlot] = createSignal<HTMLElement>();
  const toolHeader = (tool: Accessor<PanelTab>) => (
    <PaneHeader kind="tool" fit frost={tool() === "jbot"} draggable={!isMobileLayout() && folder(tool()) && Boolean(props.onMoveToRow)} data-doc-view={folder(tool()) ? `folder:${props.projectId()}` : undefined}
      name={!isMobileLayout() && folder(tool()) ? "Files" : tabLabel(tool())} nameTitle={props.workingRoot()}
      place={tool() !== "jbot" ? props.projectName() : undefined} placeTitle={props.workingRoot()}
      modes={<>
        <Show when={!isMobileLayout() && folder(tool())}><FolderModes viewer={viewer} sourceControlEnabled={props.sourceControlEnabled()} /></Show>
        <Show when={isMobileLayout() && tool() === "diff" && props.sourceControlEnabled()}><SourceControlModes control={sourceControl} /></Show>
        <Show when={tool() === "chat"}><ChatModes control={chat} historyAvailable={Boolean(props.historyAvailable?.())} /></Show>
      </>}
      views={tabStrip()}
      actions={<>
        <Show when={tool() === "terminal"}><span ref={(element) => { element.style.display = "contents"; setTermSlot(element); }} /></Show>
        <Show when={props.onMoveToRow && folder(tool())}><HeaderButton only="desktop" label="Move to a pane" aria-label="Move Files to a pane" icon={<Icons.Split />} onClick={() => props.onMoveToRow?.(`folder:${props.projectId()}`)} /></Show>
        <Show when={tool() === "terminal"}><HeaderButton label={props.expanded() ? "Restore" : "Maximise"} aria-label={props.expanded() ? "Restore workspace panel" : "Maximise workspace panel"} aria-pressed={props.expanded()} icon={<Show when={props.expanded()} fallback={<Icons.Maximize />}><Icons.Minimize /></Show>} onClick={props.onToggleExpanded} /></Show>
        <HeaderButton label="Close workspace panel" icon={<Icons.Close />} onClick={props.onClose} />
      </>} />
  );
  const toolView = (tool: PanelTab) => folder(tool)
    ? <FolderView viewer={viewer} expanded={props.expanded()} projectId={props.projectId()} workingRoot={props.workingRoot()} sourceControlEnabled={props.sourceControlEnabled()}
      commentChatId={commentChatId()} chatAvailable={Boolean(props.artifactChatId?.())} reveal={reviewReveal()} onOpenDocument={openDocument}
      onOpenAs={props.onOpenFile ? (path) => void props.onOpenFile!({ projectId: props.projectId(), path }, { beside: false, edit: false, adopt: true }) : undefined}
      onBrowseDirectory={props.onBrowseDirectory} onBrowseParent={props.onBrowseParent} openInPane={props.openFiles ? (path) => props.openFiles!().get(`${props.projectId()}:${path}`) : undefined} onHandle={props.onFileHandle} />
    : tool === "jbot" ? props.jbotView?.()
    : tool === "chat" ? <ChatView control={chat} historyAvailable={Boolean(props.historyAvailable?.())} chatId={props.artifactChatId?.() ?? null}
      commentChatId={commentChatId()} reveal={reviewReveal()} onOpenWorkingFile={openWorkingFile} />
    : <TerminalView computer={props.settingsScope?.() === "computer"} projectId={props.projectId()} projectName={props.projectName()}
      workingRoot={props.workingRoot()} terminalId={props.requestedTab?.()?.terminalId} focusRequest={terminalFocusRequest()} connectivity={props.connectivity}
      onOpenBeside={props.onMoveToRow ? (id) => props.onMoveToRow!(`term:${id}`) : undefined} controls={termSlot()} />;

  return <>
    <Show when={props.open()}>
      <Backdrop layer="panel" label="Dismiss workspace panel" onDismiss={props.onClose} />
    </Show>
    <Dock ref={panelRoot} class="workspace-panel" data-region="workspace-panel" open={props.open() || shellWidth() > 0.5} expanded={props.expanded()} overlay={Boolean(props.overlay?.())} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} style={{ "--workspace-panel-width": `${width()}px`, "--workspace-shell-width": `${shellWidth()}px`, "--dock-document-width": `${documentWidth()}px`, width: `${shellWidth()}px`, "margin-right": `${shellGap()}px` }}>
    <ResizeEdge kind="pane" dock aria-label="Resize workspace panel" aria-valuemin={minWidth()} aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} startDrag={startResize} onStep={(direction) => saveWidth(width() - 16 * direction)} />
    <DockSurface documented={Boolean(props.documentShown?.())} onPointerDown={focusWorkspaceSurface}>
    {toolHeader(tab)}
    <ToolContent>
      <Show when={folderKept()}><ToolKept shown={tabVisible("files") || tabVisible("diff")}>{toolView("files")}</ToolKept></Show>
      <For each={["chat", "terminal"] as const}>{(tool) => <Show when={tabVisible(tool)}>{toolView(tool)}</Show>}</For>
      {/* jbot's stays drawn once opened, its chat where it was: put away and back costs nothing. */}
      <Show when={jbotKept()}><ToolKept shown={tabVisible("jbot")}>{toolView("jbot")}</ToolKept></Show>
    </ToolContent>
    <DockDocument ref={(element) => { props.documentHost?.(element); onCleanup(() => props.documentHost?.(undefined)); }} />
    <Show when={requests.loading()}><Loading kind="pane"><Spinner /><span>Loading workspace</span></Loading></Show>
    </DockSurface>
  </Dock>
  </>;
}
