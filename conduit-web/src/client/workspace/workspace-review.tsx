import { ChangeNav } from "@/components/ui";
import { FileTypeIcon } from "@/components/ui/file-marks";
import { Icons, Empty, IconButton } from "@/components/ui";
import { ChangeRow } from "@/components/ui/dashboard";
import { ChangeList } from "@/components/ui/source";
import { ToolBar } from "@/components/ui/pane";

import { For, Show } from "solid-js";


export interface WorkspaceReviewFile {
  path: string;
  status: string;
  counts?: { added: number; removed: number } | null;
}

export function WorkspaceReviewNavigator(props: { title: string; files: WorkspaceReviewFile[]; selectedPath: string | null; empty?: string; onSelect: (path: string) => void; onCollapse?: () => void }) {
  return <ChangeNav aria-label={props.title}>
      <ToolBar><Show when={props.onCollapse}><IconButton aria-label="Hide changed files" title="Hide changed files" onClick={props.onCollapse}><Icons.CollapseFiles /></IconButton></Show><strong>{props.title}</strong></ToolBar>
      <Show when={props.files.length} fallback={<Empty kind="change">{props.empty ?? "No changed files."}</Empty>}><ChangeList><For each={props.files}>{(file) => {
        const name = () => file.path.split("/").at(-1) ?? file.path;
        const directory = () => file.path.split("/").slice(0, -1).join("/");
        return <ChangeRow selected={file.path === props.selectedPath} aria-current={file.path === props.selectedPath ? "true" : undefined} title={`Review ${file.path}`} onClick={() => props.onSelect(file.path)} icon={<FileTypeIcon name={name()} />} name={name()} directory={directory()} added={file.counts?.added} removed={file.counts?.removed} status={file.status} />;
      }}</For></ChangeList></Show>
    </ChangeNav>;
}
