import { ChevronDownIcon, ChevronUpIcon } from "lucide-solid";
import { For, lazy, Show, Suspense } from "solid-js";
import { FileTypeIcon } from "./file-type-icon";
import type { ComparisonPayload, ComparisonViewState } from "./workspace-comparison";

const WorkspaceComparison = lazy(() => import("./workspace-comparison"));

export interface WorkspaceReviewFile {
  path: string;
  status: string;
  counts?: { added: number; removed: number } | null;
}

export default function WorkspaceReview(props: { title: string; files: WorkspaceReviewFile[]; selectedPath: string | null; comparison: ComparisonPayload | null; viewState: ComparisonViewState; busy: boolean; full?: boolean; empty: string; onSelect: (path: string) => void; onOpenFile: (comparison: ComparisonPayload, state: ComparisonViewState) => void }) {
  const index = () => props.files.findIndex((file) => file.path === props.selectedPath);
  const move = (offset: number) => {
    if (!props.files.length) return;
    props.onSelect(props.files[(index() + offset + props.files.length) % props.files.length]!.path);
  };
  return <div class="workspace-patch workspace-review" data-full={props.full}>
    <nav class="workspace-review-files" aria-label={props.title}>
      <header><strong>{props.title}</strong><small>{index() >= 0 ? `${index() + 1} / ${props.files.length}` : props.files.length}</small><button type="button" aria-label="Previous file" disabled={props.files.length < 2} onClick={() => move(-1)}><ChevronUpIcon /></button><button type="button" aria-label="Next file" disabled={props.files.length < 2} onClick={() => move(1)}><ChevronDownIcon /></button></header>
      <div class="workspace-changes"><For each={props.files}>{(file) => {
        const name = () => file.path.split("/").at(-1) ?? file.path;
        const directory = () => file.path.split("/").slice(0, -1).join("/");
        return <div class="workspace-change-row" data-selected={file.path === props.selectedPath}><button type="button" aria-current={file.path === props.selectedPath ? "true" : undefined} title={`Review ${file.path}`} onClick={() => props.onSelect(file.path)}><FileTypeIcon name={name()} /><span class="workspace-change-name">{name()}</span><span class="workspace-change-directory">{directory()}</span><Show when={file.counts}>{(count) => <small class="workspace-change-counts"><span class="workspace-git-removed">−{count().removed}</span><span class="workspace-git-added">+{count().added}</span></small>}</Show><code data-status={file.status}>{file.status}</code></button></div>;
      }}</For></div>
    </nav>
    <div class="workspace-review-comparison"><Show when={props.selectedPath} fallback={<div class="workspace-panel-empty">{props.empty}</div>}><Show when={!props.busy} fallback={<div class="workspace-panel-empty">Loading changes…</div>}><Show when={props.comparison}>{(comparison) => <Suspense fallback={<div class="workspace-panel-empty">Loading comparison…</div>}><WorkspaceComparison comparison={comparison()} viewState={props.viewState} onOpenFile={(_source, _position, state) => props.onOpenFile(comparison(), state)} /></Suspense>}</Show></Show></Show></div>
  </div>;
}
