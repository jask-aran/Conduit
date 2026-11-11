// Kept apart from the API client so a route can be tested without a fetch, a transport or a native bridge behind it.

/** jbot's home thread has a path of its own; its chat is known once the agent's view loads, and kept for a reload. */
export const JBOT_THREAD_PATH = "/jbot/thread";
/** The messages and dashboard are separate documents; /agent keeps its dashboard destination. */
export function pathJbotPage(pathname = location.pathname): "jbot" | "agent" | null {
  return pathname === "/jbot" ? "jbot" : pathname === "/jbot/page" || pathname === "/agent" ? "agent" : null;
}
const JBOT_HOME_KEY = "conduit.jbot.home";
let jbotHome: string | null = (() => { try { return localStorage.getItem(JBOT_HOME_KEY); } catch { return null; } })();
export function setJbotHome(id: string | null) {
  jbotHome = id;
  try { if (id) localStorage.setItem(JBOT_HOME_KEY, id); else localStorage.removeItem(JBOT_HOME_KEY); } catch { /* a reload looks it up again */ }
}
export const chatPath = (id: string) => id === jbotHome ? JBOT_THREAD_PATH : `/chat/${id}`;

export function pathChatId(pathname = location.pathname): string | null {
  if (pathname === JBOT_THREAD_PATH) return jbotHome;
  return pathname.match(/^\/chat\/([a-zA-Z0-9_-]{8,128})$/)?.[1] || null;
}

export function pathProjectId(pathname = location.pathname): string | null {
  return pathname.match(/^\/(?:project|workspace)\/([a-zA-Z0-9_-]{1,128})$/)?.[1] || null;
}

/** The slug, not the id: it is what the managed folder on disk is called, and it survives a rename. */
export function projectPath(project: { id: string; slug?: string; kind?: string; origin?: string }): string {
  const workspace = project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
  return `/${workspace ? "workspace" : "project"}/${encodeURIComponent(project.slug || project.id)}`;
}

/** Whether a path's project names this one. Links minted before slugs used ids. */
export function projectMatchesPath(project: { id: string; slug?: string }, routeId: string): boolean {
  return project.id === routeId || project.slug === routeId;
}
