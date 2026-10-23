import { reducedMotion } from "@/components/ui/motion";
import { harnessMarkLabelFor } from "../harness-brand";
import { HarnessMark, ThreadHarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Section as DialogSection, Item as DialogItem } from "@/components/ui/popover";
import { CardActions, CardForm, CardBody, CardRead, CardNote } from "@/components/ui/card";
import { Button as DialogButton, Input as DialogInput, Field as DialogField } from "@/components/ui/controls";
import { Backdrop, Button, NavBrand, NavLead, NavFolder, NavFolderRow, NavGroup, NavNote, NavNotice, NavPane, NavRail, NavRailSection, NavRow, NavSkeleton, PillSwitch, RailButton, Segmented, StatusDot } from "@/components/ui";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuRow, MenuSection } from "@/components/menus";
import { isConduitManagedProject } from "./sidebar-preferences";
import { ServerSwitcher } from "./server-switcher";
import { batch, createEffect, createMemo, createSignal, For, lazy, onCleanup, onMount, Show, type JSX } from "solid-js";


import type { ChatSummary, ComputerLocation, HarnessSummary, Project, RuntimeProcess, WorkspacePolicy, WorkspaceSuggestion } from "../api/contracts";
import type { UpdateState } from "../main";
import { androidShell, desktopShell, installedClientKind } from "../platform/installed-client";
import { makeFolderAvailable, pairingWith } from "../platform/this-computer";
import { BrowserMachine } from "@/components/ui/browser";
import { PaneEmpty } from "@/components/ui/pane";
import { api } from "../api/client";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import { ChatMenuItems, MoveTo, PlaceMenuItems } from "./item-menus";
import { PlaceGlyph } from "../chat/place-picker";
import type { Pty } from "../remotes/terminal-pane";
import type { RuntimeStore } from "../state/runtime";
import { focusFirst, isMobileLayout, MOBILE_LAYOUT_QUERY, restoreFocus } from "./mobile-layout";
import { ProjectActivityIndicator, RuntimeIndicator } from "./runtime-indicator";
import { dispatchPanelGeometryMotion } from "../panel-motion";
import { compareChatsBySort, sortChats, useChatSort } from "../preferences/chat-sort";
import { publishUiPreference, UI_PREFERENCE_CHANGE_EVENT } from "../preferences/ui-preferences";
import { COMMAND_IDS, commandLabel } from "../commands/command-registry";
import { harnessStatusLabel } from "../harness-brand";
import { installSidebarCursor } from "./sidebar-cursor";

const ComputerExplorer = lazy(() => import("../dashboard/computer-dashboard").then((module) => ({ default: module.ComputerExplorer })));

type WorkspaceMode = "linked" | "created" | "cloned";
type SidebarArea = "conduit" | "computer";
/** The machine choice that makes a folder of this computer available first (the desktop app only). */
const THIS_COMPUTER = "this-computer";
type ProjectInput = { mode: string; name?: string; path?: string; nodeId?: string; directoryName?: string; cloneUrl?: string; cloneParentPath?: string; cloneDirectoryName?: string };
type WorkspacePreview = { key: string; path: string; ownership: string };
export type ChatTarget = { chat: ChatSummary; project: Project };
export type SidebarCommand = {
  type: string;
  nonce: number;
  chat?: ChatSummary;
  project?: Project;
  terminal?: Pty;
  path?: string;
};
type PinnedItem = { ref: string; type: "chat"; chat: ChatSummary; project: Project }
  | { ref: string; type: "project"; project: Project }
  | { ref: string; type: "terminal"; terminal: Pty };
type DeleteTarget = { type: "chat"; chat: ChatSummary; project: Project }
  | { type: "project"; project: Project }
  | { type: "terminal"; terminal: Pty }
  | { type: "chats"; targets: ChatTarget[] };
const COLLAPSED_PROJECTS_KEY = "conduit.sidebar.collapsed-projects";

/**
 * What the app is doing about its own version.
 *
 * Nothing at all when there is nothing to say: an empty row would be one more
 * thing between the list and the server it belongs to. "Ready" is the only
 * state carrying an action, because it is the only one waiting on a person.
 */
function UpdateNotice(props: { state?: UpdateState; onTake?: () => void }) {
  const state = () => props.state ?? { kind: "idle" as const };
  const words = () => {
    const current = state();
    if (current.kind === "checking") return "Checking for updates…";
    if (current.kind === "current") return "Conduit is up to date";
    if (current.kind === "updated") return "Conduit updated";
    if (current.kind === "ready") return "New version ready";
    return current.kind === "working" ? current.label : "";
  };
  return <Show when={state().kind !== "idle"}>
    <NavNotice ready={state().kind === "ready"} busy={state().kind === "checking" || state().kind === "working"} icon={state().kind === "ready" ? <Icons.Download /> : <Icons.Check />}
      action={state().kind === "ready" ? { label: androidShell ? "Install" : "Restart", onClick: () => props.onTake?.() } : undefined}>{words()}</NavNotice>
  </Show>;
}


function SidebarChatTitle(props: { title: string; animate: boolean }) {
  let element!: HTMLSpanElement;
  let animation: Animation | undefined;
  onMount(() => {
    if (!props.animate || reducedMotion()) return;
    animation = element.animate([
      { clipPath: "inset(0 100% 0 0)" },
      { clipPath: "inset(0 0 0 0)" },
    ], {
      duration: Math.min(1400, Math.max(360, props.title.length * 38)),
      easing: `steps(${Math.max(1, props.title.length)}, end)`,
    });
  });
  onCleanup(() => animation?.cancel());
  return <span ref={element}>{props.title}</span>;
}

