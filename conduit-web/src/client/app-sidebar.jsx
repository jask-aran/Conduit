import { useEffect, useState } from "react";
import { CableIcon } from "lucide-react";
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavChats } from "./nav-chats";
import { NavProjects } from "./nav-projects";
import { NavUser } from "./nav-user";

function ConduitBrand({ onClick }) {
  return <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" tooltip="Conduit" onClick={onClick}>
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <CableIcon className="size-6" absoluteStrokeWidth />
        </div>
        <div className="grid flex-1 text-left leading-tight">
          <span className="truncate text-2xl leading-6 font-medium">Conduit</span>
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>;
}

export function AppSidebar({
  projects,
  commandRequest,
  projectId,
  selectedId,
  selectedStatus,
  selectedTitle,
  view,
  onAddProject,
  onCopyTranscript,
  onDeleteProject,
  onDeleteSession,
  onCommandHandled,
  onMoveProjectSessions,
  onMoveSession,
  onNewChat,
  onOpenDirectory,
  onOpenSession,
  onOpenSettings,
  onRenameProject,
  onRenameSession,
}) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingRename, setPendingRename] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pendingMove, setPendingMove] = useState(null);
  const { setOpenMobile } = useSidebar();

  const chatsProject = projects.find((project) => project.slug === "chat") || projects[0];
  const folderProjects = projects.filter((project) => project.slug !== "chat");
  const selectedTarget = projects.flatMap((project) => project.sessions.map((session) => ({ session, project })))
    .find((item) => item.session.id === selectedId)
    || (selectedId && projects.find((project) => project.id === projectId)
      ? {
        session: { id: selectedId, projectId, status: selectedStatus, title: selectedTitle || "New chat" },
        project: projects.find((project) => project.id === projectId),
      }
      : null);

  useEffect(() => {
    if (!commandRequest || !selectedTarget) return;
    if (commandRequest.type === "rename") requestRename({ type: "session", ...selectedTarget });
    if (commandRequest.type === "move") setPendingMove(selectedTarget);
    if (commandRequest.type === "delete") setPendingDelete({ type: "session", ...selectedTarget });
    onCommandHandled?.();
  }, [commandRequest, selectedTarget]);

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

  const requestRename = (target) => {
    setPendingRename(target);
    setRenameName(target.type === "project" ? target.project.name : target.session.title);
  };

  const submitRename = async (event) => {
    event.preventDefault();
    const name = renameName.trim();
    if (!name || !pendingRename) return;
    const saved = pendingRename.type === "project"
      ? await onRenameProject(pendingRename.project, name)
      : await onRenameSession(pendingRename.session, pendingRename.project, name);
    if (!saved) return;
    setPendingRename(null);
    setRenameName("");
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
    <Sidebar collapsible="icon" className="conduit-sidebar">
      <SidebarHeader>
        <ConduitBrand onClick={() => chooseNewChat(chatsProject)} />
      </SidebarHeader>

      <SidebarContent>
        <NavChats
          project={chatsProject}
          projects={projects}
          selectedId={selectedId}
          view={view}
          onCopyTranscript={onCopyTranscript}
          onMoveSession={onMoveSession}
          onNewChat={chooseNewChat}
          onOpenSession={chooseSession}
          onRenameSession={(session, project) => requestRename({ type: "session", session, project })}
          onDeleteSession={(session, project) => setPendingDelete({ type: "session", session, project })}
        />
        <NavProjects
          allProjects={projects}
          projects={folderProjects}
          selectedId={selectedId}
          view={view}
          onAddProject={() => setNewFolderOpen(true)}
          onCopyTranscript={onCopyTranscript}
          onMoveProjectSessions={onMoveProjectSessions}
          onMoveSession={onMoveSession}
          onNewChat={chooseNewChat}
          onOpenDirectory={onOpenDirectory}
          onOpenSession={chooseSession}
          onRenameProject={(project) => requestRename({ type: "project", project })}
          onRenameSession={(session, project) => requestRename({ type: "session", session, project })}
          onDeleteProject={(project) => setPendingDelete({ type: "project", project })}
          onDeleteSession={(session, project) => setPendingDelete({ type: "session", session, project })}
        />
      </SidebarContent>

      <SidebarFooter>
        <NavUser onOpenSettings={chooseSettings} />
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
              : "This permanently deletes the Pi session transcript and this chat's attached files."}
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

    <Dialog open={Boolean(pendingRename)} onOpenChange={(open) => !open && setPendingRename(null)}>
      <DialogContent>
        <form onSubmit={submitRename}>
          <DialogHeader>
            <DialogTitle>{pendingRename?.type === "project" ? "Rename folder" : "Rename chat"}</DialogTitle>
            <DialogDescription>
              {pendingRename?.type === "project"
                ? "Change the folder's display name without changing its working-directory path."
                : "Set the display name stored in the Pi session."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-4">
            <Field>
              <FieldLabel htmlFor="rename-name">Name</FieldLabel>
              <Input
                id="rename-name"
                autoFocus
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRename(null)}>Cancel</Button>
            <Button type="submit" disabled={!renameName.trim()}>Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(pendingMove)} onOpenChange={(open) => !open && setPendingMove(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move chat</DialogTitle>
          <DialogDescription>Choose the working folder for this chat and its attachments.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          {projects.filter((item) => item.id !== pendingMove?.project.id).map((target) => <Button
            key={target.id}
            variant="outline"
            className="justify-start"
            onClick={() => {
              onMoveSession(pendingMove.session, pendingMove.project, target);
              setPendingMove(null);
            }}
          >{target.name}</Button>)}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
