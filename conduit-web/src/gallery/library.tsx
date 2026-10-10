import { createSignal, For, type JSX } from "solid-js";
import { ClipboardCopyIcon, Columns2Icon, CopyIcon, FolderIcon, FolderInputIcon, LayoutDashboardIcon, MenuIcon, MonitorIcon, PaperclipIcon, PencilIcon, PinIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, SearchIcon, ShareIcon, ShieldCheckIcon, SquarePenIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import { Bubble, Button, Card, Frost, Input, Item, Keycap, Menu, Pill, SearchSection, Section, Segmented, SelectTrigger, Slider } from "@/components/ui";
import { Switch } from "../client/settings/settings-controls";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import type { Atom, Scope } from "./atoms";
import { MODELS, PROFILES, PROJECTS } from "./seed";

/*
 * The unified library, most-used first, in the order a popover is built:
 *
 *   Popover   frost, holding sections
 *   Section   a list (may have a title), a search or a slider
 *   Item      a list's entry; icon, meta, keys and submenu are its parts
 *   Submenu   a popover built the same way, opened from an item
 *
 * then the app's real popovers rebuilt from these pieces -- desktop and phone
 * apart, since their structures differ -- then cards, frost on the page and
 * the controls on every surface they sit on.
 */

/** The tag: where the piece is used, and which layer of the library it is. */
const lib = (id: string, name: string, scope: Scope, layer: string, source: string, render: Atom["render"]): Atom => ({ id: `ui-${id}`, name, scope, kind: layer, source, render });
/** both: each piece drawn in a desktop and a phone layout. layout: the group stands in that layout, which its popovers inherit. */
export interface Group { title: string; note: string; atoms: Atom[]; both?: boolean; layout?: "desktop" | "phone" }

const thinking = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
/** The app's slider as its popovers use it: a label, and a value that opens the levels. */
function Levels(props: { label?: string }) {
  const [value, setValue] = createSignal("medium");
  return <Slider label={props.label ?? "Thinking"} options={thinking} value={value()} onChange={setValue} onOpen={() => {}} />;
}
function SwitchDemo() { const [on, setOn] = createSignal(true); return <Switch label="Example" checked={on()} onChange={setOn} />; }
function SegmentedText() { const [value, setValue] = createSignal("cloud"); return <Segmented label="Source" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />; }
function SegmentedCount() { const [value, setValue] = createSignal("all"); return <Segmented label="Show" value={value()} onChange={setValue} options={[{ value: "all", label: "All", count: 0 }, { value: "unread", label: "Unread", count: 0 }]} />; }
const areas = () => [{ value: "dashboard", label: "Dashboard", icon: <LayoutDashboardIcon /> }, { value: "computer", label: "Computer", icon: <MonitorIcon /> }];
function SegmentedIcons(props: { pill?: boolean }) { const [value, setValue] = createSignal("dashboard"); return <Segmented icons pill={props.pill} label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }

/** A search section filtering the list section after it. */
function ModelList(props: { keys?: string[]; title?: string }) {
  const [query, setQuery] = createSignal("");
  const [current, setCurrent] = createSignal(MODELS[2]!.spec);
  const shown = () => { const needle = query().trim().toLowerCase(); return needle ? MODELS.filter((model) => model.label.toLowerCase().includes(needle)) : MODELS; };
  return <>
    <SearchSection placeholder="Search all models…" keys={props.keys} value={query()} onInput={setQuery} />
    <Section title={props.title}><For each={shown()}>{(model) => <div onClick={() => setCurrent(model.spec)}><Item meta={model.provider} checked={model.spec === current()}>{model.label}</Item></div>}</For></Section>
  </>;
}
const Profiles = () => <Section title="Profile"><For each={PROFILES}>{(profile, index) => <Item checked={index() === 0} icon={<HarnessMark id={profile.implementation || "conduit"} class="size-4" />} meta={profile.implementation}>{profile.label}</Item>}</For></Section>;
const Projects = () => <Section title="Project"><Item icon={<FolderIcon />}>No folder</Item><For each={PROJECTS.slice(2, 7)}>{(project) => <Item icon={<PlaceGlyph project={project} />}>{project.name}</Item>}</For></Section>;
const ChatTitle = () => <Section title="Lorem ipsum file"><Item meta="12% used" opens>Context</Item></Section>;

/** The same piece on each surface it sits on: the frame (sidebar), the ground (chat, dashboard) and frost. */
function Surfaces(props: { frame?: boolean; children: () => JSX.Element }) {
  return <div class="g-surfaces">
    {props.frame && <div class="g-surface" data-surface="frame"><small>frame</small>{props.children()}</div>}
    <div class="g-surface" data-surface="ground"><small>ground</small>{props.children()}</div>
    <Frost lift="raised" class="g-surface"><small>frost</small>{props.children()}</Frost>
  </div>;
}

export const libraryGroups: Group[] = [
  { title: "Popover", note: "frost → sections → items; a submenu is another popover. Built as the desktop variant and the phone variant", both: true, atoms: [
    lib("anatomy", "Anatomy", "both", "popover", "Menu > Section > Item", () => <div class="g-anatomy"><Menu>
      <SearchSection placeholder="Section · search" />
      <Section title="Section · list"><Item icon={<PaperclipIcon />}>Item</Item><Item meta="meta">Item</Item><Item opens>Item that opens a submenu</Item></Section>
      <Section kind="slider"><Levels label="Section · slider" /></Section>
    </Menu></div>),
    lib("section-list", "List", "both", "section", "Section", () => <Menu><Section title="Project" note="5"><For each={PROJECTS.slice(2, 6)}>{(project) => <Item icon={<PlaceGlyph project={project} />}>{project.name}</Item>}</For></Section></Menu>),
    lib("section-search", "Search", "both", "section", "SearchSection", () => <Menu><SearchSection placeholder="Search all models…" keys={["⌘", "⇧", "X"]} /></Menu>),
    lib("section-slider", "Slider", "both", "section", "Section kind=slider + Slider", () => <Menu><Section kind="slider"><Levels /></Section></Menu>),
    lib("item", "Item · parts and states", "both", "item", "Item icon meta keys opens · checked disabled destructive", () => <Menu><Section>
      <Item>Plain</Item>
      <Item icon={<PaperclipIcon />}>icon</Item>
      <Item meta="xai">meta</Item>
      <Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>keys</Item>
      <Item opens>opens a submenu</Item>
      <Item checked>checked</Item>
      <Item disabled meta="offline">disabled</Item>
      <Item icon={<Trash2Icon />} destructive>destructive</Item>
    </Section></Menu>),
    lib("submenu", "Submenu", "both", "popover", "Menu beside an Item that opens", () => <div class="g-row g-top g-submenu">
      <Menu><Section title="Servers"><Item checked>Desktop-Dev</Item><Item checked={false}>Laptop</Item></Section><Section><Item opens active>Route</Item><Item>Manage settings</Item></Section></Menu>
      <Menu><Section><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Section></Menu>
    </div>),
  ] },
  { title: "Desktop popovers", note: "the app's own, rebuilt from the pieces above, in a desktop layout", layout: "desktop", atoms: [
    lib("d-model", "Model picker", "desktop", "popover", "chat/model-selector.tsx", () => <Menu class="g-w18"><ModelList keys={["⌘", "⇧", "X"]} /><Section kind="slider"><Levels /></Section></Menu>),
    lib("d-plus", "+ menu", "desktop", "popover", "chat/composer-plus-menu.tsx", () => <Menu class="g-w18">
      <Section><Item meta="Muse Spark 1.3" opens>Model</Item><Item icon={<HarnessMark id="conduit" class="size-4" />} meta="Assistant" opens>Profile</Item><Item icon={<ShieldCheckIcon />} meta="Default" opens>Permissions</Item></Section>
      <Section><Item icon={<PlaceGlyph project={null} />} meta="None" opens>Project</Item></Section>
      <Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section>
    </Menu>),
    lib("d-profile", "+ menu › Profile", "desktop", "popover", "chat/composer-plus-menu.tsx", () => <Menu class="g-w18"><Profiles /></Menu>),
    lib("d-chat", "Chat menu", "desktop", "popover", "chat/chat-screen.tsx", () => <Menu class="g-w18"><ChatTitle /><Section><Item icon={<RefreshCwIcon />}>Update app</Item></Section><Section><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>),
    lib("d-sidebar", "Chat in the sidebar (right-click)", "desktop", "popover", "navigation/sidebar.tsx", () => <div class="g-row g-top g-submenu">
      <Menu class="g-w18"><Section><Item icon={<PencilIcon />}>Rename</Item><Item icon={<FolderInputIcon />} opens active>Move to folder…</Item><Item icon={<ClipboardCopyIcon />}>Copy transcript</Item><Item icon={<Columns2Icon />}>Open beside</Item><Item icon={<TerminalIcon />}>Open terminal</Item><Item icon={<PinIcon />}>Pin to sidebar</Item></Section><Section><Item icon={<Trash2Icon />} destructive>Delete chat</Item></Section></Menu>
      <Menu><Section><For each={PROJECTS.slice(2, 6)}>{(project, index) => <Item checked={index() === 0}>{project.name}</Item>}</For></Section></Menu>
    </div>),
    lib("d-server", "Server menu", "desktop", "popover", "navigation/server-switcher.tsx", () => <div class="g-row g-top g-submenu">
      <Menu class="g-w18"><Section title="Servers"><Item checked meta="12 ms">Desktop-Dev</Item><Item checked={false} meta="48 ms">Laptop</Item></Section><Section><Item meta="LAN · 192.168.1.4" opens active>Route</Item></Section><Section><Item icon={<QrCodeIcon />}>Pair a device</Item><Item icon={<PlusIcon />}>Add server</Item></Section></Menu>
      <Menu><Section><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Section></Menu>
    </div>),
  ] },
  { title: "Phone popovers", note: "the app's own, rebuilt, in a phone layout; submenus open as panels over the dimmed parent", layout: "phone", atoms: [
    lib("p-plus", "+ menu", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16">
      <Section title="Profile"><Item icon={<HarnessMark id="conduit" class="size-4" />} opens>Assistant</Item></Section>
      <Section title="Model"><Item opens>Meta: Muse Spark 1.3 Contributor</Item></Section>
      <Section kind="slider"><Levels label="Effort" /></Section>
      <Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section>
      <Section title="Project"><Item icon={<PlaceGlyph project={null} />} opens>Add to a project folder</Item></Section>
    </Menu>),
    lib("p-models", "+ menu › Model", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><ModelList title="Model" /></Menu>),
    lib("p-profiles", "+ menu › Profile", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><Profiles /></Menu>),
    lib("p-effort", "+ menu › Effort", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w12"><Section title="Effort"><For each={thinking}>{(level) => <Item checked={level.value === "medium"}>{level.label}</Item>}</For></Section></Menu>),
    lib("p-projects", "+ menu › Project", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><Projects /></Menu>),
    lib("p-chat", "Chat menu", "phone", "popover", "chat/chat-screen.tsx", () => <Menu class="g-w16"><ChatTitle /><Section><Item icon={<RefreshCwIcon />}>Update app</Item></Section><Section><Item icon={<Columns2Icon />}>Workspace panel</Item><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>),
  ] },
  { title: "Cards", note: "the popover's frost at dialog padding", atoms: [
    lib("confirm", "Confirm", "both", "card", "Card", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" actions={<><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></>} />),
    lib("prompt", "Prompt", "both", "card", "Card + Input", () => <Card title="Rename chat" class="g-card" actions={<><Button variant="outline">Cancel</Button><Button>Save</Button></>}><Input value="Lorem ipsum file" /></Card>),
  ] },
  { title: "Frost on the page", note: "frost resting on the transcript, not floating", atoms: [
    lib("bubble", "User message", "both", "frost", "Bubble", () => <div style={{ width: "240px" }}><Bubble>write a .txt file with lorem ipsum</Bubble></div>),
    lib("pill", "Pill", "phone", "frost", "Pill", () => <div class="g-row"><Pill icons={[{ label: "Menu", icon: <MenuIcon /> }]} /><Pill icons={[{ label: "Menu", icon: <MenuIcon /> }, { label: "New chat", icon: <SquarePenIcon /> }]} /><Pill icons={[{ label: "Search", icon: <SearchIcon /> }, { label: "Folder", icon: <FolderIcon /> }, { label: "Share", icon: <ShareIcon /> }]} /></div>),
    lib("seg-pill", "Segmented · pill (sidebar)", "phone", "frost", "Segmented pill", () => <SegmentedIcons pill />),
    lib("frost", "Frost material", "both", "material", "Frost", () => <Frost class="g-swatch" />),
  ] },
  { title: "Controls", note: "each on every surface it sits on", atoms: [
    lib("buttons", "Button", "both", "control", "Button variant size", () => <Surfaces>{() => <div class="g-row"><Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button></div>}</Surfaces>),
    lib("segmented", "Segmented choice", "both", "control", "Segmented", () => <Surfaces frame>{() => <div class="g-field"><SegmentedText /><SegmentedCount /><SegmentedIcons /></div>}</Surfaces>),
    lib("input", "Input", "both", "control", "Input", () => <Surfaces>{() => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>}</Surfaces>),
    lib("select", "Select", "both", "control", "SelectTrigger bare", () => <Surfaces>{() => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>}</Surfaces>),
    lib("icon-button", "Icon button", "both", "control", "Button size=icon-sm", () => <Surfaces>{() => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button><Button variant="outline" size="icon" aria-label="Add"><PlusIcon /></Button></div>}</Surfaces>),
    lib("slider", "Slider", "both", "control", "Slider", () => <div style={{ width: "240px" }}><Levels /></div>),
    lib("switch", "Switch", "both", "control", "Switch", () => <SwitchDemo />),
    lib("keycap", "Keycap", "desktop", "control", "Keycap", () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap><Keycap>Esc</Keycap></div>),
    lib("spinner", "Spinner", "both", "control", "Spinner", () => <Spinner />),
  ] },
];
