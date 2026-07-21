import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import * as KDialog from "@kobalte/core/dialog";
import {
  ArrowLeftIcon, BrainIcon, ChevronRightIcon, CopyIcon, FileInputIcon, FilePlus2Icon,
  FolderInputIcon, FolderPlusIcon, LayersIcon, LogOutIcon, MessageSquareIcon,
  MessageSquarePlusIcon, PanelLeftIcon, PencilIcon, PlayIcon, RefreshCwIcon, SettingsIcon,
  SlashIcon, SlidersHorizontalIcon, SquareIcon, TerminalIcon, Trash2Icon,
} from "lucide-solid";
import type { ModelOption } from "../api/contracts";
import {
  groupPaletteCommands, PALETTE_PAGES, resolvePaletteCommands,
} from "../palette/command-registry";
import type { PaletteActions, PaletteCommand, PaletteContext } from "../palette/command-registry";
import { rankPaletteResults } from "../palette/palette-search";

const icons: Record<string, (props: { class?: string }) => JSX.Element> = {
  "new-chat": MessageSquarePlusIcon,
  "new-folder": FolderPlusIcon,
  attach: FilePlus2Icon,
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
  navigation: "Go to",
  profiles: "Profiles",
  thinking: "Thinking level",
  danger: "Danger zone",
  models: "Models",
};

const BACK_COMMAND: PaletteCommand = {
  id: "page-back", label: "Back", icon: "back", group: "commands", keywords: [], run: () => {},
};

type Row =
  | { type: "heading"; key: string; label: string }
  | { type: "command"; key: string; index: number; command: PaletteCommand }
  | { type: "model"; key: string; index: number; model: ModelOption };

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

