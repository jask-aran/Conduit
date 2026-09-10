import { Button } from "@/components/primitives";
import { Show, type ComponentProps, type JSX } from "solid-js";

export function WorkbenchButton(props: ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="sm" {...props} />;
}

export function WorkbenchStatus(props: { commands: JSX.Element; children: JSX.Element }) {
  return <footer class="workspace-editor-status" aria-label="Editor status">
    <div class="workspace-editor-command-group">{props.commands}</div>
    <div class="workspace-editor-detail-group">{props.children}</div>
  </footer>;
}

export function FileRepresentationControl(props: { diff: boolean; onFile?: () => void; onDiff?: () => void }) {
  return <Show when={props.onFile || props.onDiff}>
    <WorkbenchButton aria-pressed={!props.diff} title="Show file" onClick={() => props.onFile?.()}>File</WorkbenchButton>
    <WorkbenchButton aria-pressed={props.diff} title="Show changes" onClick={() => props.onDiff?.()}>Diff</WorkbenchButton>
  </Show>;
}
