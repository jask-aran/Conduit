import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { ModelOption, Project } from "../api/contracts";

type Page = "settings" | "goto" | null;
interface CommandItem { id: string; label: string; keywords?: string; group: string; action: () => void; danger?: boolean; }

export function CommandMenu(props: {
  open: boolean;
  initialPage?: Page;
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
  const [page, setPage] = createSignal<Page>(null);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let input!: HTMLInputElement;

  createEffect(() => {
    if (!props.open) return;
    setPage(props.initialPage || null);
    setQuery("");
    setSelected(0);
    queueMicrotask(() => input?.focus());
  });

  const close = () => props.onOpenChange(false);
  const rootItems = (): CommandItem[] => [
    { id: "settings", label: "Settings…", keywords: "preferences configure", group: "Commands", action: () => { setPage("settings"); setQuery(""); } },
    { id: "goto", label: "Go to…", keywords: "chat project workspace", group: "Commands", action: () => { setPage("goto"); setQuery(""); } },
    { id: "new-chat", label: "New chat", group: "Commands", action: () => { close(); props.onNewChat(); } },
    { id: "new-folder", label: "New folder", group: "Commands", action: () => { close(); props.onNewFolder(); } },
    { id: "new-workspace", label: "New workspace", group: "Commands", action: () => { close(); props.onNewWorkspace(); } },
    { id: "delete-chat", label: "Delete chat", keywords: "remove conversation", group: "Danger zone", danger: true, action: () => { close(); props.onDeleteChat(); } },
  ];
  const settingsItems = (): CommandItem[] => [
    { id: "back", label: "Back", group: "Navigation", action: () => { setPage(null); setQuery(""); } },
    ...["general", "models", "profiles", "runtime", "workspaces", "auth"].map((id) => ({ id, label: id === "auth" ? "Authentication" : id[0]!.toUpperCase() + id.slice(1), group: "Settings", action: () => { close(); props.onSettings(id); } })),
  ];
  const gotoItems = (): CommandItem[] => [
    { id: "back", label: "Back", group: "Navigation", action: () => { setPage(null); setQuery(""); } },
    ...props.projects.flatMap((project) => project.sessions.map((chat) => ({ id: chat.id, label: chat.title, keywords: project.name, group: project.name, action: () => { close(); props.onOpenChat(chat.id); } }))),
  ];

  const items = createMemo(() => {
    const base = page() === "settings" ? settingsItems() : page() === "goto" ? gotoItems() : rootItems();
    const words = query().toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = base.filter((item) => words.every((word) => `${item.label} ${item.keywords || ""}`.toLowerCase().includes(word)));
    if (!page() && words.length) {
      matches.push(...props.models.filter((model) => words.every((word) => `${model.label} ${model.spec} ${model.provider}`.toLowerCase().includes(word))).map((model) => ({ id: `model:${model.spec}`, label: model.label, keywords: model.spec, group: "Models", action: () => { close(); props.onChooseModel(model.spec); } })));
    }
    return matches;
  });
  createEffect(() => { query(); page(); setSelected(0); });
  const groups = createMemo(() => [...new Set(items().map((item) => item.group))]);

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, Math.max(items().length - 1, 0))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
    if (event.key === "Enter") { event.preventDefault(); items()[selected()]?.action(); }
    if (event.key === "Backspace" && !query() && page()) { event.preventDefault(); setPage(null); }
  };

  return <div role="dialog" aria-modal="true" aria-label="Command Palette" data-state={props.open ? "open" : "closed"} hidden={!props.open} class="command-dialog">
    <div class="command-shell">
      <div class="command-input-row"><Show when={page()}><span data-slot="command-input-prefix">{page() === "settings" ? "Settings ›" : "Go to ›"}</span></Show><input ref={input} role="combobox" placeholder="Search commands…" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={keydown} /></div>
      <div role="listbox" class="command-list">
        <Show when={!items().length}><p>No commands found.</p></Show>
        <For each={groups()}>{(group) => <div role="group" aria-label={group} class="command-group"><span>{group}</span><For each={items().filter((item) => item.group === group)}>{(item) => {
          const index = () => items().indexOf(item);
          return <button role="option" data-selected={index() === selected() ? "true" : undefined} class={item.danger ? "text-destructive" : ""} onMouseEnter={() => setSelected(index())} onClick={item.action}>{item.label}<Show when={item.keywords && item.group === "Models"}><small>{item.keywords}</small></Show></button>;
        }}</For></div>}</For>
      </div>
    </div>
  </div>;
}
