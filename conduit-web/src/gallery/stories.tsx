import { createSignal, For, type JSX } from "solid-js";
import { LayoutDashboardIcon, MessageSquarePlusIcon, MonitorIcon, PanelLeftIcon, SearchIcon, SquareTerminalIcon } from "lucide-solid";
import { Button, Field, FieldGroup, FieldLabel, Input, Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Spinner, Textarea, Tooltip, TooltipContent, TooltipTrigger } from "@/components/primitives";
import { FrostDialog, Keycap } from "@/components/frost";
import { Segmented, Switch } from "../client/settings/settings-controls";
import { StepSlider } from "../client/chat/step-slider";
import { Disclosure } from "../client/chat/disclosure";
import { headerPill, HeaderActions } from "../client/navigation/header-pill";

/** Where a component is drawn: on both layouts, or one only. */
export type Scope = "both" | "desktop" | "phone";
/**
 * How far along consolidation it is. primitive: a shared component. pattern:
 * shared CSS with no component. one-off: drawn in place. mismatch: a copy of
 * a primitive drawn its own way (DESIGN.md, Known mismatches).
 */
export type Status = "primitive" | "pattern" | "one-off" | "mismatch";

export interface Story {
  id: string;
  name: string;
  group: "Base" | "Materials" | "Surfaces";
  scope: Scope;
  status: Status;
  source: string;
  /** What is off about it, for the consolidation pass. */
  note?: string;
  /** Height of its phone frame. */
  frame?: number;
  render: () => JSX.Element;
}

const Row = (props: { children: JSX.Element }) => <div class="g-row">{props.children}</div>;

/** Something for frost to blur: the material means nothing over flat black. */
export const Backdrop = () => <div class="g-backdrop" aria-hidden="true">
  <p>Conduit keeps the answer, the trace and the files in one place. A transcript runs under the header and the composer, so their frost has text to soften.</p>
  <pre>{"const surface = createComposerSurfaceSignal();\nreturn isMobileLayout() ? frosted : {};"}</pre>
  <p>Every pill on this page is the material the composer uses.</p>
</div>;

function MenuDemo() {
  return <Menu>
    <MenuTrigger as={Button} variant="outline">Open menu</MenuTrigger>
    <MenuContent>
      <MenuGroup><MenuLabel>Servers</MenuLabel>
        <MenuItem>Desktop-Dev</MenuItem><MenuItem>Laptop</MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem>Manage settings</MenuItem><MenuItem>Sign out</MenuItem>
    </MenuContent>
  </Menu>;
}

function DialogDemo() {
  const [open, setOpen] = createSignal(false);
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}>Open dialog</Button>
    <FrostDialog open={open()} onOpenChange={setOpen} title="Delete this chat?" actions={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button variant="destructive" onClick={() => setOpen(false)}>Delete</Button></>} />
  </>;
}

function SegmentedDemo() {
  const [value, setValue] = createSignal("fade");
  return <Segmented label="Streaming" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "fade", label: "Fade" }, { value: "type", label: "Type" }]} />;
}

function SwitchDemo() {
  const [on, setOn] = createSignal(true);
  return <Row><Switch label="Example" checked={on()} onChange={setOn} /><Switch label="Off" checked={false} onChange={() => {}} /></Row>;
}

function SliderDemo() {
  const options = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "max", label: "Max" }];
  const [value, setValue] = createSignal("medium");
  return <div style={{ width: "220px" }}><StepSlider label="Effort" options={options} value={value()} onChange={setValue} /></div>;
}

function AreaToggleDemo() {
  const [area, setArea] = createSignal<"conduit" | "computer">("conduit");
  return <div class="conduit-sidebar" style={{ position: "static", transform: "none", width: "auto", background: "transparent" }}>
    <div class="sidebar-area-toggle" data-area={area()} role="group" aria-label="Sidebar section">
      <button type="button" aria-pressed={area() === "conduit"} onClick={() => setArea("conduit")}><LayoutDashboardIcon /></button>
      <button type="button" aria-pressed={area() === "computer"} onClick={() => setArea("computer")}><MonitorIcon /></button>
    </div>
  </div>;
}