function storedCollapsedProjects(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_PROJECTS_KEY) || "[]");
    return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function Sidebar(props: {
  projects: Project[];
  catalogueLoaded: boolean;
  projectId: string;
  selectedId: string | null;
  /** With two chats side by side: the one with the keyboard, current in place of the selection, and the other, marked open. */
  focusedId?: string | null;
  openIds?: string[];
  /** Open a chat beside the main pane's (Alt+click, or its menu); absent where there is no split. */
  onOpenChatBeside?: (chat: ChatSummary, project: Project) => void;
  navigatingId?: string | null;
  dashboard: boolean;
  project: boolean;
  computer: boolean;
  terminal: boolean;
  runtime: RuntimeStore;
  connectivity: string;
  workspaceSuggestions: WorkspaceSuggestion[];
  workspacePolicy: WorkspacePolicy | null;
  onWorkspaceSuggestionsNeeded: () => void;
  onNewChat: (project: Project) => Promise<void>;
  onPrefetchChat: (chat: ChatSummary) => void;
  onOpenChat: (chat: ChatSummary, project: Project) => Promise<void>;
  onOpenProject: (project: Project) => Promise<void>;
  onOpenProjectMaximized: (project: Project) => void;
  onAddProject: (input: ProjectInput) => Promise<boolean>;
  onRenameChat: (chat: ChatSummary, project: Project, name: string) => Promise<boolean>;
  onRenameProject: (project: Project, name: string) => Promise<boolean>;
  onMoveChat: (chat: ChatSummary, source: Project, target: Project) => Promise<void>;
  onMoveChats: (targets: ChatTarget[], destination: Project) => Promise<string[]>;
  onMoveProjectChats: (source: Project, target: Project) => Promise<void>;
  onCopyTranscript: (chat: ChatSummary) => Promise<void>;
  onCopyChatLinks: (targets: ChatTarget[]) => Promise<boolean>;
  onDeleteChat: (chat: ChatSummary, project: Project) => Promise<void>;
  onDeleteChats: (targets: ChatTarget[]) => Promise<string[]>;
  onDeleteProject: (project: Project) => Promise<void>;
  onStopProcess: (chat: ChatSummary) => Promise<void>;
  onOpenTerminal: (chat: ChatSummary, project: Project) => void;
  onOpenPty: (terminal: Pty) => void;
  onOpenDashboard: () => void;
  onOpenComputer: () => void;
  onOpenHarness: (id: string) => void;
  selectedHarness?: string;
  // A file or tool covers pane A: its route stays selected but is not shown.
  routeCovered?: boolean;
  onOpenTerminalView: () => void;
  onOpenWorkspaceIdentity: (project: Project) => void;
  onOpenSettings: (section?: string, workspaceId?: string | null) => void;
  onOpenPalette: (page?: string | null, initialQuery?: string | null) => void;
  /** Esc from the top of the sidebar: back to the main pane. */
  onFocusMainPane: () => void;
  /** A page opened from the sidebar is entered: its composer, else the pane. */
  onEnterMainPane: () => void;
  onUpdatePwa: () => void;
  pwaUpdating: boolean;
  updateState?: UpdateState;
  onTakeUpdate?: () => void;
  onAddServer?: () => void;
  onLogout?: () => void;
  sidebarPins: string[];
  onTogglePin: (type: PinnedItem["type"], id: string) => Promise<void>;
  chatLimit: number;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  command?: SidebarCommand | null;
}) {
  const [collapsed, setCollapsed] = createSignal(localStorage.getItem("conduit.sidebar") === "collapsed");
  const [visualCollapsed, setVisualCollapsed] = createSignal(collapsed());
  // The edge moves at once (reduced motion, a preference from elsewhere) instead of with the panel's motion.
  const [instant, setInstant] = createSignal(false);
  const paneWidth = () => sidebarRoot?.getBoundingClientRect().width ?? 0;
  const [collapsedProjectIds, setCollapsedProjectIds] = createSignal(storedCollapsedProjects());
  const [selectedChatIds, setSelectedChatIds] = createSignal<Set<string>>(new Set());
  const [terminals, setTerminals] = createSignal<Pty[]>([]);
  const [harnesses, setHarnesses] = createSignal<HarnessSummary[]>([]);
  const [activityClock, setActivityClock] = createSignal(Date.now());
  const [newKind, setNewKind] = createSignal<"folder" | "workspace" | null>(null);
  const [area, setArea] = createSignal<SidebarArea>(props.computer || props.terminal ? "computer" : "conduit");
  let sidebarRoot: HTMLElement | undefined;
  let sidebarList: HTMLDivElement | undefined;
  let sidebarMotionId = 0;
  let sidebarEdgeMotionId: number | null = null;
  let sidebarEdgeRaf = 0;
  let finishSidebarMotion: (() => void) | null = null;
  let publishingSidebarPreference = false;
  let mobileReturnFocus: HTMLElement | null = null;
  let mobileWasOpen = false;
  const cancelSidebarEdgeMotion = () => {
    if (sidebarEdgeRaf) {
      cancelAnimationFrame(sidebarEdgeRaf);
      sidebarEdgeRaf = 0;
    }
    const id = sidebarEdgeMotionId;
    sidebarEdgeMotionId = null;
    finishSidebarMotion = null;
    setInstant(false);
    if (id != null) dispatchPanelGeometryMotion({ phase: "end", id, source: "sidebar", size: paneWidth() });
  };
  const publishSidebarPreference = (value: boolean) => {
    localStorage.setItem("conduit.sidebar", value ? "collapsed" : "expanded");
    publishingSidebarPreference = true;
    try {
      publishUiPreference("sidebarCollapsed", value);
    } finally {
      publishingSidebarPreference = false;
    }
  };
  const toggleSidebar = () => {
    const nextCollapsed = !collapsed();
    const startWidth = paneWidth();
    cancelSidebarEdgeMotion();
    publishSidebarPreference(nextCollapsed);
    if (isMobileLayout()) {
      batch(() => {
        setCollapsed(nextCollapsed);
        setVisualCollapsed(nextCollapsed);
      });
      return;
    }
    if (!sidebarRoot || reducedMotion()) {
      batch(() => {
        setInstant(true);
        setCollapsed(nextCollapsed);
        setVisualCollapsed(nextCollapsed);
      });
      requestAnimationFrame(() => setInstant(false));
      return;
    }
    const id = ++sidebarMotionId;
    sidebarEdgeMotionId = id;
    // Keep the v0.4.7 sidebar contract: the real shell follows its CSS width
    // transition, while the transcript motion shell tracks that edge once per
    // display frame. This keeps the composer in the same geometry path.
    dispatchPanelGeometryMotion({
      phase: "begin",
      id,
      source: "sidebar",
      size: startWidth,
    });
    batch(() => {
      setCollapsed(nextCollapsed);
      if (!nextCollapsed) setVisualCollapsed(false);
    });
    const sampleEdge = () => {
      if (!sidebarRoot || sidebarMotionId !== id || sidebarEdgeMotionId !== id) return;
      dispatchPanelGeometryMotion({
        phase: "change",
        id,
        source: "sidebar",
        size: sidebarRoot.getBoundingClientRect().width,
      });
      sidebarEdgeRaf = requestAnimationFrame(sampleEdge);
    };
    finishSidebarMotion = () => {
      if (sidebarEdgeMotionId !== id) return;
      if (sidebarEdgeRaf) cancelAnimationFrame(sidebarEdgeRaf);
      const finalWidth = paneWidth();
      dispatchPanelGeometryMotion({ phase: "change", id, source: "sidebar", size: finalWidth });
      sidebarEdgeRaf = 0;
      sidebarEdgeMotionId = null;
      finishSidebarMotion = null;
      setVisualCollapsed(nextCollapsed);
      dispatchPanelGeometryMotion({ phase: "end", id, source: "sidebar", size: finalWidth });
    };
    sidebarEdgeRaf = requestAnimationFrame(sampleEdge);
  };
  onCleanup(() => {
    cancelSidebarEdgeMotion();
  });
  onMount(() => {
    const syncPreferences = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      if (detail?.key === "sidebarCollapsed" && typeof detail.value === "boolean") {
        if (publishingSidebarPreference) return;
        cancelSidebarEdgeMotion();
        localStorage.setItem("conduit.sidebar", detail.value ? "collapsed" : "expanded");
        setCollapsed(detail.value);
        setVisualCollapsed(detail.value);
      } else if (detail?.key === "collapsedProjectIds" && Array.isArray(detail.value)) {
        setCollapsedProjectIds(new Set(detail.value.filter((item): item is string => typeof item === "string")));
      }
    };
    window.addEventListener(UI_PREFERENCE_CHANGE_EVENT, syncPreferences);
    onCleanup(() => window.removeEventListener(UI_PREFERENCE_CHANGE_EVENT, syncPreferences));
  });
  const [phoneLayout, setPhoneLayout] = createSignal(isMobileLayout());
  onMount(() => {
    const media = typeof matchMedia === "function" ? matchMedia(MOBILE_LAYOUT_QUERY) : null;
    if (!media) return;
    const sync = () => setPhoneLayout(media.matches);
    sync();
    media.addEventListener("change", sync);
    onCleanup(() => media.removeEventListener("change", sync));
  });
  // Asked again each time the server is back, so a load that landed in a
  // restart does not leave the harness rows missing until a reload.
  createEffect(() => {
    if (props.runtime.connectivity() !== "online") return;
    void api<{ harnesses: HarnessSummary[] }>("/v0/harnesses")
      .then((result) => setHarnesses(result.harnesses.filter((item) => item.available)))
      .catch(() => {});
  });
  onMount(() => {
    const loadTerminals = () => void api<{ ptys: Pty[] }>("/v0/ptys")
      .then(({ ptys }) => setTerminals(ptys.filter((item) => item.status === "running" && !item.paneDead)))
      .catch(() => {});
    const onPtysChanged = () => loadTerminals();
    loadTerminals();
    window.addEventListener("conduit:ptys-changed", onPtysChanged);
    const timer = window.setInterval(() => setActivityClock(Date.now()), 30_000);
    onCleanup(() => {
      window.removeEventListener("conduit:ptys-changed", onPtysChanged);
      window.clearInterval(timer);
    });
  });
  onMount(() => {
    if (!sidebarRoot || !sidebarList) return;
    onCleanup(installSidebarCursor({
      root: sidebarRoot,
      list: sidebarList,
      hasSelection: () => selectedChatIds().size > 0,
      select: (ids) => setSelectedChatIds(new Set(ids)),
      clearSelection: () => clearSelection(),
      onLeave: () => props.onFocusMainPane(),
    }));
  });
  onMount(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || selectedChatIds().size === 0) return;
      clearSelection();
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || selectedChatIds().size === 0) return;
      queueMicrotask(clearSelection);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("click", click);
    onCleanup(() => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("click", click);
    });
  });
  const [mode, setMode] = createSignal<"managed" | WorkspaceMode>("managed");
  const [workspaceStep, setWorkspaceStep] = createSignal<"explore" | "details">("explore");
  // Which machine a new workspace goes on: "" for the hub's own, else a client's node (THIS_COMPUTER before this app's is paired).
  const [workspaceOn, setWorkspaceOn] = createSignal("");
  const [name, setName] = createSignal("");
  const [path, setPath] = createSignal("");
  const [cloneUrl, setCloneUrl] = createSignal("");
  const [cloneDirectoryName, setCloneDirectoryName] = createSignal("");
  const [directoryName, setDirectoryName] = createSignal("");
  const [workspacePreview, setWorkspacePreview] = createSignal<WorkspacePreview | null>(null);
  const [previewError, setPreviewError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [computerPicker, setComputerPicker] = createSignal<ComputerLocation | null>(null);
  const [computerPickerLoading, setComputerPickerLoading] = createSignal(false);
  const [computerPickerError, setComputerPickerError] = createSignal("");
  const renderedChatTitles = new Map<string, string>();
  const chatSort = useChatSort();
  const [rename, setRename] = createSignal<{ type: "chat"; chat: ChatSummary; project: Project } | { type: "project"; project: Project } | { type: "terminal"; terminal: Pty } | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [deleting, setDeleting] = createSignal<DeleteTarget | null>(null);
  const [moving, setMoving] = createSignal<{ chat: ChatSummary; project: Project } | null>(null);
  let appliedDefaultWorkspacePath = "";
  let handledCommandNonce: number | null = null;

  const currentProject = () => props.projects.find((item) => item.sessions.some((chat) => chat.id === props.selectedId))
    || props.projects.find((item) => item.id === props.projectId);
  const currentChat = (project = currentProject()): ChatSummary | null => project?.sessions.find((item) => item.id === props.selectedId)
    || (project && props.selectedId ? { id: props.selectedId, projectId: project.id, status: "draft" as const, title: "New chat" } : null);
  const chatTitle = (chat: ChatSummary) => chat.title || (chat.status === "active" ? "Untitled chat" : "New chat");

  createEffect(() => {
    const command = props.command;
    if (!command || command.nonce === handledCommandNonce) return;
    handledCommandNonce = command.nonce;
    if (command.type === "new-folder") openNewDialog("folder");
    if (command.type === "new-workspace") openNewDialog("workspace");
    if (command.type === "new-workspace-created" || command.type === "new-workspace-cloned") {
      openNewDialog("workspace");
      selectWorkspaceMode(command.type === "new-workspace-created" ? "created" : "cloned");
      setWorkspaceStep("details");
      if (command.path) { setPath(command.path); appliedDefaultWorkspacePath = ""; }
    }
    if (command.type === "toggle-sidebar") toggleSidebar();
    if (command.type === "delete-chat") {
      const project = command.project || currentProject();
      const chat = command.chat || currentChat(project);
      if (project && chat) setDeleting({ type: "chat", project, chat });
    }
    if (command.type === "rename-chat") {
      const project = command.project || currentProject();
      const chat = command.chat || currentChat(project);
      if (project && chat) requestRenameChat(chat, project);
    }
    if (command.type === "move-chat") {
      const project = command.project || currentProject();
      const chat = command.chat || currentChat(project);
      if (project && chat) setMoving({ chat, project });
    }
    if (command.type === "rename-folder") { const project = command.project || currentProject(); if (project && project.slug !== "chat") requestRenameProject(project); }
    if (command.type === "delete-project") { const project = command.project || currentProject(); if (project && project.slug !== "chat") setDeleting({ type: "project", project }); }
    if (command.type === "rename-terminal" && command.terminal) {
      setRename({ type: "terminal", terminal: command.terminal });
      setRenameValue(command.terminal.title || "Shell");
    }
    if (command.type === "delete-terminal" && command.terminal) setDeleting({ type: "terminal", terminal: command.terminal });
    if (command.type === "pin-chat" && command.chat) void togglePin("chat", command.chat.id);
    if (command.type === "pin-project" && command.project) void togglePin("project", command.project.id);
    if (command.type === "pin-terminal" && command.terminal) void togglePin("terminal", command.terminal.id);
    if (command.type === "copy-chat" && command.chat) void props.onCopyTranscript(command.chat);
    if (command.type === "open-chat-terminal" && command.chat && command.project) props.onOpenTerminal(command.chat, command.project);
  });

  createEffect(() => localStorage.setItem("conduit.sidebar", collapsed() ? "collapsed" : "expanded"));
  createEffect(() => localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...collapsedProjectIds()])));
  createEffect(() => {
    const available = new Set(props.projects.flatMap((project) => project.sessions.map((chat) => chat.id)));
    const retained = [...selectedChatIds()].filter((id) => available.has(id));
    if (retained.length !== selectedChatIds().size) setSelectedChatIds(new Set(retained));
  });
  createEffect(() => {
    const selectedId = props.selectedId;
    if (!selectedId) return;
    const owner = props.projects.find((project) => project.sessions.some((chat) => chat.id === selectedId));
    if (!owner) return;
    setCollapsedProjectIds((current) => {
      if (!current.has(owner.id)) return current;
      const next = new Set(current);
      next.delete(owner.id);
      publishUiPreference("collapsedProjectIds", [...next]);
      return next;
    });
    queueMicrotask(() => {
      const row = document.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(selectedId)}"]`);
      row?.scrollIntoView({ block: "nearest" });
    });
  });
  createEffect(() => {
    const open = props.mobileOpen;
    if (open && !mobileWasOpen) {
      mobileReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      queueMicrotask(() => focusFirst(sidebarRoot));
    } else if (!open && mobileWasOpen) {
      const previous = mobileReturnFocus;
      mobileReturnFocus = null;
      queueMicrotask(() => restoreFocus(previous, ["textarea[data-composer-input]", 'button[aria-label="Toggle Sidebar"]']));
    }
    mobileWasOpen = open;
  });
  const chats = () => props.projects.find((project) => project.slug === "chat") || props.projects[0];
  const folders = () => props.projects.filter((project) => project.slug !== "chat" && project.origin !== "linked" && project.origin !== "created" && project.origin !== "cloned" && project.kind !== "workspace");
  const workspaces = () => props.projects.filter((project) => project.origin === "linked" || project.origin === "created" || project.origin === "cloned" || project.kind === "workspace");
  const pinRef = (type: PinnedItem["type"], id: string) => `${type}:${id}`;
  const isPinned = (type: PinnedItem["type"], id: string) => props.sidebarPins.includes(pinRef(type, id));
  const togglePin = props.onTogglePin;
  const pinnedItems = createMemo<PinnedItem[]>(() => {
    const resolved: PinnedItem[] = [];
    for (const ref of props.sidebarPins) {
      const separator = ref.indexOf(":");
      const type = ref.slice(0, separator);
      const id = ref.slice(separator + 1);
      if (type === "chat") {
        const project = props.projects.find((item) => item.sessions.some((chat) => chat.id === id));
        const chat = project?.sessions.find((item) => item.id === id);
        if (project && chat && isConduitManagedProject(project)) resolved.push({ ref, type, project, chat });
      } else if (type === "project") {
        const project = props.projects.find((item) => item.id === id);
        if (project && isConduitManagedProject(project)) resolved.push({ ref, type, project });
      }
    }
    return resolved;
  });
  const terminalActivity = (terminal: Pty) => {
    const value = new Date(terminal.lastActivityAt || terminal.updatedAt || terminal.createdAt || "");
    if (Number.isNaN(value.getTime())) return "Running";
    const seconds = Math.max(0, Math.round((activityClock() - value.getTime()) / 1000));
    if (seconds < 60) return "Active now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86_400)}d ago`;
  };
  /*
   * The machines workspaces and terminals are on: every environment the server can work on (its own and the paired
   * ones), named as their device and client ("Desktop · Ubuntu"). Asked while the Computer view shows, and again now
   * and then: a client pairing or a folder mounted changes the list under it.
   */
  type Machine = { id: string; label: string; hub: boolean; online: boolean; folders: number; browse: boolean };
  const [machines, setMachines] = createSignal<Machine[] | null>(null);
  const [hubName, setHubName] = createSignal("the hub");
  const readMachines = () => void api<{ devices: Array<{ name: string; hub?: string; nodes: Array<{ id: string; name: string; local?: boolean; online: boolean; browse?: boolean; roots: unknown[] }> }> }>("/v0/nodes")
    .then(({ devices }) => {
      setHubName(devices.find((device) => device.hub)?.hub || "the hub");
      setMachines(devices.flatMap((device) => device.nodes.map((node) => ({ id: node.id, label: `${device.name} · ${node.name}`, hub: Boolean(node.local),
        online: node.online, folders: node.roots.length, browse: Boolean(node.browse) }))));
    })
    .catch(() => {});
  // This app's own node, when it is paired with this hub; and the system's picker, open or dismissed, choosing on it.
  const [ownNode, setOwnNode] = createSignal<string | null>(null);
  const [picking, setPicking] = createSignal<"" | "open" | "dismissed">("");
  const readOwnNode = () => {
    if (desktopShell) void desktopShell.companion.status().then((status) => setOwnNode(pairingWith(status, (machines() || []).map((machine) => machine.id))?.nodeId || null)).catch(() => {});
  };
  createEffect(() => { if (machines()) readOwnNode(); });
  /** The machines a workspace can go on, as the menu offers them: the hub, each client, this computer (the app's own). */
  const machineChoices = createMemo(() => {
    const list = (machines() || []).map((machine) => {
      const own = machine.id === ownNode();
      return { value: machine.hub ? "" : machine.id, label: machine.label, hub: machine.hub, own,
        meta: machine.hub ? "Hub" : own ? "This computer" : !machine.online ? "Offline" : machine.browse ? "" : machine.folders ? `${machine.folders} shared` : "Shares no folders",
        // This computer is always offered (choosing it shares a folder); another client only where there is something to browse.
        disabled: !machine.hub && !own && (!machine.online || (!machine.folders && !machine.browse)) };
    });
    if (desktopShell && !ownNode()) list.push({ value: THIS_COMPUTER, label: "This computer", hub: false, own: true, meta: "Not paired yet", disabled: false });
    return list;
  });
  const chosenMachine = () => machineChoices().find((choice) => choice.value === workspaceOn()) || machineChoices()[0];
  const machineMark = (choice?: { hub: boolean; own: boolean }) => choice?.hub ? <Icons.Server /> : <Icons.Monitor />;
  /** This computer's folder, by the system's picker: shared, then straight to its details (it is not browsed as well). */
  const pickOnThisComputer = () => {
    setPicking("open");
    setComputerPickerError("");
    void makeFolderAvailable().then((shared) => {
      if (!shared) { setPicking("dismissed"); return; }
      readMachines();
      batch(() => { setWorkspaceOn(shared.nodeId); setPicking(""); selectWorkspaceMode("linked"); setPath(shared.path); setWorkspaceStep("details"); });
    }, (error: Error) => { setPicking("dismissed"); setComputerPickerError(error.message); });
  };
  const chooseMachine = (value: string) => {
    batch(() => { setComputerPicker(null); setComputerPickerError(""); setPath(""); setPicking(""); setWorkspaceOn(value); });
    // This computer's own folders are chosen with its own picker, the only one shown; Conduit's explorer is for another
    // machine's (and for a browser, which has none of its own to offer).
    if (value === THIS_COMPUTER || value === ownNode()) { pickOnThisComputer(); return; }
    void browseComputerPicker();
  };
  createEffect(() => {
    if (area() !== "computer") return;
    readMachines();
    const timer = setInterval(readMachines, 30_000);
    onCleanup(() => clearInterval(timer));
  });
  const hubMachine = () => machines()?.find((machine) => machine.hub)?.id ?? "";
  // A workspace is placed on one machine; a terminal is in a workspace, a device's home, or the server's own.
  const machineOfProject = (project: Project) => project.nodeId || hubMachine();
  const machineOfTerminal = (terminal: Pty) => terminal.projectId.startsWith("device:") ? terminal.projectId.slice("device:".length)
    : terminal.projectId === "computer" || terminal.projectId.startsWith("computer:") ? hubMachine()
    : machineOfProject(props.projects.find((project) => project.id === terminal.projectId) || ({ nodeId: null } as Project));
  // The hub's machine always, then any other holding a workspace or a terminal.
  const byMachine = createMemo(() => (machines() || []).map((machine) => ({ machine,
    workspaces: workspaces().filter((project) => machineOfProject(project) === machine.id),
    terminals: terminals().filter((terminal) => machineOfTerminal(terminal) === machine.id) }))
    .filter((group) => group.machine.hub || group.workspaces.length || group.terminals.length)
    .sort((a, b) => Number(b.machine.hub) - Number(a.machine.hub)));
  // A device's home terminal names its device after its folder ("~ on Desktop"); its section already does.
  const terminalScope = (terminal: Pty) => props.projects.find((project) => project.id === terminal.projectId)?.name || ((terminal.projectId === "computer" || terminal.projectId.startsWith("computer:") || terminal.projectId.startsWith("device:")) ? (terminal.cwd || "Computer").replace(/ on .+$/, "") : "Unknown workspace");
  const selectedTargets = createMemo<ChatTarget[]>(() => props.projects.flatMap((project) =>
    project.sessions.filter((chat) => selectedChatIds().has(chat.id)).map((chat) => ({ chat, project }))));
  const clearSelection = () => setSelectedChatIds(new Set<string>());
  const toggleChatSelection = (chatId: string) => {
    setSelectedChatIds((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };
  const applyBulkFailures = (failedIds: string[]) => setSelectedChatIds(new Set(failedIds));
  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      publishUiPreference("collapsedProjectIds", [...next]);
      return next;
    });
  };
  const closeMobile = () => props.onMobileOpenChange(false);
  // Opening a page from the sidebar -- by click or Enter, and even the page
  // already open -- enters it: focus goes to its composer, else the pane.
  // Actions with a target of their own (a dialog, the palette, a terminal)
  // do not.
  const enterPane = () => props.onEnterMainPane();
  const startNewChat = (project?: Project) => {
    closeMobile();
    const target = project || chats();
    if (target) void props.onNewChat(target).then(enterPane);
  };

  /** Live process map wins while SSE is online; fall back to the catalogue's live snapshot when offline. */
  // Only the runtime stream says whether a chat has an agent. The chat summary
  // carries a copy of that from whenever the list was last fetched, and falling
  // back to it while the stream reconnected put pills on chats whose processes
  // had been gone for minutes -- and left them there until a reload refetched
  // the list. The stream's own last-known state is kept across a reconnect and
  // marked stale, which is the honest version of the same answer.
  const processFor = (chat: ChatSummary): RuntimeProcess | null => props.runtime.getProcess(chat.id);

  const railChats = () => [...props.projects.flatMap((project) => project.sessions
    .filter((chat) => chat.status !== "draft" || chat.id !== props.selectedId || chat.pinned || Boolean(props.runtime.getProcess(chat.id)))
    .map((chat) => ({ chat, project })))]
    .sort((left, right) => {
      const selected = Number(right.chat.id === props.selectedId) - Number(left.chat.id === props.selectedId);
      if (selected) return selected;
      return compareChatsBySort(left.chat, right.chat, chatSort());
    })
    .slice(0, 5);
  const railFolders = () => folders().slice(0, 5);
  const railWorkspaces = () => workspaces().slice(0, 5);
  // A project page keeps a draft chat open behind its composer, so the
  // selection alone cannot say which row the reader is on -- without the route,
  // the project row went dark and New chat lit up in its place.
  const shownId = () => props.routeCovered ? null : props.selectedId;
  const onProjectPage = (project: Project) => !props.routeCovered && props.projectId === project.id && (props.project || props.selectedId == null);
  // A folder or workspace holding the open chat is drawn as current with it,
  // collapsed or not, wherever its row appears -- so where you are reads up
  // the tree.
  const holdsCurrentChat = (project: Project) => shownId() != null && project.sessions.some((chat) => chat.id === shownId());
  const railProjectIsActive = (project: Project) => !props.routeCovered && (project.id === props.projectId || project.sessions.some((chat) => chat.id === props.selectedId));
  const railProjectIsLive = (project: Project) => project.sessions.some((chat) => Boolean(processFor(chat)));
  const RailAction = (railProps: { label: string; onClick: () => void; current?: boolean; live?: boolean; children: JSX.Element }) =>
    <RailButton aria-label={railProps.label} title={railProps.label} current={railProps.current} live={railProps.live} onClick={railProps.onClick}>{railProps.children}</RailButton>;

  const openNewDialog = (kind: "folder" | "workspace") => {
    if (kind === "workspace") {
      props.onWorkspaceSuggestionsNeeded();
      // A dialog left on a client's folders opens on the hub's again.
      if (workspaceOn()) { setComputerPicker(null); setPath(""); }
      setWorkspaceOn("");
      setPicking("");
      readMachines();
    }
    setMode(kind === "workspace" ? "linked" : "managed");
    setWorkspaceStep(kind === "workspace" ? "explore" : "details");
    setNewKind(kind);
  };
  const selectWorkspaceMode = (next: WorkspaceMode) => {
    if (next === "linked") setComputerPickerError("");
    if (next === "linked" && path().trim() === appliedDefaultWorkspacePath) {
      setPath("");
      appliedDefaultWorkspacePath = "";
    }
    setMode(next);
    if ((next === "created" || next === "cloned") && !path().trim()) {
      const defaultPath = props.workspacePolicy?.defaultInputPath;
      if (defaultPath) {
        setPath(defaultPath);
        appliedDefaultWorkspacePath = defaultPath;
      }
    }
  };
  const closeNewDialog = () => {
    if (submitting()) return;
    setNewKind(null);
    setMode("managed");
    setWorkspaceStep("explore");
    setName("");
    setPath("");
    setDirectoryName("");
    setCloneUrl("");
    setCloneDirectoryName("");
    setWorkspacePreview(null);
    setPreviewError("");
    setComputerPicker(null);
    setComputerPickerError("");
    appliedDefaultWorkspacePath = "";
  };

  const browseComputerPicker = async (target?: string) => {
    setComputerPickerLoading(true);
    setComputerPickerError("");
    try {
      const on = workspaceOn();
      const query = target ? `?path=${encodeURIComponent(target)}` : "";
      const location = await api<ComputerLocation>(on ? `/v0/nodes/${encodeURIComponent(on)}/computer${query}` : `/v0/computer${query}`);
      setComputerPicker(location);
      setPath(location.project.workingRoot);
      appliedDefaultWorkspacePath = "";
    } catch (error) {
      setComputerPickerError(error instanceof Error ? error.message : "Folder could not be opened");
    } finally { setComputerPickerLoading(false); }
  };
  createEffect(() => {
    // Not while this computer's own picker is choosing: nothing is browsed behind it.
    if (newKind() === "workspace" && !picking() && workspaceOn() !== THIS_COMPUTER && !computerPicker() && !computerPickerLoading() && !computerPickerError()) void browseComputerPicker(path() || undefined);
  });

  createEffect(() => {
    const defaultPath = props.workspacePolicy?.defaultInputPath;
    if (newKind() !== "workspace" || !defaultPath || !["created", "cloned"].includes(mode()) || path().trim()) return;
    setPath(defaultPath);
    appliedDefaultWorkspacePath = defaultPath;
  });

  const previewKey = () => `${mode()}\0${path().trim()}\0${directoryName().trim()}`;
  createEffect(() => {
    const currentMode = mode();
    const currentPath = path().trim();
    const currentDirectory = directoryName().trim();
    const key = `${currentMode}\0${currentPath}\0${currentDirectory}`;
    // A client's folder is checked where it is made (the device's grants); the preview asks the hub's disk.
    const previewable = newKind() === "workspace" && !workspaceOn()
      && ((currentMode === "linked" && currentPath) || (currentMode === "created" && currentPath && currentDirectory));
    setWorkspacePreview(null);
    setPreviewError("");
    if (!previewable) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{ path: string; ownership: string }>("/v0/workspaces/preview", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ mode: currentMode, path: currentPath, directoryName: currentDirectory || undefined }),
      }).then((result) => {
        if (!controller.signal.aborted) setWorkspacePreview({ key, ...result });
      }).catch((error) => {
        if (!controller.signal.aborted) setPreviewError((error as Error).message);
      });
    }, 180);
    onCleanup(() => { window.clearTimeout(timer); controller.abort(); });
  });

  const requestRenameChat = (chat: ChatSummary, project: Project) => { setRename({ type: "chat", chat, project }); setRenameValue(chat.title); };
  const requestRenameProject = (project: Project) => { setRename({ type: "project", project }); setRenameValue(project.name); };
  const submitRename = async (event: Event) => {
    event.preventDefault();
    const target = rename();
    const value = renameValue().trim();
    if (!target || !value) return;
    const saved = target.type === "chat" ? await props.onRenameChat(target.chat, target.project, value)
      : target.type === "project" ? await props.onRenameProject(target.project, value)
        : await api<Pty>(`/v0/ptys/${encodeURIComponent(target.terminal.id)}/rename`, { method: "POST", body: JSON.stringify({ title: value }) })
          .then(() => { window.dispatchEvent(new Event("conduit:ptys-changed")); return true; })
          .catch(() => false);
    if (saved) setRename(null);
  };

  const submitNew = async (event: Event) => {
    event.preventDefault();
    if (submitting()) return;
    const input: ProjectInput = newKind() === "workspace" && workspaceOn() ? { mode: "node", nodeId: workspaceOn(), name: name().trim() || undefined, path: path().trim() }
      : mode() === "managed" ? { mode: "managed", name: name().trim() }
      : mode() === "linked" ? { mode: "linked", name: name().trim() || undefined, path: path().trim() }
        : mode() === "created" ? { mode: "created", name: name().trim() || undefined, path: path().trim(), directoryName: directoryName().trim() }
        : { mode: "cloned", name: name().trim() || undefined, cloneParentPath: path().trim(), cloneDirectoryName: cloneDirectoryName().trim() || undefined, cloneUrl: cloneUrl().trim() };
    setSubmitting(true);
    let created = false;
    try { created = await props.onAddProject(input); }
    finally { setSubmitting(false); }
    if (created) closeNewDialog();
  };
  const previewReady = () => workspacePreview()?.key === previewKey();
  // A client the hub browses shares the folder chosen; its home or a drive is too broad (its device refuses it too).
  const tooBroad = () => Boolean(workspaceOn() && machines()?.find((machine) => machine.id === workspaceOn())?.browse
    && !props.projects.some((project) => project.nodeId === workspaceOn() && project.workingRoot === path())
    && (path().replace(/[\\/]+$/, "") === computerPicker()?.home?.replace(/[\\/]+$/, "") || /^([a-z]:[\\/]?|\/)$/i.test(path())));
  const canCreate = () => !submitting() && (newKind() === "workspace" && workspaceOn() ? Boolean(path().trim()) && !tooBroad() : mode() === "managed" ? Boolean(name().trim())
    : mode() === "linked" || mode() === "created" ? previewReady()
      : Boolean(cloneUrl().trim() && path().trim()));

  const confirmDelete = async () => {
    const target = deleting();
    if (!target) return;
    setDeleting(null);
    if (target.type === "chat") await props.onDeleteChat(target.chat, target.project);
    else if (target.type === "chats") applyBulkFailures(await props.onDeleteChats(target.targets));
    else if (target.type === "project") await props.onDeleteProject(target.project);
    else {
      await api(`/v0/ptys/${encodeURIComponent(target.terminal.id)}`, { method: "DELETE" });
      window.dispatchEvent(new Event("conduit:ptys-changed"));
    }
  };

  const deleteCopy = () => {
    const target = deleting();
    if (target?.type === "chats") {
      const count = target.targets.length;
      return {
        title: `Delete ${count} chats?`,
        description: `This permanently deletes ${count} session transcripts and their attached files.`,
      };
    }
    if (target?.type === "terminal") return { title: "Destroy this shell?", description: `This permanently stops ${target.terminal.title || "Shell"} and removes its terminal session.` };
    if (target?.type === "chat") {
      const implementation = target.chat.backend?.implementation;
      const harness = harnesses().find((item) => item.id === implementation);
      if (harness) return { title: "Delete this chat from Conduit?",
        description: `This deletes Conduit's link and attached files. The thread stays in ${harness.profileLabel}.` };
      return { title: "Delete this chat?", description: "This permanently deletes the session transcript and this chat's attached files." };
    }
    if (target?.type !== "project") return { title: "Delete this chat?", description: "This permanently deletes the session transcript and this chat's attached files." };
    if (target.project.origin === "linked") return { title: "Unlink this workspace?", description: `This unregisters ${target.project.name} and deletes its Conduit chats. The linked directory on disk is kept.` };
    if (target.project.origin === "created") return { title: "Unlink this workspace?", description: `This unregisters ${target.project.name} and deletes its Conduit chats. The created directory on disk is kept.` };
    if (target.project.origin === "cloned") return { title: "Unlink this workspace?", description: `This unregisters ${target.project.name} and deletes its Conduit chats. The cloned directory on disk is kept.` };
    return { title: "Delete this folder?", description: `This permanently deletes ${target.project.name}, its working files, and all of its chats.` };
  };
  const deleteButtonLabel = () => {
    const target = deleting();
    return target?.type === "chats" ? `Delete ${target.targets.length} chats` : "Delete";
  };

  const moveSelectedChats = async (destination: Project) => {
    const targets = selectedTargets();
    if (!targets.length) return;
    applyBulkFailures(await props.onMoveChats(targets, destination));
  };

  /**
   * Long-press opens the menu then synthesizes a click; swallow that click.
   *
   * The synthesized one arrives while the menu is still open, so the guard only
   * has to cover that window. Disarming it when the menu closes is the whole
   * point: while the only thing that cleared the flag was the next click, every
   * other way of leaving the menu -- picking an item, pressing Escape, clicking
   * away -- left it armed, and the row then ignored the first real click it got
   * afterwards. Clearing is deferred a turn so the click that dismissed the
   * menu, which is dispatched after the close, is still swallowed.
   */
  const menuOpenGuards = new WeakMap<object, { suppressClick: boolean }>();
  const guardFor = (key: object) => {
    let guard = menuOpenGuards.get(key);
    if (!guard) {
      guard = { suppressClick: false };
      menuOpenGuards.set(key, guard);
    }
    return guard;
  };

  const menuPlacement = () => phoneLayout() ? "bottom-start" as const : "right-start" as const;
  const guardOpen = (guard: { suppressClick: boolean }) => (open: boolean) => { if (open) guard.suppressClick = true; else setTimeout(() => { guard.suppressClick = false; }); };

  const ChatMenu = (menuProps: { chat: ChatSummary; project: Project; indent?: boolean }) => {
    const guard = guardFor(menuProps.chat);
    const selected = () => selectedChatIds().has(menuProps.chat.id);
    const title = chatTitle(menuProps.chat);
    const previousTitle = renderedChatTitles.get(menuProps.chat.id);
    const animateTitle = previousTitle !== undefined && previousTitle !== title && Boolean(menuProps.chat.title);
    renderedChatTitles.set(menuProps.chat.id, title);
    return <ContextMenu placement={menuPlacement()} onOpenChange={guardOpen(guard)}>
    <ContextMenuTrigger
      as={NavRow}
      indent={menuProps.indent}
      icon={<Show when={props.navigatingId === menuProps.chat.id} fallback={<RuntimeIndicator process={processFor(menuProps.chat)} stale={props.runtime.stale()} unread={menuProps.chat.unread} fallback={<ThreadHarnessMark id={menuProps.chat.harnessId} label={harnessMarkLabelFor(menuProps.chat.harnessId)} lively />} />}>
        <StatusDot label="Opening chat" spinning />
      </Show>}
      current={(props.focusedId || shownId()) === menuProps.chat.id}
      open={props.openIds?.includes(menuProps.chat.id)}
      selected={selected()}
      data-chat-id={menuProps.chat.id}
      draggable="true" data-doc-view={`chat:${menuProps.chat.id}`}
      aria-label={`${chatTitle(menuProps.chat)}, ${menuProps.chat.harnessId || "conduit"} harness${menuProps.chat.unread ? ", unread" : ""}${selected() ? ", selected" : ""}`}
      onPointerEnter={() => props.onPrefetchChat(menuProps.chat)}
      onFocus={() => props.onPrefetchChat(menuProps.chat)}
      onContextMenu={() => { if (!selected()) clearSelection(); }}
      onClick={(event: MouseEvent) => {
        if (guard.suppressClick) { guard.suppressClick = false; return; }
        // Shift selects for bulk actions (Ctrl too, once a selection is under
        // way); Ctrl alone opens the chat as a tab (main.tsx, openChatHere).
        if (event.shiftKey || ((event.ctrlKey || event.metaKey) && selectedChatIds().size > 0)) {
          event.preventDefault();
          toggleChatSelection(menuProps.chat.id);
          return;
        }
        clearSelection();
        if (event.altKey && props.onOpenChatBeside) {
          event.preventDefault();
          props.onOpenChatBeside(menuProps.chat, menuProps.project);
          return;
        }
        closeMobile();
        void props.onOpenChat(menuProps.chat, menuProps.project).then(enterPane);
      }}
    >
      <SidebarChatTitle title={title} animate={animateTitle} />
    </ContextMenuTrigger>
    <ContextMenuContent>
      <Show when={selected()} fallback={<ChatMenuItems project={menuProps.project} places={props.projects}
        onRename={() => requestRenameChat(menuProps.chat, menuProps.project)}
        onMove={(target) => void props.onMoveChat(menuProps.chat, menuProps.project, target)}
        onCopy={() => void props.onCopyTranscript(menuProps.chat)}
        onOpenBeside={props.onOpenChatBeside ? () => props.onOpenChatBeside?.(menuProps.chat, menuProps.project) : undefined}
        onOpenTerminal={() => props.onOpenTerminal(menuProps.chat, menuProps.project)}
        onStop={processFor(menuProps.chat)?.id ? () => void props.onStopProcess(menuProps.chat) : undefined}
        pin={isConduitManagedProject(menuProps.project) ? { pinned: isPinned("chat", menuProps.chat.id), onToggle: () => void togglePin("chat", menuProps.chat.id) } : undefined}
        onDelete={() => setDeleting({ type: "chat", chat: menuProps.chat, project: menuProps.project })} />}>
        <MenuSection title={`${selectedTargets().length} chats selected`}>
          <MoveTo label="Move to folder…" places={props.projects} held={(target) => selectedTargets().every((item) => item.project.id === target.id)} onMove={(target) => void moveSelectedChats(target)} />
          <MenuRow icon={<Icons.Copy />} onSelect={() => void props.onCopyChatLinks(selectedTargets())}>Copy links</MenuRow>
          <MenuRow icon={<Icons.Close />} onSelect={clearSelection}>Clear selection</MenuRow>
        </MenuSection>
        <MenuSection>
          <MenuRow destructive icon={<Icons.Delete />} onSelect={() => setDeleting({ type: "chats", targets: selectedTargets() })}>Delete {selectedTargets().length} chats</MenuRow>
        </MenuSection>
      </Show>
    </ContextMenuContent>
  </ContextMenu>;
  };

  const ProjectBlock = (blockProps: { project: Project; workspace?: boolean }) => {
    const open = () => !collapsedProjectIds().has(blockProps.project.id);
    const guard = guardFor(blockProps.project);
    const isWorkspace = () => blockProps.project.origin === "linked" || blockProps.project.origin === "created" || blockProps.project.origin === "cloned" || blockProps.project.kind === "workspace";
    const cloning = () => blockProps.project.state === "cloning";
    // A folder's chats slide rather than appear (NavFolder); a closed folder keeps nothing in the document.
    return <NavFolder open={open()} row={<ContextMenu placement={menuPlacement()} onOpenChange={guardOpen(guard)}>
        <ContextMenuTrigger as={NavFolderRow} open={open()} current={onProjectPage(blockProps.project)} within={holdsCurrentChat(blockProps.project)}
          icon={<Show when={isWorkspace()} fallback={<Icons.Folder />}><WorkspaceGlyph appearance={blockProps.project.workspaceAppearance} /></Show>}
          mark={<ProjectActivityIndicator sessions={blockProps.project.sessions} />}
          meta={cloning() ? "Cloning…" : undefined}
          link={{ draggable: "true", "data-doc-view": `page:project:${blockProps.project.id}`, onClick: () => {
            if (guard.suppressClick) { guard.suppressClick = false; return; }
            closeMobile();
            void props.onOpenProject(blockProps.project).then(enterPane);
          } }}
          toggle={{ "aria-label": `${open() ? "Collapse" : "Expand"} chat list`, title: `${open() ? "Collapse" : "Expand"} ${blockProps.project.name}`, onClick: (event: MouseEvent) => {
            event.stopPropagation();
            toggleProject(blockProps.project.id);
          } }}>{blockProps.project.name}</ContextMenuTrigger>
        <ContextMenuContent>
          <PlaceMenuItems project={blockProps.project} places={props.projects}
            onNewChat={() => startNewChat(blockProps.project)}
            onOpenMaximized={() => { closeMobile(); props.onOpenProjectMaximized(blockProps.project); }}
            onRename={() => requestRenameProject(blockProps.project)}
            pin={isConduitManagedProject(blockProps.project) ? { pinned: isPinned("project", blockProps.project.id), onToggle: () => void togglePin("project", blockProps.project.id) } : undefined}
            onIdentity={() => { closeMobile(); props.onOpenWorkspaceIdentity(blockProps.project); }}
            onSettings={() => props.onOpenSettings("workspaces", blockProps.project.id)}
            onMoveChats={(target) => void props.onMoveProjectChats(blockProps.project, target)}
            onDelete={() => setDeleting({ type: "project", project: blockProps.project })} />
        </ContextMenuContent>
      </ContextMenu>}>
      <For each={sortChats(blockProps.project.sessions, chatSort())}>{(chat) => <ChatMenu chat={chat} project={blockProps.project} indent />}</For>
      <Show when={!blockProps.project.sessions.length}><NavNote>No chats</NavNote></Show>
    </NavFolder>;
  };

  const PinnedRow = (rowProps: { item: PinnedItem }) => {
    const item = rowProps.item;
    const open = () => {
      closeMobile();
      if (item.type === "chat") void props.onOpenChat(item.chat, item.project).then(enterPane);
      else if (item.type === "project") void props.onOpenProject(item.project).then(enterPane);
      else props.onOpenPty(item.terminal);
    };
    const label = () => item.type === "chat" ? chatTitle(item.chat)
      : item.type === "project" ? item.project.name
        : item.terminal.title || "Shell";
    const current = () => item.type === "chat" ? shownId() === item.chat.id
      : item.type === "project" ? onProjectPage(item.project)
        : false;
    const workspace = () => item.type === "project" && workspaces().some((project) => project.id === item.project.id);
    const icon = () => item.type === "chat"
      ? <RuntimeIndicator process={processFor(item.chat)} stale={props.runtime.stale()} unread={item.chat.unread} fallback={<ThreadHarnessMark id={item.chat.harnessId} label={harnessMarkLabelFor(item.chat.harnessId)} lively />} />
      : item.type === "project" ? (workspace() ? <WorkspaceGlyph appearance={item.project.workspaceAppearance} /> : <Icons.Folder />)
        : <Icons.Terminal />;
    return <ContextMenu placement={menuPlacement()}>
      <ContextMenuTrigger as={NavRow} icon={icon()} current={current()} within={item.type === "project" && holdsCurrentChat(item.project)} onClick={open}>{label()}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuSection>
          <Show when={workspace()}>
            <MenuRow icon={<Icons.Maximize />} onSelect={() => {
              if (item.type !== "project") return;
              closeMobile();
              props.onOpenProjectMaximized(item.project);
            }}>Open maximized Workspace</MenuRow>
          </Show>
          <MenuRow icon={<Icons.PinOff />} onSelect={() => void togglePin(item.type, item.type === "chat" ? item.chat.id : item.type === "project" ? item.project.id : item.terminal.id)}>Unpin</MenuRow>
        </MenuSection>
      </ContextMenuContent>
    </ContextMenu>;
  };

  const TerminalRow = (rowProps: { terminal: Pty }) => <NavRow icon={<StatusDot label="Running" tone="success" />}
    detail={<>{terminalScope(rowProps.terminal)} · {rowProps.terminal.currentCommand || "shell"} · {terminalActivity(rowProps.terminal)}</>}
    onClick={() => {
      closeMobile();
      props.onOpenPty(rowProps.terminal);
    }}>{rowProps.terminal.title || "Shell"}</NavRow>;

  const Group = (groupProps: { label: string; projects: Project[]; chatRoot?: Project; workspace?: boolean; emptyLabel?: string }) => {
    const allChats = () => sortChats(groupProps.chatRoot?.sessions.filter((chat) => chat.status !== "draft" || chat.id !== props.selectedId || chat.pinned || Boolean(props.runtime.getProcess(chat.id))) || [], chatSort());
    const visibleChats = () => {
      const chats = allChats();
      if (chats.length <= props.chatLimit) return chats;
      const selected = chats.find((chat) => chat.id === props.selectedId);
      const first = chats.slice(0, Math.max(0, props.chatLimit));
      if (!selected || first.some((chat) => chat.id === selected.id)) return first;
      return [...first.slice(0, Math.max(0, props.chatLimit - 1)), selected];
    };
    const moreChats = () => Math.max(0, allChats().length - visibleChats().length);
    return <NavGroup label={groupProps.label}>
      <Show when={groupProps.chatRoot}>
        <For each={visibleChats()}>{(chat) => <ChatMenu chat={chat} project={groupProps.chatRoot!} />}</For>
        <Show when={moreChats() > 0}>
          <NavRow quiet icon={<Icons.Search />} meta={`${moreChats()} more`} onClick={() => props.onOpenPalette("chat-search", "scope:chats ")}>View all chats</NavRow>
        </Show>
        <Show when={!allChats().length}>
          <Show when={props.catalogueLoaded} fallback={<NavSkeleton rows={4} />}><NavNote>No chats</NavNote></Show>
        </Show>
      </Show>
      <For each={groupProps.projects}>{(project) => <ProjectBlock project={project} workspace={groupProps.workspace} />}</For>
      <Show when={!groupProps.chatRoot && !groupProps.projects.length && groupProps.emptyLabel}>
        <Show when={props.catalogueLoaded} fallback={<NavSkeleton rows={2} />}><NavNote>{groupProps.emptyLabel}</NavNote></Show>
      </Show>
    </NavGroup>;
  };

  const serverSwitcher = () => <ServerSwitcher compact={!phoneLayout() && visualCollapsed()} inline={!phoneLayout()} connectivity={props.connectivity} pwaUpdating={props.pwaUpdating}
    downloads={installedClientKind === "browser"}
    onOpenSettings={() => { closeMobile(); props.onOpenSettings(); }}
    onUpdatePwa={() => props.onUpdatePwa()}
    onAddServer={() => { closeMobile(); props.onAddServer?.(); }}
    onLogout={() => props.onLogout?.()} />;

  const areas = [{ value: "conduit" as const, label: "Conduit", icon: <Icons.Dashboard /> }, { value: "computer" as const, label: "Computer", icon: <Icons.Monitor /> }];
  return <>
    <Show when={props.mobileOpen}>
      <Backdrop layer="drawer" label="Dismiss sidebar" onDismiss={closeMobile} />
    </Show>
    <NavPane ref={(element) => { sidebarRoot = element; }} listRef={(element) => { sidebarList = element; }} data-region="sidebar"
      data-state={phoneLayout() ? "expanded" : collapsed() ? "collapsed" : "expanded"}
      collapsed={!phoneLayout() && collapsed()} folded={!phoneLayout() && visualCollapsed()} instant={instant()} drawer={phoneLayout() ? (props.mobileOpen ? "open" : "shut") : undefined}
      aria-hidden={phoneLayout() && !props.mobileOpen ? true : undefined} inert={phoneLayout() && !props.mobileOpen ? true : undefined}
      onTransitionEnd={(event) => { if (event.target === sidebarRoot && event.propertyName === "width") finishSidebarMotion?.(); }}
      onTransitionCancel={(event) => { if (event.target === sidebarRoot && event.propertyName === "width") finishSidebarMotion?.(); }}
      head={<>
        {/* A phone's open sidebar has no toggle: a swipe or the backdrop closes it. */}
        <Show when={!phoneLayout()}><Button variant="ghost" size="icon-sm" aria-label="Toggle Sidebar" aria-expanded={!collapsed()} onClick={toggleSidebar}><Icons.Sidebar /></Button></Show>
        <NavBrand name="Conduit" aria-label="Conduit" onClick={() => { setArea("conduit"); closeMobile(); props.onOpenDashboard(); enterPane(); }} />
        <Show when={phoneLayout()} fallback={<Segmented icons label="Sidebar section" value={area()} onChange={setArea} options={areas} />}>
          <PillSwitch label="Sidebar section" value={area()} onChange={setArea} options={areas} />
        </Show>
      </>}
      foot={phoneLayout() ? undefined : <>
        {/*
          * Above the server row rather than inside the menu, because the menu
          * is shut whenever this matters. A build waiting to be taken can
          * wait for minutes, and an install runs while somebody is looking
          * elsewhere -- so it gets a place rather than a notification.
          *
          * Settings opens with no section named, which on a phone is the list
          * of sections. Naming "models" here made that list unreachable and
          * landed every client on the same tab.
          *
          * Checking for an update does not close the drawer, unlike every
          * other item in that menu. It reports itself in this row, and
          * closing the sidebar on the way out put the row behind the thread
          * -- so the one thing the person asked to watch was the one thing
          * they could not see.
          */}
        <UpdateNotice state={props.updateState} onTake={props.onTakeUpdate} />
        {serverSwitcher()}
      </>}>
      <NavRail label="Quick navigation">
        <Show when={area() === "computer"}>
          <RailAction label="Computer" current={props.computer && !props.selectedHarness} onClick={() => { setArea("computer"); closeMobile(); props.onOpenComputer(); enterPane(); }}><Icons.Monitor /></RailAction>
          <RailAction label="New workspace" onClick={() => openNewDialog("workspace")}><Icons.NewFolder /></RailAction>
          <RailAction label="Terminal View" current={props.terminal} onClick={() => { setArea("computer"); closeMobile(); props.onOpenTerminalView(); }}><Icons.Terminal /></RailAction>
          <For each={harnesses()}>{(harness) => <RailAction label={`${harness.label} · ${harnessStatusLabel(harness.status)}`} current={props.selectedHarness === harness.id} onClick={() => { setArea("computer"); closeMobile(); props.onOpenHarness(harness.id); enterPane(); }}><HarnessMark id={harness.id} artwork /></RailAction>}</For>
          <Show when={railWorkspaces().length}>
            <NavRailSection>
              <For each={railWorkspaces()}>{(project) => <RailAction
                label={project.name}
                current={railProjectIsActive(project)}
                live={railProjectIsLive(project)}
                onClick={() => { setArea("computer"); closeMobile(); void props.onOpenProject(project).then(enterPane); }}
              ><WorkspaceGlyph appearance={project.workspaceAppearance} /></RailAction>}</For>
            </NavRailSection>
          </Show>
        </Show>
        <Show when={area() === "conduit"}>
          <RailAction label="Conduit Dashboard" current={props.dashboard} onClick={() => { setArea("conduit"); closeMobile(); props.onOpenDashboard(); enterPane(); }}><Icons.Dashboard /></RailAction>
          <RailAction label="New project" onClick={() => openNewDialog("folder")}><Icons.NewFolder /></RailAction>
          <Show when={railFolders().length}>
            <NavRailSection>
              <For each={railFolders()}>{(project) => <RailAction
                label={`Project: ${project.name}`}
                current={railProjectIsActive(project)}
                live={railProjectIsLive(project)}
                onClick={() => { setArea("conduit"); closeMobile(); void props.onOpenProject(project).then(enterPane); }}
              ><Icons.Folder /></RailAction>}</For>
            </NavRailSection>
          </Show>
          <NavRailSection>
            <For each={railChats()}>{(item) => <RailAction
              label={`Chat: ${chatTitle(item.chat)}`}
              current={shownId() === item.chat.id}
              live={Boolean(processFor(item.chat))}
              onClick={() => { setArea("conduit"); closeMobile(); void props.onOpenChat(item.chat, item.project).then(enterPane); }}
            ><Icons.Chat /></RailAction>}</For>
          </NavRailSection>
        </Show>
      </NavRail>
      {/* A phone's server, and the actions its sidebar reaches, as the list's first line: it scrolls, so an update's
          notice grows under it without moving the head. */}
      <Show when={phoneLayout()}>
        <NavLead server={serverSwitcher()} actions={<>
          <Button variant="ghost" size="icon" aria-label="New chat" title="New chat" onClick={() => startNewChat()}><Icons.NewChat /></Button>
          <Button variant="ghost" size="icon" aria-label="Search chats" title="Search chats" onClick={() => props.onOpenPalette("chat-search")}><Icons.Search /></Button>
          <Button variant="ghost" size="icon" aria-label="Open command palette" title="Command palette" onClick={() => props.onOpenPalette()}><Icons.Terminal /></Button>
        </>}><UpdateNotice state={props.updateState} onTake={props.onTakeUpdate} /></NavLead>
      </Show>
      <Show when={area() === "computer"}>
        <NavRow icon={<Icons.Monitor />} draggable="true" data-doc-view="page:computer" current={props.computer && !props.selectedHarness} onClick={() => { closeMobile(); props.onOpenComputer(); enterPane(); }}>Files</NavRow>
        <NavRow icon={<Icons.NewFolder />} onClick={() => openNewDialog("workspace")}>New workspace</NavRow>
        <NavRow icon={<Icons.Terminal />} end={<Icons.ExternalLink />} current={props.terminal} onClick={() => { closeMobile(); props.onOpenTerminalView(); }}>Terminal View</NavRow>
        {/* Each harness's page, a row as the ones above are, its mark in its own
            colours; a dot only when it is not ready to use. */}
        <For each={harnesses()}>{(harness) =>
          <NavRow icon={<HarnessMark id={harness.id} artwork />} draggable="true" data-doc-view={`page:harness:${encodeURIComponent(harness.id)}`} current={props.selectedHarness === harness.id}
            title={`${harness.label} · ${harnessStatusLabel(harness.status)}`} onClick={() => { closeMobile(); props.onOpenHarness(harness.id); enterPane(); }}
            end={harness.status && harness.status !== "ready" ? <StatusDot label={harnessStatusLabel(harness.status)} tone={harness.status === "authentication_required" ? "warn" : "muted"} /> : undefined}>{harness.label}</NavRow>
        }</For>
        {/* By machine once the server has said which it has; until then, as one list. */}
        <Show when={machines()?.length} fallback={<>
          <Group label="Workspaces" projects={workspaces()} workspace emptyLabel="No workspaces" />
          <NavGroup label="Terminals">
            <For each={terminals()}>{(terminal) => <TerminalRow terminal={terminal} />}</For>
            <Show when={!terminals().length}><NavNote>No live terminals</NavNote></Show>
          </NavGroup>
        </>}>
          <For each={byMachine()}>{(group) => <NavGroup label={group.machine.label}>
            <For each={group.workspaces}>{(project) => <ProjectBlock project={project} workspace />}</For>
            <For each={group.terminals}>{(terminal) => <TerminalRow terminal={terminal} />}</For>
            <Show when={!group.workspaces.length && !group.terminals.length}><NavNote>No workspaces</NavNote></Show>
          </NavGroup>}</For>
        </Show>
      </Show>
      <Show when={area() === "conduit"}>
        <NavRow icon={<Icons.Dashboard />} draggable="true" data-doc-view="page:dashboard" current={props.dashboard} onClick={() => { closeMobile(); props.onOpenDashboard(); enterPane(); }}>Conduit Dashboard</NavRow>
        <NavRow icon={<Icons.NewFolder />} onClick={() => openNewDialog("folder")}>New project</NavRow>
        <Show when={pinnedItems().length}>
          <NavGroup label="Pinned"><For each={pinnedItems()}>{(item) => <PinnedRow item={item} />}</For></NavGroup>
        </Show>
        <Group label="Projects" projects={folders()} emptyLabel="No projects" />
        <Group label="Chats" projects={[]} chatRoot={chats()} />
      </Show>
    </NavPane>

    <Dialog open={Boolean(newKind())} title={newKind() === "workspace" ? (workspaceStep() === "explore" ? "Add workspace" : mode() === "created" ? "Create workspace folder" : mode() === "cloned" ? "Clone repository" : "Workspace details") : "New folder"}
      description={newKind() === "workspace" ? undefined : newKind() === "folder" ? "Create a separate managed working directory and chat scope." : undefined}
      onOpenChange={(open) => { if (!open) closeNewDialog(); }} close={newKind() === "workspace"} size={newKind() === "workspace" ? "large" : undefined} >
      <CardForm onSubmit={submitNew}><CardBody>
        <Show when={newKind() === "workspace" && workspaceStep() === "explore"}><ComputerExplorer dialog selectOnly={Boolean(workspaceOn())}
          machine={(machines()?.length ?? 0) > 1 || desktopShell ? <DropdownMenu>
            {/* Where it goes: the hub's own machine or a client's, browsed alike; a client's only inside what it lets the hub see. */}
            <DropdownMenu.Trigger as={BrowserMachine} type="button" aria-label={`Machine: ${chosenMachine()?.label || ""}`} title={chosenMachine()?.label}>
              {machineMark(chosenMachine())}<span>{chosenMachine()?.label}</span><Icons.ChevronDown />
            </DropdownMenu.Trigger>
            <MenuContent width="md"><MenuSection title="Machines">
              <MenuRadioGroup value={workspaceOn()} onChange={chooseMachine}>
                <For each={machineChoices()}>{(choice) => <MenuRadioItem value={choice.value} icon={machineMark(choice)} meta={choice.meta} disabled={choice.disabled}>{choice.label}</MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuSection></MenuContent>
          </DropdownMenu> : undefined}
          waiting={picking() ? <PaneEmpty role="status"><div>
            <Icons.Folder />
            <strong>{picking() === "open" ? "Choose a folder in the window that opened" : "No folder chosen"}</strong>
            <p>{computerPickerError() || (picking() === "open" ? `It is shared with ${hubName()}, with edits and commands, and becomes the workspace.`
              : "Choose one with this computer's picker, or another machine from the menu.")}</p>
            <Show when={picking() === "dismissed"}><CardActions>
              <DialogButton type="button" onClick={pickOnThisComputer}><Icons.Folder />Choose a folder…</DialogButton>
            </CardActions></Show>
          </div></PaneEmpty> : undefined}
          projects={props.projects.filter((project) => workspaceOn() ? project.nodeId === workspaceOn() : !project.nodeId || project.nodeId === machines()?.find((machine) => machine.hub)?.id)} location={computerPicker()} loading={computerPickerLoading()} error={computerPickerError()} onBrowse={(target) => void browseComputerPicker(target)} onPrefetch={() => {}} onMakeWorkspace={() => {}} onCreateWorkspace={() => {}} onOpenWorkspace={props.onOpenProject} onManageWorkspace={() => {}} onStartWorkspaceAction={() => {}} onOpenView={() => {}} onOpenFile={() => {}} onSelectFolder={() => { selectWorkspaceMode("linked"); setWorkspaceStep("details"); }} onCreateFolder={() => { selectWorkspaceMode("created"); setWorkspaceStep("details"); }} onCloneRepository={() => { selectWorkspaceMode("cloned"); setWorkspaceStep("details"); }} /></Show>
        <Show when={newKind() === "folder" || workspaceStep() === "details"}>
          <Show when={mode() === "cloned"}><DialogField label={<>GitHub repository or Git URL</>}><DialogInput id="folder-clone" value={cloneUrl()} disabled={submitting()} placeholder="react/react or https://github.com/org/repo.git" onInput={(event) => setCloneUrl(event.currentTarget.value)} /></DialogField></Show>
          <DialogField label={<>{mode() === "managed" ? "Display name" : "Display name (optional)"}</>}><DialogInput id="folder-name" value={name()} disabled={submitting()} placeholder={mode() === "managed" ? "Research" : "My project"} onInput={(event) => setName(event.currentTarget.value)} /></DialogField>
          <Show when={mode() === "created"}><DialogField label={<>New folder name</>}><DialogInput id="workspace-directory-name" value={directoryName()} disabled={submitting()} placeholder="my-project" onInput={(event) => setDirectoryName(event.currentTarget.value)} /></DialogField></Show>
          <Show when={mode() === "cloned"}><DialogField label={<>Folder name (optional)</>}><DialogInput id="clone-directory-name" value={cloneDirectoryName()} disabled={submitting()} placeholder="Defaults to the repository name" onInput={(event) => setCloneDirectoryName(event.currentTarget.value)} /></DialogField></Show>
          {/* Where it will be: the folder, and whose (a client's, shared with the hub; or the hub's own, as the preview says). */}
          <Show when={newKind() === "workspace" && workspaceOn()}><CardBody><CardRead>{path()}</CardRead>
            <Show when={!tooBroad()} fallback={<CardNote error>That folder is too broad: choose a folder inside it.</CardNote>}>
              <CardNote>On {chosenMachine()?.label}. {hubName()} gets edits and commands in this folder; chats in it run their tools there.</CardNote>
            </Show></CardBody></Show>
          <Show when={!workspaceOn() ? workspacePreview() : null}>{(preview) => <CardBody><CardRead>{preview().path}</CardRead><CardNote>{preview().ownership}</CardNote></CardBody>}</Show>
          <Show when={previewError()}><CardNote error>{previewError()}</CardNote></Show>
          <CardActions><Show when={newKind() === "workspace"}><DialogButton type="button" variant="ghost" outline disabled={submitting()} onClick={() => setWorkspaceStep("explore")}>Back</DialogButton></Show><DialogButton type="button" variant="ghost" outline disabled={submitting()} onClick={closeNewDialog}>Cancel</DialogButton><DialogButton type="submit" disabled={!canCreate()}>{submitting() ? (mode() === "cloned" ? "Cloning…" : "Creating…") : mode() === "cloned" ? "Clone workspace" : mode() === "linked" ? "Add workspace" : mode() === "created" ? "Create workspace" : "Create folder"}</DialogButton></CardActions>
        </Show>
      </CardBody></CardForm>
    </Dialog>

    <Dialog open={Boolean(rename())} title={rename()?.type === "chat" ? "Rename chat" : rename()?.type === "terminal" ? "Rename terminal" : "Rename folder"}
      description={rename()?.type === "chat" ? "Set the display name stored by Conduit." : rename()?.type === "terminal" ? "Set the terminal session name." : "Change the folder's display name without changing its working-directory path."}
      onOpenChange={(open) => { if (!open) setRename(null); }}>
      <CardForm onSubmit={submitRename}><DialogField label={<>Name</>}><DialogInput id="rename-name" value={renameValue()} onInput={(event) => setRenameValue(event.currentTarget.value)} /></DialogField><CardActions><DialogButton type="button" variant="ghost" outline onClick={() => setRename(null)}>Cancel</DialogButton><DialogButton type="submit" disabled={!renameValue().trim()}>Rename</DialogButton></CardActions></CardForm>
    </Dialog>

    <Dialog alert open={Boolean(deleting())} title={deleteCopy().title} description={deleteCopy().description} onOpenChange={(open) => { if (!open) setDeleting(null); }}
      actions={<><DialogButton variant="ghost" outline onClick={() => setDeleting(null)}>Cancel</DialogButton><DialogButton variant="destructive" onClick={() => void confirmDelete()}>{deleteButtonLabel()}</DialogButton></>} />

    <Dialog open={Boolean(moving())} title="Move chat" description="Choose the working folder for this chat and its attachments." onOpenChange={(open) => { if (!open) setMoving(null); }}
      actions={<DialogButton type="button" variant="ghost" outline onClick={() => setMoving(null)}>Cancel</DialogButton>}>
      <DialogSection>
        <For each={props.projects.filter((item) => item.id !== moving()?.project.id)}>
          {(target) => <DialogItem icon={<PlaceGlyph project={target} />} onClick={() => { const current = moving(); if (current) void props.onMoveChat(current.chat, current.project, target); setMoving(null); }}>{target.name}</DialogItem>}
        </For>
        <Show when={!props.projects.some((item) => item.id !== moving()?.project.id)}>
          <CardNote>No other folders to move this chat to.</CardNote>
        </Show>
      </DialogSection>
    </Dialog>
  </>;
}
