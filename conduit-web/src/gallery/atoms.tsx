import { createSignal, For, type JSX } from "solid-js";
import { ChevronRightIcon, CopyIcon, FolderIcon, PaperclipIcon, PencilIcon, PlusIcon, SearchIcon, ShareIcon, Trash2Icon } from "lucide-solid";
import { Button, Input, menuContentClass, menuItemClass, menuLabelClass, menuSeparatorClass, PopoverSearchList, Spinner } from "@/components/primitives";
import { Keycap } from "@/components/frost";
import { cn } from "@/lib/utils";
import { StepSlider } from "../client/chat/step-slider";
import { Segmented, Switch } from "../client/settings/settings-controls";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import { headerPill, HeaderActions } from "../client/navigation/header-pill";
import { UserBubble } from "./stories";
import { MODELS, PROFILES, PROJECTS } from "./seed";

/*
 * The atoms: every piece the frosted surfaces are assembled from, each alone,
 * primitives first and assembled pieces last. A menu or popover is a
 * container; inside go sections, which may carry a title; a section is a list
 * of rows, a choice, a slider or a search; rows come in a handful of kinds.
 *
 * Menus are drawn in place with the menu's own classes rather than as live
 * Kobalte menus: thirty open menus each tracking its anchor made the page
 * crawl. The rows take the hover wash; they do not choose.
 */

export type Scope = "both" | "desktop" | "phone";
/** component: a shared component. class: shared CSS, no component. one-off: drawn where it is used. */
export type Kind = string;
export interface Atom { id: string; name: string; scope: Scope; kind: Kind; source: string; render: () => JSX.Element; wide?: boolean }

const hover = (event: PointerEvent, on: boolean) => {
  const row = (event.target as Element).closest?.("[role^='menuitem']");
  if (row) row.toggleAttribute("data-highlighted", on);
};

/** A menu's content, in place. */
export const Menu = (props: { class?: string; children: JSX.Element }) =>
  <div data-slot="menu-content" role="menu" class={cn(menuContentClass, "g-static", props.class)}
    onPointerOver={(event) => hover(event, true)} onPointerOut={(event) => hover(event, false)}>{props.children}</div>;
const Item = (props: { class?: string; disabled?: boolean; destructive?: boolean; checked?: boolean; children: JSX.Element }) =>
  <div role={props.checked !== undefined ? "menuitemradio" : "menuitem"} class={cn(menuItemClass, props.class)} data-disabled={props.disabled ? "" : undefined}
    data-variant={props.destructive ? "destructive" : undefined} data-checked={props.checked ? "" : undefined} aria-disabled={props.disabled || undefined}>{props.children}</div>;
const Label = (props: { class?: string; children: JSX.Element }) => <div class={cn(menuLabelClass, props.class)}>{props.children}</div>;
const Sep = () => <div role="separator" class={menuSeparatorClass} />;
const Sub = (props: { children: JSX.Element }) => <Item>{props.children}<ChevronRightIcon class="menu-chevron" /></Item>;

/** A popover's panel, in place. */
export const Panel = (props: { label: string; class?: string; children: JSX.Element }) =>
  <div data-slot="popover-content" role="dialog" aria-label={props.label} class={cn(menuContentClass, "g-static", props.class)}>{props.children}</div>;

const effortOptions = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
function Slider(props: { button?: boolean }) {
  const [value, setValue] = createSignal("medium");
  return <div style={{ width: "220px" }}><StepSlider label="Effort" options={effortOptions} value={value()} onChange={setValue}
    valueControl={props.button ? (label) => <button type="button" class="step-slider-value">{label()}<ChevronRightIcon /></button> : undefined} /></div>;
}
function ModelSearch() {
  const [current, setCurrent] = createSignal(MODELS[2]!.spec);
  return <PopoverSearchList items={MODELS.slice(0, 5)} placeholder="Search all models…" matches={(item, needle) => item.label.toLowerCase().includes(needle)}
    isCurrent={(item) => item.spec === current()} onChoose={(item) => setCurrent(item.spec)}>
    {(item) => <><span class="truncate">{item.label}</span><span class="ml-auto text-xs text-muted-foreground">{item.provider}</span></>}
  </PopoverSearchList>;
}
function SegmentedDemo() {
  const [value, setValue] = createSignal("fade");
  return <Segmented label="Streaming" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "fade", label: "Fade" }, { value: "type", label: "Type" }]} />;
}
function SwitchDemo() { const [on, setOn] = createSignal(true); return <Switch label="Example" checked={on()} onChange={setOn} />; }

