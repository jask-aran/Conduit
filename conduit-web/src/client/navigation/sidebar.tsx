import { createEffect, createSignal, For, Show } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import * as KDialog from "@kobalte/core/dialog";
import {
  CableIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  PencilIcon,
  PlusIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-solid";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@/components/primitives";
import type { ChatSummary, Project, RuntimeProcess, WorkspaceSuggestion } from "../api/contracts";
import type { RuntimeStore } from "../state/runtime";
import { ProjectActivityIndicator, RuntimeIndicator } from "./runtime-indicator";

type ProjectInput = { mode: string; name?: string; path?: string; cloneUrl?: string };

function Modal(props: { open: boolean; title: string; description?: string; children: unknown; onClose: () => void; class?: string }) {
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  createEffect(() => { if (props.open && !wasOpen) returnFocus = document.activeElement as HTMLElement | null; wasOpen = props.open; });
  return <KDialog.Root open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <KDialog.Portal><KDialog.Content data-state={props.open ? "open" : "closed"} class="conduit-modal" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}>
      <div class={`conduit-modal-card ${props.class || ""}`}>
        <KDialog.Title>{props.title}</KDialog.Title><Show when={props.description}><KDialog.Description class="text-muted-foreground">{props.description}</KDialog.Description></Show>
        {props.children as never}
      </div>
    </KDialog.Content></KDialog.Portal>
  </KDialog.Root>;
}

function AlertModal(props: { open: boolean; title: string; description: string; children: unknown; onClose: () => void }) {
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  createEffect(() => { if (props.open && !wasOpen) returnFocus = document.activeElement as HTMLElement | null; wasOpen = props.open; });
  return <KAlertDialog.Root open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <KAlertDialog.Portal><KAlertDialog.Content data-state={props.open ? "open" : "closed"} class="conduit-modal" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}>
      <div class="conduit-modal-card">
        <KAlertDialog.Title>{props.title}</KAlertDialog.Title>
        <KAlertDialog.Description>{props.description}</KAlertDialog.Description>
        {props.children as never}
      </div>
    </KAlertDialog.Content></KAlertDialog.Portal>
  </KAlertDialog.Root>;
}

