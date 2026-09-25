import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import * as KDialog from "@kobalte/core/dialog";
import {
  ArrowLeftIcon, BrainIcon, CheckIcon, ChevronRightIcon, CopyIcon, FileInputIcon, FilePlus2Icon,
  FolderIcon, FolderInputIcon, FolderPlusIcon, LayersIcon, LogOutIcon, MessageSquareIcon, MicIcon,
  MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, PlayIcon, RefreshCwIcon, SearchIcon, SettingsIcon,
  SlashIcon, SlidersHorizontalIcon, SquareIcon, TerminalIcon, Trash2Icon, XIcon,
} from "lucide-solid";
import { Button } from "@/components/primitives";
import { activityLabel } from "../../activity.js";
import type { ChatSummary, ModelOption, Project } from "../api/contracts";
import {
  groupPaletteCommands, PALETTE_PAGES, resolvePaletteCommands,
} from "../palette/command-registry";
import type { PaletteActions, PaletteCommand, PaletteContext } from "../palette/command-registry";
import { rankPaletteResults } from "../palette/palette-search";
import { scorePaletteMatch } from "../palette/palette-search";
import {
  parseChatQuery, resolveChatQueryScope, serializeChatQuery,
} from "../palette/chat-query";
import { COMMAND_IDS, commandRegistry } from "../commands/command-registry";
import { chatSortStamp, compareChatsBySort, useChatSort } from "../preferences/chat-sort";
import { ThreadHarnessMark } from "../harness-brand";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import type { ShortcutContext } from "../shortcuts/shortcut-types";
import { CommandHintBar } from "./command-hint-bar";
import type { CommandHintContext, CommandHintMode } from "./command-hint-bar";
import { RuntimeIndicator, visibleRuntimeActivity } from "./runtime-indicator";
import type { RuntimeStore } from "../state/runtime";
import { WorkspaceGlyph } from "../project/workspace-appearance";

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

