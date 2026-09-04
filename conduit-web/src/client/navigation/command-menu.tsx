import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import * as KDialog from "@kobalte/core/dialog";
import {
  ArrowLeftIcon, BrainIcon, CheckIcon, ChevronRightIcon, CopyIcon, FileInputIcon, FilePlus2Icon,
  FolderIcon, FolderInputIcon, FolderPlusIcon, LayersIcon, LogOutIcon, MessageSquareIcon, MicIcon,
  MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, PlayIcon, RefreshCwIcon, SettingsIcon,
  SlashIcon, SlidersHorizontalIcon, SquareIcon, TerminalIcon, Trash2Icon, XIcon,
} from "lucide-solid";
import { Button } from "@/components/primitives";
import type { ChatSummary, ModelOption, Project } from "../api/contracts";
import {
  chatDateSection, groupPaletteCommands, PALETTE_PAGES, resolvePaletteCommands,
} from "../palette/command-registry";
import type { PaletteActions, PaletteCommand, PaletteContext } from "../palette/command-registry";
import { rankPaletteResults } from "../palette/palette-search";
import {
  parseChatQuery, removeChatQueryFilter, resolveChatQueryScope, serializeChatQuery,
} from "../palette/chat-query";
import type { ChatQueryFilter } from "../palette/chat-query";
import { COMMAND_IDS, commandRegistry } from "../commands/command-registry";
import { chatSortStamp, useChatSort } from "../preferences/chat-sort";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import type { ShortcutContext } from "../shortcuts/shortcut-types";
import { CommandHintBar } from "./command-hint-bar";
import type { CommandHintContext, CommandHintMode } from "./command-hint-bar";

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
  back: ArrowLeftIcon,
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

const BACK_COMMAND: PaletteCommand = {
  id: "page-back", label: "Back", icon: "back", group: "commands", keywords: [], run: () => {},
};

const FOCUS_MOVING_COMMAND_IDS = new Set<string>([
  COMMAND_IDS.toggleWorkspacePanel,
  COMMAND_IDS.maximizeWorkspacePanel,
  COMMAND_IDS.focusComposer,
  COMMAND_IDS.focusWorkspacePanel,
  COMMAND_IDS.toggleChatWorkspaceFocus,
  COMMAND_IDS.workspaceFiles,
  COMMAND_IDS.workspaceSourceControl,
  COMMAND_IDS.workspaceArtifacts,
  COMMAND_IDS.workspaceTerminal,
]);

type Row =
  | { type: "heading"; key: string; label: string }
  | { type: "command"; key: string; index: number; command: PaletteCommand }
  | { type: "model"; key: string; index: number; model: ModelOption; scoped?: boolean }
  | { type: "destination"; key: string; index: number; project: Project };

type SelectableRow = Exclude<Row, { type: "heading" }>;
type ChatTarget = { chat: ChatSummary; project: Project };

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

