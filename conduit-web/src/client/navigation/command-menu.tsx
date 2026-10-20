import { Dialog, OverlayDialog } from "@/components/dialog";
import { Button, Input, Segmented } from "@/components/ui/controls";
import { Crumbs } from "@/components/ui/leader";
import { StatusDot } from "@/components/ui/nav";
import { OverlayActions, OverlayBar, OverlayChip, OverlayEmpty, OverlayList, OverlaySplit, type OverlayAction } from "@/components/ui/overlay";
import { Item, Match, Section } from "@/components/ui/popover";
import { Expand } from "@/components/ui/expand";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import {
  ArrowLeftIcon, BrainIcon, ChevronRightIcon, CopyIcon, FileInputIcon, FilePlus2Icon,
  FolderIcon, FolderInputIcon, FolderPlusIcon, LayersIcon, LogOutIcon, MessageSquareIcon, MicIcon,
  MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, PlayIcon, RefreshCwIcon, SearchIcon, SettingsIcon,
  SlashIcon, SlidersHorizontalIcon, SquareIcon, TerminalIcon, Trash2Icon,
} from "lucide-solid";
import { activityLabel } from "../../activity.js";
import type { ChatSummary, ModelOption, Project } from "../api/contracts";
import {
  groupPaletteCommands, PALETTE_GROUPS, PALETTE_PAGES, paletteGroupOf, resolvePaletteCommands,
} from "../palette/command-registry";
import type { PaletteActions, PaletteCommand, PaletteContext } from "../palette/command-registry";
import { rankPaletteResults } from "../palette/palette-search";
import { scorePaletteMatch } from "../palette/palette-search";
import {
  parseChatQuery, resolveChatQueryScope, serializeChatQuery,
} from "../palette/chat-query";
import { COMMAND_IDS, commandRegistry } from "../commands/command-registry";
import { chatSortStamp, compareChatsBySort, saveChatSort, useChatSort } from "../preferences/chat-sort";
import { ThreadHarnessMark } from "../harness-brand";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import type { ShortcutContext } from "../shortcuts/shortcut-types";
import { ChatPreview } from "./chat-preview";
import { CommandHintBar } from "./command-hint-bar";
import type { CommandHintContext, CommandHintMode } from "./command-hint-bar";
import { RuntimeIndicator, visibleRuntimeActivity } from "./runtime-indicator";
import type { RuntimeStore } from "../state/runtime";
import { PlaceGlyph } from "../chat/place-picker";
import { isMobileLayout } from "./mobile-layout";

const icons: Record<string, (props: { class?: string }) => JSX.Element> = {
  "new-chat": MessageSquarePlusIcon,
  "new-folder": FolderPlusIcon,
  attach: FilePlus2Icon,
  microphone: MicIcon,
  settings: SettingsIcon,
  model: SlidersHorizontalIcon,
  profile: LayersIcon,
  rename: PencilIcon,
  move: FolderInputIcon,
  stop: SquareIcon,
  regenerate: RefreshCwIcon,
  continue: PlayIcon,
  copy: CopyIcon,
  "copy-transcript": FileInputIcon,
  delete: Trash2Icon,
  sidebar: PanelLeftIcon,
  "workspace-panel": PanelRightIcon,
  terminal: TerminalIcon,
  chat: MessageSquareIcon,
  thinking: BrainIcon,
  retry: RefreshCwIcon,
  reload: RefreshCwIcon,
  logout: LogOutIcon,
  command: TerminalIcon,
  slash: SlashIcon,
};

const GROUP_HEADINGS: Record<string, string> = Object.fromEntries(PALETTE_GROUPS.map((group) => [group.id, group.heading]));

const FOCUS_MOVING_COMMAND_IDS = new Set<string>([
  COMMAND_IDS.toggleWorkspacePanel,
  COMMAND_IDS.maximizeWorkspacePanel,
  COMMAND_IDS.focusComposer,
  COMMAND_IDS.focusWorkspacePanel,
  COMMAND_IDS.toggleChatWorkspaceFocus,
  COMMAND_IDS.workspaceFiles,
  COMMAND_IDS.workspaceSourceControl,
  COMMAND_IDS.workspaceChat,
  COMMAND_IDS.workspaceTerminal,
]);

type Row =
  | { type: "heading"; key: string; label: string }
  | { type: "command"; key: string; index: number; command: PaletteCommand; parentId?: string }
  | { type: "model"; key: string; index: number; model: ModelOption; scoped?: boolean }
  | { type: "destination"; key: string; index: number; project: Project }
  | { type: "folder"; key: string; index: number; project: Project; count: number; searchResult?: boolean }
  | { type: "browse-all"; key: string; index: number; project: Project; count: number };

type SelectableRow = Exclude<Row, { type: "heading" }>;
type ChatTarget = { chat: ChatSummary; project: Project };
type ScopeReturn = { query: string; activeKey: string | null; scrollTop: number };
type ChatSearchMode =
  | { kind: "browse" }
  | { kind: "select" }
  | { kind: "rename"; id: string }
  | { kind: "move"; returnTo: "browse" | "select" }
  | { kind: "confirmDelete"; targets: ChatTarget[]; returnTo: "browse" | "select" };

function groupModels(models: ModelOption[]): { provider: string; items: ModelOption[] }[] {
  const order: string[] = [];
  const byProvider = new Map<string, ModelOption[]>();
  for (const model of models) {
    const provider = model.provider || "Other";
    if (!byProvider.has(provider)) { byProvider.set(provider, []); order.push(provider); }
    byProvider.get(provider)!.push(model);
  }
  return order.map((provider) => ({ provider, items: byProvider.get(provider)! }));
}

