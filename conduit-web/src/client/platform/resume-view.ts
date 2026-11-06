/**
 * Where the person was, kept across the app rebuilding itself: an interface update (the page reloads into the new
 * build) or a server switch (the app is rebuilt around the other server). Without it either lands on the dashboard
 * with the sidebar shut, which on a phone says neither where they were nor which server they are on.
 *
 * One record, taken once, and only within a minute: a later cold start begins as usual.
 */
const KEY = "conduit.resume-view";
const FRESH_MS = 60_000;

export interface ResumeView { path: string; sidebar: boolean }

let sidebarOpen: () => boolean = () => false;
/** The app says how to read whether its sidebar is open (the phone's drawer). */
export function trackSidebar(read: () => boolean) { sidebarOpen = read; }

export function rememberView(view: Partial<ResumeView> = {}) {
  const record = { path: view.path ?? `${location.pathname}${location.search}`, sidebar: view.sidebar ?? sidebarOpen(), at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { /* no storage: start as usual */ }
}

/** The remembered view, once, when it is fresh; its path is put in the address bar before the app reads it. */
export function takeView(): ResumeView | null {
  let record: (ResumeView & { at: number }) | null = null;
  try {
    record = JSON.parse(localStorage.getItem(KEY) || "null");
    localStorage.removeItem(KEY);
  } catch { return null; }
  if (!record || typeof record.at !== "number" || Date.now() - record.at > FRESH_MS) return null;
  const path = typeof record.path === "string" && record.path.startsWith("/") ? record.path : "/";
  if (path !== `${location.pathname}${location.search}`) history.replaceState({}, "", path);
  return { path, sidebar: record.sidebar === true };
}
