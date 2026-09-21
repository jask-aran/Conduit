import { createMemo, createSignal } from "solid-js";
import { api, asList } from "../api/client";
import type { ChatSummary, Project } from "../api/contracts";

export function createCatalogueStore() {
  const [projects, setProjectList] = createSignal<Project[]>([]);
  const [loaded, setLoaded] = createSignal(false);

  /**
   * Whether the catalogue has been answered for.
   *
   * An empty list before the answer arrives and an empty list after it are the
   * same value and mean opposite things, and without somewhere to say which,
   * the sidebar spends the whole request stating that the server has nothing
   * on it. Over a link where that request takes a third of a second or more,
   * that reads as a server it failed to reach rather than one it has not
   * finished asking.
   */
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
    const payload = await api<{ projects?: Project[] }>("/v0/projects");
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

  // A patch touches one chat, so every other project keeps its identity. The
  // spread used to run unconditionally, which handed a fresh object to every
  // project on every patch -- re-reconciling each sidebar and dashboard list
  // for a title or timestamp that belonged to one chat in one of them.
  // Not `setProjects`: a patch changes one chat in a catalogue that must
  // already be here, so it is not the event that says one arrived.
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

export type CatalogueStore = ReturnType<typeof createCatalogueStore>;
