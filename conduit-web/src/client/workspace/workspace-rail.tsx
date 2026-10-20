import { For, Show } from "solid-js";
import { PanelRightIcon, Columns3Icon, CommandIcon, FileTextIcon, FolderIcon, LayoutDashboardIcon, MessageSquareTextIcon, SquareTerminalIcon, GitCompareArrowsIcon, LayoutTemplateIcon, MessageSquareIcon, SearchIcon, TerminalIcon } from "lucide-solid";
import { Menu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/menus";
import { RailButton } from "@/components/ui/nav";
import { LayoutGlyph, RailRule, ToolRail } from "@/components/ui/pane";
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

// Share presets for the panes, by how many are open; the first is even.
const PANE_LAYOUTS: Record<number, number[][]> = {
  2: [[1, 1], [1, 2], [2, 1], [1, 3], [3, 1]],
  3: [[1, 1, 1], [2, 1, 1], [1, 2, 1], [1, 1, 2]],
};
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
 *
 * Below the tools, set apart by a hairline, are chat search and the command
 * palette: actions rather than dock views, here so no pane's header carries
 * the app's own controls. They stay when a page has no tools to show.
 *
 * At the foot, while panes are open beside pane A: Equalise, sharing the
 * panes' room evenly, and Layouts, a menu of share presets for that many.
 * Panes in the dock -- docked by hand, or there because the window has no
 * room for them -- each have an icon under the tools.
 */
export function WorkspaceRail(props: {
  /** Whether the page has a place whose tools the dock can show. */
  tools: boolean;
  onOpenSearch: () => void;
  onOpenPalette: () => void;
  current: PanelTab | null;
  inSplit: PanelTab | null;
  sourceControlEnabled: boolean;
  onChoose: (tool: PanelTab) => void;
  onDock: (view: SplitView) => void;
  /** How many panes are open, pane A included. */
  panes: number;
  onLayout: (weights: number[]) => void;
  /** Panes moved into the dock, each its own icon; Alt or a drag takes one back to a pane. */
  docked: { slot: number; view: string; name: string }[];
  currentDocked: number | null;
  onChooseDocked: (slot: number, alt: boolean) => void;
  /** The dock drawn over the panes rather than beside them. */
  dockOverlay: boolean;
  onToggleDockOverlay: () => void;
}) {
  const foot = () => <>
    <Show when={props.tools}><RailButton tabIndex={-1} aria-pressed={props.dockOverlay} data-open={props.dockOverlay ? "" : undefined}
      aria-label={props.dockOverlay ? "Dock beside the panes" : "Dock over the panes"} title={props.dockOverlay ? "Dock: over the panes" : "Dock: beside the panes"} onClick={() => props.onToggleDockOverlay()}><PanelRightIcon /></RailButton></Show>
    <Show when={PANE_LAYOUTS[props.panes]}>{(layouts) => <>
      <RailButton tabIndex={-1} aria-label="Equalise panes" title="Equalise panes" onClick={() => props.onLayout(layouts()[0]!)}><Columns3Icon /></RailButton>
      <Menu modal={false} placement="left-end">
        <MenuControl as={RailButton} tabIndex={-1} aria-label="Pane layouts" title="Pane layouts"><LayoutTemplateIcon /></MenuControl>
        <MenuContent>
          <MenuSection title="Pane widths">
            <For each={layouts()}>{(weights) =>
              <MenuRow icon={<LayoutGlyph weights={weights} />} onSelect={() => props.onLayout(weights)}>
                {weights.every((weight) => weight === weights[0]) ? "Even" : weights.join(" : ")}
              </MenuRow>}
            </For>
          </MenuSection>
        </MenuContent>
      </Menu>
    </>}</Show>
  </>;
  return <ToolRail aria-label="Workspace tools" data-region="workspace-rail" foot={PANE_LAYOUTS[props.panes] || props.tools ? foot() : undefined}
    onDragOver={(event) => { if (document.body.dataset.toolDrag === "split" && event.dataTransfer?.types.includes(TOOL_DRAG_TYPE)) event.preventDefault(); }}
    onDrop={(event) => { const drag = readToolDrag(event); if (drag?.from === "split") { event.preventDefault(); props.onDock(drag.tool); } }}>
    <Show when={props.tools}><For each={RAIL_TOOLS}>{(tool) => {
      const Icon = RAIL_ICONS[tool];
      const disabled = () => tool === "diff" && !props.sourceControlEnabled;
      const label = () => disabled() ? "Source Control is available only for Git workspaces" : WORKSPACE_TOOL_LABELS[tool];
      return <RailButton tabIndex={-1} data-tool={tool} draggable={!disabled()} data-doc-view={tool === "terminal" ? "tool:terminal" : tool} disabled={disabled()}
        aria-label={WORKSPACE_TOOL_LABELS[tool]} title={label()} current={props.current === tool}
        data-open={props.inSplit === tool ? "" : undefined}
        onClick={() => props.onChoose(tool)}><Icon /></RailButton>;
    }}</For>
    <RailRule /></Show>
    <Show when={props.docked.length}>
      <For each={props.docked}>{(doc) => {
        const Icon = doc.view.startsWith("chat:") ? MessageSquareTextIcon : doc.view.startsWith("page:") ? LayoutDashboardIcon : doc.view.startsWith("term:") ? SquareTerminalIcon : FileTextIcon;
        return <RailButton tabIndex={-1} draggable={true} data-doc-view={doc.view}
          aria-label={`${doc.name} (docked)`} title={doc.name} current={props.currentDocked === doc.slot}
          onClick={(event) => props.onChooseDocked(doc.slot, event.altKey)}><Icon /></RailButton>;
      }}</For>
      <RailRule />
    </Show>
    <RailButton tabIndex={-1} aria-label="Search chats" title="Search chats" onClick={() => props.onOpenSearch()}><SearchIcon /></RailButton>
    <RailButton tabIndex={-1} aria-label="Open command palette" title="Command palette" onClick={() => props.onOpenPalette()}><CommandIcon /></RailButton>
  </ToolRail>;
}
