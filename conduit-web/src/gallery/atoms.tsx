import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { ChevronRightIcon, CopyIcon, FolderIcon, PaperclipIcon, PencilIcon, PlusIcon, SearchIcon, ShareIcon, Trash2Icon } from "lucide-solid";
import { Button, Input, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, PopoverSearchList, Spinner } from "@/components/primitives";
import { Keycap } from "@/components/frost";
import { StepSlider } from "../client/chat/step-slider";
import { Segmented, Switch } from "../client/settings/settings-controls";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import { headerPill, HeaderActions } from "../client/navigation/header-pill";
import { UserBubble } from "./stories";
import { MODELS, PROFILES, PROJECTS } from "./seed";

/*
 * The atoms: every piece the frosted surfaces are assembled from, each alone.
 * A popover or menu is a container; inside it go sections, which may carry a
 * title; a section is a list of rows, a slider, or a search; rows come in a
 * handful of kinds. Each atom here is the app's own component or class.
 */

export type Scope = "both" | "desktop" | "phone";
/** component: a shared component. class: shared CSS, no component. one-off: drawn where it is used. */
export type Kind = "component" | "class" | "one-off";
export interface Atom { id: string; name: string; group: string; scope: Scope; kind: Kind; source: string; render: () => JSX.Element }

/**
 * A real menu held open where it is drawn. Its content floats (Kobalte portals
 * it), so the slot measures the content and keeps that much room.
 */
export function Held(props: { class?: string; children: JSX.Element }) {
  let trigger!: HTMLElement;
  let slot!: HTMLDivElement;
  onMount(() => {
    let observer: ResizeObserver | undefined;
    const find = () => {
      const content = document.getElementById(trigger.getAttribute("aria-controls") || "");
      if (!content) return void requestAnimationFrame(find);
      observer = new ResizeObserver(() => { slot.style.width = `${content.offsetWidth}px`; slot.style.height = `${content.offsetHeight}px`; });
      observer.observe(content);
    };
    find();
    onCleanup(() => observer?.disconnect());
  });
  return <div ref={slot} class="g-held">
    <KMenu open modal={false} placement="bottom-start" gutter={0} flip={false} slide={false} hideWhenDetached>
      <KMenu.Trigger ref={trigger} as="span" class="g-anchor" />
      <MenuContent class={props.class} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}><MenuGroup>{props.children}</MenuGroup></MenuContent>
    </KMenu>
  </div>;
}

/** A popover's panel drawn in place: the slot and material, without floating. */
export const Panel = (props: { label: string; class?: string; children: JSX.Element }) =>
  <div data-slot="popover-content" role="dialog" aria-label={props.label} class={`g-panel-inline ${props.class ?? ""}`}>{props.children}</div>;

const effortOptions = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));

function Slider(props: { button?: boolean }) {
  const [value, setValue] = createSignal("medium");
  return <div style={{ width: "240px" }}><StepSlider label="Effort" options={effortOptions} value={value()} onChange={setValue}
    valueControl={props.button ? (label) => <button type="button" class="step-slider-value">{label()}<ChevronRightIcon /></button> : undefined} /></div>;
}

function ModelSearch() {
  const [current, setCurrent] = createSignal(MODELS[2]!.spec);
  return <PopoverSearchList items={MODELS} placeholder="Search all models…" matches={(item, needle) => item.label.toLowerCase().includes(needle)}
    isCurrent={(item) => item.spec === current()} onChoose={(item) => setCurrent(item.spec)}>
    {(item) => <><span class="truncate">{item.label}</span><span class="ml-auto text-xs text-muted-foreground">{item.provider}</span></>}
  </PopoverSearchList>;
}

