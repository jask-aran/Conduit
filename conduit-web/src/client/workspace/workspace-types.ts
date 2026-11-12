import type { UI_VIEWS } from "../../ui-api.js";

export interface TreeEntry { name: string; path: string; type: "directory" | "file" | "other"; }
export interface DirectoryListing { entries: TreeEntry[]; truncated: boolean; cursor?: string | null; total?: number | null; oversize?: boolean; }
export interface FileWriteResult { path: string; size: number; modifiedAt: number; revision: string; }
export interface WorkspaceVersion { version: number; changedPaths: string[] | null; told?: boolean; }
export interface MovedEntry { path: string; destination: string; type: TreeEntry["type"]; }
export interface GitActionResult { ok: true; output?: string; }
export interface GitCommit { graph: string; hash: string; shortHash: string; subject: string; author: string; authoredAt: string; }
export interface GitRef { name: string; hash: string; upstream: string | null; kind: "local" | "remote" | "tag"; }
export interface GitLineCounts { added: number; removed: number; }
export interface GitChangedFile { status: string; path: string; stagedCounts?: GitLineCounts | null; workingCounts?: GitLineCounts | null; headCounts?: GitLineCounts | null; }
export interface DiffPayload { repository: boolean; branch?: string; upstream?: string | null; ahead?: number; behind?: number; commits?: GitCommit[]; refs?: GitRef[]; files: GitChangedFile[]; diff: string; }
export interface GitCommitDetail { hash: string; content: string; }
/** The dock's tools; jbot's works on no project (the jbot chat with its panel). */
export type PanelTab = "files" | "diff" | "chat" | "terminal" | "jbot";
export type SplitView = PanelTab | "file" | "home" | `shell:${string}` | `chat:${string}` | `page:${string}` | `files:${string}` | `term:${string}` | `browser:${string}` | `artifact:${string}`;
/** SplitView's kinds are the UI API's declared views', each way: a kind on one side only fails here. */
type SplitViewKind = SplitView extends infer V ? V extends `${infer K}:${string}` ? K : V : never;
type DeclaredViewKind = (typeof UI_VIEWS)[number]["kind"];
const viewKindsAgree: [SplitViewKind] extends [DeclaredViewKind] ? [DeclaredViewKind] extends [SplitViewKind] ? true : never : never = true;
void viewKindsAgree;
export const isPanelTab = (value: unknown): value is PanelTab => value === "files" || value === "diff" || value === "chat" || value === "terminal" || value === "jbot";
export const isSplitView = (value: unknown): value is SplitView => isPanelTab(value) || value === "file" || value === "home" || (typeof value === "string" && /^(shell|chat|page|files|term|browser|artifact):./.test(value));
export type ChatMode = "history" | "changes";
// `discarded`: the harness kept this step in its tree but builds every later request without it
// (an answer it was interrupted writing).
export interface HistoryEntry { id: string; parentId: string | null; timestamp: string; type: string; display: string; kind: "user" | "assistant" | "tool" | "summary" | "system"; hidden: boolean; discarded?: boolean; forkable: boolean; regeneratable: boolean; }
export interface HistoryNode { entry: HistoryEntry; children: HistoryNode[]; label?: string; }
export interface HistoryTree { mode: "linear" | "tree"; tree: HistoryNode[]; leafId: string | null; }
export type SourceControlMode = "changes" | "review" | "graph" | "patch";
export type GitAction = "stage" | "stage-all" | "unstage" | "unstage-all" | "commit" | "fetch" | "pull" | "push";
export type FileSlotId = "primary" | "secondary";
export type OpenFiles = { primary: string | null; secondary: string | null };
export type UploadTarget = { kind: "directory"; path: string } | { kind: "replacement"; path: string };

export interface WorkspaceSettings {
  panel: (name: string) => string | null;
  geometry: (name: string) => string | null;
  /** Where the open files are remembered: per project on the Computer page, per chat otherwise. */
  fileScope: () => string;
}
