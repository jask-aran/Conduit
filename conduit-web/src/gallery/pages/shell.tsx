import { DefaultMeteorShower } from "@jask-aran/solid-components/meteor-shower";
import "@jask-aran/solid-components/meteor-shower.css";
import { AppShell, Dock, DockSurface, HeaderCrumb, ResizeEdge, Sheet, SheetFill, ToolContent, PaneHeader } from "@/components/ui";
import { row, token, type Page } from "../model";

/* The window's row at a fraction of its height: a sheet's height is the window's, so the scene sets its own. */
const tall = { height: "calc(20 * var(--u-space))" };
const scene = (opts: { split?: boolean; dock?: "open" | "overlay" | "expanded" } = {}) =>
  <div class="g-shell" style={{ height: "calc(20 * var(--u-space) + var(--space-xl))", "--workspace-shell-width": "calc(16 * var(--u-space))" }}>
    <AppShell>
      <Sheet as="main" lead under={opts.dock === "expanded"} style={tall}><PaneHeader><HeaderCrumb place="Japan" title="Planning the Kyoto leg" /></PaneHeader></Sheet>
      {opts.split && <Sheet style={{ ...tall, flex: "1 1 0" }}><ResizeEdge kind="pane" aria-label="Resize panes" /><div><PaneHeader><HeaderCrumb title="Notes.md" /></PaneHeader></div></Sheet>}
      {opts.dock && <Dock open overlay={opts.dock === "overlay"} expanded={opts.dock === "expanded"} edge={<ResizeEdge kind="pane" dock aria-label="Resize workspace panel" />}
        style={{ ...tall, width: opts.dock === "overlay" ? "0px" : "calc(16 * var(--u-space))", "margin-right": "var(--space-md)" }}>
        <DockSurface><PaneHeader kind="tool" name="Files" /><ToolContent><SheetFill /></ToolContent></DockSurface>
      </Dock>}
    </AppShell>
  </div>;

export const shellPage: Page = {
  title: "Shell", rail: "Blocks",
  summary: "Beside the sidebar, the row the panes and the dock share. Each pane is a Sheet: the charcoal ground inset on the frame, rounded; the first is the main pane, the rest split from it. The Dock is the workspace's sheet at the row's end, beside the panes or floating over them. The app keeps the behaviour (weights, resizing, focus) and sets it through their props.",
  preview: () => scene({ split: true, dock: "open" }),
  usage: `import { AppShell, Sheet, Dock, DockSurface, DockDocument, ToolContent, ResizeEdge } from "@/components/ui";

<AppShell settling={panesSettling()}>
  <Sheet as="main" lead under={dockExpanded()} style={{ flex: \`\${weights()[0]} 1 0\` }}>…the route…</Sheet>
  <Sheet docked={docked ? (shown ? true : "hidden") : false}><ResizeEdge kind="pane" …/>…</Sheet>
  <Dock open={open()} expanded={expanded()} overlay={overlay()} edge={<ResizeEdge kind="pane" dock …/>}>
    <DockSurface documented={documentShown()}>{header}<ToolContent>{tools}</ToolContent><DockDocument ref={host} /></DockSurface>
  </Dock>
</AppShell>`,
  anatomy: { scene: () => scene({ split: true, dock: "open" }), parts: [
    { selector: ".ui-sheet[data-lead]", name: "Main pane", does: "the first sheet beside the sidebar; it clips what it holds", from: "Sheet lead" },
    { selector: ".ui-sheet:not([data-lead])", name: "Split pane", does: "a pane split from it, its drag edge in the gutter", from: "Sheet + ResizeEdge" },
    { selector: ".ui-dock", name: "Dock", does: "the workspace's tools at the row's end", from: "Dock + DockSurface" },
  ] },
  examples: [
    row("main pane", "one sheet: the main pane alone", () => scene(), { surfaces: ["ground"], source: "main.tsx" }),
    row("split", "a pane split from the main one", () => scene({ split: true }), { surfaces: ["ground"], source: "main.tsx" }),
    row("dock beside", "the dock taking room in the row", () => scene({ dock: "open" }), { surfaces: ["ground"], code: "<Dock open>", source: "workspace/workspace-panel.tsx" }),
    row("dock over", "the dock floating over the panes", () => scene({ dock: "overlay" }), { surfaces: ["ground"], code: "<Dock open overlay>", source: "workspace/workspace-panel.tsx" }),
    row("backdrop", "the main pane's ground drawn on: the meteor field, under everything it holds", () => <div class="g-shell" style={{ height: "calc(20 * var(--u-space) + var(--space-xl))" }}><AppShell><Sheet as="main" lead backdrop={<DefaultMeteorShower />} style={tall}><PaneHeader><HeaderCrumb title="Conduit" /></PaneHeader></Sheet></AppShell></div>, { surfaces: ["ground"], code: "<Sheet lead backdrop={<DefaultMeteorShower />}>", source: "main.tsx" }),
    row("dock expanded", "the dock covering the panes; the main pane under it", () => scene({ dock: "expanded" }), { surfaces: ["ground"], code: "<Dock open expanded> · <Sheet under>" }),
  ],
  tokens: [{ title: "The sheets", tokens: [
    token("--space-md", "a sheet's inset on the frame, and the gutter between panes"),
    token("--radius-surface", "a sheet's corners"),
    token("--background", "a sheet's ground"),
    token("--frame", "the frame between sheets"),
    token("--conduit-min-main-pane", "the main pane's narrowest, on a desktop"),
    token("--duration-fold", "a pane's share and the dock's room easing"),
  ] }],
  api: ["AppShell", "Sheet", "SheetFill", "Dock", "DockSurface", "DockDocument", "ToolContent"],
};