function Radio() {
  const [value, setValue] = createSignal(PROFILES[0]!.id);
  return <MenuRadioGroup value={value()} onChange={setValue}><For each={PROFILES.slice(0, 3)}>{(profile) =>
    <MenuRadioItem value={profile.id} closeOnSelect={false}>{profile.label}</MenuRadioItem>}</For></MenuRadioGroup>;
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
  // The material, and what wears it directly.
  { id: "material", name: "Frost material", group: "Material", scope: "both", kind: "class", source: ".composer-surface-material", render: () => <div class="g-swatch composer-surface-material" data-composer-surface="frosted-live" /> },
  { id: "bubble", name: "User message", group: "Material", scope: "both", kind: "one-off", source: "chat/transcript.tsx", render: () => <div style={{ width: "320px" }}><UserBubble text="write a .txt file in this folder that contains lorem ipsum text" /></div> },

  // Containers.
  { id: "menu-container", name: "Menu", group: "Container", scope: "both", kind: "component", source: "MenuContent", render: () => <Held><div style={{ width: "180px", height: "60px" }} /></Held> },
  { id: "popover-container", name: "Popover", group: "Container", scope: "both", kind: "component", source: "PopoverContent", render: () => <Panel label="Popover"><div style={{ width: "180px", height: "60px" }} /></Panel> },
  { id: "card", name: "Overlay card", group: "Container", scope: "both", kind: "class", source: ".frost-card", render: () => <div class="frost-card g-card-demo" style={{ height: "80px" }} /> },

  // Section titles and dividers.
  { id: "title", name: "Section title", group: "Section", scope: "both", kind: "component", source: "MenuLabel", render: () => <Held><MenuGroup><MenuLabel>Servers</MenuLabel></MenuGroup></Held> },
  { id: "separator", name: "Separator", group: "Section", scope: "both", kind: "component", source: "MenuSeparator", render: () => <Held><div style={{ width: "160px" }}><MenuSeparator /></div></Held> },

  // Section types.
  { id: "section-list", name: "List section", group: "Section", scope: "both", kind: "component", source: "MenuGroup + MenuItem", render: () => <Held><MenuGroup><MenuLabel>Servers</MenuLabel><MenuItem closeOnSelect={false}>Desktop-Dev</MenuItem><MenuItem closeOnSelect={false}>Laptop</MenuItem></MenuGroup></Held> },
  { id: "section-radio", name: "Choice section", group: "Section", scope: "both", kind: "component", source: "MenuRadioGroup", render: () => <Held><MenuGroup><MenuLabel>Profile</MenuLabel><Radio /></MenuGroup></Held> },
  { id: "section-slider", name: "Slider section", group: "Section", scope: "both", kind: "component", source: "StepSlider", render: () => <Panel label="Effort"><Slider /></Panel> },
  { id: "section-slider-menu", name: "Slider · value opens levels", group: "Section", scope: "both", kind: "component", source: "StepSlider valueControl", render: () => <Panel label="Effort"><Slider button /></Panel> },
  { id: "section-search", name: "Search section", group: "Section", scope: "both", kind: "component", source: "PopoverSearchList", render: () => <Panel label="Models" class="g-search"><ModelSearch /></Panel> },
  { id: "section-footer", name: "Footer action", group: "Section", scope: "both", kind: "component", source: "MenuSeparator + MenuItem", render: () => <Held><MenuItem closeOnSelect={false}>Chat one</MenuItem><MenuSeparator /><MenuItem closeOnSelect={false}><PlusIcon />New project</MenuItem></Held> },

  // Row kinds.
  { id: "row", name: "Row", group: "Row", scope: "both", kind: "component", source: "MenuItem", render: () => <Held><MenuItem closeOnSelect={false}>Manage settings</MenuItem></Held> },
  { id: "row-icon", name: "Row · leading icon", group: "Row", scope: "both", kind: "component", source: "MenuItem", render: () => <Held><MenuItem closeOnSelect={false}><PaperclipIcon />Attach files</MenuItem></Held> },
  { id: "row-meta", name: "Row · meta at the right", group: "Row", scope: "both", kind: "component", source: "MenuItem", render: () => <Held><MenuItem closeOnSelect={false}><span>Grok 4.6</span><span class="ml-auto text-xs text-muted-foreground">xai</span></MenuItem></Held> },
  { id: "row-keycap", name: "Row · keycap", group: "Row", scope: "desktop", kind: "component", source: "MenuItem + Keycap", render: () => <Held><MenuItem closeOnSelect={false}><SearchIcon />Search chats<span class="ml-auto"><Keycap>Ctrl</Keycap> <Keycap>K</Keycap></span></MenuItem></Held> },
  { id: "row-sub", name: "Row · opens a submenu", group: "Row", scope: "desktop", kind: "component", source: "MenuSubTrigger", render: () => <Held><MenuSub><MenuSubTrigger>Route</MenuSubTrigger><MenuSubContent><MenuItem closeOnSelect={false}>Automatic</MenuItem><MenuItem closeOnSelect={false}>Local network</MenuItem></MenuSubContent></MenuSub></Held> },
  { id: "row-value", name: "Row · value and chevron", group: "Row", scope: "both", kind: "one-off", source: ".composer-options-value", render: () => <Held><MenuItem closeOnSelect={false} class="composer-options-value"><HarnessMark id="conduit" class="size-4" /><span>Assistant</span><ChevronRightIcon /></MenuItem></Held> },
  { id: "row-place", name: "Row · place", group: "Row", scope: "both", kind: "component", source: "PlaceGlyph", render: () => <Held><For each={PROJECTS.slice(3, 6)}>{(project) => <MenuItem closeOnSelect={false}><PlaceGlyph project={project} /><span>{project.name}</span></MenuItem>}</For></Held> },
  { id: "row-current", name: "Row · current (bold)", group: "Row", scope: "both", kind: "component", source: "MenuRadioItem", render: () => <Held><MenuRadioGroup value="a"><MenuRadioItem value="a" closeOnSelect={false}>Muse Spark 1.3</MenuRadioItem></MenuRadioGroup></Held> },
  { id: "row-disabled", name: "Row · unavailable", group: "Row", scope: "both", kind: "component", source: "MenuItem disabled", render: () => <Held><MenuItem disabled>Laptop</MenuItem></Held> },
  { id: "row-destructive", name: "Row · destructive", group: "Row", scope: "both", kind: "component", source: "MenuItem variant", render: () => <Held><MenuItem variant="destructive" closeOnSelect={false}><Trash2Icon />Delete</MenuItem></Held> },
  { id: "row-busy", name: "Row · working", group: "Row", scope: "both", kind: "component", source: "MenuItem + Spinner", render: () => <Held><MenuItem disabled><Spinner class="size-3" />Checking for updates…</MenuItem></Held> },
  { id: "row-plain", name: "Row outside a menu", group: "Row", scope: "both", kind: "class", source: ".menu-row", render: () => <Panel label="Rows"><button type="button" class="menu-row">Japan</button><button type="button" class="menu-row" data-highlighted>Engie</button><button type="button" class="menu-row" data-checked>NHP</button></Panel> },

  // Assembled.
  { id: "menu-full", name: "Server menu", group: "Assembled", scope: "both", kind: "component", source: "server-switcher.tsx", render: () => <Held><MenuGroup><MenuLabel>Servers</MenuLabel><MenuItem closeOnSelect={false}>Desktop-Dev</MenuItem><MenuItem closeOnSelect={false}>Laptop</MenuItem></MenuGroup><MenuSeparator /><MenuSub><MenuSubTrigger>Route</MenuSubTrigger><MenuSubContent><MenuItem closeOnSelect={false}>Automatic</MenuItem><MenuItem closeOnSelect={false}>Internet</MenuItem></MenuSubContent></MenuSub><MenuItem closeOnSelect={false}>Manage settings</MenuItem><MenuItem closeOnSelect={false}>Sign out</MenuItem></Held> },
  { id: "chat-menu", name: "Chat menu", group: "Assembled", scope: "both", kind: "component", source: "chat-screen.tsx", render: () => <Held><MenuGroup><MenuLabel>Lorem ipsum file</MenuLabel></MenuGroup><MenuSeparator /><MenuItem closeOnSelect={false}><ShareIcon />Share</MenuItem><MenuItem closeOnSelect={false}><PencilIcon />Rename</MenuItem><MenuItem variant="destructive" closeOnSelect={false}><Trash2Icon />Delete</MenuItem></Held> },
  { id: "model-popover", name: "Model picker", group: "Assembled", scope: "both", kind: "component", source: "PopoverSearchList", render: () => <Panel label="Models" class="g-search"><ModelSearch /></Panel> },
  { id: "dialog", name: "Confirm dialog", group: "Assembled", scope: "both", kind: "component", source: "FrostDialog", render: () => <div class="frost-card g-card-demo"><strong>Delete this chat?</strong><div class="g-row"><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></div></div> },
  { id: "prompt", name: "Prompt dialog", group: "Assembled", scope: "both", kind: "component", source: "FrostDialog + Input", render: () => <div class="frost-card g-card-demo"><strong>Rename chat</strong><Input value="Lorem ipsum file" /><div class="g-row"><Button variant="outline">Cancel</Button><Button>Save</Button></div></div> },

  // Controls.
  { id: "buttons", name: "Buttons", group: "Control", scope: "both", kind: "component", source: "Button", render: () => <div class="g-row"><Button>Default</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button></div> },
  { id: "keycap", name: "Keycap", group: "Control", scope: "desktop", kind: "component", source: "Keycap", render: () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>G</Keycap><Keycap>Esc</Keycap></div> },
  { id: "segmented", name: "Segmented choice", group: "Control", scope: "both", kind: "component", source: "Segmented", render: () => <SegmentedDemo /> },
  { id: "switch", name: "Switch", group: "Control", scope: "both", kind: "component", source: "Switch", render: () => <SwitchDemo /> },
  { id: "input", name: "Input", group: "Control", scope: "both", kind: "component", source: "Input", render: () => <div style={{ width: "220px" }}><Input placeholder="My project" /></div> },
];