function Pill(props: { side: "leading" | "actions"; children: JSX.Element }) {
  const pill = headerPill();
  return props.side === "actions" ? <HeaderActions>{props.children}</HeaderActions>
    : <div class={`mobile-header-leading ${pill().class ?? ""}`} data-composer-surface={pill()["data-composer-surface"]}>{props.children}</div>;
}
const Icon = (props: { label: string; children: JSX.Element }) => <Button variant="ghost" size="icon-sm" aria-label={props.label}>{props.children}</Button>;

export const atoms: Atom[] = [
  // Primitives.
  { id: "material", name: "Frost material", scope: "both", kind: "class", source: ".composer-surface-material", render: () => <div class="g-swatch composer-surface-material" data-composer-surface="frosted-live" /> },
  { id: "buttons", name: "Buttons", scope: "both", kind: "component", source: "Button", render: () => <div class="g-row"><Button>Default</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button></div> },
  { id: "icon-button", name: "Icon button", scope: "both", kind: "component", source: "Button size=icon-sm", render: () => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button></div> },
  { id: "input", name: "Input", scope: "both", kind: "component", source: "Input", render: () => <div style={{ width: "200px" }}><Input placeholder="My project" /></div> },
  { id: "switch", name: "Switch", scope: "both", kind: "component", source: "Switch", render: () => <SwitchDemo /> },
  { id: "segmented", name: "Segmented choice", scope: "both", kind: "component", source: "Segmented", render: () => <SegmentedDemo /> },
  { id: "keycap", name: "Keycap", scope: "desktop", kind: "component", source: "Keycap", render: () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>G</Keycap><Keycap>Esc</Keycap></div> },
  { id: "spinner", name: "Spinner", scope: "both", kind: "component", source: "Spinner", render: () => <Spinner /> },

  // Containers.
  { id: "menu-container", name: "Menu", scope: "both", kind: "component", source: "MenuContent", render: () => <Menu><div style={{ width: "160px", height: "56px" }} /></Menu> },
  { id: "popover-container", name: "Popover", scope: "both", kind: "component", source: "PopoverContent", render: () => <Panel label="Popover"><div style={{ width: "160px", height: "56px" }} /></Panel> },
  { id: "card", name: "Overlay card", scope: "both", kind: "class", source: ".frost-card", render: () => <div class="frost-card" style={{ width: "200px", height: "80px" }} /> },
  { id: "bubble", name: "User message", scope: "both", kind: "one-off", source: "chat/transcript.tsx", render: () => <div style={{ width: "240px" }}><UserBubble text="write a .txt file with lorem ipsum" /></div> },

  // Section pieces.
  { id: "title", name: "Section title", scope: "both", kind: "component", source: "MenuLabel", render: () => <Menu><Label>Servers</Label></Menu> },
  { id: "separator", name: "Separator", scope: "both", kind: "component", source: "MenuSeparator", render: () => <Menu><div style={{ width: "150px" }}><Sep /></div></Menu> },

  // Rows.
  { id: "row", name: "Row", scope: "both", kind: "component", source: "MenuItem", render: () => <Menu><Item>Manage settings</Item></Menu> },
  { id: "row-icon", name: "Row · icon", scope: "both", kind: "component", source: "MenuItem", render: () => <Menu><Item><PaperclipIcon />Attach files</Item></Menu> },
  { id: "row-meta", name: "Row · meta", scope: "both", kind: "component", source: "MenuItem", render: () => <Menu><Item><span>Grok 4.6</span><span class="ml-auto text-xs text-muted-foreground">xai</span></Item></Menu> },
  { id: "row-keycap", name: "Row · keycap", scope: "desktop", kind: "component", source: "MenuItem + Keycap", render: () => <Menu><Item><SearchIcon />Search<span class="ml-auto"><Keycap>Ctrl</Keycap> <Keycap>K</Keycap></span></Item></Menu> },
  { id: "row-sub", name: "Row · submenu", scope: "desktop", kind: "component", source: "MenuSubTrigger", render: () => <Menu><Sub>Route</Sub></Menu> },
  { id: "row-value", name: "Row · value", scope: "both", kind: "one-off", source: ".composer-options-value", render: () => <Menu><Item class="composer-options-value"><HarnessMark id="conduit" class="size-4" /><span>Assistant</span><ChevronRightIcon /></Item></Menu> },
  { id: "row-place", name: "Row · place", scope: "both", kind: "component", source: "PlaceGlyph", render: () => <Menu><For each={[PROJECTS[0]!, PROJECTS[4]!, PROJECTS[6]!]}>{(project) => <Item><PlaceGlyph project={project} /><span>{project.name}</span></Item>}</For></Menu> },
  { id: "row-current", name: "Row · current", scope: "both", kind: "component", source: "MenuRadioItem", render: () => <Menu><Item checked>Muse Spark 1.3</Item><Item checked={false}>Grok 4.6</Item></Menu> },
  { id: "row-disabled", name: "Row · unavailable", scope: "both", kind: "component", source: "MenuItem disabled", render: () => <Menu><Item disabled>Laptop</Item></Menu> },
  { id: "row-destructive", name: "Row · destructive", scope: "both", kind: "component", source: "MenuItem variant", render: () => <Menu><Item destructive><Trash2Icon />Delete</Item></Menu> },
  { id: "row-busy", name: "Row · working", scope: "both", kind: "component", source: "MenuItem + Spinner", render: () => <Menu><Item disabled><Spinner class="size-3" />Checking…</Item></Menu> },
  { id: "row-plain", name: "Row outside a menu", scope: "both", kind: "class", source: ".menu-row", render: () => <Panel label="Rows"><button type="button" class="menu-row">Japan</button><button type="button" class="menu-row" data-checked>NHP</button></Panel> },

  // Sections.
  { id: "section-list", name: "List section", scope: "both", kind: "component", source: "MenuGroup", render: () => <Menu><Label>Servers</Label><Item>Desktop-Dev</Item><Item>Laptop</Item></Menu> },
  { id: "section-choice", name: "Choice section", scope: "both", kind: "component", source: "MenuRadioGroup", render: () => <Menu><Label>Profile</Label><For each={PROFILES.slice(0, 3)}>{(profile, index) => <Item checked={index() === 0}>{profile.label}</Item>}</For></Menu> },
  { id: "section-slider", name: "Slider section", scope: "both", kind: "component", source: "StepSlider", render: () => <Panel label="Effort"><Slider /></Panel> },
  { id: "section-slider-levels", name: "Slider · opens levels", scope: "both", kind: "component", source: "StepSlider valueControl", render: () => <Panel label="Effort"><Slider button /></Panel> },
  { id: "section-search", name: "Search section", scope: "both", kind: "component", source: "PopoverSearchList", render: () => <Panel label="Models" class="g-search"><ModelSearch /></Panel> },
  { id: "section-footer", name: "Footer action", scope: "both", kind: "component", source: "MenuItem under a separator", render: () => <Menu><Item>Chat one</Item><Sep /><Item><PlusIcon />New project</Item></Menu> },

  // Assembled.
  { id: "server-menu", name: "Server menu", scope: "both", kind: "component", source: "server-switcher.tsx", render: () => <div class="g-row g-top"><Menu><Label>Servers</Label><Item checked>Desktop-Dev</Item><Item checked={false}>Laptop</Item><Sep /><Sub>Route</Sub><Item>Manage settings</Item><Item>Sign out</Item></Menu><Menu><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Menu></div> },
  { id: "chat-menu", name: "Chat menu", scope: "both", kind: "component", source: "chat-screen.tsx", render: () => <Menu><Label>Lorem ipsum file</Label><Sep /><Item><ShareIcon />Share</Item><Item><PencilIcon />Rename</Item><Item destructive><Trash2Icon />Delete</Item></Menu> },
  { id: "model-picker", name: "Model picker", scope: "both", kind: "component", source: "PopoverSearchList", render: () => <Panel label="Models" class="g-search"><ModelSearch /></Panel> },
  { id: "dialog", name: "Confirm dialog", scope: "both", kind: "component", source: "FrostDialog", render: () => <div class="frost-card g-card-demo"><strong>Delete this chat?</strong><div class="g-row"><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></div></div> },
  { id: "prompt", name: "Prompt dialog", scope: "both", kind: "component", source: "FrostDialog + Input", render: () => <div class="frost-card g-card-demo"><strong>Rename chat</strong><Input value="Lorem ipsum file" /><div class="g-row"><Button variant="outline">Cancel</Button><Button>Save</Button></div></div> },
];

