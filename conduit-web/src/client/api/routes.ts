/**
 * The paths the app puts in the address bar, and how it reads them back.
 *
 * Kept apart from the API client so a route can be reasoned about -- and
 * tested -- without a fetch, a transport or a native bridge behind it.
 */

/** jbot's home thread has a path of its own; its chat is known once the agent's view loads, and kept for a reload. */
export const JBOT_THREAD_PATH = "/jbot/thread";
const JBOT_HOME_KEY = "conduit.jbot.home";
let jbotHome: string | null = (() => { try { return localStorage.getItem(JBOT_HOME_KEY); } catch { return null; } })();
export function setJbotHome(id: string | null) {
  jbotHome = id;
  try { if (id) localStorage.setItem(JBOT_HOME_KEY, id); else localStorage.removeItem(JBOT_HOME_KEY); } catch { /* a reload looks it up again */ }
}
/** A chat's address: jbot's home thread's is /jbot/thread, every other chat's its id. */
export const chatPath = (id: string) => id === jbotHome ? JBOT_THREAD_PATH : `/chat/${id}`;

export function pathChatId(pathname = location.pathname): string | null {
  if (pathname === JBOT_THREAD_PATH) return jbotHome;
  return pathname.match(/^\/chat\/([a-zA-Z0-9_-]{8,128})$/)?.[1] || null;
}

/** The project a `/project/…` or `/workspace/…` path names: a slug, or an id. */
export function pathProjectId(pathname = location.pathname): string | null {
  return pathname.match(/^\/(?:project|workspace)\/([a-zA-Z0-9_-]{1,128})$/)?.[1] || null;
}

/**
 * A project's own address. It is the slug, not the id: the slug is the
 * project's name, it is what the managed folder on disk is called, and it
 * survives a rename -- so the link reads as the project and stays valid.
 */
export function projectPath(project: { id: string; slug?: string; kind?: string; origin?: string }): string {
  const workspace = project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
  return `/${workspace ? "workspace" : "project"}/${encodeURIComponent(project.slug || project.id)}`;
}

/** Whether a path's project names this one. Links minted before slugs used ids. */
export function projectMatchesPath(project: { id: string; slug?: string }, routeId: string): boolean {
  return project.id === routeId || project.slug === routeId;
}