/** Phone-only atoms. They render in a frame that passes for a phone, where their styles apply. */
export const phoneAtoms: Atom[] = [
  { id: "pill-one", name: "Pill · one icon", group: "Phone", scope: "phone", kind: "one-off", source: "header-pill.tsx", render: () => <Pill side="leading"><Icon label="Add"><PlusIcon /></Icon></Pill> },
  { id: "pill-many", name: "Pill · several icons", group: "Phone", scope: "phone", kind: "one-off", source: "header-pill.tsx", render: () => <Pill side="actions"><Icon label="Search"><SearchIcon /></Icon><Icon label="Folder"><FolderIcon /></Icon><Icon label="Share"><ShareIcon /></Icon></Pill> },
  { id: "plus-header", name: "+ menu · title with context", group: "Phone", scope: "phone", kind: "one-off", source: ".composer-options-header", render: () => <Held class="composer-options-menu"><MenuGroup><MenuLabel class="composer-options-label composer-options-header"><span>Profile</span><span class="composer-options-context">12% context</span></MenuLabel></MenuGroup></Held> },
  { id: "plus-value", name: "+ menu · value row", group: "Phone", scope: "phone", kind: "one-off", source: ".composer-options-value", render: () => <Held class="composer-options-menu"><MenuLabel class="composer-options-label">Model</MenuLabel><MenuItem closeOnSelect={false} class="composer-options-value composer-options-model"><span>Meta: Muse Spark 1.3 Contributor</span><ChevronRightIcon /></MenuItem></Held> },
  { id: "plus-slider", name: "+ menu · slider", group: "Phone", scope: "phone", kind: "one-off", source: "StepSlider in .composer-options-menu", render: () => <Held class="composer-options-menu"><Slider button /></Held> },
  { id: "plus-models", name: "+ menu · model panel", group: "Phone", scope: "phone", kind: "one-off", source: ".composer-model-menu", render: () => <Held class="composer-options-menu composer-options-submenu composer-model-menu"><MenuItem closeOnSelect={false}><SearchIcon /><span>Search all models…</span></MenuItem><MenuSeparator /><MenuLabel class="composer-options-label">Model</MenuLabel><MenuRadioGroup value={MODELS[2]!.spec}><For each={MODELS.slice(0, 5)}>{(item) => <MenuRadioItem value={item.spec} class="composer-model-option" closeOnSelect={false}><span>{item.label}</span><small>{item.provider}</small></MenuRadioItem>}</For></MenuRadioGroup></Held> },
  { id: "plus-places", name: "+ menu · project panel", group: "Phone", scope: "phone", kind: "one-off", source: ".composer-places-menu", render: () => <Held class="composer-options-menu composer-options-submenu composer-places-menu"><MenuLabel class="composer-options-label">Project</MenuLabel><For each={PROJECTS}>{(project) => <MenuItem closeOnSelect={false}><PlaceGlyph project={project} /><span>{project.name}</span></MenuItem>}</For></Held> },
  { id: "plus-profiles", name: "+ menu · profile panel", group: "Phone", scope: "phone", kind: "one-off", source: ".composer-profile-menu", render: () => <Held class="composer-options-menu composer-options-submenu composer-profile-menu"><MenuLabel class="composer-options-label">Profile</MenuLabel><For each={PROFILES}>{(item) => <MenuItem closeOnSelect={false}><HarnessMark id={item.implementation || "conduit"} class="size-4" /><span class="composer-profile-copy"><span>{item.label}</span><small>{item.implementation}</small></span></MenuItem>}</For></Held> },
  { id: "phone-bubble", name: "User message", group: "Phone", scope: "phone", kind: "one-off", source: "chat/transcript.tsx", render: () => <div style={{ width: "360px" }}><UserBubble text="and make the second paragraph shorter" /></div> },
];
