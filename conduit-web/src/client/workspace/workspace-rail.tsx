import { Icons, IconButton } from "@/components/ui";
import { For, Show, type JSX } from "solid-js";
import { Columns3Icon, CommandIcon, LayoutTemplateIcon } from "lucide-solid";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { LayoutGlyph, RailRule, ToolRail } from "@/components/ui/pane";
import { isSplitView, type PanelTab, type SplitView } from "./workspace-types";

export const WORKSPACE_TOOL_LABELS: Record<PanelTab, string> = { files: "Files", diff: "Source Control", chat: "Chat review", terminal: "Terminal", jbot: "jbot" };
export const WORKSPACE_TOOL_ICONS = { files: Icons.Folder, diff: Icons.GitCompareArrows, chat: Icons.Chat, terminal: Icons.Terminal, jbot: Icons.Agent } satisfies Record<PanelTab, unknown>;

export const TOOL_DRAG_TYPE = "application/x-conduit-tool";
export function readToolDrag(event: DragEvent): { tool: SplitView; from: "dock" | "split" } | null {
  try {
    const value = JSON.parse(event.dataTransfer?.getData(TOOL_DRAG_TYPE) || "null");
    return value && isSplitView(value.tool) && (value.from === "dock" || value.from === "split") ? value : null;
  } catch {
    return null;
  }
}

export const PANE_LAYOUTS: Record<number, number[][]> = {
  2: [[1, 1], [1, 2], [2, 1], [1, 3], [3, 1]],
  3: [[1, 1, 1], [2, 1, 1], [1, 2, 1], [1, 1, 2]],
};
const RAIL_TOOLS = ["files", "diff", "chat", "terminal"] satisfies PanelTab[];

