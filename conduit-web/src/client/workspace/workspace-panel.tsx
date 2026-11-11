import { Icons } from "@/components/ui";
import { Dock, DockDocument, DockSurface, SheetFill, ToolContent, ToolKept, Loading, PaneHeader, Segmented } from "@/components/ui";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { batch, createEffect, createSignal, For, on, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
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
import { cachedWorkspace, cacheWorkspace, createRequestScope, reportError } from "./workspace-shared";
import { createFiles, FileBesideView, FilesView } from "./workspace-files";
import { createSourceControl, SourceControlModes, SourceControlView } from "./workspace-source-control";
import { ChatModes, ChatView, createChatReview } from "./workspace-chat-view";
import { TerminalView } from "./workspace-terminal-view";
import { createWorkspacePoll } from "./workspace-poll";
import type { DirectoryListing, FileSlotId, PanelTab, SplitView, WorkspaceSettings } from "./workspace-types";
import { readToolDrag, TOOL_DRAG_TYPE, WORKSPACE_TOOL_ICONS, WORKSPACE_TOOL_LABELS } from "./workspace-rail";
import type { FileEntry } from "./file-documents";

const PANEL_TABS = ["files", "chat", "terminal", "diff", "jbot"] satisfies PanelTab[];

function panelTab(value: string): PanelTab | null {
  if (value === "artifacts") return "chat";
  return value === "files" || value === "diff" || value === "chat" || value === "terminal" || value === "jbot" ? value : null;
}

// In the unit: its least, its most and its first width; the gap is --space-md, the chat's margin.
const MIN_WORKSPACE_PANE_UNITS = 18.75, MAX_WORKSPACE_PANE_UNITS = 38.75, DEFAULT_WORKSPACE_PANE_UNITS = 26.25, DOCK_GAP_UNITS = 0.5;

export default function WorkspacePanel(props: { connectivity?: () => Connectivity; projectId: Accessor<string>; projectName: Accessor<string>; sourceControlEnabled: Accessor<boolean>; workingRoot: Accessor<string>; chatId: Accessor<string>; artifactChatId?: Accessor<string | null>; commentChatId?: Accessor<string | null>; historyAvailable?: Accessor<boolean>; open: Accessor<boolean>; expanded: Accessor<boolean>; focusRequest: Accessor<number>; onFocusRequestComplete?: () => void; requestedTab?: Accessor<{ tab: PanelTab; terminalId?: string; nonce: number } | null>; onRequestOpen?: () => void; onToggleExpanded: () => void; onClose: () => void; onTabChange?: (tab: PanelTab) => void; splitView?: Accessor<SplitView | null>; splitHost?: Accessor<HTMLElement | undefined>; onOpenBeside?: (view: SplitView) => void; onMoveToDock?: (view: SplitView) => void; onCloseSplit?: (focus?: boolean) => void; bindSplit?: (release: (toDock: boolean) => Promise<boolean>) => () => void; shortcuts: ShortcutManager; onBrowseDirectory?: (path: string) => void; onBrowseParent?: () => void; requestedFile?: Accessor<{ path: string } | null>; settingsScope?: Accessor<string>; initialDirectory?: Accessor<DirectoryListing>; onOpenFile?: (entry: FileEntry, options: { beside: boolean; edit: boolean; reveal?: ReviewNavigationRequest }) => void; openFiles?: Accessor<Map<string, "focused" | "shown">>; documentShown?: Accessor<boolean>; minWidth?: Accessor<number>; widthRequest?: Accessor<{ width: number; nonce: number } | null>; overlay?: Accessor<boolean>; documentHost?: (element: HTMLElement | undefined) => void;
  /** Drawn by the app, which holds its session. It stays in the dock: no Maximise, no moving to a pane. */
  jbotView?: () => JSX.Element }) {
  const { confirm: confirmDialog } = createDecisionScope(props.projectId);
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
  // A view is in the dock or in the main pane's split, never both.
  const inSplit = (candidate: PanelTab) => props.splitView?.() === candidate && Boolean(props.splitHost?.()) && (candidate !== "diff" || props.sourceControlEnabled());
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
  // the split. Leaving asks first when it has an edit.
  createEffect(() => {
    const view = props.splitView?.();
    const path = files.openPaths().secondary;
    if (view !== "file" && path) files.setSlotPath("secondary", null);
    else if (view === "file" && !path) props.onCloseSplit?.(false);
  });
  const releaseFileBeside = async (toDock: boolean) => {
    const path = files.openPaths().secondary;
    if (!path) return true;
    if (files.slotHandles.get("secondary")?.hasUnsavedChanges() && !(await confirmDialog(toDock ? "Discard unsaved changes and move this file to the dock?" : "Discard unsaved changes and close this file?"))) return false;
    if (files.openPaths().secondary !== path) return false;
    if (toDock && !(await files.openInSlot("primary", path))) return false;
    files.slotHandles.get("secondary")?.discardChanges();
    return true;
  };
  const unbindSplit = props.bindSplit?.(releaseFileBeside);
  onCleanup(() => unbindSplit?.());
  const openFileBeside = async (path: string) => {
    if (openFileDocument(path, true, false)) return;
    if (!props.onOpenBeside) return files.openFile(path);
    const previous = files.openPaths().secondary;
    if (previous && previous !== path && !(await files.confirmDiscard(previous, "Discard unsaved changes and open another file?"))) return;
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
  const setPaneTab = (next: PanelTab) => {
    const resolved = next === "diff" && !props.sourceControlEnabled() ? "files" : next;
    if (!inSplit(resolved)) selectTab(resolved);
  };
  const focusSplit = () => queueMicrotask(() => {
    const content = props.splitHost?.()?.querySelector<HTMLElement>(".ui-tool-content");
    focusFirst(content);
    if (!content?.contains(document.activeElement)) content?.focus({ preventScroll: true });
  });
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
  createEffect(() => { if (dockShows("jbot") && props.open()) setJbotKept(true); });
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
    if (inSplit(next)) return focusSplit();
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

  const openSourceControlReview = async (scope: DiffScope, path: string, beside = false) => {
    if (!(await files.confirmDiscard(path, "Discard unsaved changes and review this file?"))) return;
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
  const focusedBeside = () => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const row = focused && (panelRoot?.contains(focused) || props.splitHost?.()?.contains(focused)) ? focused : null;
    if (row?.matches('[role="treeitem"]:not([aria-expanded])') && row.dataset.path) return { kind: "file" as const, path: row.dataset.path };
    if (row?.matches("[data-change-path]")) return { kind: "diff" as const, path: row.dataset.changePath!, staged: row.dataset.staged === "true" };
    return null;
  };
  // A file opens beside wherever the tree offers it (a pane of its own, or the split); a change only into the split.
  const canOpenFocusedBeside = () => {
    const target = focusedBeside();
    return Boolean(target && (props.onOpenBeside || (target.kind === "file" && props.onOpenFile)));
  };
  const openFocusedBeside = () => {
    const target = focusedBeside();
    if (target?.kind === "file") openFileBeside(target.path);
    else if (target) inspectFileDiff(target.path, target.staged, true);
  };
  const openWorkingFile = async (path: string) => {
    if (openFileDocument(path, false, false)) return;
    if (!(await files.openInSlot("primary", path))) return;
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
        pendingWidthCommit = Number(readGeometrySetting("width")) || unitPx(DEFAULT_WORKSPACE_PANE_UNITS);
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
    <PaneHeader kind="tool" fit frost={tool() === "jbot"} draggable={!isMobileLayout() && tool() !== "jbot"}
      onDragStart={(event) => { event.dataTransfer?.setData(TOOL_DRAG_TYPE, JSON.stringify({ tool: tool(), from: where })); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; document.body.dataset.toolDrag = where; }}
      onDragEnd={() => delete document.body.dataset.toolDrag}
      name={viewLabel(tool())} nameTitle={tool() === "file" ? files.openPaths().secondary ?? "" : props.workingRoot()}
      place={where === "dock" && tool() !== "jbot" ? props.projectName() : undefined} placeTitle={props.workingRoot()}
      modes={<>
        <Show when={tool() === "diff" && props.sourceControlEnabled()}><SourceControlModes control={sourceControl} /></Show>
        <Show when={tool() === "chat"}><ChatModes control={chat} historyAvailable={Boolean(props.historyAvailable?.())} /></Show>
      </>}
      views={where === "dock" ? tabStrip() : undefined}
      actions={<Show when={where === "dock"} fallback={<>
          <HeaderButton label="Move to dock" aria-label={`Move ${viewLabel(tool())} to the dock`} icon={<Icons.Workspace />} onClick={() => props.onMoveToDock?.(tool())} />
          <HeaderButton label={`Close ${viewLabel(tool())}`} icon={<Icons.Close />} onClick={() => closeSplitView(tool())} />
        </>}>
          <Show when={props.onOpenBeside && tool() !== "jbot" && !(tool() === "files" && props.onOpenFile)}><HeaderButton only="desktop" label="Move to main pane" aria-label={`Move ${viewLabel(tool())} to the main pane`} icon={<Icons.Split />} onClick={() => props.onOpenBeside?.(tool())} /></Show>
          <Show when={tool() === "terminal"}><HeaderButton label={props.expanded() ? "Restore" : "Maximise"} aria-label={props.expanded() ? "Restore workspace panel" : "Maximise workspace panel"} aria-pressed={props.expanded()} icon={<Show when={props.expanded()} fallback={<Icons.Maximize />}><Icons.Minimize /></Show>} onClick={props.onToggleExpanded} /></Show>
          <HeaderButton label="Close workspace panel" icon={<Icons.Close />} onClick={props.onClose} />
        </Show>} />
  );
  const toolView = (tool: PanelTab, where: "dock" | "split") => tool === "files"
    ? <FilesView control={files} expanded={where === "dock" && props.expanded()} projectId={props.projectId()} workingRoot={props.workingRoot()}
      sourceControlEnabled={props.sourceControlEnabled()} gitFiles={sourceControl.diff()?.files ?? []} commentChatId={commentChatId()} reveal={reviewReveal()}
      stale={poll.stale()} onRetryPoll={poll.retry} onSaved={() => void sourceControl.loadDiff(false, false)} onShowDiff={showFileDiff}
      onOpenBeside={props.onOpenBeside || props.onOpenFile ? openFileBeside : undefined} onBrowseDirectory={props.onBrowseDirectory} onBrowseParent={props.onBrowseParent}
      navigatorOnly={Boolean(props.onOpenFile)} openInPane={props.openFiles ? (path) => props.openFiles!().get(`${props.projectId()}:${path}`) : undefined} />
    : tool === "diff" ? <SourceControlView control={sourceControl} stale={poll.stale()} onRetryPoll={poll.retry} chatAvailable={Boolean(props.artifactChatId?.())}
      commentChatId={commentChatId()} reveal={reviewReveal()} onInspectFile={inspectFileDiff} onOpenWorkingFile={openWorkingFile} />
    : tool === "jbot" ? props.jbotView?.()
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
  const dockDrop = {
    onDragOver: (event: DragEvent) => { if (document.body.dataset.toolDrag === "split" && event.dataTransfer?.types.includes(TOOL_DRAG_TYPE)) event.preventDefault(); },
    onDrop: (event: DragEvent) => { const drag = readToolDrag(event); if (drag?.from === "split") { event.preventDefault(); props.onMoveToDock?.(drag.tool); } },
  };

  return <>
    <Show when={props.open()}>
      <Backdrop layer="panel" label="Dismiss workspace panel" onDismiss={props.onClose} />
    </Show>
    <Dock ref={panelRoot} class="workspace-panel" data-region="workspace-panel" open={props.open() || shellWidth() > 0.5} expanded={props.expanded()} overlay={Boolean(props.overlay?.())} aria-label="Workspace panel" aria-hidden={!props.open()} inert={!props.open()} {...dockDrop} style={{ "--workspace-panel-width": `${width()}px`, "--workspace-shell-width": `${shellWidth()}px`, "--dock-document-width": `${documentWidth()}px`, width: `${shellWidth()}px`, "margin-right": `${shellGap()}px` }}>
    <ResizeEdge kind="pane" dock aria-label="Resize workspace panel" aria-valuemin={minWidth()} aria-valuemax={Math.floor(window.innerWidth * 0.65)} aria-valuenow={width()} startDrag={startResize} onStep={(direction) => saveWidth(width() - 16 * direction)} />
    <DockSurface documented={Boolean(props.documentShown?.())} onPointerDown={focusWorkspaceSurface}>
    {toolHeader(tab, "dock")}
    <ToolContent>
      <For each={PANEL_TABS.filter((tool) => tool !== "jbot")}>{(tool) => <Show when={dockShows(tool)}>{toolView(tool, "dock")}</Show>}</For>
      {/* jbot's stays drawn once opened, its chat where it was: put away and back costs nothing. */}
      <Show when={jbotKept()}><ToolKept shown={dockShows("jbot")}>{toolView("jbot", "dock")}</ToolKept></Show>
    </ToolContent>
    <DockDocument ref={(element) => { props.documentHost?.(element); onCleanup(() => props.documentHost?.(undefined)); }} />
    <Show when={requests.loading()}><Loading kind="pane"><Spinner /><span>Loading workspace</span></Loading></Show>
    </DockSurface>
  </Dock>
    <Show when={props.splitHost?.() && props.splitView?.() && !/^(chat|page|files):/.test(props.splitView()!) && props.splitView()}>{(tool) =>
      <Portal mount={props.splitHost!()!}>
        <SheetFill>
          {toolHeader(tool, "split")}
          <ToolContent>{splitView(tool())}</ToolContent>
        </SheetFill>
      </Portal>
    }</Show>
  </>;
}
