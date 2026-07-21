import { createEffect, createSignal, For, Show } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import * as KDialog from "@kobalte/core/dialog";
import { CableIcon, FolderIcon, FolderPlusIcon, MessageSquareIcon, PanelLeftIcon, PlusIcon, SettingsIcon } from "lucide-solid";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
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
import type { ChatSummary, Project } from "../api/contracts";
import type { RuntimeStore } from "../state/runtime";

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

function RuntimeDot(props: { chatId: string; runtime: RuntimeStore }) {
  const process = () => props.runtime.getProcess(props.chatId);
  return <Show when={process()}><span class={`runtime-dot ${process()?.active ? "active" : "ready"}`} aria-label={String(process()?.activity || process()?.status || "running")} /></Show>;
}

export function Sidebar(props: {
  projects: Project[];
  projectId: string;
  selectedId: string | null;
  runtime: RuntimeStore;
  connectivity: string;
  workspaceSuggestions: string[];
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

  createEffect(() => {
    const command = props.command;
    if (!command) return;
    if (command.type === "new-folder") { setMode("managed"); setNewKind("folder"); }
    if (command.type === "new-workspace") { setMode("linked"); setNewKind("workspace"); }
    if (command.type === "delete-chat") {
      const project = props.projects.find((item) => item.sessions.some((chat) => chat.id === props.selectedId))
        || props.projects.find((item) => item.id === props.projectId);
      const chat = project?.sessions.find((item) => item.id === props.selectedId)
        || (project && props.selectedId ? { id: props.selectedId, projectId: project.id, status: "draft" as const, title: "New chat" } : null);
      if (project && chat) setDeleting({ type: "chat", project, chat });
    }
  });

  createEffect(() => localStorage.setItem("conduit.sidebar", collapsed() ? "collapsed" : "expanded"));
  const chats = () => props.projects.find((project) => project.slug === "chat") || props.projects[0];
  const folders = () => props.projects.filter((project) => project.slug !== "chat" && project.origin !== "linked" && project.origin !== "cloned" && project.kind !== "workspace");
  const workspaces = () => props.projects.filter((project) => project.origin === "linked" || project.origin === "cloned" || project.kind === "workspace");
  const closeMobile = () => setMobileOpen(false);

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
    const input: ProjectInput = mode() === "managed" ? { mode: "managed", name: name().trim() }
      : mode() === "linked" ? { mode: "linked", name: name().trim() || undefined, path: path().trim() }
        : { mode: "cloned", name: name().trim() || undefined, path: path().trim(), cloneUrl: cloneUrl().trim() };
    setSubmitting(true);
    try { if (await props.onAddProject(input)) { setNewKind(null); setName(""); setPath(""); setCloneUrl(""); setMode("managed"); } }
    finally { setSubmitting(false); }
  };

  const confirmDelete = async () => {
    const target = deleting();
    if (!target) return;
    setDeleting(null);
    if (target.type === "chat") await props.onDeleteChat(target.chat, target.project);
    else await props.onDeleteProject(target.project);
  };

  const ChatMenu = (menuProps: { chat: ChatSummary; project: Project }) => <ContextMenu>
    <ContextMenuTrigger as="button" class="sidebar-row" aria-current={props.selectedId === menuProps.chat.id ? "page" : undefined} onClick={() => { closeMobile(); void props.onOpenChat(menuProps.chat, menuProps.project); }}>
      <MessageSquareIcon /><span>{menuProps.chat.title}</span><RuntimeDot chatId={menuProps.chat.id} runtime={props.runtime} />
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => requestRenameChat(menuProps.chat, menuProps.project)}>Rename</ContextMenuItem>
      <ContextMenuSub><ContextMenuSubTrigger>Move to folder…</ContextMenuSubTrigger><ContextMenuSubContent>
        <ContextMenuRadioGroup value={menuProps.project.id} onChange={(id) => { const target = props.projects.find((item) => item.id === id); if (target) void props.onMoveChat(menuProps.chat, menuProps.project, target); }}>
          <For each={props.projects.filter((item) => item.kind !== "workspace" && item.origin !== "linked" && item.origin !== "cloned")}>
            {(target) => <ContextMenuRadioItem value={target.id}>{target.name}</ContextMenuRadioItem>}
          </For>
        </ContextMenuRadioGroup>
      </ContextMenuSubContent></ContextMenuSub>
      <ContextMenuItem onSelect={() => void props.onCopyTranscript(menuProps.chat)}>Copy transcript</ContextMenuItem>
      <ContextMenuItem class="text-destructive" onSelect={() => setDeleting({ type: "chat", ...menuProps })}>Delete chat</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;

  const ProjectMenu = (menuProps: { project: Project; workspace?: boolean }) => <ContextMenu>
    <ContextMenuTrigger as="button" class="sidebar-row sidebar-project"><FolderIcon /><span>{menuProps.project.name}</span></ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => { closeMobile(); void props.onNewChat(menuProps.project); }}>New chat</ContextMenuItem>
      <Show when={menuProps.workspace}><ContextMenuItem onSelect={() => props.onOpenSettings("workspaces", menuProps.project.id)}>Workspace settings</ContextMenuItem></Show>
      <ContextMenuItem onSelect={() => requestRenameProject(menuProps.project)}>Rename {menuProps.workspace ? "workspace" : "folder"}</ContextMenuItem>
      <ContextMenuSub><ContextMenuSubTrigger disabled={!menuProps.project.sessions.length}>Move chats to…</ContextMenuSubTrigger><ContextMenuSubContent>
        <For each={props.projects.filter((item) => item.id !== menuProps.project.id && item.kind !== "workspace" && item.origin !== "linked" && item.origin !== "cloned")}>
          {(target) => <ContextMenuItem onSelect={() => void props.onMoveProjectChats(menuProps.project, target)}>{target.name}</ContextMenuItem>}
        </For>
      </ContextMenuSubContent></ContextMenuSub>
      <ContextMenuItem class="text-destructive" onSelect={() => setDeleting({ type: "project", project: menuProps.project })}>{menuProps.workspace ? "Unlink workspace" : "Delete folder"}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;

  const Group = (groupProps: { label: string; projects: Project[]; chatRoot?: Project; workspace?: boolean }) => <section class="sidebar-group">
    <div data-sidebar="group-label">{groupProps.label}</div>
    <Show when={groupProps.chatRoot}>
      <For each={groupProps.chatRoot!.sessions.filter((chat) => chat.status !== "draft" || chat.id !== props.selectedId)}>{(chat) => <ChatMenu chat={chat} project={groupProps.chatRoot!} />}</For>
    </Show>
    <For each={groupProps.projects}>{(project) => <div class="sidebar-project-block"><ProjectMenu project={project} workspace={groupProps.workspace} /><For each={project.sessions}>{(chat) => <ChatMenu chat={chat} project={project} />}</For></div>}</For>
    <Show when={groupProps.label === "Projects"}><Button variant="ghost" class="sidebar-add" aria-label="New folder" onClick={() => { setMode("managed"); setNewKind("folder"); }}><FolderPlusIcon /><span>New folder</span></Button></Show>
    <Show when={groupProps.label === "Workspaces"}><Button variant="ghost" class="sidebar-add" aria-label="New workspace" onClick={() => { setMode("linked"); setNewKind("workspace"); }}><FolderPlusIcon /><span>New workspace</span></Button></Show>
  </section>;

  const connectionLabel = () => props.connectivity === "online" ? "Server connected" : props.connectivity === "offline" ? "Server unavailable" : props.connectivity === "reconnecting" ? "Reconnecting" : "Connecting";

  return <>
    <Button variant="ghost" size="icon" class="mobile-sidebar-trigger" aria-label="Toggle Sidebar" onClick={() => setMobileOpen((value) => !value)}><PanelLeftIcon /></Button>
    <aside data-slot="sidebar" data-state={collapsed() ? "collapsed" : "expanded"} data-mobile-open={mobileOpen()} class="conduit-sidebar">
      <div data-slot="sidebar-container" class="sidebar-container">
        <div data-sidebar="header"><button aria-label="Conduit" onClick={() => chats() && void props.onNewChat(chats()!)}><CableIcon /><span>Conduit</span></button></div>
        <Button variant="ghost" class="sidebar-add sidebar-new-chat" aria-label="New chat" onClick={() => chats() && void props.onNewChat(chats()!)}><PlusIcon /><span>New chat</span></Button>
        <div data-sidebar="content" class="sidebar-content">
          <Group label="Chats" projects={[]} chatRoot={chats()} />
          <Group label="Projects" projects={folders()} />
          <Group label="Workspaces" projects={workspaces()} workspace />
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

    <Modal open={Boolean(newKind())} title={newKind() === "workspace" ? "New workspace" : "New folder"} onClose={() => setNewKind(null)}>
      <form onSubmit={submitNew}><FieldGroup>
        <Field><FieldLabel for="folder-mode">Type</FieldLabel><select id="folder-mode" value={mode()} onChange={(event) => setMode(event.currentTarget.value)}>
          <Show when={newKind() === "folder"}><option value="managed">Managed folder</option></Show><option value="linked">Link existing folder</option><option value="cloned">Clone repository</option>
        </select></Field>
        <Show when={mode() === "managed"}><Field><FieldLabel for="folder-name">Name</FieldLabel><Input id="folder-name" aria-label="Name" value={name()} onInput={(event) => setName(event.currentTarget.value)} /></Field></Show>
        <Show when={mode() === "linked"}><Field><FieldLabel for="folder-path">Folder path</FieldLabel><Input id="folder-path" aria-label="Folder path" value={path()} list="workspace-suggestions" onInput={(event) => setPath(event.currentTarget.value)} /><datalist id="workspace-suggestions"><For each={props.workspaceSuggestions}>{(item) => <option value={item} />}</For></datalist></Field></Show>
        <Show when={mode() === "cloned"}><><Field><FieldLabel for="clone-url">Git URL</FieldLabel><Input id="clone-url" aria-label="Git URL" value={cloneUrl()} onInput={(event) => setCloneUrl(event.currentTarget.value)} /></Field><Field><FieldLabel for="clone-path">Clone location</FieldLabel><Input id="clone-path" aria-label="Clone location" value={path()} onInput={(event) => setPath(event.currentTarget.value)} /></Field></></Show>
        <div class="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setNewKind(null)}>Cancel</Button><Button type="submit" disabled={submitting() || (mode() === "managed" ? !name().trim() : mode() === "linked" ? !path().trim() : !(path().trim() && cloneUrl().trim()))}>{mode() === "cloned" ? "Clone workspace" : newKind() === "workspace" ? "Create workspace" : "Create folder"}</Button></div>
      </FieldGroup></form>
    </Modal>

    <Modal open={Boolean(rename())} title={rename()?.type === "chat" ? "Rename chat" : "Rename folder"} onClose={() => setRename(null)}>
      <form onSubmit={submitRename}><Field><FieldLabel for="rename-name">Name</FieldLabel><Input id="rename-name" aria-label="Name" value={renameValue()} onInput={(event) => setRenameValue(event.currentTarget.value)} /></Field><div class="mt-4 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setRename(null)}>Cancel</Button><Button type="submit" disabled={!renameValue().trim()}>Rename</Button></div></form>
    </Modal>

    <AlertModal open={Boolean(deleting())} title={deleting()?.type === "chat" ? "Delete this chat?" : deleting()?.type === "project" && deleting()!.project.origin !== "managed" ? "Unlink this workspace?" : "Delete this folder?"} description={deleting()?.type === "chat" ? "This permanently deletes the Pi session transcript and this chat's attached files." : "This removes the folder and its Conduit chats."} onClose={() => setDeleting(null)}>
      <div class="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" onClick={() => void confirmDelete()}>Delete</Button></div>
    </AlertModal>
  </>;
}
