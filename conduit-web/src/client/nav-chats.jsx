import { PlusIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ChatContextMenu } from "./sidebar-context-menu";

export function NavChats({
  project,
  projects,
  selectedId,
  view,
  onCopyTranscript,
  onDeleteSession,
  onDuplicateSession,
  onMoveSession,
  onNewChat,
  onOpenSession,
  onRenameSession,
}) {
  if (!project) return null;

  return <SidebarGroup className="group-data-[collapsible=icon]:hidden">
    <SidebarGroupLabel>Chats</SidebarGroupLabel>
    <SidebarGroupAction className="text-sidebar-foreground" aria-label="New chat" title="New chat" onClick={() => onNewChat(project)}>
      <PlusIcon absoluteStrokeWidth />
    </SidebarGroupAction>
    <SidebarGroupContent>
      <SidebarMenu>
        {project.sessions.map((session) => <SidebarMenuItem key={session.id}>
          <ChatContextMenu
            currentProject={project}
            projects={projects}
            onCopyTranscript={() => onCopyTranscript(session)}
            onDelete={() => onDeleteSession(session, project)}
            onDuplicate={() => onDuplicateSession(session, project)}
            onMove={(target) => onMoveSession(session, project, target)}
            onRename={() => onRenameSession(session, project)}
          >
            <SidebarMenuButton
              className="text-sidebar-foreground"
              isActive={view === "chat" && selectedId === session.id}
              aria-current={view === "chat" && selectedId === session.id ? "page" : undefined}
              tooltip={session.title}
              onClick={() => onOpenSession(session, project)}
            >
              <span>{session.title}</span>
            </SidebarMenuButton>
          </ChatContextMenu>
        </SidebarMenuItem>)}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>;
}