const GROUP_HEADINGS: Record<string, string> = {
  commands: "Commands",
  settings: "Settings",
  navigation: "Chat actions",
  profiles: "Profiles",
  thinking: "Thinking level",
  danger: "Danger zone",
};

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
  scopeModels: ModelOption[];
  enabledModelSpecs: string[];
  onToggleModelScope: (spec: string) => void;
  shortcuts: ShortcutManager;
  onPageChange?: (page: string | null) => void;
  details?: JSX.Element;
}) {
  const chatSort = useChatSort();
  const [query, setQuery] = createSignal("");
  const [page, setPage] = createSignal<string | null>(null);
  const [active, setActive] = createSignal(0);
  const [chatMode, setChatMode] = createSignal<ChatSearchMode>({ kind: "browse" });
  const [selectedChatIds, setSelectedChatIds] = createSignal<Set<string>>(new Set());
  const [editingValue, setEditingValue] = createSignal("");
  const [chatView, setChatView] = createSignal<"all" | "attention" | "progress" | "unread">("all");
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(new Set());
  const [scopeReturn, setScopeReturn] = createSignal<ScopeReturn | null>(null);
  const [deleteChoice, setDeleteChoice] = createSignal<"cancel" | "confirm">("cancel");
  const [shortcutRevision, setShortcutRevision] = createSignal(0);
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

  const rows = createMemo<Row[]>(() => {
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
      const projects = props.context.projects || [];
      const chatRoot = projects.find((project) => project.slug === "chat");
      push({ type: "heading", key: "browse-heading", label: "Browse" });
      if (chatRoot) addFolder(chatRoot);
      const folders = projects.filter((project) => project.slug !== "chat" && !isWorkspace(project));
      if (folders.length) push({ type: "heading", key: "projects-heading", label: "Projects" });
      for (const project of folders) addFolder(project);
      const workspaces = projects.filter((project) => project.slug !== "chat" && isWorkspace(project));
      if (workspaces.length) push({ type: "heading", key: "workspaces-heading", label: "Workspaces" });
      for (const project of workspaces) addFolder(project);
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
      let lastGroup = "";
      for (const row of ranked) {
        const group = chatPage() ? "Results" : row.group;
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
    if (props.open) document.getElementById(optionId(active()))?.scrollIntoView({ block: "nearest" });
  });
  createEffect(() => {
    if (selectionMode() && props.open) queueMicrotask(() => listbox?.focus());
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
  const backScope = () => {
    const previous = scopeReturn();
    setScopeReturn(null);
    focusAfterQuery = "list";
    setQuery(previous?.query || parsedQuery().text);
    requestAnimationFrame(() => {
      const index = selectable().findIndex((row) => row.key === previous?.activeKey);
      setActive(index >= 0 ? index : 0);
      if (listbox) listbox.scrollTop = previous?.scrollTop || 0;
      listbox?.focus();
    });
  };
  const toggleFolder = (id: string) => setExpandedProjects((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
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
    const id = editingId();
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
      close();
      requestAnimationFrame(() => props.actions.openProject(row.project));
      return;
    }
    const command = row.command;
    if (selectionMode() && command.entity === "chat" && command.chat) { toggleChatSelection(command.chat.id); return; }
    if (command.kind === "page" && command.page) {
      setPage(canonicalPage(command.page)); setQuery(""); setMoveMode(false); setSelectionMode(false); setSelectedChatIds(new Set<string>()); directMode = false; return;
    }
    runCommand(command);
  };

  const runPointerRow = (row: SelectableRow, event: MouseEvent) => {
    if (row.type === "command" && chatPage() && !selectionMode() && !moveMode() && !editingId()
      && (event.ctrlKey || event.metaKey) && row.command.entity === "chat"
      && row.command.chat && row.command.project) {
      event.preventDefault();
      event.stopPropagation();
      setActive(row.index);
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
        else enterScope(row.project);
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
        if (chatScope().kind === "project") { event.preventDefault(); backScope(); return; }
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
          else if (chatScope().kind === "project") backScope();
          else close();
        } else if (chatScope().kind === "project") backScope();
        else close();
      }
      else if (page() && !directMode) goBack();
      else close();
    }
    if (event.key === "Backspace" && chatPage() && !parsedQuery().text && chatScope().kind === "project") {
      event.preventDefault();
      backScope();
    }
    // Backspace edits the query. It never exits a page when no filter remains.
  };

  const renameKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); void submitRename(); }
    if (event.key === "Escape") { event.preventDefault(); setEditingId(null); }
  };

  const changeOpen = (open: boolean) => { if (!open) close(); else props.onOpenChange(true); };

  const renderRow = (row: Row) => {
    if (row.type === "heading") return <p class="command-group-label" role="presentation">{row.label}</p>;
    const selected = () => active() === row.index;
    const commonProps = {
      id: optionId(row.index),
      role: chatPage() && !moveMode() ? "treeitem" : "option",
      "aria-selected": selected(),
      class: "command-option",
      // Keep focus in the input or list so keyboard control survives a click.
      onMouseDown: (event: MouseEvent) => event.preventDefault(),
      onMouseMove: () => setActive(row.index),
      onClick: (event: MouseEvent) => runPointerRow(row, event),
    } as const;
    if (row.type === "model") {
      if (modelSelectorPage()) return <div {...commonProps} class="command-option command-model-option" data-highlighted={selected() || undefined} data-scoped={row.scoped || undefined}>
        <span class="command-model-label">{row.model.label}</span><small class="command-model-spec">{row.model.spec}</small>
      </div>;
      const Icon = icons.model!;
      return <div {...commonProps} data-highlighted={selected() || undefined}>
        <Icon class="command-icon" />
        <span class="command-copy"><span class="command-label">{row.model.label}</span><small>{row.model.spec}</small></span>
      </div>;
    }
    if (row.type === "destination") {
      return <div {...commonProps} data-highlighted={selected() || undefined}>
        <FolderIcon class="command-icon" />
        <span class="command-copy"><span class="command-label">{row.project.name}</span><small>{row.project.slug === "chat" ? "Chats" : "Folder or workspace"}</small></span>
      </div>;
    }
    if (row.type === "folder") {
      const expanded = () => expandedProjects().has(row.project.id);
      const unread = () => row.project.sessions.filter((chat) => chat.unread).length;
      const live = () => row.project.sessions.filter((chat) => {
        const activity = chatActivity(chat);
        return activity && activity !== "idle";
      }).length;
      return <div {...commonProps} class="command-option command-folder-option" role="treeitem" aria-level={1} aria-expanded={row.searchResult ? undefined : expanded()} aria-current={props.context.project?.id === row.project.id ? "page" : undefined} data-highlighted={selected() || undefined}>
        <Show when={!row.searchResult} fallback={<span class="command-folder-chevron" aria-hidden="true" />}>
          <button type="button" class="command-folder-toggle" tabIndex={-1} aria-label={`${expanded() ? "Collapse" : "Expand"} ${row.project.name}`} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); toggleFolder(row.project.id); }}><ChevronRightIcon data-expanded={expanded() || undefined} /></button>
        </Show>
        <Show when={isWorkspace(row.project)} fallback={<FolderIcon class="command-icon" />}><WorkspaceGlyph appearance={row.project.workspaceAppearance} /></Show>
        <span class="command-label">{row.project.name}</span>
        <small>{row.count} chat{row.count === 1 ? "" : "s"}<Show when={unread()}> · {unread()} unread</Show><Show when={live()}> · {live()} active</Show></small>
        <button type="button" class="command-folder-search" tabIndex={-1} aria-label={`Search in ${row.project.name}`} title={`Search in ${row.project.name}`} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); enterScope(row.project, true); }}><SearchIcon /></button>
      </div>;
    }
    if (row.type === "browse-all") return <div {...commonProps} class="command-option command-browse-all" role="treeitem" aria-level={2} data-highlighted={selected() || undefined}>
      <span class="command-browse-indent" aria-hidden="true" /><ChevronRightIcon class="command-icon" /><span class="command-label">Browse all {row.count} chats</span>
    </div>;
    const command = row.command;
    const Icon = icons[command.icon];
    const chatSelected = () => Boolean(command.chat && selectedChatIds().has(command.chat.id));
    const editing = () => command.chat?.id === editingId();
    return <div {...commonProps} title={command.chat?.title || command.label} aria-level={chatPage() ? row.parentId ? 2 : 1 : undefined} aria-current={command.chat?.id === props.context.chatId ? "page" : undefined} data-highlighted={selected() || undefined} data-danger={command.destructive || undefined} data-checked={command.checked || undefined} data-chat-row={command.entity === "chat" || undefined} data-chat-child={Boolean(row.parentId) || undefined} data-chat-selected={chatSelected() || undefined}>
      <Show when={selectionMode() && command.entity === "chat"}>
        <span class="command-select-mark" aria-hidden="true">{chatSelected() ? <CheckIcon /> : null}</span>
      </Show>
      <Show when={command.chat} fallback={<Show when={Icon}>{(resolved) => { const C = resolved(); return <C class="command-icon" />; }}</Show>}>
        {(chat) => <span class="command-chat-status"><RuntimeIndicator process={props.runtime.getProcess(chat().id)} stale={props.runtime.stale()} unread={chat().unread} fallback={<ThreadHarnessMark id={chat().harnessId} lively />} /><Show when={chat().unread && chatActivity(chat()) !== "idle" && chatActivity(chat())}><span class="command-chat-unread" role="status" aria-label="Unread response" /></Show></span>}
      </Show>
      <span class="command-copy">
        <Show when={editing()} fallback={<span class="command-label">{command.label}</span>}>
          <input ref={renameInput} class="command-rename-input" value={editingValue()} onInput={(event) => setEditingValue(event.currentTarget.value)} onKeyDown={renameKeydown} onClick={(event) => event.stopPropagation()} aria-label={`Rename ${command.label}`} />
        </Show>
        <Show when={!editing() && command.detail}><small class={command.chat ? "command-chat-meta" : undefined}>
          <Show when={command.chat && chatActivity(command.chat) && chatActivity(command.chat) !== "idle"}><span class="command-chat-activity" data-attention={["waiting_for_user", "failed"].includes(chatActivity(command.chat!) || "") || undefined}>{activityLabel(chatActivity(command.chat!)!)}{props.runtime.stale() ? " (last known)" : ""}</span><span aria-hidden="true">·</span></Show>
          <span class="command-chat-project">{command.detail}</span>
          <Show when={command.chat}><span aria-hidden="true">·</span><span class="command-chat-date">{formatChatDate(chatSortStamp(command.chat!, chatSort()))}</span></Show>
        </small></Show>
        <Show when={editing()}><small>Enter to save · Escape to cancel</small></Show>
      </span>
      <Show when={command.kind === "page"}><ChevronRightIcon class="command-chevron" /></Show>
      <Show when={commandShortcut(command)}>{(shortcut) => <kbd class="command-shortcut">{shortcut()}</kbd>}</Show>
    </div>;
  };

  return <>
    <KDialog.Root open={props.open} onOpenChange={changeOpen}>
      <KDialog.Portal>
        <KDialog.Content
          class={`command-dialog${chatPage() ? " command-dialog-chat-search" : ""}${modelSelectorPage() ? " command-dialog-model-selector" : ""}`}
          onOpenAutoFocus={(event) => { event.preventDefault(); focusInput(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}
          onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <div class="command-shell">
            <KDialog.Title class="sr-only">{modelSelectorPage() ? "Model selector" : chatPage() ? "Chat search" : "Command palette"}</KDialog.Title>
            <KDialog.Description class="sr-only">{modelSelectorPage() ? "Choose the models available in this project." : chatPage() ? "Find and manage chats." : "Search commands, settings, and models."}</KDialog.Description>
            <Show when={chatPage() && !moveMode()}><div class="command-search-path">
              <Show when={chatScope().kind === "project"} fallback={<span>All chats</span>}>
                <button type="button" onClick={backScope}>All</button><span aria-hidden="true">›</span><span>{scopeName()}</span>
              </Show>
              <small>{commands().length} chat{commands().length === 1 ? "" : "s"}</small>
            </div></Show>
            <div class="command-input-row">
              <Show when={moveMode() || (page() && !chatPage() && !modelSelectorPage())}>
                <Button type="button" variant="ghost" size="icon-sm" class="command-back" aria-label={moveMode() ? "Back to chat results" : "Back to commands"} title="Back" onMouseDown={(event) => event.preventDefault()} onClick={goBack}><ArrowLeftIcon /></Button>
              </Show>
              <Show when={chatPage()}><SearchIcon class="command-input-icon" aria-hidden="true" /></Show>
              <Show when={!chatPage() && !modelSelectorPage() && !pageMeta()}><span class="command-input-glyph" aria-hidden="true">&gt;</span></Show>
              <Show when={!chatPage() && pageMeta()}><span class="command-page-prefix">{pageMeta()!.prefix}</span></Show>
              <input
                ref={input}
                class="command-input"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-listbox"
                aria-autocomplete="list"
                aria-haspopup={chatPage() ? "tree" : "listbox"}
                aria-activedescendant={selectable().length ? optionId(active()) : undefined}
                aria-label={moveMode() ? "Choose destination" : modelSelectorPage() ? "Find models" : chatPage() ? "Search chats" : "Search commands"}
                placeholder={moveMode() ? "Choose destination…" : chatPage() ? chatScope().kind === "project" ? `Search ${scopeName()} chats…` : "Search chats, projects, workspaces…" : modelSelectorPage() ? "Find models…" : pageMeta()?.placeholder || "Run a command…"}
                value={moveMode() ? "" : parsedQuery().text}
                disabled={moveMode()}
                onInput={(event) => setQuery(serializeChatQuery(parsedQuery().filters, event.currentTarget.value))}
                onKeyDown={keydown}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="command-close"
                aria-label={chatPage() ? "Close chat search" : "Close command palette"}
                title="Close"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => close()}
              >
                <XIcon />
              </Button>
            </div>
            <div id="command-listbox" ref={listbox} role={chatPage() && !moveMode() ? "tree" : "listbox"} aria-label={modelSelectorPage() ? "Models" : chatPage() ? "Chat browser" : "Commands"} aria-activedescendant={selectable().length ? optionId(active()) : undefined} class="command-list" tabIndex={chatPage() || selectionMode() || moveMode() ? 0 : -1} onKeyDown={keydown}>
              <Show when={!selectable().length}><p class="command-empty">{emptyMessage()}</p></Show>
              <For each={rows()}>{renderRow}</For>
            </div>
            <CommandHintBar
              context={hintContext()}
              mode={modelSelectorPage() ? "model-selector" : hintMode()}
              pendingSequence={pendingActionSequence()}
              shortcuts={props.shortcuts}
              scoped={chatScope().kind === "project"}
              chatView={chatView()}
              onChatViewChange={setChatView}
              selectedCount={selectionMode() ? selectedTargets().length : null}
              onToggleEdit={toggleSelection}
              onDeleteSelected={() => requestDelete()}
              onMoveSelected={() => moveSelected()}
            />
          </div>
          <Show when={props.details}>
            <aside class="command-detail-pane" aria-label="Search preview">{props.details}</aside>
          </Show>
        </KDialog.Content>
      </KDialog.Portal>
    </KDialog.Root>
    <KAlertDialog.Root open={Boolean(pendingDelete())} onOpenChange={(open) => {
      if (!open) {
        setPendingDelete(null);
        focusInput();
      }
    }}>
      <KAlertDialog.Portal>
        <KAlertDialog.Content
          class="conduit-modal"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            selectDeleteChoice("cancel");
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            setPendingDelete(null);
            focusInput();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              selectDeleteChoice("cancel");
            } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              selectDeleteChoice("confirm");
            }
          }}
        >
          <div class="conduit-modal-card">
            <KAlertDialog.Title>Delete {pendingDelete()?.length || 0} chats?</KAlertDialog.Title>
            <KAlertDialog.Description>This permanently deletes the selected session transcripts and attached files.</KAlertDialog.Description>
            <div class="dialog-actions">
              <Button
                ref={deleteCancelButton}
                class="delete-dialog-choice"
                variant="outline"
                data-selected={deleteChoice() === "cancel"}
                onFocus={() => setDeleteChoice("cancel")}
                onClick={() => { setPendingDelete(null); focusInput(); }}
              >Cancel</Button>
              <Button
                ref={deleteConfirmButton}
                class="delete-dialog-choice delete-dialog-confirm"
                variant={deleteChoice() === "confirm" ? "destructive" : "outline"}
                data-selected={deleteChoice() === "confirm"}
                onFocus={() => setDeleteChoice("confirm")}
                onClick={() => void confirmDelete()}
              >Delete chats</Button>
            </div>
          </div>
        </KAlertDialog.Content>
      </KAlertDialog.Portal>
    </KAlertDialog.Root>
  </>;
}
