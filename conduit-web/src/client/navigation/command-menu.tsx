import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Combobox as KCombobox } from "@kobalte/core/combobox";
import * as KDialog from "@kobalte/core/dialog";
import type { ModelOption, Project } from "../api/contracts";

interface CommandItem { id: string; label: string; keywords?: string; group: string; action: () => void; danger?: boolean; }

export function CommandMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  models: ModelOption[];
  onSettings: (section: string) => void;
  onNewChat: () => void;
  onNewFolder: () => void;
  onNewWorkspace: () => void;
  onOpenChat: (chatId: string) => void;
  onChooseModel: (spec: string) => void;
  onDeleteChat: () => void;
}) {
  const [query, setQuery] = createSignal("");
  let input!: HTMLInputElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  const close = () => { setQuery(""); props.onOpenChange(false); };
  const changeOpen = (open: boolean) => { if (!open) setQuery(""); props.onOpenChange(open); };

  createEffect(() => {
    if (props.open && !wasOpen) returnFocus = document.activeElement as HTMLElement | null;
    wasOpen = props.open;
    if (!props.open) return;
    setQuery("");
    queueMicrotask(() => input?.focus());
  });

  const items = createMemo<CommandItem[]>(() => [
    { id: "settings", label: "Settings…", keywords: "preferences configure general", group: "Commands", action: () => { close(); props.onSettings("general"); } },
    { id: "new-chat", label: "New chat", group: "Commands", action: () => { close(); props.onNewChat(); } },
    { id: "new-folder", label: "New folder", group: "Commands", action: () => { close(); props.onNewFolder(); } },
    { id: "new-workspace", label: "New workspace", group: "Commands", action: () => { close(); props.onNewWorkspace(); } },
    { id: "delete-chat", label: "Delete chat", keywords: "remove conversation", group: "Commands", danger: true, action: () => { close(); props.onDeleteChat(); } },
    ...["models", "profiles", "runtime", "workspaces", "auth"].map((id): CommandItem => ({
      id: `settings:${id}`,
      label: id === "auth" ? "Authentication" : id[0]!.toUpperCase() + id.slice(1),
      keywords: `settings preferences ${id}`,
      group: "Settings",
      action: () => { close(); props.onSettings(id); },
    })),
    ...props.projects.flatMap((project) => project.sessions.map((chat): CommandItem => ({
      id: `chat:${chat.id}`,
      label: chat.title,
      keywords: `${project.name} chat conversation`,
      group: project.name,
      action: () => { close(); props.onOpenChat(chat.id); },
    }))),
    ...props.models.map((model): CommandItem => ({
      id: `model:${model.spec}`,
      label: model.label,
      keywords: `${model.spec} ${model.provider} model`,
      group: "Models",
      action: () => { close(); props.onChooseModel(model.spec); },
    })),
  ]);

  const commandFilter = (item: CommandItem, inputValue: string) => {
    const words = inputValue.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return item.group === "Commands";
    return words.every((word) => `${item.label} ${item.keywords || ""} ${item.group}`.toLowerCase().includes(word));
  };
  const hasMatches = createMemo(() => items().some((item) => commandFilter(item, query())));
  const runCommand = (id: string | undefined) => { if (id) items().find((item) => item.id === id)?.action(); };
  const inputKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Enter") return;
    const active = document.getElementById(input.getAttribute("aria-activedescendant") || "");
    if (active?.dataset.key) { event.preventDefault(); runCommand(active.dataset.key); }
  };

  return <KDialog.Root open={props.open} onOpenChange={changeOpen}>
    <KDialog.Portal><KDialog.Content class="command-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}>
      <div class="command-shell">
        <KDialog.Title class="sr-only">Command Palette</KDialog.Title>
        <KDialog.Description class="sr-only">Search commands, chats, settings, and models.</KDialog.Description>
        <KCombobox<CommandItem>
          options={items()}
          optionValue="id"
          optionTextValue={(item) => `${item.label} ${item.keywords || ""} ${item.group}`}
          optionLabel="label"
          onInputChange={setQuery}
          value={null}
          open={props.open}
          allowsEmptyCollection
          closeOnSelection={false}
          defaultFilter={commandFilter}
          modal={false}
          // Route activation through the rendered item's stable id. Kobalte
          // retains the last selected option while its closing presence runs,
          // whereas commands must be repeatable immediately after reopening.
          itemComponent={(itemProps) => <KCombobox.Item item={itemProps.item} class="command-option" data-danger={itemProps.item.rawValue.danger || undefined} onPointerDown={(event) => runCommand(event.currentTarget.dataset.key)}>
            <span>{itemProps.item.rawValue.label}</span><small aria-hidden="true">{itemProps.item.rawValue.group}<Show when={itemProps.item.rawValue.group === "Models"}> · {itemProps.item.rawValue.keywords}</Show></small>
          </KCombobox.Item>}
        >
          <KCombobox.Control class="command-input-row"><KCombobox.Input ref={input} aria-label="Search commands" placeholder="Search commands…" onKeyDown={inputKeydown} /></KCombobox.Control>
          <KCombobox.Content class="command-list" data-slot="command-list">
            <Show when={!hasMatches()}><p>No commands found.</p></Show>
            <KCombobox.Listbox />
          </KCombobox.Content>
        </KCombobox>
      </div>
    </KDialog.Content></KDialog.Portal>
  </KDialog.Root>;
}
