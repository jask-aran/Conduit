// Shapes the workspace views share: the tree and file endpoints, Git state,
// and a chat's history tree.

export interface TreeEntry { name: string; path: string; type: "directory" | "file" | "other"; }
export interface DirectoryListing { entries: TreeEntry[]; truncated: boolean; cursor?: string | null; total?: number | null; oversize?: boolean; }
export interface FileWriteResult { path: string; size: number; modifiedAt: number; revision: string; }
export interface WorkspaceVersion { version: number; changedPaths: string[] | null; }
export interface MovedEntry { path: string; destination: string; type: TreeEntry["type"]; }
export interface GitActionResult { ok: true; output?: string; }
export interface GitCommit { graph: string; hash: string; shortHash: string; subject: string; author: string; authoredAt: string; }
export interface GitRef { name: string; hash: string; upstream: string | null; kind: "local" | "remote" | "tag"; }
export interface GitLineCounts { added: number; removed: number; }
export interface GitChangedFile { status: string; path: string; stagedCounts?: GitLineCounts | null; workingCounts?: GitLineCounts | null; headCounts?: GitLineCounts | null; }
export interface DiffPayload { repository: boolean; branch?: string; upstream?: string | null; ahead?: number; behind?: number; commits?: GitCommit[]; refs?: GitRef[]; files: GitChangedFile[]; diff: string; }
export interface GitCommitDetail { hash: string; content: string; }
export type PanelTab = "files" | "diff" | "chat" | "terminal";
export type ChatMode = "history" | "changes";
// `discarded`: the harness kept this step in its tree but builds every later
// request without it -- an answer it was interrupted writing. The row is shown
// struck through so the history reads as what the agent actually has.
export interface HistoryEntry { id: string; parentId: string | null; timestamp: string; type: string; display: string; kind: "user" | "assistant" | "tool" | "summary" | "system"; hidden: boolean; discarded?: boolean; forkable: boolean; regeneratable: boolean; }
export interface HistoryNode { entry: HistoryEntry; children: HistoryNode[]; label?: string; }
export interface HistoryTree { mode: "linear" | "tree"; tree: HistoryNode[]; leafId: string | null; }
export type SourceControlMode = "changes" | "review" | "graph" | "patch";
export type GitAction = "stage" | "stage-all" | "unstage" | "unstage-all" | "commit" | "fetch" | "pull" | "push";
export type FileSlotId = "primary" | "secondary";
export type OpenFiles = { primary: string | null; secondary: string | null };
export type UploadTarget = { kind: "directory"; path: string } | { kind: "replacement"; path: string };

/** How a view reads the panel's stored settings (workspace-panel-storage). */
export interface WorkspaceSettings {
  /** A panel-wide setting, migrating a per-chat value the first time it is read. */
  panel: (name: string) => string | null;
  /** A geometry setting, migrating a per-project value the first time it is read. */
  geometry: (name: string) => string | null;
  /** Where the open files are remembered: per project on the Computer page, per chat otherwise. */
  fileScope: () => string;
}
