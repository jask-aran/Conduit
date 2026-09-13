import { WorkbenchButton } from "./workspace-workbench";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-solid";
import { For, Show } from "solid-js";
import { FileTypeIcon } from "./file-type-icon";

export interface WorkspaceReviewFile {
  path: string;
  status: string;
  counts?: { added: number; removed: number } | null;
}

export function WorkspaceReviewNavigator(props: { title: string; files: WorkspaceReviewFile[]; selectedPath: string | null; empty?: string; onSelect: (path: string) => void }) {
  const index = () => props.files.findIndex((file) => file.path === props.selectedPath);
  const move = (offset: number) => {
    if (!props.files.length) return;
    props.onSelect(props.files[(index() + offset + props.files.length) % props.files.length]!.path);
  };
  return <nav class="workspace-review-files" aria-label={props.title}>
      <header><strong>{props.title}</strong><small>{index() >= 0 ? `${index() + 1} / ${props.files.length}` : props.files.length}</small><WorkbenchButton type="button" aria-label="Previous file" disabled={props.files.length < 2} onClick={() => move(-1)}><ChevronUpIcon /></WorkbenchButton><WorkbenchButton type="button" aria-label="Next file" disabled={props.files.length < 2} onClick={() => move(1)}><ChevronDownIcon /></WorkbenchButton></header>
      <Show when={props.files.length} fallback={<div class="workspace-tree-empty">{props.empty ?? "No changed files."}</div>}><div class="workspace-changes"><For each={props.files}>{(file) => {
        const name = () => file.path.split("/").at(-1) ?? file.path;
        const directory = () => file.path.split("/").slice(0, -1).join("/");
        return <div class="workspace-change-row" data-selected={file.path === props.selectedPath}><WorkbenchButton type="button" aria-current={file.path === props.selectedPath ? "true" : undefined} title={`Review ${file.path}`} onClick={() => props.onSelect(file.path)}><FileTypeIcon name={name()} /><span class="workspace-change-name">{name()}</span><span class="workspace-change-directory">{directory()}</span><Show when={file.counts}>{(count) => <small class="workspace-change-counts"><span class="workspace-git-removed">−{count().removed}</span><span class="workspace-git-added">+{count().added}</span></small>}</Show><code data-status={file.status}>{file.status}</code></WorkbenchButton></div>;
      }}</For></div></Show>
    </nav>;
}