const optionId = (index: number) => `command-option-${index}`;
const canonicalPage = (value?: string | null) => value === "goto" ? "chat-search" : (value || null);
const isWorkspace = (project: Project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
const PREVIEW_COUNT = 5;
const RECENT_COUNT = 5;
const PREVIEW_KEY = "conduit.chat-search.preview";
type ChatView = "all" | "attention" | "progress" | "unread";
/* An activity view is a chip, typed as is:… or chosen from the rail. */
const VIEW_TOKENS: Record<string, ChatView> = { unread: "unread", running: "progress", progress: "progress", attention: "attention" };
const VIEW_LABELS: Record<ChatView, string> = { all: "", unread: "is:unread", progress: "is:running", attention: "is:attention" };
const readPreviewOpen = () => { try { return localStorage.getItem(PREVIEW_KEY) !== "closed"; } catch { return true; } };

function formatChatDate(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unknown date";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

export function CommandMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPage?: string | null;
  launchNonce?: number;
  directLaunch?: boolean;
  initialQuery?: string | null;
  context: PaletteContext;
  runtime: RuntimeStore;
  actions: PaletteActions;
  onChooseModel: (spec: string) => void;
  /** The model in use, drawn as where you are. */
  currentModel?: string;
  scopeModels: ModelOption[];
  enabledModelSpecs: string[];
  onToggleModelScope: (spec: string) => void;
  shortcuts: ShortcutManager;
  onPageChange?: (page: string | null) => void;
}) {
  const chatSort = useChatSort();
  const [query, setQuery] = createSignal("");
  const [page, setPage] = createSignal<string | null>(null);
  const [active, setActive] = createSignal(0);
  const [chatMode, setChatMode] = createSignal<ChatSearchMode>({ kind: "browse" });
  const [selectedChatIds, setSelectedChatIds] = createSignal<Set<string>>(new Set());
  const [editingValue, setEditingValue] = createSignal("");
  const [chatView, setChatView] = createSignal<ChatView>("all");
  const [previewOpen, setPreviewOpen] = createSignal(readPreviewOpen());
  const togglePreview = () => { const next = !previewOpen(); setPreviewOpen(next); try { localStorage.setItem(PREVIEW_KEY, next ? "open" : "closed"); } catch { /* per-device only */ } };
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(new Set());
  const [scopeReturn, setScopeReturn] = createSignal<ScopeReturn | null>(null);
  const [deleteChoice, setDeleteChoice] = createSignal<"cancel" | "confirm">("cancel");
  const [shortcutRevision, setShortcutRevision] = createSignal(0);
  // In chat search the cursor shows only where it acts: in the list, under
  // the pointer, or on the top result once something is typed. Freshly
  // opened, focus is in the search field and no row is lit.
  const [listFocused, setListFocused] = createSignal(false);
  const [pointerCursor, setPointerCursor] = createSignal(false);
  const selectionMode = () => {
    const mode = chatMode();
    return mode.kind === "select" || ((mode.kind === "move" || mode.kind === "confirmDelete") && mode.returnTo === "select");
  };
  const moveMode = () => chatMode().kind === "move";
  const editingId = () => { const mode = chatMode(); return mode.kind === "rename" ? mode.id : null; };
  const pendingDelete = () => { const mode = chatMode(); return mode.kind === "confirmDelete" ? mode.targets : null; };
  const setSelectionMode = (active: boolean) => setChatMode({ kind: active ? "select" : "browse" });
  const setMoveMode = (active: boolean) => {
    const mode = chatMode();
    setChatMode(active ? { kind: "move", returnTo: selectionMode() ? "select" : "browse" }
      : { kind: mode.kind === "move" ? mode.returnTo : "browse" });
  };
  const setEditingId = (id: string | null) => setChatMode(id ? { kind: "rename", id } : { kind: "browse" });
  const setPendingDelete = (targets: ChatTarget[] | null) => {
    const mode = chatMode();
    setChatMode(targets ? { kind: "confirmDelete", targets, returnTo: selectionMode() ? "select" : "browse" }
      : { kind: mode.kind === "confirmDelete" ? mode.returnTo : "browse" });
  };
  let input!: HTMLInputElement;
  let listbox!: HTMLDivElement;
  let renameInput!: HTMLInputElement;
  let deleteCancelButton!: HTMLButtonElement;
  let deleteConfirmButton!: HTMLButtonElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  let lastLaunchNonce: number | undefined;
  let directMode = false;
  let focusAfterQuery: "input" | "list" = "input";

  onCleanup(props.shortcuts.subscribe(() => setShortcutRevision((value) => value + 1)));

  const focusInput = () => {
    queueMicrotask(() => {
      input?.focus();
      requestAnimationFrame(() => input?.focus());
    });
  };

  const pageMeta = createMemo(() => (page() ? PALETTE_PAGES[page()!] : null));
  const commandShortcut = (command: PaletteCommand) => {
    shortcutRevision();
    return props.shortcuts.formatEffectiveBinding(command.id) || command.shortcut || null;
  };
  const parsedQuery = createMemo(() => parseChatQuery(query()));
  const searching = createMemo(() => Boolean(parsedQuery().text));
  const chatPage = createMemo(() => page() === "chat-search");
  const modelSelectorPage = createMemo(() => page() === "model-selector");
  const chatScope = createMemo(() => resolveChatQueryScope(parsedQuery(), props.context.projects || []));
  const chatActivity = (chat: ChatSummary) => visibleRuntimeActivity(props.runtime.getProcess(chat.id));
  const matchesChatView = (chat: ChatSummary) => {
    const view = chatView();
    if (view === "all") return true;
    if (view === "unread") return Boolean(chat.unread);
    const activity = chatActivity(chat);
    if (view === "attention") return activity === "waiting_for_user" || activity === "failed";
    if (view === "progress") return ["starting", "working", "retrying", "compacting", "stopping"].includes(activity || "");
    return true;
  };
  const chatNavigable = (chat: ChatSummary) => chat.status !== "draft" || chat.id !== props.context.chatId || chat.pinned || Boolean(props.runtime.getProcess(chat.id));
  const hintContext = createMemo<CommandHintContext>(() => chatPage() ? "chat" : "generic");
  const pendingActionSequence = createMemo(() => {
    shortcutRevision();
    const pending = props.shortcuts.pendingSequence();
    return pending?.context === "chat-search.browse" ? pending : null;
  });
  const hintMode = createMemo<CommandHintMode>(() => {
    if (editingId()) return "rename";
    if (moveMode()) return "move";
    if (selectionMode()) return "edit";
    if (pendingActionSequence()) return "action-prefix";
    return "browse";
  });

  const resetTransient = () => {
    setQuery("");
    setPage(null);
    setSelectionMode(false);
    setSelectedChatIds(new Set<string>());
    setMoveMode(false);
    setEditingId(null);
    setEditingValue("");
    setPendingDelete(null);
    setChatView("all");
    setExpandedProjects(new Set<string>());
    setScopeReturn(null);
    directMode = false;
  };

  createEffect(() => {
    // Track launchNonce so re-opening on the same page re-applies the initial page.
    void props.launchNonce;
    const launchChanged = props.launchNonce !== lastLaunchNonce;
    if (props.open && (!wasOpen || launchChanged)) {
      if (!wasOpen) returnFocus = document.activeElement as HTMLElement | null;
      setPage(canonicalPage(props.initialPage));
      const initialQuery = props.initialQuery || "";
      setQuery(initialQuery);
      setSelectionMode(false);
      setSelectedChatIds(new Set<string>());
      setMoveMode(false);
      setEditingId(null);
      setPendingDelete(null);
      setChatView("all");
      setExpandedProjects(new Set<string>());
      const initialScope = resolveChatQueryScope(parseChatQuery(initialQuery), props.context.projects || []);
      setScopeReturn(initialScope.kind === "project" ? { query: "", activeKey: `folder:${initialScope.project.id}`, scrollTop: 0 } : null);
      directMode = Boolean(props.directLaunch);
      lastLaunchNonce = props.launchNonce;
      focusInput();
    }
    if (!props.open && wasOpen) resetTransient();
    wasOpen = props.open;
  });
  createEffect(() => props.onPageChange?.(page()));

  const commands = createMemo(() => {
    const currentPage = page();
    const all = resolvePaletteCommands(props.context, { page: currentPage });
    const scope = chatScope();
    if (!chatPage()) return all;
    if (scope.kind === "unresolved") return [];
    return all.filter((command) => command.entity === "chat" && command.chat
      && chatNavigable(command.chat) && matchesChatView(command.chat)
      && (scope.kind === "all" || command.project?.id === scope.project.id));
  });

  const builtRows = createMemo<Row[]>(() => {
    if (!props.open) return [];
    const currentPage = page();
    const source = commands();
    const out: Row[] = [];
    let index = 0;
    const push = (row: Row) => out.push(row);

    if (moveMode()) {
      push({ type: "heading", key: "move-heading", label: "Move selected chats to" });
      for (const project of props.context.projects || []) {
        push({ type: "destination", key: `destination:${project.id}`, index: index++, project });
      }
      return out;
    }

    if (modelSelectorPage()) {
      const models = searching()
        ? (rankPaletteResults<PaletteCommand, ModelOption>({
          commands: [], models: props.scopeModels, query: parsedQuery().text, currentModel: "",
        }) || []).flatMap((row) => row.model ? [row.model] : [])
        : props.scopeModels;
      const scoped = models.filter((model) => props.enabledModelSpecs.includes(model.spec));
      const unscoped = models.filter((model) => !props.enabledModelSpecs.includes(model.spec));
      if (scoped.length) {
        push({ type: "heading", key: "scoped", label: "Scoped" });
        for (const model of scoped) push({ type: "model", key: `scoped:${model.spec}`, index: index++, model, scoped: true });
      }
      for (const group of groupModels(unscoped)) {
        push({ type: "heading", key: `m-${group.provider}`, label: group.provider });
        for (const model of group.items) push({ type: "model", key: `model:${model.spec}`, index: index++, model });
      }
      return out;
    }

    if (chatPage()) {
      const chatCommands = source.filter((command) => command.entity === "chat" && command.chat && command.project);
      const scope = chatScope();
      if (searching()) {
        const queryText = parsedQuery().text;
        const matches = [
          ...chatCommands.map((command) => ({ command, score: scorePaletteMatch({ label: command.label, query: queryText }) }))
            .filter((item) => item.score >= 0.42),
          ...(scope.kind === "all" ? props.context.projects.map((project) => ({ project, score: scorePaletteMatch({ label: project.name, query: queryText }) }))
            .filter((item) => item.score >= 0.42) : []),
        ].sort((left, right) => right.score - left.score || ("command" in left && "command" in right
          ? compareChatsBySort(left.command.chat!, right.command.chat!, chatSort()) : "project" in left ? -1 : 1));
        if (matches.length) push({ type: "heading", key: "search-results", label: "Results" });
        for (const match of matches) {
          if ("project" in match) push({ type: "folder", key: `folder:${match.project.id}`, index: index++, project: match.project, count: match.project.sessions.filter(chatNavigable).length, searchResult: true });
          else push({ type: "command", key: match.command.id, index: index++, command: match.command });
        }
        return out;
      }
      if (scope.kind === "project") {
        for (const command of chatCommands) push({ type: "command", key: command.id, index: index++, command });
        return out;
      }
      if (scope.kind === "unresolved") return out;
      if (chatCommands.length) {
        push({ type: "heading", key: "recent-heading", label: "Recent" });
        for (const command of chatCommands.slice(0, RECENT_COUNT)) push({ type: "command", key: `recent:${command.id}`, index: index++, command });
      }
      const projects = props.context.projects || [];
      const chatRoot = projects.find((project) => project.slug === "chat");
      const addFolder = (project: Project) => {
        const children = chatCommands.filter((command) => command.project?.id === project.id);
        push({ type: "folder", key: `folder:${project.id}`, index: index++, project, count: project.sessions.filter(chatNavigable).length });
        if (!expandedProjects().has(project.id)) return;
        const preview = children.slice(0, PREVIEW_COUNT);
        const current = children.find((command) => command.chat?.id === props.context.chatId);
        if (current && !preview.includes(current) && preview.length === PREVIEW_COUNT) preview[PREVIEW_COUNT - 1] = current;
        for (const command of preview) push({ type: "command", key: `preview:${command.id}`, index: index++, command, parentId: project.id });
        if (children.length > preview.length) push({ type: "browse-all", key: `browse:${project.id}`, index: index++, project, count: children.length });
      };
      // The chats outside any folder are a place of their own, between Recent
      // and the folders: one row that expands like a folder but is not one.
      if (chatRoot) { push({ type: "heading", key: "loose-heading", label: "" }); addFolder(chatRoot); }
      push({ type: "heading", key: "folders-heading", label: "Folders" });
      for (const project of projects.filter((project) => project.slug !== "chat" && !isWorkspace(project))) addFolder(project);
      for (const project of projects.filter((project) => project.slug !== "chat" && isWorkspace(project))) addFolder(project);
      return out;
    }

    if (searching()) {
      const ranked = rankPaletteResults<PaletteCommand, ModelOption>({
        commands: source,
        models: [],
        query: parsedQuery().text,
      }) || [];
      if (chatPage()) ranked.sort((left, right) => right.score - left.score
        || compareChatsBySort(left.command!.chat!, right.command!.chat!, chatSort()));
      // Each group once, in the order of its best match.
      const groupOf = (row: typeof ranked[number]) => chatPage() ? "Results" : row.command ? paletteGroupOf(row.command) : row.group;
      const firstSeen = new Map<string, number>();
      ranked.forEach((row, at) => { if (!firstSeen.has(groupOf(row))) firstSeen.set(groupOf(row), at); });
      ranked.sort((left, right) => firstSeen.get(groupOf(left))! - firstSeen.get(groupOf(right))!);
      let lastGroup = "";
      for (const row of ranked) {
        const group = groupOf(row);
        if (group !== lastGroup) {
          push({ type: "heading", key: `h-${group}-${index}`, label: GROUP_HEADINGS[group] || group });
          lastGroup = group;
        }
        if (row.kind === "model" && row.model) push({ type: "model", key: row.id, index: index++, model: row.model });
        else if (row.command) push({ type: "command", key: row.command.id, index: index++, command: row.command });
      }
      return out;
    }

    if (currentPage) {
      if (!chatPage()) {
        push({ type: "heading", key: "page-heading", label: pageMeta()?.heading || "Results" });
        for (const command of source) push({ type: "command", key: command.id, index: index++, command });
        return out;
      }
      let lastSection = "";
      for (const command of source) {
        const section = command.entity === "chat" ? (command.section || "Older") : "Actions";
        if (section !== lastSection) {
          push({ type: "heading", key: `chat-${section}`, label: section });
          lastSection = section;
        }
        push({ type: "command", key: command.id, index: index++, command });
      }
      return out;
    }

    for (const group of groupPaletteCommands(source)) {
      push({ type: "heading", key: `g-${group.id}`, label: group.heading });
      for (const command of group.items) push({ type: "command", key: command.id, index: index++, command });
    }
    return out;
  });

  /*
   * The rows drawn: a rebuild (a folder toggled, a chat's state changing) makes every row anew, and drawing each
   * again cost a toggle 30-80ms. A row whose content is the same keeps the object drawn for it, so only rows that
   * changed are drawn again; its place in the list is read from indexOf, which follows each rebuild.
   */
  let kept = new Map<string, Row>();
  const sameRow = (a: Row, b: Row) => {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) if (key !== "index" && left[key] !== right[key]) return false;
    return true;
  };
  const rows = createMemo<Row[]>(() => {
    const next = new Map<string, Row>();
    const out = builtRows().map((row) => {
      const before = kept.get(row.key);
      const use = before && sameRow(before, row) ? before : row;
      // Handlers read a row's place when they run; what is drawn reads it through indexOf.
      if (use !== row && "index" in row) (use as { index: number }).index = row.index;
      next.set(row.key, use);
      return use;
    });
    kept = next;
    return out;
  });
  const indexByKey = createMemo(() => new Map(builtRows().flatMap((row) => row.type === "heading" ? [] : [[row.key, row.index] as const])));
  const indexOf = (row: SelectableRow) => indexByKey().get(row.key) ?? row.index;
  const selectable = createMemo<SelectableRow[]>(() => rows().filter((row): row is SelectableRow => row.type !== "heading"));
  const allChatTargets = createMemo<ChatTarget[]>(() => (props.context.projects || []).flatMap((project) =>
    (project.sessions || []).map((chat) => ({ chat, project }))));
  const selectedTargets = createMemo<ChatTarget[]>(() => {
    const lookup = new Map(allChatTargets().map((target) => [target.chat.id, target]));
    return [...selectedChatIds()].map((id) => lookup.get(id)).filter((target): target is ChatTarget => Boolean(target));
  });
  const editingTarget = createMemo<ChatTarget | null>(() => {
    const id = editingId();
    return id ? allChatTargets().find((target) => target.chat.id === id) || null : null;
  });
  const activeChat = createMemo<ChatTarget | null>(() => {
    const row = selectable()[active()];
    if (!row || row.type !== "command" || row.command.entity !== "chat" || !row.command.chat || !row.command.project) return null;
    return { chat: row.command.chat, project: row.command.project };
  });
  const highlightedChat = createMemo<ChatTarget | null>(() => {
    const target = activeChat();
    if (target) return target;
    if (chatPage() && selectable()[active()]) return null;
    if (searching()) return null;
    const fallback = selectable().find((row): row is Extract<SelectableRow, { type: "command" }> => row.type === "command" && row.command.entity === "chat" && Boolean(row.command.chat && row.command.project));
    return fallback?.command.chat && fallback.command.project
      ? { chat: fallback.command.chat, project: fallback.command.project }
      : null;
  });

  createEffect(() => {
    const count = selectable().length;
    if (active() >= count) setActive(count ? count - 1 : 0);
  });
  createEffect(() => {
    void query(); void page(); void moveMode();
    setActive(0);
    const target = focusAfterQuery;
    focusAfterQuery = "input";
    if (props.open && !selectionMode() && !editingId() && target === "input") focusInput();
  });
  createEffect(() => { void chatView(); void chatSort(); setActive(0); });
  createEffect(() => {
    // The first row brings its group label into view with it.
    if (props.open && active() === 0 && listbox) listbox.scrollTop = 0;
    else if (props.open) document.getElementById(optionId(active()))?.scrollIntoView({ block: "nearest" });
  });
  createEffect(() => {
    // The field is shut while choosing a destination, so the list holds the keys.
    if ((selectionMode() || moveMode()) && props.open) queueMicrotask(() => listbox?.focus());
  });
  createEffect(() => {
    if (editingId() && props.open) queueMicrotask(() => { renameInput?.focus(); renameInput?.select(); });
  });

  const close = () => { resetTransient(); props.onOpenChange(false); };
  const runCommand = (command: PaletteCommand) => {
    if (FOCUS_MOVING_COMMAND_IDS.has(command.id)) returnFocus = null;
    close();
    requestAnimationFrame(() => command.run(props.actions));
  };
  const goBack = () => {
    if (moveMode()) {
      setMoveMode(false);
      if (!selectionMode()) setSelectedChatIds(new Set<string>());
      return;
    }
    if (chatPage() && chatScope().kind === "project") { backScope(); return; }
    setPage(null); setQuery(""); setSelectionMode(false); setSelectedChatIds(new Set<string>()); directMode = false;
  };

  const enterScope = (project: Project, searchHere = false) => {
    setScopeReturn({ query: query(), activeKey: selectable()[active()]?.key || `folder:${project.id}`, scrollTop: listbox?.scrollTop || 0 });
    const filter = project.slug === "chat" ? { kind: "scope" as const, value: "chats", raw: "scope:chats" }
      : { kind: "in" as const, value: project.id, raw: `in:${project.id}` };
    focusAfterQuery = searchHere ? "input" : "list";
    setQuery(serializeChatQuery([filter], parsedQuery().text));
    if (searchHere) focusInput();
    else requestAnimationFrame(() => { if (listbox) listbox.scrollTop = 0; listbox?.focus(); });
  };
  // Stepping out returns to the row it left from; from the input (Backspace
  // on the chip) typing carries on there.
  const backScope = (toList = true) => {
    const previous = scopeReturn();
    setScopeReturn(null);
    focusAfterQuery = toList ? "list" : "input";
    setQuery(previous?.query || parsedQuery().text);
    requestAnimationFrame(() => {
      const index = selectable().findIndex((row) => row.key === previous?.activeKey);
      setActive(index >= 0 ? index : 0);
      if (listbox) listbox.scrollTop = previous?.scrollTop || 0;
      if (toList) listbox?.focus();
    });
  };
  const lastActivity = (project: Project) => project.sessions.reduce<string | undefined>((latest, chat) => {
    const stamp = chatSortStamp(chat, chatSort());
    return stamp && (!latest || Date.parse(stamp) > Date.parse(latest)) ? stamp : latest;
  }, undefined);
  const toggleFolder = (id: string) => setExpandedProjects((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const scopeChipName = () => { const scope = chatScope(); return scope.kind === "project" ? (scope.project.slug === "chat" ? "Chats" : scope.project.name) : scope.kind === "unresolved" ? scope.value : ""; };
  const scopeName = () => { const scope = chatScope(); return scope.kind === "project" ? scope.project.name : "All chats"; };
  const emptyMessage = () => {
    if (modelSelectorPage()) return "No matching models.";
    const scope = chatScope();
    if (scope.kind === "unresolved") return `No chats in “${scope.value}”.`;
    if (chatPage()) {
      if (searching()) return scope.kind === "project" ? `No matches in ${scope.project.name}.` : "No matching chats or folders.";
      return scope.kind === "project" ? `No chats in ${scope.project.name}.` : "No chats yet.";
    }
    return "No matching commands.";
  };

  const toggleChatSelection = (id: string) => {
    setSelectedChatIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const enterSelection = (target = highlightedChat()) => {
    if (!chatPage()) return;
    if (target) setSelectedChatIds(new Set([target.chat.id]));
    setSelectionMode(true);
  };
  const startRename = () => {
    if (selectionMode() || moveMode()) return;
    const target = highlightedChat();
    if (!target) return;
    setEditingId(target.chat.id);
    setEditingValue(target.chat.title || "");
  };
  const submitRename = async () => {
    const target = editingTarget();
    const value = editingValue().trim();
    if (!target || !value) return;
    const saved = await props.actions.renameChat(target.chat, target.project, value);
    if (saved) setEditingId(null);
  };
  const copySelected = () => { if (selectedTargets().length) void props.actions.copyChatLinks(selectedTargets()); };
  const selectDeleteChoice = (choice: "cancel" | "confirm") => {
    setDeleteChoice(choice);
    queueMicrotask(() => (choice === "confirm" ? deleteConfirmButton : deleteCancelButton)?.focus());
  };
  const requestDelete = (targets = selectedTargets()) => {
    if (!targets.length) return;
    setDeleteChoice("cancel");
    setPendingDelete(targets);
  };
  const requestActiveDelete = () => {
    const target = highlightedChat();
    if (target) requestDelete([target]);
  };
  const confirmDelete = async () => {
    const targets = pendingDelete();
    if (!targets) return;
    setPendingDelete(null);
    const failed = await props.actions.deleteChats(targets);
    setSelectedChatIds(new Set(failed));
    if (!failed.length) { setSelectionMode(false); close(); }
  };
  const chooseDestination = async (project: Project) => {
    const targets = selectedTargets();
    if (!targets.length) return;
    const failed = await props.actions.moveChats(targets, project);
    setSelectedChatIds(new Set(failed));
    if (!failed.length) { setSelectionMode(false); setMoveMode(false); close(); }
  };
  const moveSelected = (targets = selectedTargets()) => {
    if (!targets.length) return;
    setMoveMode(true);
  };
  const moveHighlighted = () => {
    const target = highlightedChat();
    if (!target) return;
    setSelectedChatIds(new Set([target.chat.id]));
    moveSelected([target]);
  };
  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedChatIds(new Set<string>());
    if (moveMode()) setMoveMode(false);
    focusInput();
  };
  const toggleSelection = () => {
    if (selectionMode()) exitSelection();
    else enterSelection();
  };

  const openPalettePage = (nextPage: string, direct = false) => {
    setPage(nextPage);
    setQuery("");
    setMoveMode(false);
    setSelectionMode(false);
    setSelectedChatIds(new Set<string>());
    directMode = direct;
  };

  const runPaletteShortcut = (commandId: string) => {
    const command = commands().find((candidate) => candidate.id === commandId);
    if (!command) return;
    if (command.kind === "page" && command.page) {
      openPalettePage(canonicalPage(command.page)!, command.id === COMMAND_IDS.searchChats);
      return;
    }
    runCommand(command);
  };

  const paletteRootCommandIds = commandRegistry
    .filter((command) => command.contexts.includes("palette.root") && command.defaultBindings.length)
    .map((command) => command.id);
  const palettePageCommands = [
    [COMMAND_IDS.searchChats, "chat-search"],
    [COMMAND_IDS.openSettings, "settings"],
    [COMMAND_IDS.openWorkspaceViews, "workspace"],
  ] as const;
  const releaseShortcutHandlers = [
    ...paletteRootCommandIds.map((commandId) =>
      props.shortcuts.registerHandler(commandId, "palette.root", () => runPaletteShortcut(commandId))),
    ...palettePageCommands.map(([commandId, targetPage]) =>
      props.shortcuts.registerHandler(commandId, "palette.page", () =>
        openPalettePage(targetPage, commandId === COMMAND_IDS.searchChats))),
    props.shortcuts.registerHandler(COMMAND_IDS.openModelSelector, "model-selector", close),
    props.shortcuts.registerHandler(COMMAND_IDS.toggleModelScope, "model-selector", toggleActiveModelScope),
    props.shortcuts.registerHandler(COMMAND_IDS.toggleChatEdit, "chat-search.browse", toggleSelection),
    props.shortcuts.registerHandler(COMMAND_IDS.searchChats, "chat-search.browse", close),
    props.shortcuts.registerHandler(COMMAND_IDS.renameHighlightedChat, "chat-search.browse", startRename),
    props.shortcuts.registerHandler(COMMAND_IDS.moveHighlightedChat, "chat-search.browse", moveHighlighted),
    props.shortcuts.registerHandler(COMMAND_IDS.deleteHighlightedChat, "chat-search.browse", requestActiveDelete),
    props.shortcuts.registerHandler(COMMAND_IDS.toggleChatEdit, "chat-search.edit", toggleSelection),
    props.shortcuts.registerHandler(COMMAND_IDS.searchChats, "chat-search.edit", close),
    props.shortcuts.registerHandler(COMMAND_IDS.moveSelectedChats, "chat-search.edit", moveSelected),
    props.shortcuts.registerHandler(COMMAND_IDS.deleteSelectedChats, "chat-search.edit", requestDelete),
    props.shortcuts.registerHandler(COMMAND_IDS.searchChats, "chat-search.move", close),
    props.shortcuts.registerHandler(COMMAND_IDS.searchChats, "chat-search.rename", close),
  ];
  onCleanup(() => releaseShortcutHandlers.forEach((release) => release()));

  createEffect(() => {
    if (!props.open) return;
    let context: ShortcutContext;
    let exclusive = false;
    if (pendingDelete()) {
      context = "confirmation";
      exclusive = true;
    } else if (editingId()) {
      context = "chat-search.rename";
      exclusive = true;
    } else if (moveMode()) {
      context = "chat-search.move";
      exclusive = true;
    } else if (chatPage()) {
      context = selectionMode() ? "chat-search.edit" : "chat-search.browse";
    } else if (modelSelectorPage()) {
      context = "model-selector";
      exclusive = true;
    } else {
      context = page() ? "palette.page" : "palette.root";
    }
    const release = props.shortcuts.activateContext(context, { exclusive });
    onCleanup(release);
  });

  const runRow = (row?: SelectableRow) => {
    if (!row) return;
    if (row.type === "model") {
      if (modelSelectorPage()) {
        if (row.scoped) { close(); requestAnimationFrame(() => props.onChooseModel(row.model.spec)); }
        return;
      }
      close(); requestAnimationFrame(() => props.onChooseModel(row.model.spec));
      return;
    }
    if (row.type === "destination") { void chooseDestination(row.project); return; }
    if (row.type === "browse-all") { enterScope(row.project); return; }
    if (row.type === "folder") {
      if (selectionMode()) { toggleFolder(row.project.id); return; }
      enterScope(row.project);
      return;
    }
    const command = row.command;
    if (selectionMode() && command.entity === "chat" && command.chat) { toggleChatSelection(command.chat.id); return; }
    if (command.kind === "page" && command.page) {
      setPage(canonicalPage(command.page)); setQuery(""); setMoveMode(false); setSelectionMode(false); setSelectedChatIds(new Set<string>()); directMode = false; return;
    }
    runCommand(command);
  };

  const rowProject = (row?: SelectableRow) => row?.type === "folder" || row?.type === "browse-all" ? row.project
    : row?.type === "command" ? row.command.project || null : null;
  const openRowProject = (row?: SelectableRow) => {
    const project = rowProject(row);
    if (!project) return;
    close();
    requestAnimationFrame(() => props.actions.openProject(project));
  };

  const runPointerRow = (row: SelectableRow, event: MouseEvent) => {
    if (row.type === "command" && chatPage() && !selectionMode() && !moveMode() && !editingId()
      && (event.ctrlKey || event.metaKey) && row.command.entity === "chat"
      && row.command.chat && row.command.project) {
      event.preventDefault();
      event.stopPropagation();
      setActive(indexOf(row));
      enterSelection({ chat: row.command.chat, project: row.command.project });
      return;
    }
    runRow(row);
  };

  const move = (delta: number) => {
    const count = selectable().length;
    if (!count) return;
    setActive((current) => chatPage() ? Math.min(count - 1, Math.max(0, current + delta)) : (current + delta + count) % count);
  };

  function toggleActiveModelScope() {
    const row = selectable()[active()];
    if (!modelSelectorPage() || row?.type !== "model") return;
    const spec = row.model.spec;
    props.onToggleModelScope(spec);
    queueMicrotask(() => {
      const index = selectable().findIndex((candidate) => candidate.type === "model" && candidate.model.spec === spec);
      if (index >= 0) setActive(index);
    });
  }

  const keydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const inList = event.currentTarget === listbox;
    // Unmodified selection actions belong to the result list. When the search
    // input owns the event, letters and Delete must edit the query instead.
    if (selectionMode() && event.currentTarget !== input
      && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === " ") { event.preventDefault(); const target = activeChat(); if (target) toggleChatSelection(target.chat.id); return; }
      if (key === "c") { event.preventDefault(); copySelected(); return; }
      if (key === "/") { event.preventDefault(); input?.focus(); return; }
    }
    if (chatPage() && inList && !moveMode()) {
      const row = selectable()[active()];
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const project = row?.type === "folder" || row?.type === "browse-all" ? row.project : row?.type === "command" ? row.command.project : null;
        if (project && chatScope().kind === "all") enterScope(project, true);
        else focusInput();
        return;
      }
      if (event.key === "ArrowRight" && row?.type === "folder") {
        event.preventDefault();
        if (searching()) enterScope(row.project);
        else if (!expandedProjects().has(row.project.id)) toggleFolder(row.project.id);
        else if (selectable()[active() + 1]?.type === "command" && (selectable()[active() + 1] as Extract<SelectableRow, { type: "command" }>).parentId === row.project.id) move(1);
        else if (row.count) enterScope(row.project);
        return;
      }
      if (event.key === "ArrowRight" && row?.type === "browse-all") { event.preventDefault(); enterScope(row.project); return; }
      if (event.key === "ArrowLeft") {
        if ((row?.type === "command" && row.parentId) || row?.type === "browse-all") {
          event.preventDefault();
          const parentId = row.type === "browse-all" ? row.project.id : row.parentId;
          const parent = selectable().findIndex((item) => item.type === "folder" && item.project.id === parentId);
          if (parent >= 0) setActive(parent);
          return;
        }
        if (row?.type === "folder" && expandedProjects().has(row.project.id)) { event.preventDefault(); toggleFolder(row.project.id); return; }
        if (chatScope().kind !== "all") { event.preventDefault(); backScope(); return; }
      }
      if (event.key === "PageDown" || event.key === "PageUp") { event.preventDefault(); move(event.key === "PageDown" ? 10 : -10); return; }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !selectionMode()) {
        event.preventDefault();
        setQuery(serializeChatQuery(parsedQuery().filters, `${parsedQuery().text}${event.key}`));
        focusInput();
        return;
      }
    }
    if (event.key === "ArrowDown") { event.preventDefault(); if (chatPage() && !inList) listbox?.focus(); else move(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); if (chatPage() && !inList) { setActive(Math.max(0, selectable().length - 1)); listbox?.focus(); } else if (chatPage() && active() === 0) input?.focus(); else move(-1); return; }
    if (event.key === "Home" && (!chatPage() || inList)) { event.preventDefault(); setActive(0); return; }
    if (event.key === "End" && (!chatPage() || inList)) { event.preventDefault(); setActive(Math.max(0, selectable().length - 1)); return; }
    if (event.key === "Tab" && !event.shiftKey) {
      const row = selectable()[active()];
      if (row?.type === "command" && row.command.kind === "page") { event.preventDefault(); runRow(row); }
      return;
    }
    if (chatPage() && (event.ctrlKey || event.metaKey) && !event.altKey && key === "p") { event.preventDefault(); togglePreview(); return; }
    if (event.key === "Enter" && chatPage() && (event.ctrlKey || event.metaKey) && !selectionMode() && !moveMode()) { event.preventDefault(); openRowProject(selectable()[active()]); return; }
    // Nothing is lit from a fresh search field, so Enter there goes to the list
    // rather than opening a row the reader cannot see chosen.
    if (event.key === "Enter" && chatPage() && !inList && !searching() && !pointerCursor()) { event.preventDefault(); listbox?.focus(); return; }
    if (event.key === "Enter") { event.preventDefault(); runRow(selectable()[active()]); return; }
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (editingId()) { setEditingId(null); return; }
      if (moveMode()) { goBack(); return; }
      if (selectionMode()) { exitSelection(); return; }
      if (chatPage()) {
        if (parsedQuery().text) { setQuery(serializeChatQuery(parsedQuery().filters, "")); focusInput(); }
        else if (inList) {
          const row = selectable()[active()];
          const parentId = row?.type === "command" ? row.parentId : row?.type === "browse-all" ? row.project.id : null;
          const parent = parentId ? selectable().findIndex((item) => item.type === "folder" && item.project.id === parentId) : -1;
          if (parent >= 0) setActive(parent);
          else if (row?.type === "folder" && expandedProjects().has(row.project.id)) toggleFolder(row.project.id);
          else if (chatScope().kind !== "all") backScope();
          else close();
        } else if (chatScope().kind !== "all") backScope(false);
        else close();
      }
      else if (page() && !directMode) goBack();
      else close();
    }
    if (event.key === "Backspace" && chatPage() && !parsedQuery().text && (event.currentTarget === input || inList)) {
      if (chatView() !== "all") { event.preventDefault(); setChatView("all"); }
      else if (chatScope().kind !== "all") { event.preventDefault(); backScope(inList); }
    }
    // Backspace edits the query. It never exits a page when no filter remains.
  };

  const renameKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); void submitRename(); }
    if (event.key === "Escape") { event.preventDefault(); setEditingId(null); }
  };

  const changeOpen = (open: boolean) => { if (!open) close(); else props.onOpenChange(true); };

  // The rows in their groups: a heading opens a Section; an untitled one is a break between groups.
  const sections = createMemo(() => {
    const out: { key: string; label: string; rows: SelectableRow[] }[] = [];
    for (const row of rows()) {
      if (row.type === "heading") out.push({ key: row.key, label: row.label, rows: [] });
      else { if (!out.length) out.push({ key: "top", label: "", rows: [] }); out.at(-1)!.rows.push(row); }
    }
    return out.filter((section) => section.rows.length);
  });
  /*
   * The sections drawn: each a run of blocks, a row and (a folder's) the rows under it. Drawn by key, so what a
   * toggle rebuilds keeps its place -- a folder's Expand above all, which slides its chats open and shut.
   */
  type Block = { key: string; row: SelectableRow; children: SelectableRow[] };
  const sectionsByKey = createMemo(() => new Map(sections().map((section) => {
    const blocks: Block[] = [];
    for (const row of section.rows) {
      const folder = blocks.at(-1);
      const under = folder?.row.type === "folder" && ((row.type === "command" && row.parentId === folder.row.project.id) || (row.type === "browse-all" && row.project.id === folder.row.project.id));
      if (under) folder!.children.push(row); else blocks.push({ key: row.key, row, children: [] });
    }
    return [section.key, { label: section.label, blocks }] as const;
  })));
  const queryText = () => parsedQuery().text;
  // The cursor is lit only where it acts (see listFocused); the pointer moves it, and a press keeps focus where it is.
  const lit = (row: SelectableRow) => active() === indexOf(row)
    && (!chatPage() || listFocused() || pointerCursor() || searching() || selectionMode() || moveMode());
  const rowProps = (row: SelectableRow) => ({
    get id() { return optionId(indexOf(row)); },
    get role() { return chatPage() && !moveMode() ? "treeitem" : "option"; },
    get "aria-selected"() { return lit(row); },
    get active() { return lit(row); },
    onMouseDown: (event: MouseEvent) => event.preventDefault(),
    onCursor: () => { setPointerCursor(true); setActive(indexOf(row)); },
    onClick: (event: MouseEvent) => runPointerRow(row, event),
  });
  const placeIcon = (project: Project) => project.slug === "chat" ? <MessageSquareIcon /> : <PlaceGlyph project={project} />;

  const renderRow = (row: SelectableRow) => {
    if (row.type === "model") {
      if (modelSelectorPage()) return <Item {...rowProps(row)} checked={row.model.spec === props.currentModel || undefined} meta={row.model.spec}><Match text={row.model.label} query={queryText()} /></Item>;
      return <Item {...rowProps(row)} icon={<SlidersHorizontalIcon />} meta={row.model.spec}>{row.model.label}</Item>;
    }
    if (row.type === "destination") return <Item {...rowProps(row)} icon={placeIcon(row.project)}>{row.project.name}</Item>;
    if (row.type === "folder") {
      const expanded = () => expandedProjects().has(row.project.id);
      const unread = () => row.project.sessions.filter((chat) => chat.unread).length;
      const live = () => row.project.sessions.filter((chat) => { const activity = chatActivity(chat); return activity && activity !== "idle"; }).length;
      const facts = () => [String(row.count), lastActivity(row.project) ? formatChatDate(lastActivity(row.project)) : ""].filter(Boolean).join(" · ");
      return <Item {...rowProps(row)} role="treeitem" aria-level={1} aria-expanded={row.searchResult ? undefined : expanded()} aria-current={props.context.project?.id === row.project.id ? "page" : undefined}
        icon={placeIcon(row.project)} opens onOpens={row.searchResult ? undefined : () => toggleFolder(row.project.id)} opensLabel={`${expanded() ? "Collapse" : "Expand"} ${row.project.name}`}
        meta={<><Show when={live() || unread()}><StatusDot label={live() ? `${live()} active` : `${unread()} unread`} tone={live() ? "active" : "unread"} /></Show>{facts()}</>}
        reveal end={<Button variant="ghost" size="icon-xs" tabIndex={-1} aria-label={`Search in ${row.project.name}`} title={`Search in ${row.project.name}`} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); enterScope(row.project, true); }}><SearchIcon /></Button>}>
        <Match text={row.project.name} query={queryText()} />
      </Item>;
    }
    if (row.type === "browse-all") return <Item {...rowProps(row)} role="treeitem" aria-level={2} indent opens>Browse all {row.count} chats</Item>;
    const command = row.command;
    const Icon = icons[command.icon];
    const chatSelected = () => Boolean(command.chat && selectedChatIds().has(command.chat.id));
    const editing = () => command.chat?.id === editingId();
    const meta = () => {
      if (editing()) return "Enter to save · Escape to cancel";
      if (!command.chat) return undefined;
      const activity = chatActivity(command.chat);
      return [
        activity && activity !== "idle" ? `${activityLabel(activity)}${props.runtime.stale() ? " (last known)" : ""}` : "",
        !(chatPage() && chatScope().kind === "project") && command.project?.slug !== "chat" ? command.detail || "" : "",
        formatChatDate(chatSortStamp(command.chat, chatSort())),
      ].filter(Boolean).join(" · ");
    };
    return <Item {...rowProps(row)} title={command.chat?.title || command.label} aria-level={chatPage() ? row.parentId ? 2 : 1 : undefined} aria-current={command.chat?.id === props.context.chatId ? "page" : undefined}
      destructive={command.destructive} checked={command.checked || undefined} indent={Boolean(row.parentId)} picked={selectionMode() && command.entity === "chat" ? chatSelected() : undefined}
      icon={command.chat ? <RuntimeIndicator process={props.runtime.getProcess(command.chat.id)} stale={props.runtime.stale()} unread={command.chat.unread} fallback={<ThreadHarnessMark id={command.chat.harnessId} lively />} /> : Icon ? <Icon /> : undefined}
      meta={meta()} keys={commandShortcut(command)?.split(/\s+/)} opens={command.kind === "page"}>
      <Show when={editing()} fallback={<Match text={command.label} query={queryText()} />}>
        <Input ref={renameInput} value={editingValue()} onInput={(event) => setEditingValue(event.currentTarget.value)} onKeyDown={renameKeydown} onClick={(event) => event.stopPropagation()} aria-label={`Rename ${command.label}`} />
      </Show>
    </Item>;
  };

  // On a phone the keys mean nothing: the hints give way to a bar of the view's actions.
  const phoneActions = (): OverlayAction[] => {
    if (!chatPage() || moveMode()) return [];
    if (selectionMode()) return [
      { label: `Move ${selectedTargets().length || ""}`.trim(), disabled: !selectedTargets().length, onClick: () => moveSelected() },
      { label: `Delete ${selectedTargets().length || ""}`.trim(), destructive: true, disabled: !selectedTargets().length, onClick: () => requestDelete() },
      { label: "Done", onClick: () => exitSelection() },
    ];
    const scope = chatScope();
    return [
      { label: "Edit", onClick: () => enterSelection() },
      { label: chatSort() === "latest" ? "Latest" : "Created", onClick: () => saveChatSort(chatSort() === "latest" ? "created" : "latest") },
      ...(scope.kind === "project" ? [{ label: `Open ${scopeChipName()}`, onClick: () => { close(); requestAnimationFrame(() => props.actions.openProject(scope.project)); } }] : []),
    ];
  };
  const back = () => moveMode() || (page() && !chatPage() && !modelSelectorPage());
  const label = () => modelSelectorPage() ? "Model selector" : chatPage() ? "Chat search" : "Command palette";
  const withPreview = () => chatPage() && previewOpen() && !moveMode();

  return <>
    <OverlayDialog
      open={props.open}
      onOpenChange={changeOpen}
      label={label()}
      style={{ "--overlay-width": withPreview() ? "calc(81.25 * var(--u-space))" : chatPage() || modelSelectorPage() ? "calc(56.25 * var(--u-space))" : undefined, "--overlay-height": chatPage() ? "calc(45 * var(--u-space))" : "calc(37.5 * var(--u-space))" }}
      onOpenAutoFocus={(event) => { event.preventDefault(); focusInput(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}
    >
      <OverlayBar
        lead={back() ? <Button variant="ghost" size="icon-sm" aria-label={moveMode() ? "Back to chat results" : "Back to commands"} title="Back" onMouseDown={(event) => event.preventDefault()} onClick={goBack}><ArrowLeftIcon /></Button>
          : chatPage() ? <SearchIcon /> : modelSelectorPage() ? <SlidersHorizontalIcon /> : <ChevronRightIcon />}
        chips={<>
          <Show when={!chatPage() && !modelSelectorPage() && pageMeta()}>{(meta) => <Crumbs label="Where you are" items={[{ label: "Commands", onClick: goBack }, { label: meta().heading, current: true }]} />}</Show>
          <Show when={chatPage() && !moveMode() && chatScope().kind !== "all"}><OverlayChip onRemove={() => { backScope(false); focusInput(); }}>{`in:${scopeChipName()}`}</OverlayChip></Show>
          <Show when={chatPage() && !moveMode() && chatView() !== "all"}><OverlayChip onRemove={() => { setChatView("all"); focusInput(); }}>{VIEW_LABELS[chatView()]}</OverlayChip></Show>
        </>}
        placeholder={moveMode() ? "Choose destination…" : chatPage() ? chatScope().kind === "project" ? `Search ${scopeName()} chats…` : "Search chats, projects, workspaces…" : modelSelectorPage() ? "Find models…" : pageMeta()?.placeholder || "Run a command…"}
        value={moveMode() ? "" : parsedQuery().text}
        onInput={(value) => {
          // A finished is:… token becomes the activity chip.
          const view = chatPage() ? /(^|\s)is:(\w+)\s$/i.exec(value) : null;
          if (view && VIEW_TOKENS[view[2]!.toLowerCase()]) { setChatView(VIEW_TOKENS[view[2]!.toLowerCase()]!); value = value.slice(0, view.index); input.value = value; }
          setQuery(serializeChatQuery(parsedQuery().filters, value));
        }}
        field={{
          ref: (element: HTMLInputElement) => { input = element; },
          role: "combobox",
          "aria-expanded": "true",
          "aria-controls": "command-listbox",
          "aria-autocomplete": "list",
          get "aria-haspopup"() { return chatPage() ? "tree" as const : "listbox" as const; },
          get "aria-activedescendant"() { return selectable().length ? optionId(active()) : undefined; },
          get "aria-label"() { return moveMode() ? "Choose destination" : modelSelectorPage() ? "Find models" : chatPage() ? "Search chats" : "Search commands"; },
          get disabled() { return moveMode(); },
          onKeyDown: keydown,
        }}
        end={<Show when={chatPage() && !moveMode() && !isMobileLayout()}>
          <span onMouseDown={(event) => event.preventDefault()}><Segmented label="Chat sort" size="sm" value={chatSort()} onChange={saveChatSort} options={[{ value: "latest", label: "Latest" }, { value: "created", label: "Created" }]} /></span>
        </Show>}
        onClose={close}
        closeLabel={chatPage() ? "Close chat search" : "Close command palette"}
      />
      <OverlaySplit aside={withPreview() ? <ChatPreview target={activeChat()} folder={rowProject(selectable()[active()])} active={(chat) => { const activity = chatActivity(chat); return Boolean(activity && activity !== "idle"); }} /> : undefined}>
        <OverlayList managed id="command-listbox" ref={listbox} role={chatPage() && !moveMode() ? "tree" : "listbox"} aria-label={modelSelectorPage() ? "Models" : chatPage() ? "Chat browser" : "Commands"}
          aria-activedescendant={selectable().length ? optionId(active()) : undefined} tabIndex={chatPage() || selectionMode() || moveMode() ? 0 : -1}
          onFocus={() => setListFocused(true)} onBlur={() => setListFocused(false)} onMouseLeave={() => setPointerCursor(false)} onKeyDown={keydown}>
          <Show when={selectable().length} fallback={<OverlayEmpty>{emptyMessage()}</OverlayEmpty>}>
            <For each={sections().map((section) => section.key)}>{(key) => {
              const section = () => sectionsByKey().get(key);
              return <Show when={section()}><Section title={section()!.label || undefined}>
                <For each={section()!.blocks.map((block) => block.key)}>{(blockKey) => {
                  const block = () => section()?.blocks.find((item) => item.key === blockKey);
                  return <>
                    <Show when={block()?.row} keyed>{renderRow}</Show>
                    {/* A folder's chats open under it (Expand), and shut the same way. */}
                    <Show when={block()?.row.type === "folder"}><Expand open={Boolean(block()?.children.length)}><For each={block()?.children ?? []}>{renderRow}</For></Expand></Show>
                  </>;
                }}</For>
              </Section></Show>;
            }}</For>
          </Show>
        </OverlayList>
      </OverlaySplit>
      <CommandHintBar
        context={hintContext()}
        mode={modelSelectorPage() ? "model-selector" : hintMode()}
        pendingSequence={pendingActionSequence()}
        shortcuts={props.shortcuts}
        scoped={chatScope().kind !== "all"}
        selectedCount={selectionMode() ? selectedTargets().length : null}
        onToggleEdit={toggleSelection}
        onDeleteSelected={() => requestDelete()}
        onMoveSelected={() => moveSelected()}
        previewOpen={previewOpen()}
        onTogglePreview={togglePreview}
      />
      <Show when={phoneActions().length}><OverlayActions actions={phoneActions()} /></Show>
    </OverlayDialog>
    <Dialog alert open={Boolean(pendingDelete())}
      onOpenChange={(open) => { if (!open) { setPendingDelete(null); focusInput(); } }}
      onOpenAutoFocus={(event) => { event.preventDefault(); selectDeleteChoice("cancel"); }}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          selectDeleteChoice("cancel");
        } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          selectDeleteChoice("confirm");
        }
      }}
      title={`Delete ${pendingDelete()?.length || 0} chats?`}
      description="This permanently deletes the selected session transcripts and attached files."
      actions={<>
        <Button
          ref={deleteCancelButton}
          variant="ghost" outline
          data-selected={deleteChoice() === "cancel"}
          onFocus={() => setDeleteChoice("cancel")}
          onClick={() => { setPendingDelete(null); focusInput(); }}
       >Cancel</Button>
        <Button
          ref={deleteConfirmButton}
          variant="destructive" outline={deleteChoice() !== "confirm"}
          data-selected={deleteChoice() === "confirm"}
          onFocus={() => setDeleteChoice("confirm")}
          onClick={() => void confirmDelete()}
       >Delete chats</Button>
      </>} />
  </>;
}