export function CommandMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPage?: string | null;
  launchNonce?: number;
  context: PaletteContext;
  actions: PaletteActions;
  models: ModelOption[];
  currentModel: string;
  onChooseModel: (spec: string) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [page, setPage] = createSignal<string | null>(null);
  const [active, setActive] = createSignal(0);
  let input!: HTMLInputElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;

  const pageMeta = createMemo(() => (page() ? PALETTE_PAGES[page()!] : null));
  const searching = createMemo(() => Boolean(query().trim()));

  createEffect(() => {
    // Track launchNonce so re-opening on the same page re-applies the initial page.
    void props.launchNonce;
    if (props.open && !wasOpen) {
      returnFocus = document.activeElement as HTMLElement | null;
      setPage(props.initialPage || null);
      setQuery("");
      queueMicrotask(() => input?.focus());
    }
    if (!props.open && wasOpen) { setPage(null); setQuery(""); }
    wasOpen = props.open;
  });

  const rows = createMemo<Row[]>(() => {
    if (!props.open) return [];
    const currentPage = page();
    const commands = resolvePaletteCommands(props.context, { page: currentPage });
    const out: Row[] = [];
    let index = 0;
    const push = (row: Row) => out.push(row);

    if (searching()) {
      const ranked = rankPaletteResults<PaletteCommand, ModelOption>({
        commands,
        models: currentPage ? [] : props.models,
        query: query(),
        currentModel: props.currentModel,
      }) || [];
      let lastGroup = "";
      for (const row of ranked) {
        if (row.group !== lastGroup) {
          push({ type: "heading", key: `h-${row.group}-${index}`, label: GROUP_HEADINGS[row.group] || row.group });
          lastGroup = row.group;
        }
        if (row.kind === "model" && row.model) push({ type: "model", key: row.id, index: index++, model: row.model });
        else if (row.command) push({ type: "command", key: row.command.id, index: index++, command: row.command });
      }
      return out;
    }

    if (currentPage) {
      push({ type: "command", key: "page-back", index: index++, command: BACK_COMMAND });
      push({ type: "heading", key: "page-heading", label: pageMeta()?.heading || "Results" });
      for (const command of commands) push({ type: "command", key: command.id, index: index++, command });
      return out;
    }

    for (const group of groupPaletteCommands(commands)) {
      push({ type: "heading", key: `g-${group.id}`, label: group.heading });
      for (const command of group.items) push({ type: "command", key: command.id, index: index++, command });
    }
    for (const group of groupModels(props.models)) {
      push({ type: "heading", key: `m-${group.provider}`, label: `Models · ${group.provider}` });
      for (const model of group.items) push({ type: "model", key: `model:${model.spec}`, index: index++, model });
    }
    return out;
  });

  const selectable = createMemo(() => rows().filter((row): row is Exclude<Row, { type: "heading" }> => row.type !== "heading"));

  // Keep the active index in range whenever the visible set changes.
  createEffect(() => { const count = selectable().length; if (active() >= count) setActive(count ? count - 1 : 0); });
  createEffect(() => { void query(); void page(); setActive(0); if (props.open) queueMicrotask(() => input?.focus()); });
  createEffect(() => { if (props.open) document.getElementById(optionId(active()))?.scrollIntoView({ block: "nearest" }); });

  const close = () => { setQuery(""); setPage(null); props.onOpenChange(false); };
  const goBack = () => { setPage(null); setQuery(""); };

  const runRow = (row?: Exclude<Row, { type: "heading" }>) => {
    if (!row) return;
    if (row.type === "model") { close(); requestAnimationFrame(() => props.onChooseModel(row.model.spec)); return; }
    const command = row.command;
    if (command.id === "page-back") { goBack(); return; }
    if (command.kind === "page" && command.page) { setPage(command.page); setQuery(""); return; }
    close();
    requestAnimationFrame(() => command.run(props.actions));
  };

  const move = (delta: number) => {
    const count = selectable().length;
    if (!count) return;
    setActive((current) => (current + delta + count) % count);
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); move(-1); return; }
    if (event.key === "Home") { event.preventDefault(); setActive(0); return; }
    if (event.key === "End") { event.preventDefault(); setActive(Math.max(0, selectable().length - 1)); return; }
    if (event.key === "Enter") { event.preventDefault(); runRow(selectable()[active()]); return; }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (page()) goBack(); else close();
      return;
    }
    if (event.key === "Backspace" && page() && !query()) { event.preventDefault(); goBack(); }
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
      // Keep focus in the input so keyboard control (Escape/paging) survives a click.
      onMouseDown: (event: MouseEvent) => event.preventDefault(),
      onMouseMove: () => setActive(row.index),
      onClick: () => runRow(row),
    } as const;
    if (row.type === "model") {
      const Icon = icons.model!;
      return <div {...commonProps} data-highlighted={selected() || undefined}>
        <Icon class="command-icon" />
        <span class="command-copy"><span class="command-label">{row.model.label}</span><small>{row.model.spec}</small></span>
      </div>;
    }
    const command = row.command;
    const Icon = icons[command.icon];
    return <div {...commonProps} data-highlighted={selected() || undefined} data-danger={command.destructive || undefined} data-checked={command.checked || undefined}>
      <Show when={Icon}>{(resolved) => { const C = resolved(); return <C class="command-icon" />; }}</Show>
      <span class="command-copy">
        <span class="command-label">{command.label}</span>
        <Show when={command.detail}><small>{command.detail}</small></Show>
      </span>
      <Show when={command.kind === "page"}><ChevronRightIcon class="command-chevron" /></Show>
      <Show when={command.shortcut}><kbd class="command-shortcut">{command.shortcut}</kbd></Show>
    </div>;
  };

  return <KDialog.Root open={props.open} onOpenChange={changeOpen}>
    <KDialog.Portal>
      <KDialog.Content class="command-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}>
        <div class="command-shell">
          <KDialog.Title class="sr-only">Command Palette</KDialog.Title>
          <KDialog.Description class="sr-only">Search commands, chats, settings, and models.</KDialog.Description>
          <div class="command-input-row">
            <Show when={pageMeta()}><span class="command-page-prefix">{pageMeta()!.prefix}</span></Show>
            <input
              ref={input}
              class="command-input"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-listbox"
              aria-autocomplete="list"
              aria-activedescendant={selectable().length ? optionId(active()) : undefined}
              aria-label="Search commands"
              placeholder={pageMeta()?.placeholder || "Search commands…"}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={keydown}
            />
          </div>
          <div id="command-listbox" role="listbox" aria-label="Commands" class="command-list">
            <Show when={!selectable().length}><p class="command-empty">No matching commands.</p></Show>
            <For each={rows()}>{renderRow}</For>
          </div>
        </div>
      </KDialog.Content>
    </KDialog.Portal>
  </KDialog.Root>;
}
