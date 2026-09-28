import type { SplitView } from "./workspace-types";

/**
 * One file a file viewer shows: a path in a place (docs/design/panes-and-rail.md,
 * 6d-2), and what of it -- its contents, or its unstaged or staged changes (6d-3).
 */
export interface FileEntry { projectId: string; path: string; mode?: "changes" | "staged"; }

export const sameFileEntry = (a: FileEntry, b: FileEntry) => a.projectId === b.projectId && a.path === b.path;

/** A file viewer pane's view: one or two entries, side by side. */
export const formatFileView = (entries: FileEntry[]): SplitView =>
  `files:${entries.map((entry) => `${encodeURIComponent(entry.projectId)}:${encodeURIComponent(entry.path)}${entry.mode ? `@${entry.mode}` : ""}`).join("|")}`;

export function parseFileView(view: string | null | undefined): FileEntry[] | null {
  if (!view?.startsWith("files:")) return null;
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
  return entries.length && entries.length <= 2 && entries.every((entry) => entry.path) ? entries : null;
}
