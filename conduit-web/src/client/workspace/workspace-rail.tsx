import { For, Show } from "solid-js";
import { PanelRightIcon, Columns3Icon, CommandIcon, FileTextIcon, FolderIcon, LayoutDashboardIcon, MessageSquareTextIcon, SquareTerminalIcon, GitCompareArrowsIcon, LayoutTemplateIcon, MessageSquareIcon, SearchIcon, TerminalIcon } from "lucide-solid";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuTrigger } from "@/components/primitives";
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
 * Above them, set apart, a tile for each pane folded away because the window
 * is too narrow, lettered as the pane it comes back as; choosing it trades it
 * with the pane that has the keyboard.
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
  folded: { slot: number; letter: string; name: string }[];
  onShowFolded: (slot: number) => void;
  /** Panes moved into the dock, each its own icon; Alt or a drag takes one back to a pane. */
  docked: { slot: number; view: string; name: string }[];
  currentDocked: number | null;
  onChooseDocked: (slot: number, alt: boolean) => void;
  /** The dock drawn over the panes rather than beside them. */
  dockOverlay: boolean;
  onToggleDockOverlay: () => void;
}) {
  return <nav class="workspace-rail" aria-label="Workspace tools"
    onDragOver={(event) => { if (document.body.dataset.toolDrag === "split" && event.dataTransfer?.types.includes(TOOL_DRAG_TYPE)) event.preventDefault(); }}
    onDrop={(event) => { const drag = readToolDrag(event); if (drag?.from === "split") { event.preventDefault(); props.onDock(drag.tool); } }}>
    <Show when={props.tools}><For each={RAIL_TOOLS}>{(tool) => {
      const Icon = RAIL_ICONS[tool];
      const disabled = () => tool === "diff" && !props.sourceControlEnabled;
      const label = () => disabled() ? "Source Control is available only for Git workspaces" : WORKSPACE_TOOL_LABELS[tool];
      return <button type="button" class="workspace-rail-action" tabIndex={-1} data-tool={tool} draggable={!disabled()} data-doc-view={tool === "terminal" ? "tool:terminal" : tool} disabled={disabled()}
        aria-label={WORKSPACE_TOOL_LABELS[tool]} title={label()} aria-current={props.current === tool ? "true" : undefined}
        data-open={props.inSplit === tool ? "true" : undefined}
        onClick={() => props.onChoose(tool)}><Icon /></button>;
    }}</For>
    <span class="workspace-rail-separator" aria-hidden="true" /></Show>
    <Show when={props.docked.length}>
      <For each={props.docked}>{(doc) => {
        const Icon = doc.view.startsWith("chat:") ? MessageSquareTextIcon : doc.view.startsWith("page:") ? LayoutDashboardIcon : doc.view.startsWith("term:") ? SquareTerminalIcon : FileTextIcon;
        return <button type="button" class="workspace-rail-action" tabIndex={-1} draggable={true} data-doc-view={doc.view}
          aria-label={`${doc.name} (docked)`} title={doc.name} aria-current={props.currentDocked === doc.slot ? "true" : undefined}
          onClick={(event) => props.onChooseDocked(doc.slot, event.altKey)}><Icon /></button>;
      }}</For>
      <span class="workspace-rail-separator" aria-hidden="true" />
    </Show>
    <button type="button" class="workspace-rail-action" tabIndex={-1} aria-label="Search chats" title="Search chats" onClick={() => props.onOpenSearch()}><SearchIcon /></button>
    <button type="button" class="workspace-rail-action" tabIndex={-1} aria-label="Open command palette" title="Command palette" onClick={() => props.onOpenPalette()}><CommandIcon /></button>
    <Show when={PANE_LAYOUTS[props.panes] || props.folded.length || props.tools}><div class="workspace-rail-foot">
      <Show when={props.tools}><button type="button" class="workspace-rail-action" tabIndex={-1} aria-pressed={props.dockOverlay} data-open={props.dockOverlay ? "true" : undefined}
        aria-label={props.dockOverlay ? "Dock beside the panes" : "Dock over the panes"} title={props.dockOverlay ? "Dock: over the panes" : "Dock: beside the panes"} onClick={() => props.onToggleDockOverlay()}><PanelRightIcon /></button></Show>
      <Show when={props.folded.length}>
        <For each={props.folded}>{(pane) =>
          <button type="button" class="workspace-rail-action workspace-rail-folded" tabIndex={-1} aria-label={`Show pane ${pane.letter}: ${pane.name}`} title={`${pane.name} (pane ${pane.letter}, folded: no room)`} onClick={() => props.onShowFolded(pane.slot)}>
            <span aria-hidden="true">{pane.letter}</span>
          </button>}
        </For>
        <Show when={PANE_LAYOUTS[props.panes]}><span class="workspace-rail-separator" aria-hidden="true" /></Show>
      </Show>
      <Show when={PANE_LAYOUTS[props.panes]}>{(layouts) => <>
      <button type="button" class="workspace-rail-action" tabIndex={-1} aria-label="Equalise panes" title="Equalise panes" onClick={() => props.onLayout(layouts()[0]!)}><Columns3Icon /></button>
      <Menu modal={false} placement="left-end">
        <MenuTrigger class="workspace-rail-action" tabIndex={-1} aria-label="Pane layouts" title="Pane layouts"><LayoutTemplateIcon /></MenuTrigger>
        <MenuContent class="pane-layouts">
          <MenuGroup><MenuLabel>Pane widths</MenuLabel>
          <For each={layouts()}>{(weights) =>
            <MenuItem onSelect={() => props.onLayout(weights)} textValue={weights.join(":")}>
              <span class="pane-layout-glyph" aria-hidden="true"><For each={weights}>{(weight) => <i style={{ flex: `${weight} 1 0` }} />}</For></span>
              <span>{weights.every((weight) => weight === weights[0]) ? "Even" : weights.join(" : ")}</span>
            </MenuItem>}
          </For></MenuGroup>
        </MenuContent>
      </Menu>
      </>}</Show>
    </div></Show>
  </nav>;
}