function formatChatDate(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function CommandMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPage?: string | null;
  launchNonce?: number;
  directLaunch?: boolean;
  initialQuery?: string | null;
  context: PaletteContext;
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
  const [selectionMode, setSelectionMode] = createSignal(false);
  const [selectedChatIds, setSelectedChatIds] = createSignal<Set<string>>(new Set());
  const [moveMode, setMoveMode] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingValue, setEditingValue] = createSignal("");
  const [pendingDelete, setPendingDelete] = createSignal<ChatTarget[] | null>(null);
  const [deleteChoice, setDeleteChoice] = createSignal<"cancel" | "confirm">("cancel");
  const [shortcutRevision, setShortcutRevision] = createSignal(0);
  let input!: HTMLInputElement;
  let listbox!: HTMLDivElement;
  let renameInput!: HTMLInputElement;
  let deleteCancelButton!: HTMLButtonElement;
  let deleteConfirmButton!: HTMLButtonElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  let lastLaunchNonce: number | undefined;
  let directMode = false;

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
    directMode = false;
  };

  createEffect(() => {
    // Track launchNonce so re-opening on the same page re-applies the initial page.
    void props.launchNonce;
    const launchChanged = props.launchNonce !== lastLaunchNonce;
    if (props.open && (!wasOpen || launchChanged)) {
      if (!wasOpen) returnFocus = document.activeElement as HTMLElement | null;
      setPage(canonicalPage(props.initialPage));
      setQuery(props.initialQuery || "");
      setSelectionMode(false);
      setSelectedChatIds(new Set<string>());
      setMoveMode(false);
      setEditingId(null);
      setPendingDelete(null);
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
    if (!chatPage() || scope.kind === "all") return all;
    if (scope.kind === "unresolved") return [];
    return all.filter((command) => command.entity === "chat"
      ? command.project?.id === scope.project.id
      : command.id === `new-chat-in:${scope.project.id}`);
  });

  const rows = createMemo<Row[]>(() => {
    if (!props.open) return [];
    const currentPage = page();
    const source = commands();
    const out: Row[] = [];
    let index = 0;
    const push = (row: Row) => out.push(row);

    if (moveMode()) {
      push({ type: "command", key: "page-back", index: index++, command: BACK_COMMAND });
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

    if (searching()) {
      const ranked = rankPaletteResults<PaletteCommand, ModelOption>({
        commands: source,
        models: [],
        query: parsedQuery().text,
      }) || [];
      let lastGroup = "";
      for (const row of ranked) {
        const group = row.command?.entity === "chat" && chatPage()
          ? (row.command.section || "Chats")
          : row.group;
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
      push({ type: "command", key: "page-back", index: index++, command: BACK_COMMAND });
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
    if (props.open && !selectionMode() && !editingId()) focusInput();
  });
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
      setQuery("");
      if (!selectionMode()) setSelectedChatIds(new Set<string>());
      return;
    }
    setPage(null); setQuery(""); setSelectionMode(false); setSelectedChatIds(new Set<string>()); directMode = false;
  };

  const filterLabel = (filter: ChatQueryFilter): string => {
    if (filter.kind === "scope" && filter.value.toLocaleLowerCase() === "chats") return "Chats";
    if (filter.kind === "scope" && filter.value.toLocaleLowerCase() === "all") return "All chats";
    const scope = chatScope();
    return scope.kind === "project" ? scope.project.name : `in:${filter.value}`;
  };
  const removeFilter = (index: number) => {
    setQuery(removeChatQueryFilter(parsedQuery(), index));
    focusInput();
  };
  const emptyMessage = () => {
    if (modelSelectorPage()) return "No matching models.";
    const scope = chatScope();
    if (scope.kind === "unresolved") return `No chats in “${scope.value}”.`;
    if (chatPage() && parsedQuery().filters.length) return "No chats match this filter.";
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
    setQuery("");
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
    if (moveMode()) { setMoveMode(false); setQuery(""); }
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
    const command = row.command;
    if (command.id === "page-back") { goBack(); return; }
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
    setActive((current) => (current + delta + count) % count);
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
    // Unmodified selection actions belong to the result list. When the search
    // input owns the event, letters and Delete must edit the query instead.
    if (selectionMode() && event.currentTarget !== input
      && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === " ") { event.preventDefault(); const target = activeChat(); if (target) toggleChatSelection(target.chat.id); return; }
      if (key === "c") { event.preventDefault(); copySelected(); return; }
      if (key === "/") { event.preventDefault(); input?.focus(); return; }
    }
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); move(-1); return; }
    if (event.key === "Home") { event.preventDefault(); setActive(0); return; }
    if (event.key === "End") { event.preventDefault(); setActive(Math.max(0, selectable().length - 1)); return; }
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
      if (page() && !directMode) goBack(); else close();
    }
    if (event.key === "Backspace" && chatPage() && !parsedQuery().text && parsedQuery().filters.length) {
      event.preventDefault();
      removeFilter(parsedQuery().filters.length - 1);
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
      role: "option",
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
    const command = row.command;
    const Icon = icons[command.icon];
    const chatSelected = () => Boolean(command.chat && selectedChatIds().has(command.chat.id));
    const editing = () => command.chat?.id === editingId();
    return <div {...commonProps} title={command.chat?.title || command.label} data-highlighted={selected() || undefined} data-danger={command.destructive || undefined} data-checked={command.checked || undefined} data-chat-row={command.entity === "chat" || undefined} data-chat-selected={chatSelected() || undefined}>
      <Show when={selectionMode() && command.entity === "chat"}>
        <span class="command-select-mark" aria-hidden="true">{chatSelected() ? <CheckIcon /> : null}</span>
      </Show>
      <Show when={Icon}>{(resolved) => { const C = resolved(); return <C class="command-icon" />; }}</Show>
      <span class="command-copy">
        <Show when={editing()} fallback={<span class="command-label">{command.label}</span>}>
          <input ref={renameInput} class="command-rename-input" value={editingValue()} onInput={(event) => setEditingValue(event.currentTarget.value)} onKeyDown={renameKeydown} onClick={(event) => event.stopPropagation()} aria-label={`Rename ${command.label}`} />
        </Show>
        <Show when={!editing() && command.detail}><small>{command.detail}{command.chat ? ` · ${formatChatDate(chatSortStamp(command.chat, chatSort()))}` : ""}</small></Show>
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
            <KDialog.Title class="sr-only">{modelSelectorPage() ? "Model selector" : "Command Palette"}</KDialog.Title>
            <KDialog.Description class="sr-only">{modelSelectorPage() ? "Choose the models available in this project." : "Search commands, chats, settings, and models."}</KDialog.Description>
            <div class="command-input-row">
              <Show when={pageMeta()}><span class="command-page-prefix">{pageMeta()!.prefix}</span></Show>
              <Show when={chatPage()}>
                <For each={parsedQuery().filters}>{(filter, index) => {
                  const label = () => filterLabel(filter);
                  return <button type="button" class="command-filter-chip" aria-label={`Remove ${label()} filter`} title={`Remove ${label()} filter`} onMouseDown={(event) => event.preventDefault()} onClick={() => removeFilter(index())}>
                    {label()} <span aria-hidden="true">×</span>
                  </button>;
                }}</For>
              </Show>
              <input
                ref={input}
                class="command-input"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-listbox"
                aria-autocomplete="list"
                aria-activedescendant={selectable().length ? optionId(active()) : undefined}
                aria-label={modelSelectorPage() ? "Find models" : "Search commands"}
                placeholder={pageMeta()?.placeholder || "Search commands…"}
                value={parsedQuery().text}
                onInput={(event) => setQuery(serializeChatQuery(parsedQuery().filters, event.currentTarget.value))}
                onKeyDown={keydown}
              />
              <Show when={selectionMode()}><span class="command-selection-count">{selectedTargets().length} selected</span></Show>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="command-close"
                aria-label="Close command palette"
                title="Close"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => close()}
              >
                <XIcon />
              </Button>
            </div>
            <div id="command-listbox" ref={listbox} role="listbox" aria-label={modelSelectorPage() ? "Models" : chatPage() ? "Chats" : "Commands"} class="command-list" data-mode-focus={selectionMode() || moveMode() || undefined} tabIndex={selectionMode() || moveMode() ? 0 : -1} onKeyDown={keydown}>
              <Show when={!selectable().length}><p class="command-empty">{emptyMessage()}</p></Show>
              <For each={rows()}>{renderRow}</For>
            </div>
            <CommandHintBar
              context={hintContext()}
              mode={modelSelectorPage() ? "model-selector" : hintMode()}
              pendingSequence={pendingActionSequence()}
              shortcuts={props.shortcuts}
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
            <KAlertDialog.Description>This permanently deletes the selected Pi session transcripts and attached files.</KAlertDialog.Description>
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
