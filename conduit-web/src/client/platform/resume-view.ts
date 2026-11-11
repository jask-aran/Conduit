/**
 * Where the person was, kept across an interface update or server switch. Fresh only for a minute, so a later cold
 * start begins as usual.
 */
const KEY = "conduit.resume-view";
const FRESH_MS = 60_000;

export interface ResumeView { path: string; sidebar: boolean }

let sidebarOpen: () => boolean = () => false;
export function trackSidebar(read: () => boolean) { sidebarOpen = read; }

export function rememberView(view: Partial<ResumeView> = {}) {
  const record = { path: view.path ?? `${location.pathname}${location.search}`, sidebar: view.sidebar ?? sidebarOpen(), at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { /* no storage: start as usual */ }
}

/** Its path is put in the address bar before the app reads it. */
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
