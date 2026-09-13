import { Button } from "@/components/primitives";
import type { ComponentProps, JSX } from "solid-js";

export function WorkbenchButton(props: ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="sm" {...props} />;
}

export function WorkbenchStatus(props: { commands: JSX.Element; children: JSX.Element }) {
  return <footer class="workspace-editor-status" aria-label="Editor status">
    <div class="workspace-editor-command-group">{props.commands}</div>
    <div class="workspace-editor-detail-group">{props.children}</div>
  </footer>;
}
