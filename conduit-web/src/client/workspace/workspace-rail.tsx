import { For } from "solid-js";
import { FolderIcon, GitCompareArrowsIcon, MessageSquareIcon, TerminalIcon } from "lucide-solid";
import { isSplitView, type PanelTab, type SplitView } from "./workspace-types";

export const WORKSPACE_TOOL_LABELS: Record<PanelTab, string> = { files: "Files", diff: "Source Control", chat: "Chat review", terminal: "Terminal" };

/** A view dragged by its header, between the dock and the main pane's split. */
export const TOOL_DRAG_TYPE = "application/x-conduit-tool";
export function readToolDrag(event: DragEvent): { tool: SplitView; from: "dock" | "split" } | null {
  try {
    const value = JSON.parse(event.dataTransfer?.getData(TOOL_DRAG_TYPE) || "null");
    return value && isSplitView(value.tool) && (value.from === "dock" || value.from === "split") ? value : null;
  } catch {
    return null;
  }
}

const RAIL_TOOLS = ["files", "diff", "chat", "terminal"] satisfies PanelTab[];
const RAIL_ICONS = { files: FolderIcon, diff: GitCompareArrowsIcon, chat: MessageSquareIcon, terminal: TerminalIcon };

/**
 * The right edge's rail, on the frame as the sidebar's collapsed rail is: one
 * icon per workspace tool, opening the dock on it. The tool the open dock
 * shows is current; pressing it again closes the dock. A tool moved into the
 * main pane's split is marked open and its icon goes to it. Desktop only -- a
 * phone keeps the dock's own tabs. Not a region of its own: its icons are
 * reached from the dock, so it stays out of the tab order as the header's
 * icons do. A view dragged from the split onto it docks.
 */
export function WorkspaceRail(props: {
  current: PanelTab | null;
  inSplit: PanelTab | null;
  sourceControlEnabled: boolean;
  onChoose: (tool: PanelTab) => void;
  onDock: (view: SplitView) => void;
}) {
  return <nav class="workspace-rail" aria-label="Workspace tools"
    onDragOver={(event) => { if (document.body.dataset.toolDrag === "split" && event.dataTransfer?.types.includes(TOOL_DRAG_TYPE)) event.preventDefault(); }}
    onDrop={(event) => { const drag = readToolDrag(event); if (drag?.from === "split") { event.preventDefault(); props.onDock(drag.tool); } }}>
    <For each={RAIL_TOOLS}>{(tool) => {
      const Icon = RAIL_ICONS[tool];
      const disabled = () => tool === "diff" && !props.sourceControlEnabled;
      const label = () => disabled() ? "Source Control is available only for Git workspaces" : WORKSPACE_TOOL_LABELS[tool];
      return <button type="button" class="workspace-rail-action" tabIndex={-1} data-tool={tool} disabled={disabled()}
        aria-label={WORKSPACE_TOOL_LABELS[tool]} title={label()} aria-current={props.current === tool ? "true" : undefined}
        data-open={props.inSplit === tool ? "true" : undefined}
        onClick={() => props.onChoose(tool)}><Icon /></button>;
    }}</For>
  </nav>;
}
