import { useState } from "react";
import {
  CableIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquarePlusIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

function DeleteContextMenu({ children, disabled = false, label, onDelete }) {
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem variant="destructive" disabled={disabled} onSelect={onDelete}>
          <Trash2Icon />
          {label}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>;
}

export function AppSidebar({
  projects,
  projectId,
  selectedId,
  view,
  onAddProject,
  onDeleteProject,
  onDeleteSession,
  onNewChat,
  onOpenSession,
  onOpenSettings,
}) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const { setOpenMobile } = useSidebar();

  const chatsProject = projects.find((project) => project.slug === "chat") || projects[0];
  const folderProjects = projects.filter((project) => project.slug !== "chat");

  const chooseSession = (session, project) => {
    setOpenMobile(false);
    onOpenSession(session, project);
  };

  const chooseNewChat = (project = chatsProject) => {
    setOpenMobile(false);
    onNewChat(project);
  };

  const chooseSettings = () => {
    setOpenMobile(false);
    onOpenSettings();
  };

  const confirmDelete = () => {
    if (pendingDelete?.type === "project") onDeleteProject(pendingDelete.project);
    if (pendingDelete?.type === "session") onDeleteSession(pendingDelete.session, pendingDelete.project);
    setPendingDelete(null);
  };

  const createFolder = async (event) => {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name || !await onAddProject(name)) return;
    setNewFolderName("");
    setNewFolderOpen(false);
    setOpenMobile(false);
  };

  return <>
    <Sidebar collapsible="offcanvas" variant="inset" className="conduit-sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="sidebar-brand">
              <CableIcon />
              <span>Conduit</span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="gap-2 py-4">
          <SidebarGroupLabel className="h-7 px-2 text-base font-semibold text-sidebar-foreground">Chats</SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {chatsProject && <>
              {chatsProject.sessions.map((session) => <SidebarMenuItem key={session.id}>
                <DeleteContextMenu
                  label="Delete chat"
                  onDelete={() => setPendingDelete({ type: "session", session, project: chatsProject })}
                >
                  <SidebarMenuButton
                    size="sm"
                    isActive={view === "chat" && selectedId === session.id}
                    aria-current={view === "chat" && selectedId === session.id ? "page" : undefined}
                    tooltip={session.title}
                    onClick={() => chooseSession(session, chatsProject)}
                  >
                    <span>{session.title}</span>
                  </SidebarMenuButton>
                </DeleteContextMenu>
              </SidebarMenuItem>)}
            </>}
          </SidebarMenu>
        </SidebarGroup>

        {folderProjects.length > 0 && <SidebarGroup className="gap-2 py-4 pt-0">
          <SidebarGroupLabel className="h-7 px-2 text-base font-semibold text-sidebar-foreground">Projects</SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {folderProjects.map((project) => {
              return <Collapsible key={project.id} defaultOpen asChild>
                <SidebarMenuItem>
                  <DeleteContextMenu
                    label="Delete folder"
                    onDelete={() => setPendingDelete({ type: "project", project })}
                  >
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton size="sm" className="font-normal" tooltip={project.name}>
                        <FolderIcon />
                        <span className="font-semibold">{project.name}</span>
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  </DeleteContextMenu>
                  <CollapsibleContent>
                    <SidebarMenu className="mt-1 gap-1 pl-4">
                      {project.sessions.map((session) => <SidebarMenuItem key={session.id}>
                        <DeleteContextMenu
                          label="Delete chat"
                          onDelete={() => setPendingDelete({ type: "session", session, project })}
                        >
                          <SidebarMenuButton
                            size="sm"
                            isActive={view === "chat" && selectedId === session.id}
                            aria-current={view === "chat" && selectedId === session.id ? "page" : undefined}
                            tooltip={session.title}
                            onClick={() => chooseSession(session, project)}
                          >
                            <span>{session.title}</span>
                          </SidebarMenuButton>
                        </DeleteContextMenu>
                      </SidebarMenuItem>)}
                      {!project.sessions.length && <li className="px-2 py-1.5 text-xs text-sidebar-foreground/45">No chats</li>}
                    </SidebarMenu>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>;
            })}
          </SidebarMenu>
        </SidebarGroup>}
      </SidebarContent>

      <SidebarFooter>
        <ButtonGroup aria-label="Sidebar actions" orientation="vertical" className="w-full">
          <Button variant="outline" size="lg" className="w-full justify-start" onClick={() => chooseNewChat()}>
            <MessageSquarePlusIcon data-icon="inline-start" />
            <span>New chat</span>
          </Button>
          <Button variant="outline" size="lg" className="w-full justify-start" onClick={() => setNewFolderOpen(true)}>
            <FolderPlusIcon data-icon="inline-start" />
            <span>New folder</span>
          </Button>
          <Button variant="outline" size="lg" className="w-full justify-start" aria-current={view === "settings" ? "page" : undefined} onClick={chooseSettings}>
            <SettingsIcon data-icon="inline-start" />
            <span>Settings</span>
          </Button>
        </ButtonGroup>
      </SidebarFooter>
    </Sidebar>

    <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingDelete?.type === "project" ? "Delete this folder?" : "Delete this chat?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.type === "project"
              ? `This permanently deletes ${pendingDelete.project.name}, its working files, and all of its chats.`
              : "This permanently deletes the Pi session transcript."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirmDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
      <DialogContent>
        <form onSubmit={createFolder}>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Create a separate working directory and chat scope.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-4">
            <Field>
              <FieldLabel htmlFor="folder-name">Folder name</FieldLabel>
              <Input
                id="folder-name"
                autoFocus
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="Research"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!newFolderName.trim()}>Create folder</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
