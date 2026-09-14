import { WorkbenchButton } from "./workspace-workbench";
import { PanelLeftCloseIcon } from "lucide-solid";
import { For, Show } from "solid-js";
import { FileTypeIcon } from "./file-type-icon";

export interface WorkspaceReviewFile {
  path: string;
  status: string;
  counts?: { added: number; removed: number } | null;
}

export function WorkspaceReviewNavigator(props: { title: string; files: WorkspaceReviewFile[]; selectedPath: string | null; empty?: string; onSelect: (path: string) => void; onCollapse?: () => void }) {
  return <nav class="workspace-review-files" aria-label={props.title}>
      <header><Show when={props.onCollapse}><WorkbenchButton type="button" aria-label="Hide changed files" title="Hide changed files" onClick={props.onCollapse}><PanelLeftCloseIcon /></WorkbenchButton></Show><strong>{props.title}</strong></header>
      <Show when={props.files.length} fallback={<div class="workspace-tree-empty">{props.empty ?? "No changed files."}</div>}><div class="workspace-changes"><For each={props.files}>{(file) => {
        const name = () => file.path.split("/").at(-1) ?? file.path;
        const directory = () => file.path.split("/").slice(0, -1).join("/");
        return <div class="workspace-change-row" data-selected={file.path === props.selectedPath}><WorkbenchButton type="button" aria-current={file.path === props.selectedPath ? "true" : undefined} title={`Review ${file.path}`} onClick={() => props.onSelect(file.path)}><FileTypeIcon name={name()} /><span class="workspace-change-name">{name()}</span><span class="workspace-change-directory">{directory()}</span><Show when={file.counts}>{(count) => <small class="workspace-change-counts"><span class="workspace-git-removed">−{count().removed}</span><span class="workspace-git-added">+{count().added}</span></small>}</Show><code data-status={file.status}>{file.status}</code></WorkbenchButton></div>;
      }}</For></div></Show>
    </nav>;
}
