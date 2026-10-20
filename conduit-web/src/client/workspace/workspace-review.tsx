import { ChangeRow } from "@/components/ui/dashboard";
import { ChangeList, ChangeEmpty } from "@/components/ui/source";
import { ToolBar, ToolButton } from "@/components/ui/pane";
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
      <ToolBar><Show when={props.onCollapse}><ToolButton aria-label="Hide changed files" title="Hide changed files" onClick={props.onCollapse}><PanelLeftCloseIcon /></ToolButton></Show><strong>{props.title}</strong></ToolBar>
      <Show when={props.files.length} fallback={<ChangeEmpty>{props.empty ?? "No changed files."}</ChangeEmpty>}><ChangeList><For each={props.files}>{(file) => {
        const name = () => file.path.split("/").at(-1) ?? file.path;
        const directory = () => file.path.split("/").slice(0, -1).join("/");
        return <ChangeRow selected={file.path === props.selectedPath} aria-current={file.path === props.selectedPath ? "true" : undefined} title={`Review ${file.path}`} onClick={() => props.onSelect(file.path)} icon={<FileTypeIcon name={name()} />} name={name()} directory={directory()} added={file.counts?.added} removed={file.counts?.removed} status={file.status} />;
      }}</For></ChangeList></Show>
    </nav>;
}
