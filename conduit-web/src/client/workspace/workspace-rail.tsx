import { For } from "solid-js";
import { FolderIcon, GitCompareArrowsIcon, MessageSquareIcon, TerminalIcon } from "lucide-solid";
import type { PanelTab } from "./workspace-types";

export const WORKSPACE_TOOL_LABELS: Record<PanelTab, string> = { files: "Files", diff: "Source Control", chat: "Chat review", terminal: "Terminal" };

const RAIL_TOOLS = ["files", "diff", "chat", "terminal"] satisfies PanelTab[];
const RAIL_ICONS = { files: FolderIcon, diff: GitCompareArrowsIcon, chat: MessageSquareIcon, terminal: TerminalIcon };

/**
 * The right edge's rail, on the frame as the sidebar's collapsed rail is: one
 * icon per workspace tool, opening the dock on it. The tool the open dock
 * shows is current; pressing it again closes the dock. Desktop only -- a phone
 * keeps the dock's own tabs. Not a region of its own: its icons are reached
 * from the dock, so it stays out of the tab order as the header's icons do.
 */
export function WorkspaceRail(props: {
  current: PanelTab | null;
  sourceControlEnabled: boolean;
  onChoose: (tool: PanelTab) => void;
}) {
  return <nav class="workspace-rail" aria-label="Workspace tools">
    <For each={RAIL_TOOLS}>{(tool) => {
      const Icon = RAIL_ICONS[tool];
      const disabled = () => tool === "diff" && !props.sourceControlEnabled;
      const label = () => disabled() ? "Source Control is available only for Git workspaces" : WORKSPACE_TOOL_LABELS[tool];
      return <button type="button" class="workspace-rail-action" tabIndex={-1} data-tool={tool} disabled={disabled()}
        aria-label={WORKSPACE_TOOL_LABELS[tool]} title={label()} aria-current={props.current === tool ? "true" : undefined}
        onClick={() => props.onChoose(tool)}><Icon /></button>;
    }}</For>
  </nav>;
}