/** Not a region of its own: its icons are reached from the dock, so it stays out of the tab order as the header's icons do. */
export function WorkspaceRail(props: {
  tools: boolean;
  onOpenSearch: () => void;
  onOpenPalette: () => void;
  onOpenBrowser: () => void;
  windowControls?: JSX.Element;
  current: PanelTab | null;
  inSplit: PanelTab | null;
  sourceControlEnabled: boolean;
  onChoose: (tool: PanelTab) => void;
  onDock: (view: SplitView) => void;
  panes: number;
  onLayout: (weights: number[]) => void;
  docked: { slot: number; view: string; name: string }[];
  currentDocked: number | null;
  onChooseDocked: (slot: number, alt: boolean) => void;
  dockOverlay: boolean;
  onToggleDockOverlay: () => void;
  jbot?: { name: string; current: boolean; needs: number; onOpen: () => void };
  feedback?: { open: boolean; onToggle: () => void };
}) {
  const foot = () => <>
    <Show when={props.tools}><IconButton kind="rail" tabIndex={-1} aria-pressed={props.dockOverlay} data-open={props.dockOverlay ? "" : undefined}
      aria-label={props.dockOverlay ? "Dock beside the panes" : "Dock over the panes"} title={props.dockOverlay ? "Dock: over the panes" : "Dock: beside the panes"} onClick={() => props.onToggleDockOverlay()}><Icons.Workspace /></IconButton></Show>
    <Show when={PANE_LAYOUTS[props.panes]}>{(layouts) => <>
      <IconButton kind="rail" tabIndex={-1} aria-label="Equalise panes" title="Equalise panes" onClick={() => props.onLayout(layouts()[0]!)}><Columns3Icon /></IconButton>
      <DropdownMenu modal={false} placement="left-end">
        <MenuControl kind="rail" as={IconButton} tabIndex={-1} aria-label="Pane layouts" title="Pane layouts"><LayoutTemplateIcon /></MenuControl>
        <MenuContent>
          <MenuSection title="Pane widths">
            <For each={layouts()}>{(weights) =>
              <MenuRow icon={<LayoutGlyph weights={weights} />} onSelect={() => props.onLayout(weights)}>
                {weights.every((weight) => weight === weights[0]) ? "Even" : weights.join(" : ")}
              </MenuRow>}
            </For>
          </MenuSection>
        </MenuContent>
      </DropdownMenu>
    </>}</Show>
  </>;
  return <ToolRail aria-label="Workspace tools" data-region="workspace-rail" foot={PANE_LAYOUTS[props.panes] || props.tools ? foot() : undefined}
    onDragOver={(event) => { if (document.body.dataset.toolDrag === "split" && event.dataTransfer?.types.includes(TOOL_DRAG_TYPE)) event.preventDefault(); }}
    onDrop={(event) => { const drag = readToolDrag(event); if (drag?.from === "split") { event.preventDefault(); props.onDock(drag.tool); } }}>
    <Show when={props.windowControls}>{props.windowControls}<RailRule /></Show>
    <Show when={props.tools}><For each={RAIL_TOOLS}>{(tool) => {
      const Icon = WORKSPACE_TOOL_ICONS[tool];
      const disabled = () => tool === "diff" && !props.sourceControlEnabled;
      const label = () => disabled() ? "Source Control is available only for Git workspaces" : WORKSPACE_TOOL_LABELS[tool];
      return <IconButton kind="rail" tabIndex={-1} data-tool={tool} draggable={!disabled()} data-doc-view={tool === "terminal" ? "tool:terminal" : tool} disabled={disabled()}
        aria-label={WORKSPACE_TOOL_LABELS[tool]} title={label()} current={props.current === tool}
        data-open={props.inSplit === tool ? "" : undefined}
        onClick={() => props.onChoose(tool)}><Icon /></IconButton>;
    }}</For></Show>
    <Show when={props.jbot}>{(jbot) => <IconButton kind="rail" tabIndex={-1} data-doc-view="page:jbot" aria-label={jbot().needs ? `${jbot().name}, ${jbot().needs} waiting on you` : jbot().name} title={jbot().name}
      current={jbot().current} count={jbot().needs || undefined} onClick={() => jbot().onOpen()}><Icons.Agent /></IconButton>}</Show>
    <Show when={props.tools || props.jbot}><RailRule /></Show>
    <Show when={props.docked.some((doc) => doc.view !== "page:jbot")}>
      <For each={props.docked.filter((doc) => doc.view !== "page:jbot")}>{(doc) => {
        const Icon = doc.view.startsWith("chat:") ? Icons.Message : doc.view.startsWith("page:") ? Icons.Dashboard : doc.view.startsWith("term:") ? Icons.Shell : doc.view.startsWith("browser:") ? Icons.Browser : Icons.FileText;
        return <IconButton kind="rail" tabIndex={-1} draggable={true} data-doc-view={doc.view}
          aria-label={`${doc.name} (docked)`} title={doc.name} current={props.currentDocked === doc.slot}
          onClick={(event) => props.onChooseDocked(doc.slot, event.altKey)}><Icon /></IconButton>;
      }}</For>
      <RailRule />
    </Show>
    <IconButton kind="rail" tabIndex={-1} aria-label="Browser" title="Browser" onClick={() => props.onOpenBrowser()}><Icons.Browser /></IconButton>
    <IconButton kind="rail" tabIndex={-1} aria-label="Search chats" title="Search chats" onClick={() => props.onOpenSearch()}><Icons.Search /></IconButton>
    <IconButton kind="rail" tabIndex={-1} aria-label="Open command palette" title="Command palette" onClick={() => props.onOpenPalette()}><CommandIcon /></IconButton>
    <Show when={props.feedback}>{(feedback) => <IconButton kind="rail" tabIndex={-1} aria-label="UI feedback" title="UI feedback" aria-pressed={feedback().open} data-open={feedback().open ? "" : undefined} onClick={() => feedback().onToggle()}><Icons.Pointer /></IconButton>}</Show>
  </ToolRail>;
}
