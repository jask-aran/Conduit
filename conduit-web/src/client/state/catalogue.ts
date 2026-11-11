import { createMemo, createSignal } from "solid-js";
import { api, asList } from "../api/client";
import type { ChatSummary, Project, ProjectsPayload } from "../api/contracts";

export function createCatalogueStore() {
  const [projects, setProjectList] = createSignal<Project[]>([]);
  const [loaded, setLoaded] = createSignal(false);

  // An empty list before the answer and an empty list after it mean opposite things, so `loaded` says which.
  const setProjects = (value: Project[] | ((current: Project[]) => Project[])) => {
    setLoaded(true);
    if (typeof value === "function") setProjectList(value);
    else setProjectList(value);
  };
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
    const payload = await api<ProjectsPayload>("/v0/projects");
    const next = asList<Project>(payload.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) }));
    setProjects(next);
    return next;
  };

  const select = (chat: ChatSummary, project: Project) => {
    setSelectedId(chat.id);
    setProjectId(project.id);
  };

  const selectProject = (project: Project) => {
    setSelectedId(null);
    setProjectId(project.id);
  };

  // Every untouched project keeps its identity, or each sidebar and dashboard list reconciles again. Not
  // `setProjects`: a patch is not the event that says the catalogue arrived.
  const patchChat = (chatId: string, patch: Partial<ChatSummary>) => setProjectList((current) => {
    let touched = false;
    const next = current.map((project) => {
      let changed = false;
      const sessions = project.sessions.map((chat) => {
        if (chat.id !== chatId) return chat;
        if (!Object.entries(patch).some(([key, value]) => Reflect.get(chat, key) !== value)) return chat;
        changed = true;
        return { ...chat, ...patch };
      });
      if (!changed) return project;
      touched = true;
      return { ...project, sessions };
    });
    return touched ? next : current;
  });

  return { projects, loaded, setProjects, selectedId, setSelectedId, projectId, setProjectId, selected, refresh, select, selectProject, patchChat };
}

