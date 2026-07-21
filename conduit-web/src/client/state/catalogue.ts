import { createMemo, createSignal } from "solid-js";
import { api, asList } from "../api/client";
import type { ChatSummary, Project } from "../api/contracts";

export function createCatalogueStore() {
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [projectId, setProjectId] = createSignal("project_chat");

  const selected = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    for (const project of projects()) {
      const chat = project.sessions.find((item) => item.id === id);
      if (chat) return { chat, project };
    }
    return null;
  });

  const refresh = async () => {
    const payload = await api<{ projects?: Project[] }>("/v0/projects");
    const next = asList<Project>(payload.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) }));
    setProjects(next);
    return next;
  };

  const select = (chat: ChatSummary, project: Project) => {
    setSelectedId(chat.id);
    setProjectId(project.id);
  };

  const patchChat = (chatId: string, patch: Partial<ChatSummary>) => setProjects((current) => current.map((project) => ({
    ...project,
    sessions: project.sessions.map((chat) => chat.id === chatId ? { ...chat, ...patch } : chat),
  })));

  return { projects, setProjects, selectedId, setSelectedId, projectId, setProjectId, selected, refresh, select, patchChat };
}

export type CatalogueStore = ReturnType<typeof createCatalogueStore>;

