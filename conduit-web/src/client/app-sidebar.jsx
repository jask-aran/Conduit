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
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
  connectivity = "online",
  getProcess,
  runtimeStale = false,
  onRetryConnection,
  onAddProject,
  onCopyTranscript,
  onDeleteProject,
  onDeleteSession,
  onCommandHandled,
  onMoveProjectSessions,
  onMoveSession,
  onNewChat,
  onOpenSession,
  onOpenSettings,
  onRenameProject,
  onRenameSession,
}) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingRename, setPendingRename] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderIsWorkspace, setNewFolderIsWorkspace] = useState(false);
  const [newFolderMode, setNewFolderMode] = useState("managed");
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [newFolderCloneUrl, setNewFolderCloneUrl] = useState("");
  const [newFolderSubmitting, setNewFolderSubmitting] = useState(false);
  const [pendingMove, setPendingMove] = useState(null);
  const { setOpenMobile } = useSidebar();

  const chatsProject = projects.find((project) => project.slug === "chat") || projects[0];
  const folderProjects = projects.filter((project) => project.slug !== "chat" && project.origin !== "linked" && project.origin !== "cloned");
  const workspaceProjects = projects.filter((project) => project.origin === "linked" || project.origin === "cloned");
  const selectedTarget = projects.flatMap((project) => project.sessions.map((session) => ({ session, project })))
    .find((item) => item.session.id === selectedId)
    || (selectedId && projects.find((project) => project.id === projectId)
      ? {
        session: { id: selectedId, projectId, status: selectedStatus, title: selectedTitle || "New chat" },
        project: projects.find((project) => project.id === projectId),
      }
      : null);

  useEffect(() => {
    if (!commandRequest) return;
    if (commandRequest.type === "new-folder") {
      openNewFolderDialog(false);
      onCommandHandled?.();
      return;
    }
    if (commandRequest.type === "new-workspace") {
      openNewFolderDialog(true);
      onCommandHandled?.();
      return;
    }
    if (!selectedTarget) return;
    if (commandRequest.type === "rename") requestRename({ type: "session", ...selectedTarget });
    if (commandRequest.type === "rename-folder") {
      const project = projects.find((item) => item.id === projectId);
      if (project && project.slug !== "chat") requestRename({ type: "project", project });
    }
    if (commandRequest.type === "move") setPendingMove(selectedTarget);
    if (commandRequest.type === "delete") setPendingDelete({ type: "session", ...selectedTarget });
    if (commandRequest.type === "delete-folder") {
      const project = projects.find((item) => item.id === projectId);
      if (project && project.slug !== "chat") setPendingDelete({ type: "project", project });
    }
    onCommandHandled?.();
  }, [commandRequest, selectedTarget, projectId, projects]);

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

  const openNewFolderDialog = (workspace = false) => {
    setNewFolderIsWorkspace(workspace);
    setNewFolderMode(workspace ? "linked" : "managed");
    setNewFolderOpen(true);
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
    if (newFolderSubmitting) return;
    const name = newFolderName.trim();
    const pathValue = newFolderPath.trim();
    const cloneUrl = newFolderCloneUrl.trim();
    if (newFolderMode === "managed" && !name) return;
    if (newFolderMode === "linked" && !pathValue) return;
    if (newFolderMode === "cloned" && !cloneUrl) return;
    const payload = newFolderMode === "managed"
      ? { mode: "managed", name }
      : newFolderMode === "linked"
        ? { mode: "linked", name: name || undefined, path: pathValue, defaultTemplateId: "workspace" }
        : { mode: "cloned", name: name || undefined, cloneUrl, defaultTemplateId: "workspace" };
    setNewFolderSubmitting(true);
    try {
      if (!await onAddProject(payload)) return;
      setNewFolderName("");
      setNewFolderPath("");
      setNewFolderCloneUrl("");
      setNewFolderIsWorkspace(false);
      setNewFolderMode("managed");
      setNewFolderOpen(false);
      setOpenMobile(false);
    } finally {
      setNewFolderSubmitting(false);
    }
  };

  const canCreateFolder = !newFolderSubmitting && (
    newFolderMode === "managed"
      ? Boolean(newFolderName.trim())
      : newFolderMode === "linked"
        ? Boolean(newFolderPath.trim())
        : Boolean(newFolderCloneUrl.trim())
  );

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
          getProcess={getProcess}
          runtimeStale={runtimeStale}
          runtimeOnline={connectivity === "online"}
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
          groupLabel="Projects"
          addLabel="New folder"
          emptyLabel="No projects"
          projectNoun="folder"
          selectedId={selectedId}
          view={view}
          getProcess={getProcess}
          runtimeStale={runtimeStale}
          runtimeOnline={connectivity === "online"}
          onAddProject={() => openNewFolderDialog(false)}
          onCopyTranscript={onCopyTranscript}
          onMoveProjectSessions={onMoveProjectSessions}
          onMoveSession={onMoveSession}
          onNewChat={chooseNewChat}
          onOpenSession={chooseSession}
          onRenameProject={(project) => requestRename({ type: "project", project })}
          onRenameSession={(session, project) => requestRename({ type: "session", session, project })}
          onDeleteProject={(project) => setPendingDelete({ type: "project", project })}
          onDeleteSession={(session, project) => setPendingDelete({ type: "session", session, project })}
        />
        {workspaceProjects.length > 0 && <NavProjects
          allProjects={projects}
          projects={workspaceProjects}
          groupLabel="Workspaces"
          addLabel="New workspace"
          emptyLabel="No workspaces"
          projectNoun="workspace"
          selectedId={selectedId}
          view={view}
          getProcess={getProcess}
          runtimeStale={runtimeStale}
          runtimeOnline={connectivity === "online"}
          onAddProject={() => openNewFolderDialog(true)}
          onCopyTranscript={onCopyTranscript}
          onMoveProjectSessions={onMoveProjectSessions}
          onMoveSession={onMoveSession}
          onNewChat={chooseNewChat}
          onOpenSession={chooseSession}
          onRenameProject={(project) => requestRename({ type: "project", project })}
          onRenameSession={(session, project) => requestRename({ type: "session", session, project })}
          onDeleteProject={(project) => setPendingDelete({ type: "project", project })}
          onDeleteSession={(session, project) => setPendingDelete({ type: "session", session, project })}
        />}
      </SidebarContent>

      <SidebarFooter>
        <NavUser
          onOpenSettings={chooseSettings}
          connectivity={connectivity}
          onRetryConnection={onRetryConnection}
        />
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
              ? (pendingDelete.project.origin === "linked"
                ? `This unregisters ${pendingDelete.project.name} and deletes its Conduit chats. The linked directory on disk is kept.`
                : `This permanently deletes ${pendingDelete.project.name}, its working files, and all of its chats.`)
              : "This permanently deletes the Pi session transcript and this chat's attached files."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirmDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={newFolderOpen} onOpenChange={(open) => {
      if (newFolderSubmitting) return;
      setNewFolderOpen(open);
      if (!open) {
        setNewFolderIsWorkspace(false);
        setNewFolderMode("managed");
        setNewFolderName("");
        setNewFolderPath("");
        setNewFolderCloneUrl("");
      }
    }}>
      <DialogContent>
        <form onSubmit={createFolder}>
          <DialogHeader>
            <DialogTitle>{newFolderIsWorkspace ? "New workspace" : "New folder"}</DialogTitle>
            <DialogDescription>
              {newFolderIsWorkspace
                ? "Link an existing allow-listed directory or clone a repository into Conduit."
                : "Create a separate managed working directory and chat scope."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-4">
            <Field>
              <FieldLabel htmlFor="folder-mode">Type</FieldLabel>
              <select
                id="folder-mode"
                className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
                value={newFolderMode}
                disabled={newFolderSubmitting}
                onChange={(event) => setNewFolderMode(event.target.value)}
              >
              {!newFolderIsWorkspace && <option value="managed">Managed folder</option>}
                <option value="linked">Link existing directory</option>
                <option value="cloned">Clone git repository</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="folder-name">Display name{newFolderMode === "managed" ? "" : " (optional)"}</FieldLabel>
              <Input
                id="folder-name"
                autoFocus={newFolderMode === "managed"}
                value={newFolderName}
                disabled={newFolderSubmitting}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder={newFolderMode === "managed" ? "Research" : "My project"}
              />
            </Field>
            {newFolderMode === "linked" && <Field>
              <FieldLabel htmlFor="folder-path">Absolute path</FieldLabel>
              <Input
                id="folder-path"
                autoFocus
                value={newFolderPath}
                disabled={newFolderSubmitting}
                onChange={(event) => setNewFolderPath(event.target.value)}
                placeholder="~/code/my-repo"
              />
            </Field>}
            {newFolderMode === "cloned" && <Field>
              <FieldLabel htmlFor="folder-clone">Git URL</FieldLabel>
              <Input
                id="folder-clone"
                autoFocus
                value={newFolderCloneUrl}
                disabled={newFolderSubmitting}
                onChange={(event) => setNewFolderCloneUrl(event.target.value)}
                placeholder="https://github.com/org/repo.git"
              />
            </Field>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={newFolderSubmitting} onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!canCreateFolder}>
              {newFolderSubmitting
                ? (newFolderMode === "cloned" ? "Cloning…" : "Creating…")
                : newFolderMode === "cloned" ? "Clone workspace" : newFolderMode === "linked" ? "Link workspace" : "Create folder"}
            </Button>
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
        <Command className="border">
          <CommandInput placeholder="Search folders…" />
          <CommandList>
            <CommandEmpty>No matching folders.</CommandEmpty>
            <CommandGroup heading="Folders">
          {projects.filter((item) => item.id !== pendingMove?.project.id).map((target) => <CommandItem
            key={target.id}
            value={`${target.name} ${target.slug}`}
            onSelect={() => {
              onMoveSession(pendingMove.session, pendingMove.project, target);
              setPendingMove(null);
            }}
          >{target.name}</CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  </>;
}
