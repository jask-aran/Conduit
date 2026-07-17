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
import { RuntimeIndicator } from "./runtime-indicator";

export function NavChats({
  project,
  projects,
  selectedId,
  view,
  getProcess,
  runtimeStale = false,
  onCopyTranscript,
  onDeleteSession,
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
        {project.sessions.map((session) => {
          const process = getProcess?.(session.id) || (session.liveStatus ? {
            chatId: session.id,
            status: session.liveStatus,
            activity: session.liveActivity || (session.liveActive ? "working" : "idle"),
            active: session.liveActive,
          } : null);
          return <SidebarMenuItem key={session.id}>
            <ChatContextMenu
              currentProject={project}
              projects={projects}
              onCopyTranscript={() => onCopyTranscript(session)}
              onDelete={() => onDeleteSession(session, project)}
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
                <RuntimeIndicator process={process} stale={runtimeStale} />
                <span className="truncate">{session.title}</span>
              </SidebarMenuButton>
            </ChatContextMenu>
          </SidebarMenuItem>;
        })}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>;
}
