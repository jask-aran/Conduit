import { createSignal, For, type JSX } from "solid-js";
import { CopyIcon, FolderIcon, LayoutDashboardIcon, MenuIcon, MonitorIcon, PaperclipIcon, PencilIcon, PlusIcon, SearchIcon, ShareIcon, SquarePenIcon, Trash2Icon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import { Bubble, Button, Card, Frost, Input, Item, Keycap, Menu, Pill, SearchSection, Section, Segmented, SelectTrigger } from "@/components/ui";
import { StepSlider } from "../client/chat/step-slider";
import { Switch } from "../client/settings/settings-controls";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import type { Atom } from "./atoms";
import { MODELS, PROFILES, PROJECTS } from "./seed";

/*
 * The unified library, most-used first, in the order a popover is built:
 *
 *   Popover   frost, holding sections
 *   Section   a list, a search or a slider, with an optional title
 *   Item      a list's entry; icon, meta, keys and submenu are its parts
 *   Submenu   a popover built the same way, opened from an item
 *
 * then cards and the phone's frosted pieces, then the controls, each shown on
 * every surface it sits on.
 */

const lib = (id: string, name: string, source: string, render: Atom["render"]): Atom => ({ id: `ui-${id}`, name, scope: "both", kind: "component", source, render });
/** side: each piece drawn at desktop and phone density side by side, whatever the toggle says. */
export interface Group { title: string; note: string; atoms: Atom[]; side?: boolean }

const effort = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
function Effort() { const [value, setValue] = createSignal("medium"); return <StepSlider label="Effort" options={effort} value={value()} onChange={setValue} />; }
function SwitchDemo() { const [on, setOn] = createSignal(true); return <Switch label="Example" checked={on()} onChange={setOn} />; }
function SegmentedText() { const [value, setValue] = createSignal("cloud"); return <Segmented label="Source" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />; }
function SegmentedCount() { const [value, setValue] = createSignal("all"); return <Segmented label="Show" value={value()} onChange={setValue} options={[{ value: "all", label: "All", count: 0 }, { value: "unread", label: "Unread", count: 0 }]} />; }
const areas = () => [{ value: "dashboard", label: "Dashboard", icon: <LayoutDashboardIcon /> }, { value: "computer", label: "Computer", icon: <MonitorIcon /> }];
function SegmentedIcons(props: { pill?: boolean }) { const [value, setValue] = createSignal("dashboard"); return <Segmented icons pill={props.pill} label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }
const Models = () => <SearchSection placeholder="Search all models…" items={MODELS} matches={(model, needle) => model.label.toLowerCase().includes(needle)}>
  {(model) => <Item meta={model.provider} checked={model === MODELS[2]}>{model.label}</Item>}
</SearchSection>;

/** The same piece on each surface it sits on: the frame (sidebar), the ground (chat, dashboard) and frost. */
function Surfaces(props: { frame?: boolean; children: () => JSX.Element }) {
  return <div class="g-surfaces">
    {props.frame && <div class="g-surface" data-surface="frame"><small>frame</small>{props.children()}</div>}
    <div class="g-surface" data-surface="ground"><small>ground</small>{props.children()}</div>
    <Frost lift="raised" class="g-surface"><small>frost</small>{props.children()}</Frost>
  </div>;
}

export const libraryGroups: Group[] = [
  { title: "Popover", note: "frost → sections → items; a submenu is another popover", atoms: [
    lib("anatomy", "Popover · anatomy", "Menu > Section > Item", () => <div class="g-anatomy"><Menu>
      <Section title="Section · list"><Item icon={<PaperclipIcon />}>Item</Item><Item meta="meta">Item</Item><Item opens>Item that opens a submenu</Item></Section>
      <Section kind="slider"><Effort /></Section>
      <Section title="Section · search"><input class="ui-search" placeholder="Search…" /><Item>Item</Item></Section>
    </Menu></div>),
    lib("section-list", "Section · list", "Section", () => <Menu><Section title="Project" note="5"><For each={PROJECTS.slice(2, 6)}>{(project) => <Item icon={<PlaceGlyph project={project} />}>{project.name}</Item>}</For></Section><Section><Item icon={<PlusIcon />}>New project</Item></Section></Menu>),
    lib("section-search", "Section · search", "SearchSection", () => <Menu class="g-search"><Models /></Menu>),
    lib("section-slider", "Section · slider", "Section kind=slider", () => <Menu><Section title="Reasoning" kind="slider"><Effort /></Section></Menu>),
    lib("item", "Item · parts and states", "Item icon meta keys opens · checked disabled destructive", () => <Menu><Section>
      <Item>Plain</Item>
      <Item icon={<PaperclipIcon />}>icon</Item>
      <Item meta="xai">meta</Item>
      <Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>keys</Item>
      <Item opens>opens a submenu</Item>
      <Item checked>checked</Item>
      <Item disabled meta="offline">disabled</Item>
      <Item icon={<Trash2Icon />} destructive>destructive</Item>
    </Section></Menu>),
    lib("submenu", "Submenu", "Menu beside Item opens", () => <div class="g-row g-top g-submenu">
      <Menu><Section title="Servers"><Item checked>Desktop-Dev</Item><Item checked={false}>Laptop</Item></Section><Section><Item opens active>Route</Item><Item>Manage settings</Item><Item>Sign out</Item></Section></Menu>
      <Menu><Section><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Section></Menu>
    </div>),
  ] },
  { title: "Popovers in the app", note: "desktop and phone side by side, the same pieces at two densities", side: true, atoms: [
    lib("plus", "+ menu", "Menu", () => <Menu><Section title="Profile" note="12% context"><Item icon={<HarnessMark id="conduit" class="size-4" />} opens>Assistant</Item></Section><Section title="Model"><Item opens>Muse Spark 1.3</Item></Section><Section kind="slider"><Effort /></Section></Menu>),
    lib("profiles", "Profile picker", "Menu", () => <Menu><Section title="Profile"><For each={PROFILES}>{(profile, index) => <Item checked={index() === 0} icon={<HarnessMark id={profile.implementation || "conduit"} class="size-4" />} meta={profile.implementation}>{profile.label}</Item>}</For></Section></Menu>),
    lib("server", "Server menu", "Menu", () => <Menu><Section title="Servers"><Item checked>Desktop-Dev</Item><Item checked={false}>Laptop</Item></Section><Section><Item opens>Route</Item><Item>Manage settings</Item><Item>Sign out</Item></Section></Menu>),
    lib("models", "Model picker", "Menu + SearchSection", () => <Menu class="g-search"><Models /></Menu>),
    lib("chat", "Chat menu", "Menu", () => <Menu><Section title="Lorem ipsum file"><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<CopyIcon />}>Copy link</Item></Section><Section><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>),
  ] },
  { title: "Cards", note: "the popover's frost at dialog padding", atoms: [
    lib("confirm", "Confirm", "Card", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" actions={<><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></>} />),
    lib("prompt", "Prompt", "Card + Input", () => <Card title="Rename chat" class="g-card" actions={<><Button variant="outline">Cancel</Button><Button>Save</Button></>}><Input value="Lorem ipsum file" /></Card>),
  ] },
  { title: "Frost on the page", note: "frost resting on the transcript, not floating", atoms: [
    lib("bubble", "User message", "Bubble", () => <div style={{ width: "240px" }}><Bubble>write a .txt file with lorem ipsum</Bubble></div>),
    lib("pill", "Pill", "Pill", () => <div class="g-row"><Pill icons={[{ label: "Menu", icon: <MenuIcon /> }]} /><Pill icons={[{ label: "Menu", icon: <MenuIcon /> }, { label: "New chat", icon: <SquarePenIcon /> }]} /><Pill icons={[{ label: "Search", icon: <SearchIcon /> }, { label: "Folder", icon: <FolderIcon /> }, { label: "Share", icon: <ShareIcon /> }]} /></div>),
    lib("seg-pill", "Segmented · pill (phone sidebar)", "Segmented pill", () => <SegmentedIcons pill />),
    lib("frost", "Frost material", "Frost", () => <Frost class="g-swatch" />),
  ] },
  { title: "Controls", note: "each on every surface it sits on", atoms: [
    lib("buttons", "Button", "Button variant size", () => <Surfaces>{() => <div class="g-row"><Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button></div>}</Surfaces>),
    lib("segmented", "Segmented choice", "Segmented", () => <Surfaces frame>{() => <div class="g-field"><SegmentedText /><SegmentedCount /><SegmentedIcons /></div>}</Surfaces>),
    lib("input", "Input", "Input", () => <Surfaces>{() => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>}</Surfaces>),
    lib("select", "Select", "SelectTrigger bare", () => <Surfaces>{() => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>}</Surfaces>),
    lib("icon-button", "Icon button", "Button size=icon-sm", () => <Surfaces>{() => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button><Button variant="outline" size="icon" aria-label="Add"><PlusIcon /></Button></div>}</Surfaces>),
    lib("switch", "Switch", "Switch", () => <SwitchDemo />),
    lib("slider", "Slider", "StepSlider", () => <div style={{ width: "220px" }}><Effort /></div>),
    lib("keycap", "Keycap", "Keycap", () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap><Keycap>Esc</Keycap></div>),
    lib("spinner", "Spinner", "Spinner", () => <Spinner />),
  ] },
];
