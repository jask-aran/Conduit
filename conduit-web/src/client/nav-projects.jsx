import { ChevronRightIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { ChatContextMenu, ProjectContextMenu } from "./sidebar-context-menu";
import { ProjectActivityIndicator, RuntimeIndicator } from "./runtime-indicator";

export function NavProjects({
  allProjects,
  projects,
  selectedId,
  view,
  getProcess,
  runtimeStale = false,
  runtimeOnline = false,
  onAddProject,
  onCopyTranscript,
  onDeleteProject,
  onDeleteSession,
  onMoveProjectSessions,
  onMoveSession,
  onNewChat,
  onOpenSession,
  onRenameProject,
  onRenameSession,
}) {
  return <SidebarGroup>
    <SidebarGroupLabel>Projects</SidebarGroupLabel>
    <SidebarGroupAction className="text-sidebar-foreground" aria-label="New folder" title="New folder" onClick={onAddProject}>
      <FolderPlusIcon absoluteStrokeWidth />
    </SidebarGroupAction>
    <SidebarGroupContent>
      <SidebarMenu>
        {projects.map((project) => <Collapsible key={project.id} asChild defaultOpen className="group/project">
          <SidebarMenuItem>
            <ProjectContextMenu
              currentProject={project}
              projects={allProjects}
              onDelete={() => onDeleteProject(project)}
              onMoveChats={(target) => onMoveProjectSessions(project, target)}
              onNewChat={() => onNewChat(project)}
              onRename={() => onRenameProject(project)}
            >
              <CollapsibleTrigger asChild>
                <SidebarMenuButton className="text-sidebar-foreground" tooltip={project.name}>
                  <FolderIcon absoluteStrokeWidth />
                  <ProjectActivityIndicator sessions={project.sessions} getProcess={getProcess} stale={runtimeStale} runtimeOnline={runtimeOnline} />
                  <span className="truncate">{project.name}</span>
                  <ChevronRightIcon absoluteStrokeWidth className="ml-auto transition-transform group-data-[state=open]/project:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
            </ProjectContextMenu>
            <CollapsibleContent>
              <SidebarMenuSub>
                {project.sessions.map((session) => {
                  const process = getProcess?.(session.id)
                    || (!runtimeOnline && session.liveStatus ? {
                      chatId: session.id,
                      status: session.liveStatus,
                      activity: session.liveActivity || (session.liveActive ? "working" : "idle"),
                      active: session.liveActive,
                    } : null);
                  return <SidebarMenuSubItem key={session.id}>
                    <ChatContextMenu
                      currentProject={project}
                      projects={allProjects}
                      onCopyTranscript={() => onCopyTranscript(session)}
                      onDelete={() => onDeleteSession(session, project)}
                      onMove={(target) => onMoveSession(session, project, target)}
                      onRename={() => onRenameSession(session, project)}
                    >
                      <SidebarMenuSubButton
                        asChild
                        isActive={view === "chat" && selectedId === session.id}
                        aria-current={view === "chat" && selectedId === session.id ? "page" : undefined}
                      >
                        <button type="button" className="flex w-full items-center gap-2" onClick={() => onOpenSession(session, project)}>
                          <RuntimeIndicator process={process} stale={runtimeStale} />
                          <span className="truncate">{session.title}</span>
                        </button>
                      </SidebarMenuSubButton>
                    </ChatContextMenu>
                  </SidebarMenuSubItem>;
                })}
                {!project.sessions.length && <SidebarMenuSubItem>
                  <span className="block px-2 py-1 text-[13px] text-sidebar-foreground/50">No chats</span>
                </SidebarMenuSubItem>}
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>)}
        {!projects.length && <SidebarMenuItem>
          <span className="block px-2 py-1 text-[13px] text-sidebar-foreground/50">No projects</span>
        </SidebarMenuItem>}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>;
}