export function Sidebar(props: {
  projects: Project[];
  projectId: string;
  selectedId: string | null;
  runtime: RuntimeStore;
  connectivity: string;
  workspaceSuggestions: WorkspaceSuggestion[];
  onNewChat: (project: Project) => Promise<void>;
  onOpenChat: (chat: ChatSummary, project: Project) => Promise<void>;
  onAddProject: (input: ProjectInput) => Promise<boolean>;
  onRenameChat: (chat: ChatSummary, project: Project, name: string) => Promise<boolean>;
  onRenameProject: (project: Project, name: string) => Promise<boolean>;
  onMoveChat: (chat: ChatSummary, source: Project, target: Project) => Promise<void>;
  onMoveProjectChats: (source: Project, target: Project) => Promise<void>;
  onCopyTranscript: (chat: ChatSummary) => Promise<void>;
  onDeleteChat: (chat: ChatSummary, project: Project) => Promise<void>;
  onDeleteProject: (project: Project) => Promise<void>;
  onOpenSettings: (section?: string, workspaceId?: string | null) => void;
  onOpenPalette: () => void;
  command?: { type: string; nonce: number } | null;
}) {
  const [collapsed, setCollapsed] = createSignal(localStorage.getItem("conduit.sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const [newKind, setNewKind] = createSignal<"folder" | "workspace" | null>(null);
  const [mode, setMode] = createSignal("managed");
  const [name, setName] = createSignal("");
  const [path, setPath] = createSignal("");
  const [cloneUrl, setCloneUrl] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [rename, setRename] = createSignal<{ type: "chat"; chat: ChatSummary; project: Project } | { type: "project"; project: Project } | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [deleting, setDeleting] = createSignal<{ type: "chat"; chat: ChatSummary; project: Project } | { type: "project"; project: Project } | null>(null);
  const [moving, setMoving] = createSignal<{ chat: ChatSummary; project: Project } | null>(null);

  const currentProject = () => props.projects.find((item) => item.sessions.some((chat) => chat.id === props.selectedId))
    || props.projects.find((item) => item.id === props.projectId);
  const currentChat = (project = currentProject()): ChatSummary | null => project?.sessions.find((item) => item.id === props.selectedId)
    || (project && props.selectedId ? { id: props.selectedId, projectId: project.id, status: "draft" as const, title: "New chat" } : null);

  createEffect(() => {
    const command = props.command;
    if (!command) return;
    if (command.type === "new-folder") openNewDialog("folder");
    if (command.type === "new-workspace") openNewDialog("workspace");
    if (command.type === "toggle-sidebar") setCollapsed((value) => !value);
    if (command.type === "delete-chat") {
      const project = currentProject();
      const chat = currentChat(project);
      if (project && chat) setDeleting({ type: "chat", project, chat });
    }
    if (command.type === "rename-chat") {
      const project = currentProject();
      const chat = currentChat(project);
      if (project && chat) requestRenameChat(chat, project);
    }
    if (command.type === "move-chat") {
      const project = currentProject();
      const chat = currentChat(project);
      if (project && chat) setMoving({ chat, project });
    }
    if (command.type === "rename-folder") { const project = currentProject(); if (project && project.slug !== "chat") requestRenameProject(project); }
    if (command.type === "delete-project") { const project = currentProject(); if (project && project.slug !== "chat") setDeleting({ type: "project", project }); }
  });

  createEffect(() => localStorage.setItem("conduit.sidebar", collapsed() ? "collapsed" : "expanded"));
  const chats = () => props.projects.find((project) => project.slug === "chat") || props.projects[0];
  const folders = () => props.projects.filter((project) => project.slug !== "chat" && project.origin !== "linked" && project.origin !== "cloned" && project.kind !== "workspace");
  const workspaces = () => props.projects.filter((project) => project.origin === "linked" || project.origin === "cloned" || project.kind === "workspace");
  const closeMobile = () => setMobileOpen(false);

  /** Live process map wins while SSE is online; fall back to the catalogue's live snapshot when offline. */
  const processFor = (chat: ChatSummary): RuntimeProcess | null => props.runtime.getProcess(chat.id)
    || (props.connectivity !== "online" && chat.liveStatus ? {
      chatId: chat.id,
      status: chat.liveStatus,
      activity: chat.liveActivity || (chat.liveActive ? "working" : "idle"),
      active: chat.liveActive,
    } : null);

  const openNewDialog = (kind: "folder" | "workspace") => {
    setMode(kind === "workspace" ? "linked" : "managed");
    setNewKind(kind);
  };
  const closeNewDialog = () => {
    if (submitting()) return;
    setNewKind(null);
    setMode("managed");
    setName("");
    setPath("");
    setCloneUrl("");
  };

  const requestRenameChat = (chat: ChatSummary, project: Project) => { setRename({ type: "chat", chat, project }); setRenameValue(chat.title); };
  const requestRenameProject = (project: Project) => { setRename({ type: "project", project }); setRenameValue(project.name); };
  const submitRename = async (event: Event) => {
    event.preventDefault();
    const target = rename();
    const value = renameValue().trim();
    if (!target || !value) return;
    const saved = target.type === "chat" ? await props.onRenameChat(target.chat, target.project, value) : await props.onRenameProject(target.project, value);
    if (saved) setRename(null);
  };

  const submitNew = async (event: Event) => {
    event.preventDefault();
    if (submitting()) return;
    const input: ProjectInput = mode() === "managed" ? { mode: "managed", name: name().trim() }
      : mode() === "linked" ? { mode: "linked", name: name().trim() || undefined, path: path().trim() }
        : { mode: "cloned", name: name().trim() || undefined, path: path().trim(), cloneUrl: cloneUrl().trim() };
    setSubmitting(true);
    try { if (await props.onAddProject(input)) closeNewDialog(); }
    finally { setSubmitting(false); }
  };
  const canCreate = () => !submitting() && (mode() === "managed" ? Boolean(name().trim())
    : mode() === "linked" ? Boolean(path().trim())
      : Boolean(cloneUrl().trim() && path().trim()));

  const confirmDelete = async () => {
    const target = deleting();
    if (!target) return;
    setDeleting(null);
    if (target.type === "chat") await props.onDeleteChat(target.chat, target.project);
    else await props.onDeleteProject(target.project);
  };

  const deleteCopy = () => {
    const target = deleting();
    if (target?.type !== "project") return { title: "Delete this chat?", description: "This permanently deletes the Pi session transcript and this chat's attached files." };
    if (target.project.origin === "linked") return { title: "Unlink this workspace?", description: `This unregisters ${target.project.name} and deletes its Conduit chats. The linked directory on disk is kept.` };
    if (target.project.origin === "cloned") return { title: "Unlink this workspace?", description: `This unregisters ${target.project.name} and deletes its Conduit chats. The cloned directory on disk is kept.` };
    return { title: "Delete this folder?", description: `This permanently deletes ${target.project.name}, its working files, and all of its chats.` };
  };

  const ChatMenu = (menuProps: { chat: ChatSummary; project: Project }) => <ContextMenu>
    <ContextMenuTrigger as="button" class="sidebar-row sidebar-chat" aria-current={props.selectedId === menuProps.chat.id ? "page" : undefined} onClick={() => { closeMobile(); void props.onOpenChat(menuProps.chat, menuProps.project); }}>
      <RuntimeIndicator process={processFor(menuProps.chat)} stale={props.runtime.stale()} />
      <span>{menuProps.chat.title}</span>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-60 sidebar-context-menu">
      <ContextMenuGroup>
        <ContextMenuItem onSelect={() => requestRenameChat(menuProps.chat, menuProps.project)}><PencilIcon />Rename</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><FolderInputIcon />Move to folder…</ContextMenuSubTrigger>
          <ContextMenuSubContent class="w-48 sidebar-context-menu">
            <ContextMenuRadioGroup value={menuProps.project.id} onChange={(id) => { const target = props.projects.find((item) => item.id === id); if (target) void props.onMoveChat(menuProps.chat, menuProps.project, target); }}>
              <For each={props.projects}>{(target) => <ContextMenuRadioItem value={target.id}>{target.name}</ContextMenuRadioItem>}</For>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={() => void props.onCopyTranscript(menuProps.chat)}><ClipboardCopyIcon />Copy transcript</ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem variant="destructive" onSelect={() => setDeleting({ type: "chat", ...menuProps })}><Trash2Icon />Delete chat</ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>;

  const ProjectBlock = (blockProps: { project: Project; workspace?: boolean }) => {
    const [open, setOpen] = createSignal(true);
    const isWorkspace = () => blockProps.project.origin === "linked" || blockProps.project.origin === "cloned" || blockProps.project.kind === "workspace";
    const deleteLabel = () => blockProps.project.deletesFilesOnRemove === false ? "Unlink workspace"
      : isWorkspace() ? "Delete workspace"
        : `Delete ${blockProps.workspace ? "workspace" : "folder"}`;
    return <div class="sidebar-project-block">
      <ContextMenu>
        <ContextMenuTrigger as="button" class="sidebar-row sidebar-project" data-open={open()} onClick={() => setOpen((value) => !value)}>
          <FolderIcon />
          <ProjectActivityIndicator sessions={blockProps.project.sessions} processFor={processFor} stale={props.runtime.stale()} />
          <span>{blockProps.project.name}</span>
          <ChevronRightIcon class="sidebar-chevron" />
        </ContextMenuTrigger>
        <ContextMenuContent class="w-60 sidebar-context-menu">
          <ContextMenuGroup>
            <ContextMenuItem onSelect={() => { closeMobile(); void props.onNewChat(blockProps.project); }}><MessageSquarePlusIcon />New chat</ContextMenuItem>
            <ContextMenuItem onSelect={() => requestRenameProject(blockProps.project)}><PencilIcon />Rename {blockProps.workspace ? "workspace" : "folder"}</ContextMenuItem>
            <Show when={blockProps.workspace}><ContextMenuItem onSelect={() => props.onOpenSettings("workspaces", blockProps.project.id)}><Settings2Icon />Workspace settings</ContextMenuItem></Show>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={!blockProps.project.sessions.length}><FolderInputIcon />Move chats to…</ContextMenuSubTrigger>
              <ContextMenuSubContent class="w-48 sidebar-context-menu">
                <For each={props.projects.filter((item) => item.id !== blockProps.project.id)}>
                  {(target) => <ContextMenuItem onSelect={() => void props.onMoveProjectChats(blockProps.project, target)}>{target.name}</ContextMenuItem>}
                </For>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem variant="destructive" onSelect={() => setDeleting({ type: "project", project: blockProps.project })}><Trash2Icon />{deleteLabel()}</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <Show when={open()}>
        <For each={blockProps.project.sessions}>{(chat) => <ChatMenu chat={chat} project={blockProps.project} />}</For>
        <Show when={!blockProps.project.sessions.length}><div class="sidebar-empty">No chats</div></Show>
      </Show>
    </div>;
  };

  const Group = (groupProps: { label: string; projects: Project[]; chatRoot?: Project; workspace?: boolean; emptyLabel?: string; onAdd?: () => void; addLabel?: string }) => <section class="sidebar-group">
    <div class="sidebar-group-header">
      <div data-sidebar="group-label">{groupProps.label}</div>
      <Show when={groupProps.onAdd}>
        <button class="sidebar-group-action" aria-label={groupProps.addLabel} title={groupProps.addLabel} onClick={groupProps.onAdd}>
          {groupProps.label === "Chats" ? <PlusIcon /> : <FolderPlusIcon />}
        </button>
      </Show>
    </div>
    <Show when={groupProps.chatRoot}>
      <For each={groupProps.chatRoot!.sessions.filter((chat) => chat.status !== "draft" || chat.id !== props.selectedId)}>{(chat) => <ChatMenu chat={chat} project={groupProps.chatRoot!} />}</For>
    </Show>
    <For each={groupProps.projects}>{(project) => <ProjectBlock project={project} workspace={groupProps.workspace} />}</For>
    <Show when={!groupProps.chatRoot && !groupProps.projects.length && groupProps.emptyLabel}><div class="sidebar-empty">{groupProps.emptyLabel}</div></Show>
  </section>;

  const connectionLabel = () => props.connectivity === "online" ? "Server connected" : props.connectivity === "offline" ? "Server unavailable" : props.connectivity === "reconnecting" ? "Reconnecting" : "Connecting";

  return <>
    <Button variant="ghost" size="icon" class="mobile-sidebar-trigger" aria-label="Toggle Sidebar" onClick={() => setMobileOpen((value) => !value)}><PanelLeftIcon /></Button>
    <aside data-slot="sidebar" data-state={collapsed() ? "collapsed" : "expanded"} data-mobile-open={mobileOpen()} class="conduit-sidebar">
      <div data-slot="sidebar-container" class="sidebar-container">
        <div data-sidebar="header"><button aria-label="Conduit" onClick={() => chats() && void props.onNewChat(chats()!)}><CableIcon /><span>Conduit</span></button></div>
        <div data-sidebar="content" class="sidebar-content">
          <Group label="Chats" projects={[]} chatRoot={chats()} addLabel="New chat" onAdd={() => chats() && void props.onNewChat(chats()!)} />
          <Group label="Projects" projects={folders()} emptyLabel="No projects" addLabel="New folder" onAdd={() => openNewDialog("folder")} />
          <Group label="Workspaces" projects={workspaces()} workspace emptyLabel="No workspaces" addLabel="New workspace" onAdd={() => openNewDialog("workspace")} />
        </div>
        <div data-sidebar="footer"><Menu><MenuTrigger class="sidebar-user"><CableIcon /><span><strong>Conduit</strong><small>{connectionLabel()}</small></span></MenuTrigger><MenuContent>
          <MenuItem onSelect={() => { closeMobile(); props.onOpenSettings("models"); }}>Manage settings</MenuItem>
          <MenuItem onSelect={() => { closeMobile(); props.onOpenPalette(); }}>Command Palette</MenuItem>
          <MenuItem onSelect={() => fetch("/v0/auth/logout", { method: "POST" }).finally(() => { location.href = "/login"; })}>Sign out</MenuItem>
        </MenuContent></Menu></div>
        <button data-sidebar="rail" aria-hidden="true" tabIndex={-1} onClick={() => setCollapsed((value) => !value)} />
      </div>
      <Button variant="ghost" size="icon-sm" data-sidebar="trigger" aria-label="Toggle Sidebar" onClick={() => setCollapsed((value) => !value)}><PanelLeftIcon /></Button>
    </aside>

    <Modal open={Boolean(newKind())} title={newKind() === "workspace" ? "New workspace" : "New folder"}
      description={newKind() === "workspace"
        ? "Link an existing allow-listed directory or clone a repository into a chosen host directory."
        : "Create a separate managed working directory and chat scope."}
      onClose={closeNewDialog}>
      <form onSubmit={submitNew}><FieldGroup>
        <Show when={newKind() === "workspace"}><Field><FieldLabel for="folder-mode">Type</FieldLabel><select id="folder-mode" value={mode()} disabled={submitting()} onChange={(event) => setMode(event.currentTarget.value)}>
          <option value="linked">Link existing directory</option><option value="cloned">Clone git repository</option>
        </select></Field></Show>
        <Field><FieldLabel for="folder-name">{mode() === "managed" ? "Display name" : "Display name (optional)"}</FieldLabel><Input id="folder-name" value={name()} disabled={submitting()} placeholder={mode() === "managed" ? "Research" : "My project"} onInput={(event) => setName(event.currentTarget.value)} /></Field>
        <Show when={mode() === "linked" || mode() === "cloned"}><Field><FieldLabel for="folder-path">{mode() === "cloned" ? "Clone location" : "Absolute path"}</FieldLabel><Input id="folder-path" value={path()} disabled={submitting()} list="workspace-path-suggestions" placeholder={mode() === "cloned" ? "~/code/new-repo" : "~/code/my-repo"} onInput={(event) => setPath(event.currentTarget.value)} /><datalist id="workspace-path-suggestions"><For each={props.workspaceSuggestions}>{(item) => <option value={item.displayPath || item.path} label={item.name} />}</For></datalist></Field></Show>
        <Show when={mode() === "cloned"}><Field><FieldLabel for="folder-clone">Git URL</FieldLabel><Input id="folder-clone" value={cloneUrl()} disabled={submitting()} placeholder="https://github.com/org/repo.git" onInput={(event) => setCloneUrl(event.currentTarget.value)} /></Field></Show>
        <div class="flex justify-end gap-2"><Button type="button" variant="outline" disabled={submitting()} onClick={closeNewDialog}>Cancel</Button><Button type="submit" disabled={!canCreate()}>{submitting()
          ? (mode() === "cloned" ? "Cloning…" : "Creating…")
          : mode() === "cloned" ? "Clone workspace" : mode() === "linked" ? "Link workspace" : "Create folder"}</Button></div>
      </FieldGroup></form>
    </Modal>

    <Modal open={Boolean(rename())} title={rename()?.type === "chat" ? "Rename chat" : "Rename folder"}
      description={rename()?.type === "chat" ? "Set the display name stored in the Pi session." : "Change the folder's display name without changing its working-directory path."}
      onClose={() => setRename(null)}>
      <form onSubmit={submitRename}><Field><FieldLabel for="rename-name">Name</FieldLabel><Input id="rename-name" value={renameValue()} onInput={(event) => setRenameValue(event.currentTarget.value)} /></Field><div class="mt-4 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setRename(null)}>Cancel</Button><Button type="submit" disabled={!renameValue().trim()}>Rename</Button></div></form>
    </Modal>

    <AlertModal open={Boolean(deleting())} title={deleteCopy().title} description={deleteCopy().description} onClose={() => setDeleting(null)}>
      <div class="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" onClick={() => void confirmDelete()}>Delete</Button></div>
    </AlertModal>

    <Modal open={Boolean(moving())} title="Move chat" description="Choose the working folder for this chat and its attachments." onClose={() => setMoving(null)}>
      <div class="palette-move-list">
        <For each={props.projects.filter((item) => item.id !== moving()?.project.id)}>
          {(target) => <Button variant="ghost" class="palette-move-option" onClick={() => { const current = moving(); if (current) void props.onMoveChat(current.chat, current.project, target); setMoving(null); }}><FolderIcon /><span>{target.name}</span></Button>}
        </For>
        <Show when={!props.projects.some((item) => item.id !== moving()?.project.id)}>
          <p class="text-sm text-muted-foreground">No other folders to move this chat to.</p>
        </Show>
      </div>
      <div class="mt-4 flex justify-end"><Button type="button" variant="outline" onClick={() => setMoving(null)}>Cancel</Button></div>
    </Modal>
  </>;
}
