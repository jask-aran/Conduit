import { PanelLeftIcon, MessageSquarePlusIcon, EllipsisIcon, CameraIcon, KeyboardIcon, MicIcon, ArrowUpIcon, ChevronDownIcon, CircleIcon, FileTextIcon, ClockIcon, Maximize2Icon, SendHorizontalIcon, XIcon, CheckIcon } from "lucide-solid";
import { createSignal, For, onMount, type JSX } from "solid-js";
import { PanelRightIcon, ClipboardCopyIcon, Columns2Icon, CopyIcon, FolderIcon, FolderInputIcon, LayoutDashboardIcon, MenuIcon, MonitorIcon, PaperclipIcon, PencilIcon, PinIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, SearchIcon, ShareIcon, ShieldCheckIcon, SquarePenIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import { Bubble, Button, Card, Chip, Choice, ComposerField, DesktopComposer, Line, TextArea, Rider, RiderActions, RiderTitle, Toolbar, Frost, Input, Item, Keycap, Menu, PillButton, PillField, PillGroup, PillSwitch, HeadingSection, SearchSection, Section, Segmented, SelectTrigger, Slider } from "@/components/ui";
import { Switch } from "../client/settings/settings-controls";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import { MODELS, PROFILES, PROJECTS } from "./seed";
import { QuestionCard } from "../client/chat/question-card";
import type { Question } from "../client/api/contracts";
import { LibraryContext } from "@/components/ui/swap";

/*
 * The unified library, as a tree: Frost is the material; Popover, Card, Pill
 * and Message are what it makes. Each is a section of the gallery: the base
 * piece, then its constituents, then the app's own pieces assembled from them.
 */

export type Scope = "both" | "desktop" | "phone";
/** A cell: kind is the layer of the library it shows; source, where it lives in the code. */
export interface Atom { id: string; name: string; scope: Scope; kind: string; source: string; render: () => JSX.Element; wide?: boolean | "row" }

/** The tag: where the piece is used, and which layer of the library it is. wide: spans two cells; "row": the whole row.
 *  An assembled piece is named as the app's code names it (component, then the part within it). */
const lib = (id: string, name: string, scope: Scope, layer: string, source: string, render: Atom["render"], wide?: Atom["wide"]): Atom => ({ id: `ui-${id}`, name, scope, kind: layer, source, render, wide });
/** A run of cells; layout: fixed at that layout (no per-cell toggle). */
export interface Group { title?: string; note?: string; atoms: Atom[]; layout?: "desktop" | "phone" }
export interface Family { title: string; note: string; groups: Group[] }

export const thinking = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
/** The app's slider as its popovers use it: a label, and a value that opens the levels. */
export function Levels(props: { label?: string; onOpen?: () => void }) {
  const [value, setValue] = createSignal("medium");
  return <Slider label={props.label ?? "Thinking"} options={thinking} value={value()} onChange={setValue} onOpen={props.onOpen ?? (() => {})} />;
}
function SwitchDemo() { const [on, setOn] = createSignal(true); return <Switch label="Example" checked={on()} onChange={setOn} />; }
function SegmentedText() { const [value, setValue] = createSignal("cloud"); return <Segmented label="Source" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />; }
function SegmentedCount() { const [value, setValue] = createSignal("all"); return <Segmented label="Show" value={value()} onChange={setValue} options={[{ value: "all", label: "All", count: 0 }, { value: "unread", label: "Unread", count: 0 }]} />; }
const areas = () => [{ value: "dashboard", label: "Dashboard", icon: <LayoutDashboardIcon /> }, { value: "computer", label: "Computer", icon: <MonitorIcon /> }];
function SegmentedIcons(props: { pill?: boolean }) { const [value, setValue] = createSignal("dashboard"); return <Segmented icons pill={props.pill} label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }

/** A search section filtering the list section after it. */
export function ModelList(props: { keys?: string[]; title?: string }) {
  const [query, setQuery] = createSignal("");
  const [current, setCurrent] = createSignal(MODELS[2]!.spec);
  const shown = () => { const needle = query().trim().toLowerCase(); return needle ? MODELS.filter((model) => model.label.toLowerCase().includes(needle)) : MODELS; };
  return <>
    <SearchSection placeholder="Search all models…" keys={props.keys} value={query()} onInput={setQuery} />
    <Section title={props.title}><For each={shown()}>{(model) => <div onClick={() => setCurrent(model.spec)}><Item meta={model.provider} checked={model.spec === current()}>{model.label}</Item></div>}</For></Section>
  </>;
}
export const Profiles = () => <Section title="Profile"><For each={PROFILES}>{(profile, index) => <Item checked={index() === 0} icon={<HarnessMark id={profile.implementation || "conduit"} class="size-4" />} meta={profile.implementation}>{profile.label}</Item>}</For></Section>;
export const Projects = () => <Section title="Project"><Item icon={<FolderIcon />}>No folder</Item><For each={PROJECTS.slice(2, 7)}>{(project) => <Item icon={<PlaceGlyph project={project} />}>{project.name}</Item>}</For></Section>;
export const ChatTitle = () => <HeadingSection title="Lorem ipsum file" detail="Chats · Assistant"><Item field meta="Unavailable" opens>Context</Item></HeadingSection>;

/** The same piece on each surface it sits on: the frame (sidebar), the ground (chat, dashboard) and frost. */
function Surfaces(props: { frame?: boolean; children: () => JSX.Element }) {
  return <div class="g-surfaces">
    {props.frame && <div class="g-surface" data-surface="frame"><small>frame</small>{props.children()}</div>}
    <div class="g-surface" data-surface="ground"><small>ground</small>{props.children()}</div>
    <Frost lift="raised" class="g-surface"><small>frost</small>{props.children()}</Frost>
  </div>;
}

const icon = (label: string, glyph: JSX.Element) => ({ label, icon: glyph });

/** The material's CSS, read live, so a tuned value shows here too. */
function FrostTokens() {
  const names = ["--frost-fill", "--frost-stroke", "--frost-blur", "--frost-highlight", "--frost-lift-rest", "--frost-lift-raised", "--frost-wash", "--frost-rule", "--frost-radius", "--frost-inset"];
  const [values, setValues] = createSignal<string[]>([]);
  let el!: HTMLDListElement;
  onMount(() => { const style = getComputedStyle(el); setValues(names.map((name) => style.getPropertyValue(name).trim())); });
  return <dl ref={el} class="g-tokens"><For each={names}>{(name, index) => <><dt>{name}</dt><dd>{values()[index()]}</dd></>}</For></dl>;
}

function Area() { const [value, setValue] = createSignal("dashboard"); return <PillSwitch label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }

/* The desktop composer's controls, as components v2 draws them: ghost icon buttons and small ghost pickers. */
const ghost = (label: string, glyph: JSX.Element) => <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>{glyph}</Button>;
const picker = (children: JSX.Element) => <Button variant="ghost" size="sm" class="g-picker">{children}<ChevronDownIcon /></Button>;
const toolbarStart = () => <>{ghost("Attach and more", <PlusIcon />)}{ghost("Context usage", <CircleIcon />)}{picker(<HarnessMark id="conduit" class="size-4" />)}{picker(<><strong>Meta: Muse Spark 1.3</strong><span class="g-muted">medium</span></>)}</>;
const toolbarEnd = () => <>{ghost("Start voice dictation", <MicIcon />)}{ghost("Send message", <ArrowUpIcon />)}</>;
const thumb = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#6b8afd"/><stop offset="1" stop-color="#d97706"/></linearGradient></defs><rect width="48" height="48" fill="url(#g)"/></svg>');
/** The app's riders, as components v2 builds them. */
const attachments = () => <Rider label="Attachments" layout="strip"><div class="ui-chips"><Chip name="photo.png" image={thumb} /><Chip name="notes.txt" detail="2.1 KB" icon={<FileTextIcon />} /><Chip name="lorem_ipsum.txt" detail="412 bytes" icon={<FileTextIcon />} status="uploading" progress={60} /></div>
  <RiderActions stack>{ghost("Show all attachments", <Maximize2Icon />)}{ghost("Remove all attachments", <Trash2Icon />)}</RiderActions></Rider>;
const queued = () => <Rider label="Queued"><RiderTitle>Steering</RiderTitle><ul class="ui-lines"><Line text="and make the second paragraph shorter" /><Line text="then rename the file to lorem.txt, and add a heading at the top that says what it is" clipped /></ul>
  <RiderActions>{ghost("Interrupt and send now", <SendHorizontalIcon />)}{ghost("Edit", <PencilIcon />)}{ghost("Discard", <XIcon />)}</RiderActions></Rider>;
// The real QuestionCard, drawn with components v2, so the cell shows all the live card can: a
// single question's title, tabs with their ticks, pick-any, an option's preview,
// one's own answer, a note, the Submit page, the hints, Stop and Submit.
const q = (id: string, header: string, prompt: string, options: [string, string, Question["options"][number]["preview"]?][], more: Partial<Question> = {}): Question =>
  ({ id, header, prompt, multiSelect: false, secret: false, required: true, freeform: { placeholder: "Type your own answer" }, ...more,
    options: options.map(([label, description, preview], i) => ({ id: `${id}${i}`, label, description, preview })) });
const questionCard = (questions: Question[], extra: { notes?: boolean; page?: "submit" } = {}) => {
  let box!: HTMLDivElement;
  onMount(() => { if (extra.page === "submit") box.querySelector<HTMLButtonElement>("[role=tab]:last-child")?.click(); });
  return <div ref={box} class="g-composer"><LibraryContext.Provider value={true}>
    <QuestionCard request={{ id: questions[0].id, kind: "question", questions, notes: extra.notes }} onStop={() => {}} onRespond={() => {}} />
  </LibraryContext.Provider></div>;
};
const LANGUAGE = q("lang", "Preferred language", "Which programming language should I use for this task?",
  [["Python", "Use Python for the task"], ["TypeScript", "Use TypeScript for the task"], ["Rust", "Use Rust for the task"]]);
const TABS = [
  q("fmt", "Format", "Which sections should the file have?", [["A heading", "a title line at the top"], ["Paragraphs", ""], ["A list", "the main points, bulleted"]], { multiSelect: true, freeform: false }),
  q("len", "Length", "How long should the second paragraph be?", [["Two sentences", "the shortest that keeps its point", { format: "monospace", text: "Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit." }], ["Half as long", ""], ["Keep it", "leave the paragraph as it is"]],
    { freeform: { placeholder: "Or say how long", multiline: true } }),
];
const SUMMARY = [q("name", "File name", "What should the file be called?", [], { freeform: { initial: "lorem.txt" } }), q("key", "API key", "Paste the key it should use", [], { secret: true, required: false })];

export const libraryFamilies: Family[] = [
  { title: "Frost", note: "the material: fill, edge, blur, highlight. Lift: rest sits on the page, raised floats above it; core is a solid backing for busy content", groups: [{ atoms: [
    lib("frost-rest", "Rest", "both", "material", "Frost lift=rest", () => <Frost class="g-swatch" />),
    lib("frost-raised", "Raised", "both", "material", "Frost lift=raised", () => <Frost lift="raised" class="g-swatch" />),
    lib("frost-core", "Core", "both", "material", "Frost core", () => <Frost lift="raised" core class="g-swatch" />),
    lib("frost-css", "The material's CSS", "both", "material", "library.css :root", () => <FrostTokens />, true),
  ] }] },
  { title: "Popover", note: "raised frost holding sections, separated by rules; a submenu is another popover", groups: [
    { atoms: [
      lib("anatomy", "Anatomy", "both", "popover", "Menu > Section > Item", () => <div class="g-anatomy"><Menu>
        <HeadingSection title="Section · heading" detail="a title and a line under it" />
        <SearchSection placeholder="Section · search" />
        <Section title="Section · list"><Item icon={<PaperclipIcon />}>Item</Item><Item meta="meta">Item</Item><Item opens>Item that opens a submenu</Item></Section>
        <Section kind="slider"><Levels label="Section · slider" /></Section>
      </Menu></div>),
      lib("section-heading", "Heading", "both", "section", "HeadingSection + Item field", () => <Menu><ChatTitle /></Menu>),
      lib("section-search", "Search", "both", "section", "SearchSection", () => <Menu><SearchSection placeholder="Search all models…" keys={["⌘", "⇧", "X"]} /></Menu>),
      lib("item", "List · items", "both", "section", "Section + Item: icon meta detail keys opens field · checked disabled destructive", () => <Menu><Section title="Title" note="note">
        <Item>Plain</Item>
        <Item icon={<PaperclipIcon />}>icon</Item>
        <Item meta="xai">meta</Item>
        <Item detail="192.168.1.4">detail</Item>
        <Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>keys</Item>
        <Item opens>opens a submenu</Item>
        <Item field meta="Unavailable" opens>Field</Item>
        <Item checked>checked</Item>
        <Item active>highlighted</Item>
        <Item disabled meta="offline">disabled</Item>
        <Item icon={<Trash2Icon />} destructive>destructive</Item>
      </Section></Menu>),
      lib("section-slider", "Slider", "both", "section", "Section kind=slider + Slider", () => <Menu><Section kind="slider"><Levels /></Section></Menu>),
      lib("submenu", "Submenu", "both", "popover", "Menu beside an Item that opens", () => <div class="g-row g-top g-submenu">
        <Menu><Section title="Servers"><Item checked>Desktop-Dev</Item><Item checked={false}>Laptop</Item></Section><Section><Item opens active>Route</Item><Item>Manage settings</Item></Section></Menu>
        <Menu><Section><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Section></Menu>
      </div>, true),
    ] },
    { title: "Desktop popovers", note: "the app's own, assembled from the pieces above", layout: "desktop", atoms: [
    lib("d-model", "ModelSelector", "desktop", "popover", "chat/model-selector.tsx", () => <Menu class="g-w18"><ModelList keys={["⌘", "⇧", "X"]} /><Section kind="slider"><Levels /></Section></Menu>),
    lib("d-plus", "ComposerPlusMenu", "desktop", "popover", "chat/composer-plus-menu.tsx", () => <Menu class="g-w18">
      <Section><Item meta="Muse Spark 1.3" opens>Model</Item><Item icon={<HarnessMark id="conduit" class="size-4" />} meta="Assistant" opens>Profile</Item><Item icon={<ShieldCheckIcon />} meta="Default" opens>Permissions</Item></Section>
      <Section><Item icon={<PlaceGlyph project={null} />} meta="None" opens>Project</Item></Section>
      <Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section>
    </Menu>),
    lib("d-profile", "ComposerPlusMenu › Profile", "desktop", "popover", "chat/composer-plus-menu.tsx", () => <Menu class="g-w18"><Profiles /></Menu>),
    lib("d-chat", "ChatHeader › menu", "desktop", "popover", "chat/chat-screen.tsx", () => <Menu class="g-w18"><ChatTitle /><Section><Item icon={<RefreshCwIcon />}>Update app</Item></Section><Section><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>),
    lib("d-sidebar", "Sidebar › ChatMenu", "desktop", "popover", "navigation/sidebar.tsx", () => <div class="g-row g-top g-submenu">
      <Menu class="g-w18"><Section><Item icon={<PencilIcon />}>Rename</Item><Item icon={<FolderInputIcon />} opens active>Move to folder…</Item><Item icon={<ClipboardCopyIcon />}>Copy transcript</Item><Item icon={<Columns2Icon />}>Open beside</Item><Item icon={<TerminalIcon />}>Open terminal</Item><Item icon={<PinIcon />}>Pin to sidebar</Item></Section><Section><Item icon={<Trash2Icon />} destructive>Delete chat</Item></Section></Menu>
      <Menu><Section><For each={PROJECTS.slice(2, 6)}>{(project, index) => <Item checked={index() === 0}>{project.name}</Item>}</For></Section></Menu>
    </div>, true),
    lib("d-server", "ServerSwitcher", "desktop", "popover", "navigation/server-switcher.tsx", () => <div class="g-row g-top g-submenu">
      <Menu class="g-w18"><Section title="Servers"><Item checked meta="12 ms">Desktop-Dev</Item><Item checked={false} meta="48 ms">Laptop</Item></Section><Section><Item meta="LAN · 192.168.1.4" opens active>Route</Item></Section><Section><Item icon={<QrCodeIcon />}>Pair a device</Item><Item icon={<PlusIcon />}>Add server</Item></Section></Menu>
      <Menu><Section><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Section></Menu>
    </div>, true),
    ] },
    { title: "Phone popovers", note: "submenus open as panels over the dimmed parent", layout: "phone", atoms: [
    lib("p-plus", "MobileComposerOptions", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16">
      <Section title="Profile"><Item icon={<HarnessMark id="conduit" class="size-4" />} opens>Assistant</Item></Section>
      <Section title="Model"><Item opens>Meta: Muse Spark 1.3 Contributor</Item></Section>
      <Section kind="slider"><Levels label="Effort" /></Section>
      <Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section>
      <Section title="Project"><Item icon={<PlaceGlyph project={null} />} opens>Add to a project folder</Item></Section>
    </Menu>, true),
    lib("p-models", "MobileComposerOptions › models", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><ModelList title="Model" /></Menu>, true),
    lib("p-profiles", "MobileComposerOptions › profiles", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><Profiles /></Menu>, true),
    lib("p-effort", "MobileComposerOptions › effort", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w12"><Section title="Effort"><For each={thinking}>{(level) => <Item checked={level.value === "medium"}>{level.label}</Item>}</For></Section></Menu>, true),
    lib("p-projects", "MobileComposerOptions › places", "phone", "popover", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><Projects /></Menu>, true),
    lib("p-chat", "ChatHeader › menu", "phone", "popover", "chat/chat-screen.tsx", () => <Menu class="g-w16"><ChatTitle /><Section><Item icon={<RefreshCwIcon />}>Update app</Item></Section><Section><Item icon={<PanelRightIcon />}>Workspace panel</Item><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<Trash2Icon />} destructive>Delete</Item></Section></Menu>, true),
    ] },
  ] },
  { title: "Card", note: "raised frost at dialog padding: title · detail · body · actions", groups: [
    { atoms: [
      lib("card-anatomy", "Anatomy", "both", "card", "Card title detail children actions", () => <div class="g-anatomy"><Card title="Title" detail="Detail: a line under the title" class="g-card" actions={<><Button variant="outline">Action</Button><Button>Action</Button></>}><div class="g-slot">Body</div></Card></div>),
      lib("card-head", "Title · detail", "both", "card", "Card title detail", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" />),
      lib("card-body", "Body", "both", "card", "Card children", () => <Card title="Rename chat" class="g-card"><Input value="Lorem ipsum file" /></Card>),
      lib("card-actions", "Actions", "both", "card", "Card actions", () => <Card title="Actions" class="g-card" actions={<><Button variant="outline">Cancel</Button><Button>Save</Button><Button variant="destructive">Delete</Button></>} />),
    ] },
    { title: "Assembled", atoms: [
      lib("confirm", "FrostDialog alert", "both", "card", "Card", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" actions={<><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></>} />),
      lib("prompt", "FrostDialog", "both", "card", "Card + Input", () => <Card title="Rename chat" class="g-card" actions={<><Button variant="outline">Cancel</Button><Button>Save</Button></>}><Input value="Lorem ipsum file" /></Card>),
    ] },
  ] },
  { title: "DesktopComposer", note: "desktop only, one integrated piece: resting frost holding a TextArea above a Toolbar, with Riders on its top edge. A phone's composer is Pills, sharing the TextArea and the Riders", groups: [
    { atoms: [
      lib("composer-anatomy", "Anatomy", "desktop", "composer", "DesktopComposer > riders · ComposerField (a TextArea) · Toolbar (start · end)", () => <div class="g-anatomy g-composer"><DesktopComposer riders={<Rider label="Rider"><span class="g-muted">Rider (its own section below)</span></Rider>}>
        <ComposerField><TextArea placeholder="TextArea (a control), padded by the composer" /></ComposerField>
        <Toolbar start={<>{ghost("Icon button", <PlusIcon />)}{picker(<span>Picker</span>)}</>} end={ghost("Primary", <ArrowUpIcon />)} />
      </DesktopComposer></div>, true),
      lib("composer-toolbar", "Toolbar", "desktop", "composer", "Toolbar start · end, no frost of its own: ghost icon buttons, pickers, the primary", () => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()} /></div>, "row"),
    ] },
    { title: "Assembled", atoms: [
      lib("composer", "Composer", "desktop", "composer", "chat/composer.tsx", () => <div class="g-composer"><DesktopComposer><ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} /></DesktopComposer></div>, true),
      lib("composer-ridden", "Composer · QueuedMessages + AttachmentStrip", "desktop", "composer", "chat/composer.tsx, queued-messages.tsx, attachment-strip.tsx", () => <div class="g-composer"><DesktopComposer riders={<>{queued()}{attachments()}</>}><ComposerField><TextArea value="see the attached notes" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} /></DesktopComposer></div>, true),
    ] },
  ] },
  { title: "Rider", note: "resting frost on a composer's top edge, either composer's: a row, a strip or a card", groups: [
    { atoms: [
      lib("rider-anatomy", "Anatomy", "both", "rider", "Rider layout=row: RiderTitle · body · RiderActions", () => <div class="g-anatomy g-composer"><Rider label="Rider"><RiderTitle>Title</RiderTitle><ul class="ui-lines"><Line text="Body: lines, chips or choices" /></ul><RiderActions>{ghost("Action", <PencilIcon />)}{ghost("Action", <XIcon />)}</RiderActions></Rider></div>, true),
      lib("rider-line", "Line", "both", "rider", "Line: waiting text, one line until opened", () => <div class="g-composer"><Rider><ul class="ui-lines"><Line text="and make the second paragraph shorter" /><Line text="then rename the file to lorem.txt, and add a heading at the top that says what it is, and then read it back to me" clipped /></ul></Rider></div>, true),
      lib("rider-chip", "Chip", "both", "rider", "Chip: image · file · uploading · failed", () => <div class="g-row"><Chip name="photo.png" image={thumb} /><Chip name="notes.txt" detail="2.1 KB" icon={<FileTextIcon />} /><Chip name="big.pdf" detail="64%" icon={<FileTextIcon />} status="uploading" progress={64} /><Chip name="broken.txt" detail="Upload failed" icon={<FileTextIcon />} status="error" /></div>, true),
      lib("rider-choice", "Choice", "both", "rider", "Choice: number · label · detail · check; multi: a box; its own answer: a TextArea", () => <div class="g-composer"><Rider layout="card"><div class="ui-choices"><Choice n={1} label="Chosen" detail="with a description" chosen active /><Choice n={2} label="Not chosen" /><Choice n={3} label="Several may be chosen" multi chosen /><Choice n={4} label="A box, unticked" multi /><div class="ui-choice" data-active="true"><span class="ui-choice-key">5</span><TextArea placeholder="Type your own answer (a TextArea)" /><span class="ui-choice-check" /></div></div></Rider></div>, true),
    ] },
    { title: "Assembled", atoms: [
      lib("rider-queued", "QueuedMessages", "both", "rider", "chat/queued-messages.tsx", () => <div class="g-composer">{queued()}</div>, true),
      lib("rider-attachments", "AttachmentStrip", "both", "rider", "chat/attachment-strip.tsx", () => <div class="g-composer">{attachments()}</div>, true),
      lib("rider-question", "QuestionCard", "both", "rider", "chat/question-card.tsx · one question: its title, Choices, own answer, Stop · Submit", () => questionCard([LANGUAGE]), true),
      lib("rider-question-tabs", "QuestionCard · tabs", "both", "rider", "chat/question-card.tsx · tabs (ticked when answered), pick any, a preview, a multi-line own answer, notes", () => questionCard(TABS, { notes: true }), true),
      lib("rider-question-submit", "QuestionCard · Submit page", "both", "rider", "chat/question-card.tsx · the review page; a secret answer", () => questionCard(SUMMARY, { page: "submit" }), true),
    ] },
  ] },
  { title: "Pill", note: "resting frost floating over the page, the phone's controls. The kind sets the shape: a button is a circle, a group a capsule", groups: [
    { layout: "phone", atoms: [
      lib("pill-button", "PillButton", "phone", "pill", "PillButton: one action, a circle", () => <div class="g-row"><PillButton {...icon("Sidebar", <PanelLeftIcon />)} /><PillButton {...icon("Add", <PlusIcon />)} /></div>),
      lib("pill-stretch", "PillButton · stretch", "phone", "pill", "PillButton stretch: across its row", () => <div class="g-row g-fill"><PillButton stretch {...icon("Dictate", <MicIcon />)} /></div>),
      lib("pill-group", "PillGroup", "phone", "pill", "PillGroup: several actions, one capsule", () => <div class="g-row"><PillGroup actions={[icon("Sidebar", <PanelLeftIcon />), icon("New chat", <MessageSquarePlusIcon />)]} /><PillGroup actions={[icon("Search", <SearchIcon />), icon("Terminal", <TerminalIcon />), icon("More", <EllipsisIcon />)]} /></div>),
      lib("pill-switch", "PillSwitch", "phone", "pill", "PillSwitch: a group where one slot is chosen", () => <Area />),
      lib("pill-field", "PillField", "phone", "pill", "PillField: text in the capsule", () => <div class="g-fill"><PillField placeholder="Send a message…" /></div>),
    ] },
    { title: "Assembled", layout: "phone", atoms: [
      lib("pill-header", "ChatHeader · headerPill + HeaderActions", "phone", "pill", "navigation/header-pill.tsx", () => <div class="g-bar-demo"><PillGroup actions={[icon("Sidebar", <PanelLeftIcon />), icon("New chat", <MessageSquarePlusIcon />)]} /><PillGroup actions={[icon("Search", <SearchIcon />), icon("Terminal", <TerminalIcon />), icon("More", <EllipsisIcon />)]} /></div>, true),
      lib("pill-sidebar", "Sidebar · header (PillShell)", "phone", "pill", "navigation/sidebar.tsx", () => <div class="g-bar-demo"><PillButton {...icon("Sidebar", <PanelLeftIcon />)} /><Area /></div>, true),
      lib("pill-composer", "Composer · bar layout", "phone", "pill", "chat/composer.tsx (bar)", () => <div class="g-composer-demo"><PillField placeholder="Send a message…" /><div class="g-bar-demo">
        <PillButton {...icon("Message options", <PlusIcon />)} /><PillButton {...icon("Take a photo", <CameraIcon />)} /><PillButton {...icon("Type a message", <KeyboardIcon />)} /><PillButton stretch {...icon("Dictate", <MicIcon />)} /><PillButton {...icon("Send", <ArrowUpIcon />)} />
      </div></div>, true),
    ] },
  ] },
  { title: "Message", note: "the simplest: resting frost around text", groups: [{ atoms: [
    lib("bubble", "User message", "both", "message", "Bubble", () => <div style={{ width: "240px" }}><Bubble>write a .txt file with lorem ipsum</Bubble></div>),
  ] }] },
  { title: "Controls", note: "not frost: what sits on any surface, shown on each", groups: [{ atoms: [
    lib("buttons", "Button", "both", "control", "Button variant size", () => <Surfaces>{() => <div class="g-row"><Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button></div>}</Surfaces>),
    lib("segmented", "Segmented choice", "both", "control", "Segmented", () => <Surfaces frame>{() => <div class="g-field"><SegmentedText /><SegmentedCount /><SegmentedIcons /></div>}</Surfaces>),
    lib("input", "Input", "both", "control", "Input", () => <Surfaces>{() => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>}</Surfaces>),
    lib("textarea", "TextArea", "both", "control", "TextArea: multi-line, grows with its lines, bare -- what holds it pads it", () => <Surfaces>{() => <div class="g-field"><TextArea placeholder="Type several lines…" /><TextArea value={"Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit."} /></div>}</Surfaces>),
    lib("select", "Select", "both", "control", "SelectTrigger bare", () => <Surfaces>{() => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>}</Surfaces>),
    lib("icon-button", "Icon button", "both", "control", "Button size=icon-sm", () => <Surfaces>{() => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button><Button variant="outline" size="icon" aria-label="Add"><PlusIcon /></Button></div>}</Surfaces>),
    lib("slider", "Slider", "both", "control", "Slider", () => <div style={{ width: "240px" }}><Levels /></div>),
    lib("switch", "Switch", "both", "control", "Switch", () => <SwitchDemo />),
    lib("keycap", "Keycap", "desktop", "control", "Keycap", () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap><Keycap>Esc</Keycap></div>),
    lib("spinner", "Spinner", "both", "control", "Spinner", () => <Spinner />),
  ] }] },
];
