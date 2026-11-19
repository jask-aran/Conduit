import type { SplitView } from "./workspace-types";

export interface FileEntry { projectId: string; path: string; mode?: "changes" | "staged"; }

export const sameFileEntry = (a: FileEntry, b: FileEntry) => a.projectId === b.projectId && a.path === b.path;

export const EMPTY_FILE_VIEW: SplitView = "files:~";
export const fileEntryKey = (entry: FileEntry) => `${entry.projectId}:${entry.path}`;

export const formatFileView = (entries: FileEntry[]): SplitView => entries.length === 0 ? EMPTY_FILE_VIEW :
  `files:${entries.map((entry) => `${encodeURIComponent(entry.projectId)}:${encodeURIComponent(entry.path)}${entry.mode ? `@${entry.mode}` : ""}`).join("|")}`;

export function parseFileView(view: string | null | undefined): FileEntry[] | null {
  if (!view?.startsWith("files:")) return null;
  if (view === EMPTY_FILE_VIEW) return [];
  const entries: FileEntry[] = [];
  for (const part of view.slice("files:".length).split("|")) {
    const at = part.indexOf(":");
    if (at < 1) return null;
    // Encoded, a path has no "@": what follows one is the entry's mode.
    const [encodedPath, mode] = part.slice(at + 1).split("@");
    try {
      entries.push({ projectId: decodeURIComponent(part.slice(0, at)), path: decodeURIComponent(encodedPath!), ...(mode === "changes" || mode === "staged" ? { mode } : {}) });
    } catch {
      return null;
    }
  }
  // A view of two sides, from a layout stored before a file document held one file, shows its first.
  return entries[0]?.path ? entries.slice(0, 1) : null;
}