/** The phone chat header: the leading pill as main.tsx draws it, and the real HeaderActions. */
function PhoneHeader() {
  const leading = headerPill();
  return <div class="g-surface"><Backdrop />
    <header class="chat-header" style={{ position: "absolute", inset: "0 0 auto" }}>
      <div class={`mobile-header-leading ${leading().class ?? ""}`} data-composer-surface={leading()["data-composer-surface"]}>
        <Button variant="ghost" size="icon-sm" class="mobile-sidebar-trigger" aria-label="Toggle Sidebar"><PanelLeftIcon /></Button>
        <Button variant="ghost" size="icon-sm" class="mobile-new-chat-trigger" aria-label="New chat"><MessageSquarePlusIcon /></Button>
      </div>
      <nav class="chat-header-title"><strong>Gallery</strong></nav>
      <HeaderActions>
        <Button variant="ghost" size="icon-sm" class="search-trigger" aria-label="Search chats"><SearchIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Terminal"><SquareTerminalIcon /></Button>
      </HeaderActions>
    </header>
  </div>;
}

/** The phone sidebar header, mirroring sidebar.tsx's markup (Sidebar needs the whole app). */
function SidebarHeader() {
  const pill = headerPill();
  const [area, setArea] = createSignal<"conduit" | "computer">("conduit");
  return <aside class="conduit-sidebar" data-slot="sidebar" data-state="expanded" data-mobile-open="true" style={{ position: "relative", height: "100%" }}>
    <div class="sidebar-container">
      <div data-sidebar="header">
        <div class={`sidebar-header-pill ${pill().class ?? ""}`} data-composer-surface={pill()["data-composer-surface"]}>
          <Button variant="ghost" size="icon-sm" data-sidebar="trigger" aria-label="Toggle Sidebar"><PanelLeftIcon /></Button>
        </div>
        <button data-sidebar="brand" aria-label="Conduit"><span>Conduit</span></button>
        <div class="sidebar-header-server">
          <button class="sidebar-user"><span class="sidebar-user-label"><strong>Desktop-Dev</strong><small>Connected · 25ms</small></span>
            <span class="server-status-indicator runtime-indicator runtime-indicator-success"><span class="runtime-indicator-dot" /></span></button>
        </div>
        <div class={`sidebar-area-toggle ${pill().class ?? ""}`} data-composer-surface={pill()["data-composer-surface"]} data-area={area()} role="group">
          <button type="button" aria-pressed={area() === "conduit"} onClick={() => setArea("conduit")}><LayoutDashboardIcon /></button>
          <button type="button" aria-pressed={area() === "computer"} onClick={() => setArea("computer")}><MonitorIcon /></button>
        </div>
      </div>
      <div class="sidebar-content"><For each={["Conduit Dashboard", "New chat", "Projects", "Chats"]}>{(label) => <div class="sidebar-row" style={{ padding: "0 10px" }}>{label}</div>}</For></div>
    </div>
  </aside>;
}

/** The materials side by side over the same text, which is where they drift. */
function Materials() {
  const swatch = (label: string, props: Record<string, string>) => <div class="g-swatch" {...props}><span>{label}</span></div>;
  return <div class="g-surface g-materials"><Backdrop />
    <div class="g-swatches">
      {swatch("composer · static", { class: "g-swatch composer-surface-material", "data-composer-surface": "static" })}
      {swatch("composer · frosted-live", { class: "g-swatch composer-surface-material", "data-composer-surface": "frosted-live" })}
      {swatch("overlay card (.frost-card)", { class: "g-swatch frost-card" })}
      {swatch("menu / popover", { class: "g-swatch", "data-slot": "popover-content" })}
      {swatch("phone + menu (.composer-options-menu)", { class: "g-swatch composer-options-menu" })}
    </div>
  </div>;
}