/** Phone-only atoms, in a frame that passes for a phone, where their styles apply. Primitives first. */
export const phoneAtoms: Atom[] = [
  { id: "pill-one", name: "Pill · one icon", scope: "phone", kind: "one-off", source: "header-pill.tsx", render: () => <Pill side="leading"><Icon label="Add"><PlusIcon /></Icon></Pill> },
  { id: "pill-many", name: "Pill · several icons", scope: "phone", kind: "one-off", source: "header-pill.tsx", render: () => <Pill side="actions"><Icon label="Search"><SearchIcon /></Icon><Icon label="Folder"><FolderIcon /></Icon><Icon label="Share"><ShareIcon /></Icon></Pill> },
  { id: "phone-bubble", name: "User message", scope: "phone", kind: "one-off", source: "chat/transcript.tsx", render: () => <div style={{ width: "170px" }}><UserBubble text="make it shorter" /></div> },
  { id: "plus-header", name: "+ menu · title", scope: "phone", kind: "one-off", source: ".composer-options-header", render: () => <Menu class="composer-options-menu g-phone-menu"><Label class="composer-options-label composer-options-header"><span>Profile</span><span class="composer-options-context">12% context</span></Label></Menu> },
  { id: "plus-value", name: "+ menu · value row", scope: "phone", kind: "one-off", source: ".composer-options-value", render: () => <Menu class="composer-options-menu g-phone-menu"><Label class="composer-options-label">Model</Label><Item class="composer-options-value composer-options-model"><span>Muse Spark 1.3</span><ChevronRightIcon /></Item></Menu> },
  { id: "plus-slider", name: "+ menu · slider", scope: "phone", kind: "one-off", source: "StepSlider", render: () => <Menu class="composer-options-menu g-phone-menu"><Slider button /></Menu> },
  { id: "plus-models", name: "+ menu · models", scope: "phone", kind: "one-off", source: ".composer-model-menu", render: () => <Menu class="composer-options-menu g-phone-menu"><Item><SearchIcon /><span>Search all models…</span></Item><Sep /><Label class="composer-options-label">Model</Label><For each={MODELS.slice(0, 4)}>{(item, index) => <Item checked={index() === 2} class="composer-model-option"><span>{item.label}</span><small>{item.provider}</small></Item>}</For></Menu> },
  { id: "plus-places", name: "+ menu · projects", scope: "phone", kind: "one-off", source: ".composer-places-menu", render: () => <Menu class="composer-options-menu g-phone-menu"><Label class="composer-options-label">Project</Label><For each={PROJECTS.slice(2, 7)}>{(project) => <Item><PlaceGlyph project={project} /><span>{project.name}</span></Item>}</For></Menu> },
  { id: "plus-profiles", name: "+ menu · profiles", scope: "phone", kind: "one-off", source: ".composer-profile-menu", render: () => <Menu class="composer-options-menu g-phone-menu"><Label class="composer-options-label">Profile</Label><For each={PROFILES}>{(item) => <Item><HarnessMark id={item.implementation || "conduit"} class="size-4" /><span class="composer-profile-copy"><span>{item.label}</span><small>{item.implementation}</small></span></Item>}</For></Menu> },
];
