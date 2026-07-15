import { useState } from "react";
import {
  FolderIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  SquarePenIcon,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

function ProjectMenu({ project, onNewChat, onDelete }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SidebarMenuAction showOnHover aria-label={`Actions for ${project.name}`}>
        <MoreHorizontalIcon />
      </SidebarMenuAction>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="right" align="start" className="w-44">
      <DropdownMenuItem onSelect={onNewChat}>
        <SquarePenIcon /> New chat
      </DropdownMenuItem>
      {project.slug !== "chat" && <>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon /> Delete folder
        </DropdownMenuItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function SessionMenu({ session, onDelete }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SidebarMenuAction showOnHover aria-label={`Actions for ${session.title}`}>
        <MoreHorizontalIcon />
      </SidebarMenuAction>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="right" align="start" className="w-40">
      <DropdownMenuItem variant="destructive" onSelect={onDelete}>
        <Trash2Icon /> Delete chat
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function AppSidebar({
  projects,
  projectId,
  selectedId,
  onAddProject,
  onDeleteProject,
  onDeleteSession,
  onNewChat,
  onOpenSession,
}) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const { setOpenMobile } = useSidebar();

  const chooseSession = (session, project) => {
    setOpenMobile(false);
    onOpenSession(session, project);
  };

  const chooseNewChat = (project) => {
    setOpenMobile(false);
    onNewChat(project);
  };

  const confirmDelete = () => {
    if (pendingDelete?.type === "project") onDeleteProject(pendingDelete.project);
    if (pendingDelete?.type === "session") onDeleteSession(pendingDelete.session, pendingDelete.project);
    setPendingDelete(null);
  };

  const createFolder = async (event) => {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    if (!await onAddProject(name)) return;
    setNewFolderName("");
    setNewFolderOpen(false);
    setOpenMobile(false);
  };

  return <>
    <Sidebar collapsible="icon" variant="sidebar" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            <SidebarMenuButton
              size="lg"
              tooltip="New chat"
              onClick={() => chooseNewChat(projects.find((project) => project.id === projectId) || projects[0])}
              className="min-w-0 flex-1"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <SquarePenIcon className="size-4" />
              </span>
              <span className="truncate font-semibold">Conduit</span>
            </SidebarMenuButton>
            <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:hidden" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2 py-3">
          <SidebarMenu>
            {projects.map((project) => <Collapsible key={project.id} defaultOpen asChild>
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={project.name} isActive={project.id === projectId}>
                    <FolderIcon />
                    <span>{project.name}</span>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <ProjectMenu
                  project={project}
                  onNewChat={() => chooseNewChat(project)}
                  onDelete={() => setPendingDelete({ type: "project", project })}
                />
                <CollapsibleContent>
                  <SidebarMenu className="mt-1 pl-4 group-data-[collapsible=icon]:hidden">
                    {project.sessions.map((session) => <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        size="sm"
                        isActive={selectedId === session.id}
                        tooltip={session.title}
                        onClick={() => chooseSession(session, project)}
                        className="pr-8"
                      >
                        <MessageSquareIcon />
                        <span>{session.title}</span>
                      </SidebarMenuButton>
                      <SessionMenu
                        session={session}
                        onDelete={() => setPendingDelete({ type: "session", session, project })}
                      />
                    </SidebarMenuItem>)}
                    {!project.sessions.length && <li className="px-2 py-1.5 text-xs text-sidebar-foreground/45">No chats</li>}
                  </SidebarMenu>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>)}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-auto px-2 pb-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="New folder" onClick={() => setNewFolderOpen(true)}>
                <FolderPlusIcon />
                <span>New folder</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" disabled>
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
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
          <Input
            autoFocus
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="Folder name"
            className="my-4"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!newFolderName.trim()}>Create folder</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