export const stories: Story[] = [
  { id: "button", name: "Button", group: "Base", scope: "both", status: "primitive", source: "components/primitives.tsx",
    note: "Plain <button>s with local styling outnumber it in the terminal pane, sidebar, main.tsx and command menu.",
    render: () => <><Row><Button>Default</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Destructive</Button></Row>
      <Row><Button size="sm">Small</Button><Button size="icon" variant="ghost" aria-label="Search"><SearchIcon /></Button><Button size="icon-sm" variant="ghost" aria-label="Search"><SearchIcon /></Button><Button disabled>Disabled</Button></Row></> },
  { id: "spinner", name: "Spinner", group: "Base", scope: "both", status: "primitive", source: "components/primitives.tsx", render: () => <Row><Spinner /><Spinner class="size-3" /></Row> },
  { id: "menu", name: "Menu", group: "Base", scope: "both", status: "primitive", source: "components/primitives.tsx", frame: 420,
    note: "On a phone, submenus open as panels via PhoneMenuSubmenu.", render: () => <MenuDemo /> },
  { id: "popover", name: "Popover", group: "Base", scope: "both", status: "primitive", source: "components/primitives.tsx",
    render: () => <Popover><PopoverTrigger as={Button} variant="outline">Open popover</PopoverTrigger><PopoverContent>A popover on the overlay frost.</PopoverContent></Popover> },
  { id: "tooltip", name: "Tooltip", group: "Base", scope: "desktop", status: "primitive", source: "components/primitives.tsx",
    render: () => <Tooltip><TooltipTrigger as={Button} variant="outline">Hover me</TooltipTrigger><TooltipContent>Tooltip</TooltipContent></Tooltip> },
  { id: "fields", name: "Field, Input, Textarea", group: "Base", scope: "both", status: "primitive", source: "components/primitives.tsx",
    render: () => <div style={{ width: "260px" }}><FieldGroup><Field><FieldLabel for="g-name">Name</FieldLabel><Input id="g-name" placeholder="My project" /></Field><Field><FieldLabel for="g-notes">Notes</FieldLabel><Textarea id="g-notes" placeholder="Anything" /></Field></FieldGroup></div> },
  { id: "dialog", name: "FrostDialog", group: "Base", scope: "both", status: "primitive", source: "components/frost.tsx", frame: 420, render: () => <DialogDemo /> },
  { id: "keycap", name: "Keycap", group: "Base", scope: "desktop", status: "primitive", source: "components/frost.tsx", render: () => <Row><Keycap>Ctrl</Keycap><Keycap>G</Keycap><Keycap>Esc</Keycap></Row> },
  { id: "segmented", name: "Segmented choice", group: "Base", scope: "both", status: "primitive", source: "settings/settings-controls.tsx",
    note: "Lives in settings/ though it is used beyond it.", render: () => <SegmentedDemo /> },
  { id: "area-toggle", name: "Sidebar area toggle", group: "Base", scope: "both", status: "mismatch", source: "navigation/sidebar.tsx",
    note: "A segmented choice drawn again. So are .split-heading-switches (dashboards) and .workspace-history-toggle.", render: () => <AreaToggleDemo /> },
  { id: "switch", name: "Switch", group: "Base", scope: "both", status: "primitive", source: "settings/settings-controls.tsx", render: () => <SwitchDemo /> },
  { id: "step-slider", name: "StepSlider", group: "Base", scope: "both", status: "primitive", source: "chat/step-slider.tsx", render: () => <SliderDemo /> },
  { id: "disclosure", name: "Disclosure", group: "Base", scope: "both", status: "primitive", source: "chat/disclosure.tsx",
    render: () => <div style={{ width: "280px" }}><Disclosure class="g-disclosure" headerClass="g-disclosure-header" bodyClass="g-disclosure-body" header={<span>Thought for 4s</span>} body={() => <p>The body unfolds in height and folds to nothing.</p>} /></div> },
  { id: "runtime-dot", name: "Runtime dot", group: "Base", scope: "both", status: "pattern", source: "navigation/runtime-indicator.tsx",
    note: "RuntimeIndicator needs a live process, so the server switcher and others draw the dot from its classes.",
    render: () => <Row><For each={["success", "warn", "danger", "muted"]}>{(tone) => <span class={`runtime-indicator runtime-indicator-${tone}`}><span class="runtime-indicator-dot" /></span>}</For><span class="runtime-indicator"><Spinner class="size-3" /></span></Row> },
  { id: "materials", name: "Frost materials", group: "Materials", scope: "both", status: "mismatch", source: "styles.css", frame: 520,
    note: "One fill and stroke (#ffffff2b / #ffffff4d) written out in four rules instead of shared tokens; blur 19.2px, 24px and 17.6px+saturate; three different shadows; --frost-fill and --frost-stroke are read but never set. The phone + menu is an older material altogether.",
    render: () => <Materials /> },
  { id: "phone-header", name: "Chat header", group: "Surfaces", scope: "phone", status: "one-off", source: "main.tsx, navigation/header-pill.tsx", frame: 140,
    note: "Real HeaderActions; the leading pill mirrors main.tsx's ChatHeader.", render: () => <PhoneHeader /> },
  { id: "sidebar-header", name: "Sidebar header", group: "Surfaces", scope: "phone", status: "one-off", source: "navigation/sidebar.tsx", frame: 240,
    note: "Mirrors sidebar.tsx's markup: the Sidebar component needs the whole app.", render: () => <SidebarHeader /> },
];
