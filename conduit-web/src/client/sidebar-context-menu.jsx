import {
  ClipboardCopyIcon,
  FolderInputIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import {
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
} from "@/components/ui/context-menu";

function MoveTargets({ currentProject, projects, onMove }) {
  return <ContextMenuGroup>
    <ContextMenuRadioGroup
      value={currentProject.id}
      onValueChange={(projectId) => onMove(projects.find((project) => project.id === projectId))}
    >
      {projects.map((project) => <ContextMenuRadioItem key={project.id} value={project.id}>
        {project.name}
      </ContextMenuRadioItem>)}
    </ContextMenuRadioGroup>
  </ContextMenuGroup>;
}

export function ChatContextMenu({
  children,
  currentProject,
  projects,
  onCopyTranscript,
  onDelete,
  onMove,
  onRename,
}) {
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent className="w-60 sidebar-context-menu">
      <ContextMenuGroup>
        <ContextMenuItem onSelect={onRename}>
          <PencilIcon absoluteStrokeWidth />
          Rename
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInputIcon absoluteStrokeWidth />
            Move to folder…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48 sidebar-context-menu">
            <MoveTargets currentProject={currentProject} projects={projects} onMove={onMove} />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={onCopyTranscript}>
          <ClipboardCopyIcon absoluteStrokeWidth />
          Copy transcript
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon absoluteStrokeWidth />
          Delete chat
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>;
}

export function ProjectContextMenu({
  children,
  currentProject,
  projects,
  projectNoun = "folder",
  onDelete,
  onMoveChats,
  onNewChat,
  onRename,
}) {
  const isWorkspace = currentProject.origin === "linked" || currentProject.origin === "cloned";
  const deleteLabel = currentProject.deletesFilesOnRemove === false
    ? "Unlink workspace"
    : isWorkspace
      ? "Delete workspace"
      : `Delete ${projectNoun}`;
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent className="w-60 sidebar-context-menu">
      <ContextMenuGroup>
        <ContextMenuItem onSelect={onNewChat}>
          <MessageSquarePlusIcon absoluteStrokeWidth />
          New chat
        </ContextMenuItem>
        <ContextMenuItem onSelect={onRename}>
          <PencilIcon absoluteStrokeWidth />
          Rename {projectNoun}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!currentProject.sessions.length}>
            <FolderInputIcon absoluteStrokeWidth />
            Move chats to…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48 sidebar-context-menu">
            <MoveTargets currentProject={currentProject} projects={projects} onMove={onMoveChats} />
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon absoluteStrokeWidth />
          {deleteLabel}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>;
}
