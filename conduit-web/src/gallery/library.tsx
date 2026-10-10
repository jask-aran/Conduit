import { createSignal, For, type JSX } from "solid-js";
import { CopyIcon, FolderIcon, MessagesSquareIcon, MonitorIcon, MenuIcon, PaperclipIcon, PencilIcon, PlusIcon, SearchIcon, ShareIcon, SquarePenIcon, Trash2Icon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import { Bubble, Button, Card, Input, Segmented, SelectTrigger, Frost, Item, Keycap, Menu, Pill, SearchSection, Section } from "@/components/ui";
import { StepSlider } from "../client/chat/step-slider";
import { Switch } from "../client/settings/settings-controls";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import type { Atom } from "./atoms";
import { MODELS, PROFILES, PROJECTS } from "./seed";

/*
 * The unified library, primitives first. A menu holds sections; a section is
 * a list, a search or a slider and may have a title; an item's icon, meta,
 * keys and submenu chevron are its parts, not pieces of their own.
 */

const lib = (id: string, name: string, source: string, render: Atom["render"]): Atom => ({ id: `ui-${id}`, name, scope: "both", kind: "component", source, render });

const effort = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
function Effort() { const [value, setValue] = createSignal("medium"); return <StepSlider label="Effort" options={effort} value={value()} onChange={setValue} />; }
function SegmentedDemo() { const [value, setValue] = createSignal("cloud"); return <Segmented label="Source" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />; }
function SegmentedPill() { const [value, setValue] = createSignal("chats"); return <Segmented pill label="Sidebar section" value={value()} onChange={setValue} options={[{ value: "chats", label: "Chats", icon: <MessagesSquareIcon /> }, { value: "computer", label: "Computer", icon: <MonitorIcon /> }]} />; }

/** The same piece on each surface it sits on, side by side. */
function Surfaces(props: { ground?: boolean; frost?: boolean; children: () => JSX.Element }) {
  return <div class="g-surfaces">
    {props.ground !== false && <div class="g-surface" data-surface="ground"><small>ground</small>{props.children()}</div>}
    {props.frost !== false && <Frost lift="raised" class="g-surface"><small>frost</small>{props.children()}</Frost>}
  </div>;
}
function SwitchDemo() { const [on, setOn] = createSignal(true); return <Switch label="Example" checked={on()} onChange={setOn} />; }
const Models = () => <SearchSection placeholder="Search all models…" items={MODELS} matches={(model, needle) => model.label.toLowerCase().includes(needle)}>
  {(model) => <Item meta={model.provider} checked={model === MODELS[2]}>{model.label}</Item>}
</SearchSection>;

export const libraryAtoms: Atom[] = [
  // Primitives.
  lib("frost", "Frost", "Frost", () => <Frost class="g-swatch" />),
  lib("buttons", "Button", "Button variant size", () => <Surfaces>{() => <div class="g-row"><Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button></div>}</Surfaces>),
  lib("icon-button", "Icon button", "Button size=icon-sm", () => <Surfaces>{() => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button><Button variant="outline" size="icon" aria-label="Add"><PlusIcon /></Button></div>}</Surfaces>),
  lib("input", "Input", "Input", () => <Surfaces>{() => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>}</Surfaces>),
  lib("select", "Select", "SelectTrigger bare", () => <Surfaces>{() => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>}</Surfaces>),
  lib("switch", "Switch", "Switch", () => <SwitchDemo />),
  lib("segmented", "Segmented choice", "Segmented", () => <Surfaces>{() => <SegmentedDemo />}</Surfaces>),
  lib("segmented-pill", "Segmented · pill", "Segmented pill", () => <SegmentedPill />),
  lib("slider", "Slider", "StepSlider", () => <div style={{ width: "220px" }}><Effort /></div>),
  lib("keycap", "Keycap", "Keycap", () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap><Keycap>Esc</Keycap></div>),
  lib("spinner", "Spinner", "Spinner", () => <Spinner />),

  // Containers.
  lib("pill", "Pill", "Pill", () => <div class="g-row"><Pill icons={[{ label: "Menu", icon: <MenuIcon /> }]} /><Pill icons={[{ label: "Menu", icon: <MenuIcon /> }, { label: "New chat", icon: <SquarePenIcon /> }]} /><Pill icons={[{ label: "Search", icon: <SearchIcon /> }, { label: "Folder", icon: <FolderIcon /> }, { label: "Share", icon: <ShareIcon /> }]} /></div>),
  lib("bubble", "User message", "Bubble", () => <div style={{ width: "240px" }}><Bubble>write a .txt file with lorem ipsum</Bubble></div>),
  lib("card", "Card", "Card", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" actions={<><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></>} />),
  lib("menu", "Menu", "Menu", () => <Menu><Section><Item>One section</Item></Section><Section><Item>Another</Item></Section></Menu>),

  // Sections, and the item with each of its parts and states.
  lib("item", "Item · parts and states", "Item icon meta keys opens checked disabled destructive", () => <Menu><Section>
    <Item>Plain</Item>
    <Item icon={<PaperclipIcon />}>icon</Item>
    <Item meta="xai">meta</Item>
    <Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>keys</Item>
    <Item opens>opens</Item>
    <Item checked>checked</Item>
    <Item disabled meta="offline">disabled</Item>
    <Item icon={<Trash2Icon />} destructive>destructive</Item>
  </Section></Menu>),
  lib("section-list", "Section · list", "Section", () => <Menu><Section title="Project" note="5"><For each={PROJECTS.slice(2, 6)}>{(project) => <Item icon={<PlaceGlyph project={project} />}>{project.name}</Item>}</For></Section><Section><Item icon={<PlusIcon />}>New project</Item></Section></Menu>),
  lib("section-search", "Section · search", "SearchSection", () => <Menu class="g-search"><Models /></Menu>),

  // Assembled.
  lib("plus", "+ menu", "Menu", () => <Menu><Section title="Profile" note="12% context"><Item icon={<HarnessMark id="conduit" class="size-4" />} opens>Assistant</Item></Section><Section title="Model"><Item opens>Muse Spark 1.3</Item></Section><Section kind="slider"><Effort /></Section></Menu>),
  lib("profiles", "Profile picker", "Menu", () => <Menu><Section title="Profile"><For each={PROFILES}>{(profile, index) => <Item checked={index() === 0} icon={<HarnessMark id={profile.implementation || "conduit"} class="size-4" />} meta={profile.implementation}>{profile.label}</Item>}</For></Section></Menu>),
  lib("server", "Server menu", "Menu", () => <Menu><Section title="Servers"><Item checked>Desktop-Dev</Item><Item checked={false}>Laptop</Item></Section><Section><Item opens>Route</Item><Item>Manage settings</Item><Item>Sign out</Item></Section></Menu>),
  lib("chat", "Chat menu", "Menu", () => <Menu><Section title="Lorem ipsum file"><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<CopyIcon />}>Copy link</Item></Section><Section><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>),
  lib("prompt", "Prompt card", "Card + Input", () => <Card title="Rename chat" class="g-card" actions={<><Button variant="outline">Cancel</Button><Button>Save</Button></>}><Input value="Lorem ipsum file" /></Card>),
];
