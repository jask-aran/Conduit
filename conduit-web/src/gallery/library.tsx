import { RailButton as PaneRailButton } from "@/components/ui/nav";
import { HeaderButton as PaneHeaderButton } from "@/components/ui/header";
import { PaneTabRow, PaneTabs, TabPlace, PaneTab, PaneActions, PaneAction, PaneEdge, DropWash, DragPill, ToolRail, RailRule, LayoutGlyph, ToolHeader, ToolViews, ToolView, ToolBar, ToolButton, ToolFilter, ToolNotice, Tree, TreeRow, PaneEmpty, PaneLoading } from "@/components/ui/pane";
import { ToolLine, CommitBox, ChangeLedger, ChangeSection, ChangeList, ChangeItem, ChangeEmpty, CommitList, CommitRow, PatchLines } from "@/components/ui/source";
import { HistoryList, HistoryRow, HistoryBranch } from "@/components/ui/history";
import { filesFamilies } from "./files";
import { TermKeys, TermKey } from "@/components/ui/terminal";
import { ChevronDownIcon, FocusIcon, LogOutIcon } from "lucide-solid";
import { TermHeader, TermLead, TermIdentity, TermStatus, TermContext, TermShortcuts, TermShortcut, TermOverflow, TermActions, TermActionLabel, TermState, TermError } from "@/components/ui/terminal";
import { Button as TermButton } from "@/components/ui/controls";
import { SettingsIcon } from "lucide-solid";
import { SearchList, Menu as LiveMenu, MenuContent as LiveMenuContent, MenuSection as LiveMenuSection, MenuRow as LiveMenuRow, MenuRadioGroup as LiveRadioGroup, MenuRadioItem as LiveRadioItem, MenuSub as LiveSub, MenuSubTrigger as LiveSubTrigger, MenuSubContent as LiveSubContent } from "@/components/menus";
import { createDecisionDialogs } from "@/components/decision-dialog";
import { WorkspaceAppearanceEditor } from "../client/project/workspace-appearance-editor";
import { ComputerExplorer } from "../client/dashboard/computer-dashboard";
import WorkspaceExcerptView from "../client/workspace/workspace-excerpt-view";
import { ConnectionScreen, PasswordSignIn, ServerControl, ConnectionRecovery, ConnectionForm, ConnectionChoices, ConnectionChoice, ConnectionGroup, ConnectionAddress, ConnectionStatus, ConnectionPassword, type AddressState, CameraPreview } from "@/components/ui/connection";
import { NotificationToaster, toast } from "@/components/notifications";
import { Dialog } from "@/components/dialog";
import { CardColumns, CardColumn, CardCaption, CardActions, CardForm, CardBody, CardNote, CardRead, CardDetails, CardQR, CardPreview, CardAttachments, CardAttachment } from "@/components/ui/card";
import { ArrowDownIcon, PanelLeftIcon, MessageSquarePlusIcon, EllipsisIcon, CameraIcon, KeyboardIcon, MicIcon, ArrowUpIcon, FileTextIcon, ClockIcon, Maximize2Icon, SendHorizontalIcon, XIcon, CheckIcon } from "lucide-solid";
import { createSignal, createUniqueId, For, Index, onCleanup, onMount, Show, type JSX } from "solid-js";
import { LightbulbIcon, MessageSquareTextIcon, FilePenLineIcon, SquareTerminalIcon, CodeXmlIcon, WrenchIcon } from "lucide-solid";
import { FileCode2Icon, FileDiffIcon, Undo2Icon, DeleteIcon, ChevronLeftIcon, TextCursorInputIcon } from "lucide-solid";
import { PanelRightIcon, ClipboardCopyIcon, Columns2Icon, CopyIcon, FolderIcon, FolderInputIcon, LayoutDashboardIcon, MenuIcon, MonitorIcon, PaperclipIcon, PencilIcon, PinIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, SearchIcon, ShareIcon, ShieldCheckIcon, SquarePenIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { type Motion, Backdrop, RowGroup, RowAction, Welcome, Picker, Rule, MenuNote, Gauge, Meter, Swatch, Readout, SliderValue, Reference, References, Captions, Completion, VoiceRider, Spinner, StopGlyph, ANSWER_MARKDOWN, CODE_BLOCK, Disclosure, Transcript, TranscriptRow, Message, Turn, Failure, HarnessPrompt, Changes, LoadingEarlier, TraceHeader, Trail, Step, Answer, CodeBlock, codeBlockHtml, fillCodeBlocks, CopyButton, MessageFoot, StopLine, Orb, settledOrbRate, PLAIN_SPHERE, SPUTTERING_SPHERE, Trace, StepOutput, StepProse, TraceError, ORBITS_TRAILED, PhoneComposer, PHONE_COMPOSER_STATES, type PhonePart, type VoiceMode, Toast, Toaster, SettingRecorder, Field, Leader, Crumbs, Spotlight, OverlayHead, Match, Choices, OverlayBar, OverlayChip, OverlayEmpty, OverlayActions, OverlayHints, OverlayList, OverlayPage, OverlayRail, OverlayFacts, OverlayFact, OverlaySplit, Glance, GlanceHead, GlancePrompt, GlanceTurn, GlanceAnswer, GlanceEmpty, RiderButton, Overlay, Scrim, SettingGroup, SettingLine, SettingValue, SettingLink, SettingNote, SettingDetails, SettingWide, SettingLoading, Progress, Keycap, NavGroup, NavRow, Segmented, SelectTrigger, Bubble, Button, Card, Chip, Choice, ComposerField, DesktopComposer, Line, TextArea, Rider, RiderActions, RiderTitle, Toolbar, Frost, Input, Item, Menu, PillButton, PillField, PillGroup, PillSwitch, PillWave, HeadingSection, SearchSection, Section, Slider, Switch, Chips, Lines, Read, Preview } from "@/components/ui";

import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import { MODELS, PROFILES, PROJECTS } from "./seed";
import { scaleOf, setScale } from "./foundations";
import { QuestionCard } from "../client/chat/question-card";
import { ArrowLeftIcon, ImageIcon, ActivityIcon, BrainIcon, ChevronRightIcon, GlobeIcon, MessageSquareIcon, MicIcon as VoiceIcon, NotebookTextIcon, PanelLeftCloseIcon, ServerIcon } from "lucide-solid";
import type { Question } from "../client/api/contracts";
import { InUse, Anatomy, type Part, FormTable, form, px, rounding, edge, fg, bg, Replay, States, Presence, type Mark, type FormRow } from "./specs";
import { Header, HeaderButton, HeaderCrumb, HeaderNote, Reading, ReadingTotal, ReadingParts, ReadingPart, ReadingStats, ReadingStat, ReadingFoot } from "@/components/ui";
import { ShrinkIcon } from "lucide-solid";
import { NavPane, NavBrand, NavLead, NavGroup as GNavGroup, NavRow as GNavRow, NavFolder, NavFolderRow, NavNote, NavSkeleton, NavNotice, NavRail, NavRailSection, RailButton, Segmented as GSegmented, Button as GButton } from "@/components/ui";
import { DownloadIcon, ExternalLinkIcon, FolderPlusIcon, SearchIcon as GSearchIcon, TerminalIcon as GTerminalIcon } from "lucide-solid";
import katex from "katex";
import { Dashboard, DashHeader, QuickActions, QuickAction, QuickMore, DashIconButton, GroupHeading, GroupToggle, GroupSwitches, Group, GroupAction, DashDay, DashMore, DashRow, ChangeRow, Counts, DashEmpty, DashNote, DashPath, FolderShelf, FolderTile } from "@/components/ui/dashboard";

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
export const lib = (id: string, name: string, scope: Scope, layer: string, source: string, render: Atom["render"], wide?: Atom["wide"]): Atom => ({ id: `ui-${id}`, name, scope, kind: layer, source, render, wide });
/** A run of cells; layout: fixed at that layout (no per-cell toggle); staged: drawn on the page's surface at its density, or "density": at its density only (the cell draws its own surfaces). */
export interface Group { title?: string; note?: string; atoms: Atom[]; layout?: "desktop" | "phone"; staged?: boolean | "density" }
/** rail: the heading it sits under in the rail (Frosted by default); stage: the page picks one surface and density for its staged groups. */
export interface Family { title: string; note: string; rail?: string; stage?: boolean; groups: Group[] }

export const thinking = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
/** The app's slider as its popovers use it: a label, and a value that opens the levels. */
export function Levels(props: { label?: string; onOpen?: () => void }) {
  const [value, setValue] = createSignal("medium");
  return <Slider label={props.label ?? "Thinking"} options={thinking} value={value()} onChange={setValue} onOpen={props.onOpen ?? (() => {})} />;
}
export function SwitchDemo() { const [on, setOn] = createSignal(true); return <Switch label="Example" checked={on()} onChange={setOn} />; }
export function SegmentedText() { const [value, setValue] = createSignal("cloud"); return <Segmented label="Source" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />; }
export function SegmentedCount() { const [value, setValue] = createSignal("all"); return <Segmented label="Show" value={value()} onChange={setValue} options={[{ value: "all", label: "All", count: 0 }, { value: "unread", label: "Unread", count: 0 }]} />; }
const areas = () => [{ value: "dashboard", label: "Dashboard", icon: <LayoutDashboardIcon /> }, { value: "computer", label: "Computer", icon: <MonitorIcon /> }];
export function SegmentedIcons(props: { pill?: boolean }) { const [value, setValue] = createSignal("dashboard"); return <Segmented icons pill={props.pill} label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }

/** A menu over a long list starts with a Search all… row that opens the palette (DESIGN Dropdown menu), then the list; the current choice is bold. */
export function ModelList(props: { keys?: string[]; title?: string }) {
  const [current, setCurrent] = createSignal(MODELS[2]!.spec);
  return <>
    <Section><Item icon={<SearchIcon />} keys={props.keys}>Search all models…</Item></Section>
    <Section title={props.title}><For each={MODELS}>{(model) => <Item meta={model.provider} checked={model.spec === current()} onClick={() => setCurrent(model.spec)}>{model.label}</Item>}</For></Section>
  </>;
}
export const Profiles = () => <Section title="Profile"><For each={PROFILES}>{(profile, index) => <Item checked={index() === 0} icon={<HarnessMark id={profile.implementation || "conduit"} class="size-4" />} meta={profile.implementation}>{profile.label}</Item>}</For></Section>;
export const Projects = () => <Section title="Project"><Item icon={<FolderIcon />}>No folder</Item><For each={PROJECTS.slice(2, 7)}>{(project) => <Item icon={<PlaceGlyph project={project} />}>{project.name}</Item>}</For></Section>;
/** A context window's reading (chat/context-gauge.tsx ContextBreakdown): bare, it opens under the chat menu's own row and bar. */
const READING_PARTS = [{ label: "Messages", value: "60k · 30.0%", colour: "oklch(0.72 0.15 300)" }, { label: "System prompt", value: "16k · 8.0%", colour: "oklch(0.7 0.02 260)" }, { label: "Tools (3)", value: "12k · 6.0%", colour: "oklch(0.74 0.12 230)", opens: true }, { label: "Free space", value: "112k · 56.0%", hollow: true }];
export const ContextReadingDemo = (props: { bare?: boolean; open?: boolean }) => <Reading>
  <Show when={!props.bare}><ReadingTotal label={<strong>Context</strong>} value="42% used" /></Show>
  <Show when={!props.bare}><Meter parts={[{ value: 60, colour: "oklch(0.72 0.15 300)" }, { value: 16, colour: "oklch(0.7 0.02 260)" }, { value: 12, colour: "oklch(0.74 0.12 230)" }, { value: 112, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%", quiet: true }} /></Show>
  <ReadingTotal label="84k of 200k tokens" value="$0.42" />
  <ReadingParts label="What fills the window"><For each={READING_PARTS}>{(part) => <>
    <ReadingPart role={part.opens ? "button" : undefined} opens={part.opens} expanded={part.opens && props.open} colour={part.colour} hollow={part.hollow} label={part.label} value={part.value} />
    <Show when={part.opens && props.open}><ReadingPart sub label="read_file" value="4k" /><ReadingPart sub label="edit_file" value="5k" /><ReadingPart sub label="shell" value="3k" /></Show>
  </>}</For></ReadingParts>
  <ReadingTotal label="Cache hits · 54% of what could be reused" value="71%" />
  <ReadingFoot action={<Button variant="ghost" outline size="sm"><ShrinkIcon />Compact now</Button>}>Compacts at 85% · 2 so far</ReadingFoot>
  <Show when={!props.bare}><ReadingFoot action={<Button variant="ghost" size="sm">019a3f…3e70</Button>}>gpt-6-luna</ReadingFoot></Show>
  <ReadingStats title="Plan · Plus"><ReadingStat label="5-hour" value="5%" detail="resets 1:47 pm" /><ReadingStat label="Weekly" value="17%" detail="resets Tue" /></ReadingStats>
</Reading>;
export const ChatTitle = () => <HeadingSection title="Lorem ipsum file" detail="Chats · Assistant"><Item field meta="Unavailable" opens>Context</Item></HeadingSection>;

const icon = (label: string, glyph: JSX.Element) => ({ label, icon: glyph });

/** A material's own CSS, read live, so a tuned value shows here too. */
function FrostTokens(props: { names: string[] }) {
  const [values, setValues] = createSignal<string[]>([]);
  let el!: HTMLDListElement;
  onMount(() => { const style = getComputedStyle(el); setValues(props.names.map((name) => style.getPropertyValue(name).trim())); });
  return <dl ref={el} class="g-tokens"><For each={props.names}>{(name, index) => <><dt>{name}</dt><dd>{values()[index()]}</dd></>}</For></dl>;
}
const FROST_CSS = ["--frost-fill", "--frost-stroke", "--frost-blur", "--frost-highlight", "--frost-lift-rest", "--frost-lift-raised"];

function Area() { const [value, setValue] = createSignal("dashboard"); return <PillSwitch label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }

/* The desktop composer's controls, as components v2 draws them: ghost icon buttons and small ghost pickers. */
const ghost = (label: string, glyph: JSX.Element) => <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>{glyph}</Button>;
const toolbarStart = () => <>{ghost("Attach and more", <PlusIcon />)}{ghost("Context usage", <Gauge value={42} />)}<Picker icon={<HarnessMark id="conduit" />} aria-label="Profile" /><Picker subject value="Meta: Muse Spark 1.3" quiet="medium" /></>;
const toolbarEnd = () => ghost("Start voice dictation", <MicIcon />);
const send = () => ghost("Send message", <ArrowUpIcon />);
/** The phone's composer, as components v2 builds it; each option a value or an accessor (the Motion cell switches them). */
type Live<T> = T | (() => T);
const read = <T,>(value: Live<T>) => typeof value === "function" ? (value as () => T)() : value;
const WAVE = [3, 5, 8, 6, 4, 7, 11, 8, 5, 3, 6, 9, 12, 8, 5, 4, 7, 10, 6, 4, 3, 5, 8, 6];
/** A speaking voice for the gallery: a level (0-1) every 70ms, as the app's dictation samples it, and its last bars. */
const speech = (on: () => boolean) => {
  const [level, setLevel] = createSignal(0), [bars, setBars] = createSignal(Array.from({ length: 80 }, (_, i) => WAVE[i % WAVE.length]! / 12));
  let t = 0;
  const timer = setInterval(() => {
    if (!on()) return;
    t += 1;
    const next = Math.max(0, Math.min(1, (Math.sin(t / 3) * .5 + .5) * (Math.sin(t / 11) * .4 + .6) * (.6 + Math.random() * .4)));
    setLevel(next); setBars((b) => [...b.slice(1), next]);
  }, 70);
  onCleanup(() => clearInterval(timer));
  return { level, bars };
};
const phoneComposer = (mode: Live<VoiceMode>, opts: { draft?: Live<boolean>; away?: Live<boolean>; editing?: Live<boolean>; under?: Live<boolean>; riders?: boolean; layout?: "bar" | "surface" } = {}) => {
  const m = () => read(mode), draft = () => !!read(opts.draft ?? false), under = () => !!read(opts.under ?? false), voice = speech(() => m() === "listening");
  return <PhoneComposer mode={m()} layout={opts.layout} under={under()} editing={!!read(opts.editing ?? false)} level={voice.level()} riders={opts.riders ? queued() : undefined}
    field={<PillField value={draft() ? "make the second paragraph shorter" : ""} placeholder="Send a message…" />}
    track={<PillWave levels={voice.bars()} />}
    captions={<Captions lead="make the second paragraph shorter" words={["then ", "rename ", "the ", "file ", "to ", "lorem.txt"]} />}
    edit={<><PillButton {...icon("Undo", <Undo2Icon />)} /><PillButton {...icon("Delete word or selection", <DeleteIcon />)} /><PillButton {...icon("Previous word", <ChevronLeftIcon />)} /><PillButton {...icon("Next word", <ChevronRightIcon />)} /><PillButton {...icon("End of draft", <TextCursorInputIcon />)} /></>}>
    <PillButton open={under()} {...icon("Message options", <PlusIcon />)} />
    <PillButton {...icon("Take a photo", <CameraIcon />)} />
    <PillButton {...icon(m() === "typing" ? "Close the keyboard" : "Type a message", <KeyboardIcon />)} />
    <PillButton folded={!read(opts.away ?? false)} {...icon("Scroll to latest", <ArrowDownIcon />)} />
    <PillButton stretch aura {...icon("Dictate", <MicIcon />)} />
    {/* Send and Stop and send are one slot, one arrow: with a draft it stays put as listening starts and stops. */}
    <PillButton voice folded={m() !== "listening" && !draft()} {...icon(m() === "listening" ? "Stop and send" : "Send", <ArrowUpIcon />)} />
  </PhoneComposer>;
};
const pill = (label: string) => `[aria-label="${label}"]`;
const PHONE_PARTS: Part[] = [
  [".ui-phone-edit", "Edit pills", "PillButtons in edit", "Undo · Delete word · Previous word · Next word · End of draft: over the field while its cursor is moved by hand"],
  [".ui-phone-field", "Field", "PillField", "the draft; shown while typing"],
  [pill("Message options"), "Options", "PillButton · open", "+: opens the options menu (attach, model, ...); stays lit while the rest dims"],
  [pill("Take a photo"), "Camera", "PillButton", "takes a photo to attach", "below"],
  [pill("Close the keyboard"), "Keyboard", "PillButton", "opens or closes the keyboard (Type a message / Close the keyboard)", "below"],
  [pill("Scroll to latest"), "Scroll to latest", "PillButton · folded", "shown only when scrolled up", "below"],
  [pill("Dictate"), "Dictate", "PillButton · stretch aura", "the mic: fills the row's rest; starts listening", "below"],
  [pill("Send"), "Send", "PillButton · voice folded", "the arrow: shown with a draft; Stop and send while listening", "below"],
];
const PART_NAMES: Record<PhonePart, string> = { field: "Field", pills: "Options · Camera · Keyboard · Scroll to latest", edit: "Edit pills", track: "Voice track", captions: "Captions", orb: "Dictate as an orb pill" };
const StateTable = () => <table class="g-state-table"><thead><tr><th />{(Object.keys(PHONE_COMPOSER_STATES) as (keyof typeof PHONE_COMPOSER_STATES)[]).map((state) => <th>{state}</th>)}</tr></thead>
  <tbody>{(Object.keys(PART_NAMES) as PhonePart[]).map((part) => <tr><th>{PART_NAMES[part]}</th>{Object.values(PHONE_COMPOSER_STATES).map((shown) => <td>{(shown as readonly PhonePart[]).includes(part) ? "●" : ""}</td>)}</tr>)}</tbody></table>;
const PHONE_VOICE_PARTS: Part[] = [
  [".ui-voice-captions", "Captions", "PhoneComposer captions", "the newest three lines heard, on the page's ground"],
  [".ui-voice-track", "Voice track", "PillWave", "the waveform, from the row's start to the mic; tap to stop"],
  ['[aria-label="Dictate"]', "Dictate", "PillButton · Aura", "shrunk to an orb pill; its Aura follows the voice level", "below"],
  ['[aria-label="Stop and send"]', "Stop and send", "PillButton · voice", "stops and sends what was heard", "below"],
];
const thumb = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#6b8afd"/><stop offset="1" stop-color="#d97706"/></linearGradient></defs><rect width="48" height="48" fill="url(#g)"/></svg>');
/** The app's riders, as components v2 builds them. */
const attachments = (motion?: Motion) => <Rider label="Attachments" layout="strip" motion={motion}><Chips><Chip name="photo.png" image={thumb} /><Chip name="notes.txt" detail="2.1 KB" icon={<FileTextIcon />} /><Chip name="lorem_ipsum.txt" detail="412 bytes" icon={<FileTextIcon />} status="uploading" progress={60} /></Chips>
  <RiderActions stack>{ghost("Show all attachments", <Maximize2Icon />)}{ghost("Remove all attachments", <Trash2Icon />)}</RiderActions></Rider>;
const queued = (motion?: Motion) => <Rider label="Queued" motion={motion}><RiderTitle>Steering</RiderTitle><Lines><Line text="and make the second paragraph shorter" /><Line text="then rename the file to lorem.txt, and add a heading at the top that says what it is" clipped /></Lines>
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
  return <div ref={box} class="g-composer">
    <QuestionCard request={{ id: questions[0]!.id, kind: "question", questions, notes: extra.notes }} onStop={() => {}} onRespond={() => {}} />
  </div>;
};
const LANGUAGE = q("lang", "Preferred language", "Which programming language should I use for this task?",
  [["Python", "Use Python for the task"], ["TypeScript", "Use TypeScript for the task"], ["Rust", "Use Rust for the task"]]);
const TABS = [
  q("fmt", "Format", "Which sections should the file have?", [["A heading", "a title line at the top"], ["Paragraphs", ""], ["A list", "the main points, bulleted"]], { multiSelect: true, freeform: false }),
  q("len", "Length", "How long should the second paragraph be?", [["Two sentences", "the shortest that keeps its point", { format: "monospace", text: "Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit." }], ["Half as long", ""], ["Keep it", "leave the paragraph as it is"]],
    { freeform: { placeholder: "Or say how long", multiline: true } }),
];
const SUMMARY = [q("name", "File name", "What should the file be called?", [], { freeform: { initial: "lorem.txt" } }), q("key", "API key", "Paste the key it should use", [], { secret: true, required: false })];

// Overlay: the app's large surfaces, drawn from the library's pieces.
// The command prompt's ">" is a mark like search's, drawn the same.
const glyph = () => <ChevronRightIcon />;
const paletteList = () => <OverlayList>
  <Section title="This chat"><Item icon={<PaperclipIcon />} active>Attach files</Item><Item icon={<FileTextIcon />} keys={["Ctrl", "Shift", "S"]}>Stash prompt</Item><Item icon={<PencilIcon />}>Rename chat</Item><Item icon={<CopyIcon />}>Copy last response</Item></Section>
  <Section title="Go to"><Item icon={<SquarePenIcon />} opens keys={["Ctrl", ","]}>Settings…</Item><Item icon={<MessageSquareIcon />} opens keys={["Ctrl", "Shift", "K"]}>Search chats…</Item><Item icon={<PanelLeftIcon />} opens>Workspace views…</Item></Section>
  <Section title="View"><Item icon={<PanelLeftCloseIcon />} keys={["Ctrl", "B"]}>Toggle sidebar</Item><Item icon={<PanelRightIcon />} keys={["Ctrl", "."]}>Toggle workspace panel</Item></Section>
</OverlayList>;
const paletteHints = () => <OverlayHints start={[[["↑", "↓"], "Navigate"], [["Enter"], "Open"]]} end={[[["Esc"], "Close"]]} />;
const SortToggle = () => { const [sort, setSort] = createSignal<"latest" | "created">("created"); return <Segmented label="Chat sort" size="sm" value={sort()} onChange={setSort} options={[{ value: "latest", label: "Latest" }, { value: "created", label: "Created" }]} />; };
const chatRows = (query = "") => <OverlayList>
  <Section title="Recent"><Item icon={<SquarePenIcon />} meta="18:29" active><Match text="Untitled chat" query={query} /></Item><Item icon={<HarnessMark id="opencode" />} meta="9 Oct"><Match text="Short Sprint Workout Plan" query={query} /></Item><Item icon={<HarnessMark id="opencode" />} meta="8 Oct"><Match text="Wispah V3 Lodge" query={query} /></Item></Section>
  <Section title="Folders"><Item icon={<FolderIcon />} meta="3 · 25 Sept" opens>Japan</Item><Item icon={<FolderIcon />} meta="0" opens>NHP</Item><Item icon={<FolderIcon />} meta="3 · 26 Sept" opens>Conduit</Item></Section>
</OverlayList>;
/* Chat search's preview, drawn by the library's Glance from what the app would read; the orb is the library's Orb. */
const orb = (done: boolean) => <Orb state="working" frame={done ? PLAIN_SPHERE : SPUTTERING_SPHERE} tint={done ? undefined : "var(--destructive)"} rate={settledOrbRate(!done)} />;
const glanceChat = () => <Glance label="Chat preview"><GlanceHead mark={<HarnessMark id="opencode" />} title="Untitled chat" facts={["OpenCode · Chats · 18:30"]} />
  <GlancePrompt>ask me a question using the question tool</GlancePrompt><GlanceTurn orb={orb(true)} outcome="Done" detail="42s · 1 tool" />
  <GlanceAnswer>I'll ask you a question using the question tool. Which of these would you like to try first: a short sprint workout, a longer endurance session, or a mobility routine?</GlanceAnswer></Glance>;
const glanceStopped = () => <Glance label="Chat preview"><GlanceHead mark={<HarnessMark id="claude" />} title="Short Sprint Workout Plan" facts={["Claude Code · Japan · 9 Oct"]} />
  <GlancePrompt>make the plan two weeks, three sessions a week, and keep each under 30 minutes</GlancePrompt><GlanceTurn orb={orb(false)} outcome="Interrupted" detail="2m 10s · 3 edits · 2 commands" />
  <GlanceAnswer>Here's a two-week plan, three sessions a week. Week one builds the base: short sprints with long rests, then</GlanceAnswer></Glance>;
const math = katex.renderToString("\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}", { displayMode: true, throwOnError: false });
const glanceMath = () => <Glance label="Chat preview"><GlanceHead mark={<HarnessMark id="opencode" />} title="Wispah V3 Lodge" facts={["OpenCode · Chats · 8 Oct"]} />
  <GlancePrompt>why does the sum of the first n numbers come to n(n+1)/2?</GlancePrompt><GlanceTurn orb={orb(true)} outcome="Done" detail="18s" />
  <GlanceAnswer html={`<p>Pair the first term with the last, the second with the second-to-last, and so on:</p>${math}<p>Each pair sums to n + 1, and there are n/2 of them.</p>`} /></Glance>;
const glanceFolder = () => <Glance label="Folder preview"><GlanceHead mark={<FolderIcon />} title="Japan" facts={["~/projects/japan", "3 chats · 1 running"]} />
  <Section><Item icon={<HarnessMark id="claude" />} meta="9 Oct">Short Sprint Workout Plan</Item><Item icon={<HarnessMark id="opencode" />} meta="26 Sept">Gassho House Stays in Japan</Item><Item icon={<HarnessMark id="opencode" />} meta="25 Sept">Varied dog question formats</Item></Section></Glance>;
const glanceEmpty = (text: string) => () => <Glance label="Chat preview"><GlanceEmpty>{text}</GlanceEmpty></Glance>;
const chatPreview = glanceChat;
/* Chat search's tree: a folder open in place (its chevron turns; its search shows under the cursor), its chats in under it, Browse all; picked: an edit's check column. */
const chatTree = (edit: boolean) => <>
  <Section title="Recent"><Item role="treeitem" icon={<HarnessMark id="claude" />} meta="9 Oct" picked={edit ? true : undefined} active={edit}>Short Sprint Workout Plan</Item><Item role="treeitem" icon={<HarnessMark id="opencode" />} meta="8 Oct" picked={edit ? false : undefined}>Wispah V3 Lodge</Item></Section>
  <Section title="Folders">
    <Item role="treeitem" aria-expanded={true} icon={<FolderIcon />} meta="3 · 25 Sept" opens onOpens={() => {}} opensLabel="Collapse Japan" active={!edit} reveal end={<Button variant="ghost" size="icon-xs" aria-label="Search in Japan"><SearchIcon /></Button>}>Japan</Item>
    <Item role="treeitem" indent icon={<HarnessMark id="claude" />} meta="9 Oct" picked={edit ? true : undefined}>Gassho House Stays in Japan</Item>
    <Item role="treeitem" indent icon={<HarnessMark id="opencode" />} meta="26 Sept" picked={edit ? false : undefined}>Gassho Houses for Six</Item>
    <Item role="treeitem" indent opens>Browse all 3 chats</Item>
    <Item role="treeitem" aria-expanded={false} icon={<FolderIcon />} meta="0" opens onOpens={() => {}} opensLabel="Expand NHP">NHP</Item>
  </Section>
</>;
const searchHints = () => <OverlayHints start={[[["Ctrl", "E"], "Edit", () => {}], [["Alt", "R"], "Rename"], [["Ctrl", "K", "D"], "Delete"]]} end={[[["/"], "Search in"], [["Ctrl", "P"], "Preview"], [["Enter"], "Open"], [["Esc"], "Close"]]} />;
const LeaderPath = () => { const [at, setAt] = createSignal(2); const levels = ["Conduit", "Chat", "Composer"];
  return <Crumbs label="Where you are" items={levels.map((label, index) => ({ label, current: index === at(), onClick: () => setAt(index) }))} />; };
const leaderRows = () => <Section><Item keysFirst keys={["1"]} active>Model</Item><Item keysFirst keys={["2"]}>Thinking level</Item><Item keysFirst keys={["A"]}>Attach files</Item><Item keysFirst keys={["S"]}>Stash prompt</Item><Item keysFirst keys={["V"]}>Toggle voice dictation</Item></Section>;
const leaderHints = () => <OverlayHints start={[[["←", "→"], "level"], [["Ctrl+Shift+1"], "Sidebar"], [["Ctrl+Shift+2"], "Main"]]} />;
/*
 * Settings: a rail of sections, and a page per section showing each kind of line the app's
 * settings hold -- a field (select, input, switch, segmented), a value read, a link out, buttons,
 * a note or details under a line, something at the page's width, a shortcut, waiting.
 */
type SettingsSection = "appearance" | "shortcuts" | "models" | "prompts" | "runtime" | "servers" | "voice" | "web";
const SETTINGS: { label: string; sections: [SettingsSection, string, () => JSX.Element][] }[] = [
  { label: "Personal", sections: [["appearance", "Appearance", () => <MonitorIcon />], ["shortcuts", "Shortcuts", () => <KeyboardIcon />]] },
  { label: "AI", sections: [["models", "Models & accounts", () => <BrainIcon />], ["prompts", "Prompts", () => <NotebookTextIcon />]] },
  { label: "System", sections: [["runtime", "Runtime", () => <ActivityIcon />], ["servers", "Servers", () => <ServerIcon />]] },
  { label: "Services", sections: [["voice", "Voice", () => <VoiceIcon />], ["web", "Web search", () => <GlobeIcon />]] },
];
const titleOf = (id: SettingsSection) => SETTINGS.flatMap((group) => group.sections).find(([key]) => key === id)![1];
function Theme() { const [value, setValue] = createSignal("dark"); return <Segmented size="sm" label="Theme" value={value()} onChange={setValue} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />; }
const reset = () => <Button variant="ghost" size="icon-sm" aria-label="Reset to default"><RefreshCwIcon /></Button>;
const keys = (...names: string[]) => <span class="g-keys">{names.map((name) => <Keycap>{name}</Keycap>)}</span>;
const SETTING_PAGES: Record<SettingsSection, { status?: string; busy?: boolean; failed?: boolean; why?: string; body: () => JSX.Element }> = {
  appearance: { status: "Saved", body: () => <>
    <SettingGroup title="Interface"><SettingLine label="Theme"><Theme /></SettingLine><SettingLine label="Interface size"><ScaleSetting /></SettingLine><SettingLine label="Sidebar chats"><Input value="20" /></SettingLine><SettingLine label="Tab row"><SwitchDemo /></SettingLine><SettingLine label="Streaming" state="paused while hidden"><SelectTrigger value="Adaptive" bare /></SettingLine></SettingGroup>
    <SettingGroup title="Reading"><SettingLine label="Transcript width"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Wide blocks"><SelectTrigger value="Off" bare /></SettingLine><SettingLine label="Terminal font"><SelectTrigger value="Meslo" bare /></SettingLine></SettingGroup>
  </> },
  shortcuts: { status: "Saved", body: () => <Shortcuts /> },
  models: { status: "Not saved", failed: true, why: "The server answered 502.", body: () => <>
    <SettingGroup title="Accounts"><SettingLine label="OpenAI" plain><SettingValue>Signed in</SettingValue><Button variant="ghost" size="sm">Sign out</Button></SettingLine><SettingLine label="Anthropic" plain><SettingLink href="#">Open sign-in</SettingLink></SettingLine>
      <SettingLine label="OpenRouter key"><Input value="sk-or-••••••••3f2a" /></SettingLine><SettingNote tone="error">That key was turned down (401). Check it has credit.</SettingNote>
      <SettingDetails summary="Where to find them"><ol><li>Open openrouter.ai/keys</li><li>Create a key, then paste it here</li></ol><p>Keys stay on this server, in <code>~/.conduit/data</code>.</p></SettingDetails></SettingGroup>
    <SettingGroup title="Providers"><SettingLine label="Gemini" plain><SettingLink href="#">Docs</SettingLink></SettingLine><SettingLine label="Default model"><SelectTrigger value="GPT-6 Luna" bare /></SettingLine></SettingGroup>
  </> },
  prompts: { status: "Saving", busy: true, body: () => <SettingGroup title="System prompt"><SettingLine label="Assistant" state="edited" plain>{reset()}</SettingLine>
    <SettingWide><TextArea value={"You are Conduit's assistant. Answer briefly, then offer to go further.\nPrefer the user's own words for things."} /></SettingWide></SettingGroup> },
  runtime: { body: () => <>
    <SettingGroup title="Processes"><SettingLine label="Running" plain><SettingValue mono>3 of 8</SettingValue></SettingLine><SettingLine label="Idle timeout"><SelectTrigger value="10 minutes" bare /></SettingLine></SettingGroup>
    <SettingGroup title="Harnesses"><SettingLoading>Loading runtime settings…</SettingLoading></SettingGroup>
  </> },
  servers: { body: () => <>
    <SettingGroup title="This server"><SettingLine label="Name" plain><SettingValue>Desktop-Dev</SettingValue></SettingLine><SettingLine label="Address" plain><SettingValue mono>a91f03c2 · TLS verified</SettingValue></SettingLine></SettingGroup>
    <SettingGroup title="Others"><SettingLine label="Laptop" state="9 ms" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" outline size="sm">Forget</Button></SettingLine>
      <SettingLine label="VPS" state="offline" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" outline size="sm">Forget</Button></SettingLine><SettingNote tone="error">Couldn't reach VPS: the connection timed out.</SettingNote></SettingGroup>
  </> },
  voice: { status: "Saved", body: () => <>
    <SettingGroup title="Dictation"><SettingLine label="Shortcut"><Input value="Ctrl+Space" readOnly title="Focus and press a shortcut" /></SettingLine><SettingLine label="Engine"><SelectTrigger value="Local" bare /></SettingLine><SettingLine label="Live captions"><SwitchDemo /></SettingLine></SettingGroup>
    <SettingGroup title="Local model"><SettingLine label="Parakeet v3" state="downloading" plain><SettingValue mono>1.2 / 3.1 GB</SettingValue></SettingLine><SettingWide><Progress label="Download" value={1.2} max={3.1} /></SettingWide></SettingGroup>
  </> },
  web: { body: () => <SettingGroup title="Search"><SettingLine label="Web search"><SwitchDemo /></SettingLine><SettingLine label="Provider"><SelectTrigger value="Brave" bare /></SettingLine><SettingLine label="Brave" plain><SettingLink href="#">Docs</SettingLink></SettingLine></SettingGroup> },
};
/** Settings · Shortcuts: a command per line, its chords as keycaps that can be pressed to record another and cleared, and + to add one. */
function Shortcuts() {
  const [bound, setBound] = createSignal<Record<string, string[]>>({ "Open command palette": ["Ctrl K"], "Search chats…": ["Ctrl Shift K"], "Settings…": ["Ctrl ,"], "Model selector…": ["Ctrl Shift X"], "Workspace views…": [], "New chat": ["Ctrl Shift C"], "New folder": [], "Stash prompt": ["Ctrl Shift S"], "Toggle sidebar": ["Ctrl B"] });
  const clear = (command: string, chord: string) => setBound((all) => ({ ...all, [command]: all[command]!.filter((key) => key !== chord) }));
  // Which command is recording, and what it has heard: the + (or a key) opens the recorder line under it.
  const [recording, setRecording] = createSignal<string | null>("Open command palette");
  const [heard, setHeard] = createSignal<string[]>([]);
  const add = (command: string) => <Button variant="ghost" size="icon-xs" aria-label="Add a shortcut" onClick={() => { setHeard([]); setRecording(command); }}><PlusIcon /></Button>;
  // The gallery's recorder hears real keys: modifiers and one key make a chord; Esc cancels, Backspace clears.
  const listen = (event: KeyboardEvent) => {
    if (!recording()) return;
    if (event.key === "Escape") { setRecording(null); return; }
    if (event.key === "Backspace") { setHeard([]); event.preventDefault(); return; }
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    event.preventDefault();
    setHeard([...(event.ctrlKey ? ["Ctrl"] : []), ...(event.altKey ? ["Alt"] : []), ...(event.shiftKey ? ["Shift"] : []), event.key.length === 1 ? event.key.toUpperCase() : event.key]);
  };
  onMount(() => { addEventListener("keydown", listen); onCleanup(() => removeEventListener("keydown", listen)); });
  return <>
    <SettingGroup title="Keyboard"><SettingLine label="Keys for" state="Chrome · Windows · Browser tab" plain><Button variant="ghost" size="sm"><RefreshCwIcon />Reset all</Button></SettingLine>
      <SettingLine label="Leader menu" state="Ctrl G"><SelectTrigger value="After a pause" bare /></SettingLine>
      <Input placeholder="Search commands, contexts, or keys…" /></SettingGroup>
    <SettingGroup title="Application"><For each={Object.keys(bound())}>{(command) => <><SettingLine label={command} plain>
      <Show when={bound()[command]!.length} fallback={<SettingValue>Not assigned</SettingValue>}>
        <For each={bound()[command]}>{(chord) => <Keycap label={`${command}: ${chord}`} onClick={() => {}} onRemove={() => clear(command, chord)}>{chord}</Keycap>}</For>
      </Show>{add(command)}</SettingLine>
      <Show when={recording() === command}><SettingRecorder keys={heard()} onCancel={() => setRecording(null)} onSave={() => { setBound((all) => ({ ...all, [command]: [...all[command]!, heard().join(" ")] })); setRecording(null); }} /></Show></>}</For></SettingGroup>
  </>;
}

/** The Interface size as a setting: the app's Appearance sets it; here it moves the whole gallery. */
const SCALE_STEPS = [["0.9", "90%"], ["1", "100%"], ["1.1", "110%"], ["1.25", "125%"]] as const;
function ScaleSetting() {
  const options = SCALE_STEPS.map(([value, label]) => ({ value, label }));
  const value = () => SCALE_STEPS.find(([step]) => Number(step) === scaleOf("--ui-scale"))?.[0] ?? "1";
  return <Segmented size="sm" label="Interface size" value={value()} options={options} onChange={(next) => setScale("--ui-scale", Number(next) === 1 ? null : Number(next))} />;
}

/** Settings: on a desktop the rail beside the page; on a phone one at a time, the page with Back to the rail. */
function Settings(props: { close: () => void; phone?: boolean; start?: SettingsSection | null }) {
  const [section, setSection] = createSignal<SettingsSection | null>(props.start === undefined ? (props.phone ? null : "appearance") : props.start);
  const rail = () => <OverlayRail title="Settings" foot={<OverlayFacts title="About"><OverlayFact label="Interface" value="0.8.1-dev.20261020063706.abb9a10" /><OverlayFact label="Running as" value="Browser tab" /><OverlayFact label="Server" value="0.8.1-dev.20261020063706.abb9a10 · modified" /></OverlayFacts>} onClose={props.phone ? props.close : undefined}>
    <For each={SETTINGS}>{(group) => <NavGroup label={group.label}><For each={group.sections}>{([id, label, glyph]) =>
      <NavRow icon={glyph()} current={!props.phone && section() === id} onClick={() => setSection(id)}>{label}</NavRow>}</For></NavGroup>}</For>
  </OverlayRail>;
  const page = (id: SettingsSection) => { const view = SETTING_PAGES[id]; return <OverlayPage title={titleOf(id)} status={view.status} busy={view.busy} failed={view.failed} why={view.why} onRetry={view.failed ? () => {} : undefined} onBack={props.phone ? () => setSection(null) : undefined} onClose={props.close}>{view.body()}</OverlayPage>; };
  return <Overlay label="Settings" layout="rail" style={props.phone ? undefined : { "--overlay-width": "calc(70.3125 * var(--u-space))", "--overlay-height": "560px" }}>
    <Show when={!props.phone || section() === null}>{rail()}</Show>
    <Show when={section()} keyed>{(id) => page(id)}</Show>
  </Overlay>;
}

/** Chat search: the list, and beside it the preview, which Ctrl+P hides and shows (remembered, as the app does). */
function ChatSearch(props: { close: () => void }) {
  const stored = () => { try { return localStorage.getItem("gallery:search-preview") !== "closed"; } catch { return true; } };
  const [preview, setPreview] = createSignal(stored());
  const toggle = () => { const next = !preview(); setPreview(next); try { localStorage.setItem("gallery:search-preview", next ? "open" : "closed"); } catch { /* private window */ } };
  return <Overlay label="Chat search" style={{ "--overlay-width": preview() ? "calc(81.25 * var(--u-space))" : "calc(56.25 * var(--u-space))", "--overlay-height": "576px" }}>
    <div class="g-contents" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") { event.preventDefault(); toggle(); } }}>
      <OverlayBar lead={<SearchIcon />} placeholder="Search chats, projects, workspaces…" value="t" end={<SortToggle />} onClose={props.close} />
      <OverlaySplit aside={preview() ? glanceChat() : undefined}>{chatRows("t")}</OverlaySplit>{searchHints()}
    </div></Overlay>;
}

/* Card: its parts measured in a prompt, then each form at each density. */
const cardScene = () => <div class="g-card-scene"><Card title="Destroy Japan?" detail="Type Japan to confirm." actions={<><Button variant="ghost" outline>Cancel</Button><Button variant="destructive">Destroy</Button></>}><Input placeholder="Japan" /></Card></div>;
const typeOf = (el: HTMLElement) => { const s = getComputedStyle(el); return px(`${s.fontSize} · ${s.fontWeight}`); };
const CARD_MARKS: Mark[] = [
  { selector: ".ui-card", label: "--card-edge: padding all round, every box meets it (1.25 units)", read: (el) => px(getComputedStyle(el).paddingTop) },
  { selector: ".ui-card > h3", label: "title: the Heading role (--text-body · --weight-strong)", read: typeOf },
  { selector: ".ui-card > p", label: "detail: the Caption role (--text-caption · muted), --card-pair under the title", read: (el) => `${typeOf(el)} · ${px(`${el.getBoundingClientRect().top - el.previousElementSibling!.getBoundingClientRect().bottom}px`)} under` },
  { selector: ".ui-card .ui-input", label: "body: the library's Input, its box on the edge, --card-gap from what is above and below", read: (el) => { const card = el.closest<HTMLElement>(".ui-card")!.getBoundingClientRect(); const r = el.getBoundingClientRect(); return `${px(`${r.left - card.left}px`)} / ${px(`${card.right - r.right}px`)} from the sides · ${px(`${r.top - el.previousElementSibling!.getBoundingClientRect().bottom}px`)} gap`; } },
  { selector: ".ui-card-actions", label: "actions: right-aligned, half a unit apart, each the widest's width", read: (el) => `${px(getComputedStyle(el).columnGap)} apart · ${[...el.children].map((b) => px(`${b.getBoundingClientRect().width}px`)).join(" = ")}` },
  { selector: ".ui-card .ui-button[data-variant='ghost']", label: "a secondary action: ghost outline, a --tint hairline", read: edge },
  { selector: ".ui-card .ui-button[data-variant='destructive']", label: "the confirm: destructive, filled red", read: bg },
  { selector: ".ui-card", label: "corner --radius-surface; at most 30 units wide (a phone: its width)", read: (el) => `${rounding(el)} · ${px(`${el.getBoundingClientRect().width}px`)} wide` },
];
function DialogBehaviorDemo(props: { alert?: boolean; busy?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(Boolean(props.busy));
  return <><Button onClick={() => { setBusy(Boolean(props.busy)); setOpen(true); }}>Open {props.busy ? "busy dialog" : props.alert ? "confirmation" : "dialog"}</Button>
    <Dialog open={open()} onOpenChange={setOpen} title="Example dialog" description="Keyboard and focus behavior" alert={props.alert} busy={busy()} close="Close example"
      actions={<><Button variant="ghost" outline disabled={busy()} onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => busy() ? setBusy(false) : setOpen(false)}>{busy() ? "Finish operation" : "Done"}</Button></>}>
      <Field label="Example name"><Input value="Example" /></Field>
    </Dialog></>;
}
function DecisionDemo() {
  const decisions = createDecisionDialogs();
  const [answer, setAnswer] = createSignal("No decision yet");
  const [valid, setValid] = createSignal(true);
  return <CardBody>
    <Button onClick={async () => setAnswer(`Confirm: ${await decisions.confirm("Discard example changes?", { destructive: true, confirmLabel: "Discard" })}`)}>Try confirmation</Button>
    <Button onClick={async () => { const value = await decisions.prompt("Rename example", "Example"); setAnswer(value === null ? "Prompt cancelled" : `Prompt: ${JSON.stringify(value)}`); }}>Try prompt</Button>
    <Button onClick={() => {
      const first = decisions.confirm("First queued decision");
      const second = decisions.prompt("Second queued decision", "Queued");
      void Promise.all([first, second]).then((values) => setAnswer(JSON.stringify(values)));
    }}>Queue two decisions</Button>
    <Button onClick={async () => { setValid(true); const pending = decisions.confirm("This target expires while open", { valid }); setValid(false); setAnswer(`Expired: ${await pending}`); }}>Try expired target</Button>
    <CardNote>{answer()}</CardNote><decisions.Host />
  </CardBody>;
}
function ExplorerDemo() {
  const [result, setResult] = createSignal("No action yet");
  const project = PROJECTS[0]!;
  const [location, setLocation] = createSignal({ project, home: "/home/you", parent: "/home", repository: false,
    listing: { truncated: false, entries: [{ name: "src", path: "src", type: "directory" as const }, { name: "README.md", path: "README.md", type: "file" as const, size: 1024 }, { name: ".hidden", path: ".hidden", type: "file" as const }] } });
  return <CardBody><ComputerExplorer dialog projects={PROJECTS} location={location()} loading={false} error=""
    onBrowse={(path) => { setResult(`Browse: ${path ?? "Home"}`); setLocation((current) => ({ ...current, project: { ...current.project, workingRoot: path ?? "/home/you" } })); }}
    onPrefetch={() => {}} onMakeWorkspace={() => setResult("Make workspace")} onCreateWorkspace={(path) => setResult(`Create workspace: ${path}`)}
    onOpenWorkspace={(target) => setResult(`Open: ${target.name}`)} onManageWorkspace={(action) => setResult(action)} onStartWorkspaceAction={(action) => setResult(action)}
    onOpenView={(view) => setResult(view)} onOpenFile={(path) => setResult(`Open: ${path}`)} onSelectFolder={() => setResult("Select folder")}
    onCreateFolder={() => setResult("Create folder")} onCloneRepository={() => setResult("Clone repository")} /><CardNote>{result()}</CardNote></CardBody>;
}
function ConnectionDemo() {
  const [address, setAddress] = createSignal("");
  const [state, setState] = createSignal<AddressState>();
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [signedIn, setSignedIn] = createSignal(false);
  const [cameraError, setCameraError] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(timer);
    setState(undefined); setPassword(""); setBusy(false); setError(""); setSignedIn(false);
  };
  const check = () => {
    reset();
    if (!address().trim()) return;
    setState("checking");
    timer = setTimeout(() => setState(address().includes("laptop") ? "found" : "missing"), 900);
  };
  const choose = (value: string) => { reset(); setAddress(value); setState("found"); };
  onCleanup(() => clearTimeout(timer));
  return <ConnectionForm onSubmit={(event) => {
    event.preventDefault();
    if (busy() || signedIn()) return;
    if (state() !== "found") { check(); return; }
    setBusy(true); setError("");
    timer = setTimeout(() => {
      setBusy(false);
      if (password() === "conduit") setSignedIn(true);
      else setError("Incorrect password.");
    }, 800);
  }}>
    <ConnectionChoices><ConnectionChoice type="button" icon={<QrCodeIcon />} detail="conduit-server pair" onClick={() => setCameraError(true)}>Scan QR code</ConnectionChoice><ConnectionChoice type="button" icon={<MonitorIcon />} detail="localhost:4310" onClick={() => choose("localhost:4310")}>This computer</ConnectionChoice></ConnectionChoices>
    <ConnectionGroup>On this network</ConnectionGroup>
    <ConnectionChoices><ConnectionChoice type="button" icon={<ServerIcon />} detail="laptop.ts.net" onClick={() => choose("laptop.ts.net")}>Laptop</ConnectionChoice></ConnectionChoices>
    <ConnectionAddress placeholder="Address or pair link" aria-label="Server address" value={address()} state={state()} onInput={(event) => {
      reset(); setAddress(event.currentTarget.value);
      timer = setTimeout(check, 600);
    }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); check(); } }} />
    <Show when={state()}>{(current) => <ConnectionStatus state={current()} title={current() === "checking" ? `Looking for ${address()}…` : current() === "found" ? "Laptop" : "Nothing answered"} detail={current() === "found" ? "laptop.ts.net · 0.8.1" : current() === "missing" ? address() : undefined} />}</Show>
    <Show when={state() === "found"}><Show when={!signedIn()} fallback={<ConnectionStatus state="found" title="Signed in" />}><ConnectionPassword reveal busy={busy()} error={error()} value={password()} disabled={busy()} onInput={(event) => setPassword(event.currentTarget.value)} /></Show></Show>
    <Show when={cameraError()}><CardNote error>Camera unavailable. Paste the pairing link.</CardNote></Show>
  </ConnectionForm>;
}
function ServerMenuDemo(props: { phone?: boolean }) {
  const [route, setRoute] = createSignal("automatic");
  const [action, setAction] = createSignal("No action yet");
  const Routes = () => <LiveMenuSection title="Route to Laptop"><LiveRadioGroup value={route()} onChange={setRoute}>
    <LiveRadioItem value="automatic" detail="Tailscale · laptop.ts.net" meta="12 ms">Automatic</LiveRadioItem>
    <LiveRadioItem value="lan" detail="192.168.1.10" meta="3 ms">This network</LiveRadioItem>
    <LiveRadioItem value="internet" away detail="laptop.example.com">Internet</LiveRadioItem>
    <LiveRadioItem value="tunnel" away detailData detail="remote.example.com" meta="41 ms">Internet</LiveRadioItem>
    <LiveRadioItem value="unreachable" disabled detailData detail="10.0.0.10">Unavailable</LiveRadioItem>
  </LiveRadioGroup></LiveMenuSection>;
  return <CardBody><LiveMenu>
    <LiveMenu.Trigger as={ServerControl} name="Laptop" detail="Connected · 12 ms" connectivity="online" />
    <LiveMenuContent>
      <LiveMenuSection title="Servers"><LiveRadioGroup value="laptop"><LiveRadioItem value="laptop" meta="12 ms">Laptop</LiveRadioItem><LiveRadioItem value="office" away>Office</LiveRadioItem><LiveRadioItem value="offline" disabled>Studio</LiveRadioItem></LiveRadioGroup>
      <LiveSub phone={props.phone}><LiveSubTrigger detailData detail={route()}>Route</LiveSubTrigger><LiveSubContent><Routes /></LiveSubContent></LiveSub></LiveMenuSection>
      <LiveMenuSection title="App"><LiveMenuRow onSelect={() => setAction("Check for updates")} icon={<RefreshCwIcon />}>Check for updates</LiveMenuRow></LiveMenuSection>
      <LiveMenuSection title="Account"><LiveMenuRow onSelect={() => setAction("Connect a device or server")} icon={<QrCodeIcon />}>Connect a device or server</LiveMenuRow><LiveMenuRow onSelect={() => setAction("Manage settings")} icon={<SettingsIcon />}>Manage settings</LiveMenuRow><LiveMenuRow destructive onSelect={() => setAction("Sign out")} icon={<LogOutIcon />}>Sign out</LiveMenuRow></LiveMenuSection>
    </LiveMenuContent>
  </LiveMenu><CardNote>{action()}</CardNote></CardBody>;
}
const CONNECTIONS: FormRow[] = [
  form("browser sign-in", "plain form POST, password-manager autocomplete and autofocus", () => <ConnectionScreen embedded><PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/" /></ConnectionScreen>, "ConnectionScreen > PasswordSignIn", "the same component generates /login without JavaScript"),
  form("incorrect password", "the field identifies and describes the server error", () => <PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/chat/example" error="Incorrect password." />, "PasswordSignIn error", "aria-invalid · aria-describedby · role=alert"),
  form("address · checking", "the address check is in progress", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="laptop.ts.net" state="checking" /><ConnectionStatus state="checking" title="Looking for laptop.ts.net…" /></ConnectionForm>, "ConnectionAddress · ConnectionStatus · ConnectionPassword"),
  form("address · found, password", "the server answered and asks for a password", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="laptop.ts.net" state="found" /><ConnectionStatus state="found" title="Laptop" detail="laptop.ts.net · 0.8.1" /><ConnectionPassword /></ConnectionForm>, "ConnectionAddress · ConnectionStatus · ConnectionPassword"),
  form("address · nothing answered", "the address check found no server", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="office.ts.net" state="missing" /><ConnectionStatus state="missing" title="Nothing answered" detail="office.ts.net" /></ConnectionForm>, "ConnectionAddress · ConnectionStatus · ConnectionPassword"),
  form("rate limited", "the server keeps the redirect and explains the wait", () => <PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/" error="Too many failed attempts. Try again shortly." />, "PasswordSignIn error", "server keeps rate limiting and credential handling"),
  form("first connection / add server", "live: type an address and it looks for it; one with \"laptop\" in it is found and asks for a password (\"conduit\" signs in), anything else answers nothing", () => <ConnectionDemo />, "ConnectionForm · ConnectionChoice · ConnectionAddress · ConnectionStatus · ConnectionPassword", "uses v2 at every stage"),
  form("phone route panel", "Back returns to the parent; the opening tap cannot select a route", () => <ServerMenuDemo phone />, "Kobalte Sub > v2 MenuPanel", "same submenu behavior adapter on desktop and phone"),
  form("server selection", "keyboard choice, unavailable rows and a real route submenu", () => <ServerMenuDemo />, "Kobalte > v2 Menu · Section · Item", "no network calls or stored server changes"),
  ...["online", "connecting", "reconnecting", "offline"].map((state) => form(state, "connection state on the server control", () => <ServerControl name="Laptop" detail={state === "offline" ? "Server unavailable" : state === "online" ? "Connected · 12 ms" : state === "reconnecting" ? "Reconnecting" : "Connecting"} connectivity={state} />, "ServerControl > StatusDot · Spinner", "shared status and type tokens")),
  form("inline control", "a desktop rail's foot: the state after the name, on one line", () => <ServerControl inline name="Laptop" detail="Connected · 12 ms" connectivity="online" />, "<ServerControl inline>"),
  form("collapsed control", "same status and accessible name in a narrow rail", () => <ServerControl compact name="Laptop" detail="Reconnecting" connectivity="reconnecting" aria-label="Laptop · Reconnecting" />, "ServerControl compact", "the caller supplies layout state, never styling"),
  form("recovery", "a root error and the existing reload action", () => <ConnectionRecovery embedded title="Conduit hit a UI error" error="The interface could not load." onRetry={() => {}} retryLabel="Reload Conduit" />, "ConnectionRecovery", "shared access layout and controls"),
];
const CARDS: FormRow[] = [
  form("async decisions", "confirm, prompt, queue, cancellation and stale target guard", () => <DecisionDemo />, "createDecisionDialogs > Dialog", "the live app's shared decision queue"),
  form("workspace identity", "mark, icon search, palette and custom colour; Save retains the draft", () => <WorkspaceAppearanceEditor compact onSave={() => {}} />, "WorkspaceAppearanceEditor > IdentityEditor", "v2 controls and tokens"),
  form("folder explorer", "search, sort, tiles/details, hidden files and context menus", () => <ExplorerDemo />, "ComputerExplorer > Browser", "same presentation as the live folder dialog"),
  form("server connection", "choices, address, password, loading and errors", () => <ConnectionDemo />, "ConnectionForm > ConnectionAddress · ConnectionStatus · ConnectionPassword", "no discovery or connection requests"),
  form("camera preview", "camera display and cancel, without opening a real camera", () => <CameraPreview videoRef={() => {}} message="Point the camera at a pairing code" onClose={() => {}} />, "CameraPreview", "the real scanner's v2 presentation"),
  form("code excerpt", "real read-only code with line numbers and highlighted selection", () => <WorkspaceExcerptView path="example.ts" text={"const total = 42;\nconsole.log(total);"} firstLine={12} startColumn={7} endColumn={13} />, "WorkspaceExcerptView > CodeExcerpt", "CodeMirror uses v2 syntax and size tokens"),
  form("modal", "focus is trapped, Escape or a press on the dim closes; focus returns to the trigger", () => <DialogBehaviorDemo />, "Dialog > Scrim + Card", "Kobalte behavior, v2 surface"),
  form("modal alert", "a press on the dim does not dismiss a confirmation", () => <DialogBehaviorDemo alert />, "<Dialog alert>", "Kobalte alert-dialog"),
  form("modal busy", "Escape, the dim and close cannot dismiss while busy; finish releases the dialog", () => <DialogBehaviorDemo busy />, "<Dialog busy>", "all dismissal paths share the busy guard"),
  form("shared parts", "forms, actions, notes, paths and previews use the Card's spacing", () => <Card title="Shared dialog parts"><CardForm onSubmit={(event) => event.preventDefault()}><CardBody><Field label="Name"><Input value="Example" /></Field><CardRead>src/example.ts</CardRead><CardNote>Supporting text</CardNote><CardPreview><Read>Selected source</Read></CardPreview><CardDetails><dt>Server</dt><dd>Laptop</dd></CardDetails><CardQR svg="" expired /></CardBody><CardActions><Button type="submit">Save</Button></CardActions></CardForm></Card>, "CardForm · CardBody · CardActions · CardRead · CardNote · CardPreview · CardDetails · CardQR", "v2 tokens only"),
  form("title", "a card says what it is about", () => <Card title="Delete this chat?" />, "<Card title>", "Heading: --text-body · --weight-strong"),
  form("title · detail", "a line --card-pair under the title, only when it asks something of you: never what the title already says", () => <Card title="Destroy Japan?" detail="Type Japan to confirm." />, "<Card title detail>", "Caption: --text-caption · muted, --card-pair under the title"),
  form("body", "what the card holds: one field, a list, a preview", () => <Card title="Rename chat"><Input value="Lorem ipsum file" /></Card>, "<Card title>{children}</Card>", "1 unit between parts; the Input's well and line are the surface's"),
  form("actions", "its buttons, right-aligned: the place picks each form", () => <Card title="Save changes?" actions={<><Button variant="ghost" outline>Cancel</Button><Button outline>Save</Button></>} />, "<Card actions={<>…</>}>", "half a unit apart · primary outline, ghost outline"),
  form("alert", "confirms what cannot be undone (Dialog alert)", () => <Card title="Delete this chat?" actions={<><Button variant="ghost" outline>Cancel</Button><Button variant="destructive">Delete</Button></>} />, "<Card title detail actions>", "the confirm destructive, filled"),
  form("prompt", "one field and its answer (Dialog)", () => <Card title="Rename chat" actions={<><Button variant="ghost" outline>Cancel</Button><Button outline>Save</Button></>}><Input value="Lorem ipsum file" /></Card>, "<Card title actions>{<Input />}</Card>", "a one-field prompt drops its label"),
];

/*
 * In the app: every dialog the app opens, rebuilt from its real content with v2 alone. Lines
 * that only restate the title are left out (DESIGN.md Dialog). Under each: its file, and what v2
 * still lacks for it, or that it has all of it.
 */
const status = (needs?: string) => needs ? `Needs: ${needs}` : "v2 has all of it";
/** A fresh Cancel each time: one element can only be in one place. */
const cancel = () => <Button variant="ghost" outline>Cancel</Button>;
const files = [{ name: "M105525021_AAMI_incident_form_completed_signed.pdf", detail: "940 KB · application/pdf", icon: () => <FileTextIcon /> }, { name: "notes.txt", detail: "2.1 KB · text/plain", icon: () => <FileTextIcon /> }];
const IN_APP: FormRow[] = [
  form("Rename chat · folder · terminal", "one name, then Rename", () => <Card title="Rename chat" actions={<>{cancel()}<Button outline>Rename</Button></>}><Field label="Name"><Input value="Lorem ipsum file" /></Field></Card>, "navigation/sidebar.tsx · remotes/terminal-pane.tsx", status()),
  form("Edit shortcut", "the terminal's shortcut, from its shortcuts menu: name, command, which shell, and whether /terminal runs it on start", () => <Card title="Edit shortcut" description="A command you run often, one press from the terminal's header." actions={<>{cancel()}<Button outline>Save</Button></>}><Field label="Name"><Input value="Dev" /></Field><Field label="Command"><Input value="npm run dev" /></Field><Field plain label="Runs in"><Segmented label="Runs in" value="current" options={[{ value: "current", label: "This shell" }, { value: "new", label: "New shell" }]} onChange={() => {}} /></Field><Field inline label="Also run it when /terminal starts or recovers a shell"><SwitchDemo /></Field></Card>, "remotes/terminal-pane.tsx · Field plain, Field inline", status()),
  form("New folder", "a display name, then Create folder", () => <Card title="New folder" actions={<>{cancel()}<Button outline>Create folder</Button></>}><Field label="Display name"><Input placeholder="Research" /></Field></Card>, "navigation/sidebar.tsx", status()),
  form("Delete chat · chats", "the sidebar's and chat search's delete", () => <Card title="Delete 3 chats?" actions={<>{cancel()}<Button variant="destructive">Delete 3 chats</Button></>} />, "navigation/sidebar.tsx · navigation/command-menu.tsx", status()),
  form("Delete workspace and files", "type its name to confirm; Delete waits until it matches", () => <Card title="Delete workspace and files?" detail="Type the workspace's name, Japan, to continue." actions={<>{cancel()}<Button variant="destructive" disabled><Trash2Icon />Delete workspace</Button></>}><Field label="Workspace name"><Input /></Field></Card>, "project/dashboard.tsx", status()),
  form("Open external link", "the address, shown before it opens", () => <Card title="Open external link?" actions={<>{cancel()}<Button outline>Open link</Button></>}><CardRead>https://example.com/a/long/path?q=1&amp;ref=conduit</CardRead></Card>, "chat/external-link-dialog.tsx", status()),
  form("Attachments", "every file on the draft, opened from the strip: remove one, or all", () => <Card size="wide" title="2 attachments" actions={<><Button variant="ghost" outline>Remove all</Button><Button outline>Done</Button></>}><CardAttachments><For each={files}>{(file) => <CardAttachment name={file.name} detail={file.detail} icon={file.icon()} onRemove={() => {}} />}</For></CardAttachments></Card>, "chat/attachment-strip.tsx", status()),
  form("Edit review comment", "the excerpt it is on, and its text", () => <Card size="wide" close title="Edit review comment" detail="src/main.tsx · lines 12–14" actions={<>{cancel()}<Button outline>Save comment</Button></>}><Preview>{"const total = items.reduce(\n  (sum, item) => sum + item.size, 0);"}</Preview><TextArea value="This could use the size label helper." /></Card>, "chat/review-comment-cards.tsx", status()),
  form("Connect", "pair this server as a QR, or add another", () => <Card size="split" close title="Connect"><CardColumns><CardColumn title="Pair a device"><div class="g-slot g-qr">QR code</div><CardCaption>laptop.ts.net</CardCaption><CardDetails><dt>Opens on</dt><dd>Tailscale</dd><dt>Code</dt><dd>Single use · 4:52</dd></CardDetails><CardActions><Button variant="ghost">Copy link</Button><Button variant="ghost" outline>New code</Button></CardActions></CardColumn><CardColumn title="Add server"><Input aria-label="Server address" placeholder="Address or pair link" /><Button variant="ghost" outline><QrCodeIcon />Scan QR code</Button><Button outline>Connect</Button></CardColumn></CardColumns></Card>, "navigation/pair-dialog.tsx · main.tsx (ServerConnectForm)", status()),
  form("Workspace identity", "a short mark or an icon, then its colour", () => <Card size="wide" close title="Workspace identity" actions={<Button outline>Save</Button>}><Segmented label="Kind" value="mark" options={[{ value: "mark", label: "Mark" }, { value: "icon", label: "Icon" }]} onChange={() => {}} /><Field label="Mark"><Input value="JP" /></Field></Card>, "main.tsx · project/dashboard.tsx (WorkspaceAppearanceEditor)", status()),
];

/* Toast: measured in use, each kind and form at each density, and every toast the app raises. */
function LiveNotifications() {
  const toasterId = createUniqueId();
  const emitted = new Set<string | number>();
  const [actions, setActions] = createSignal(0);
  const show = (kind: "success" | "info" | "warning" | "error", repeat = false) => {
    emitted.add(toast[kind]("Example notification", {
      toasterId, id: repeat ? `${toasterId}-repeat` : undefined, duration: 8000,
      description: "The real Sonner host with the library's frost frame.",
      action: { label: "Count action", onClick: () => setActions((count) => count + 1) },
    }));
  };
  onCleanup(() => { emitted.forEach((id) => toast.dismiss(id)); });
  return <div class="g-stack">
    <div class="g-row"><Button onClick={() => show("success")}>Show success toast</Button><Button variant="ghost" outline onClick={() => show("error")}>Show error toast</Button></div>
    <div class="g-row"><Button variant="ghost" outline onClick={() => show("info", true)}>Repeat same toast</Button><Button variant="ghost" outline onClick={() => emitted.forEach((id) => toast.dismiss(id))}>Dismiss demo toasts</Button></div>
    <CardNote>Actions run: {actions()}. Hover to pause; use × or swipe to dismiss. Each notification lasts eight seconds.</CardNote>
    <NotificationToaster id={toasterId} />
  </div>;
}
const toastScene = () => <div class="g-card-scene"><Toaster><Toast kind="info" action={{ label: "Open workspace" }}>This folder is the Japan workspace.</Toast><Toast kind="success">Renamed chat to Trip notes</Toast></Toaster></div>;
const TOAST_MARKS: Mark[] = [
  { selector: ".ui-toast", label: "raised frost, --radius-surface; at most 25 units wide (a phone: its width)", read: (el) => `${rounding(el)} · ${px(`${el.getBoundingClientRect().width}px`)} wide` },
  { selector: ".ui-toast-icon", label: "its kind: a glyph in the state's colour, on the first line", read: (el) => fg(el) },
  { selector: ".ui-toast-text", label: "the sentence: the Row role, wrapping under its own start", read: (el) => typeOf(el) },
  { selector: ".ui-toast .ui-button[data-outline]", label: "an action, when there is one thing to do: ghost outline, sm, under the sentence", read: (el) => `${px(`${el.getBoundingClientRect().height}px`)} tall` },
  { selector: ".ui-toast-close", label: "dismiss: a ghost ×, muted", read: (el) => px(`${el.getBoundingClientRect().width}px`) },
  { selector: ".ui-toaster", label: "the stack: newest at the edge, 0.375 units apart", read: (el) => px(getComputedStyle(el).rowGap) },
];
const TOASTS: FormRow[] = [
  form("success", "something you did, done", () => <Toast kind="success">Renamed chat to Trip notes</Toast>, '<Toast kind="success">', "glyph --live"),
  form("info", "worth knowing, nothing wrong", () => <Toast kind="info">Workspace files updated</Toast>, '<Toast kind="info">', "glyph --muted-foreground"),
  form("warning", "it went ahead another way", () => <Toast kind="warning">gpt-5 is unavailable. Using gpt-5-mini.</Toast>, '<Toast kind="warning">', "glyph --warn"),
  form("error", "it did not happen: an alert", () => <Toast kind="error">Could not reach the server to update.</Toast>, '<Toast kind="error">', "glyph --destructive · role alert"),
  form("action", "one thing to do about it", () => <Toast kind="error" action={{ label: "Ask Runtime" }}>The model stopped: context window exceeded.</Toast>, "<Toast action={{ label, onClick }}>", "Button ghost outline sm, under the sentence"),
  form("description", "an explanation under the notification", () => <Toast description="Large pastes are attached so they do not fill the model's context." action={{ label: "Paste inline" }}>Pasted text attached as paste.txt</Toast>, "<Toast description action>", "Caption role under the sentence"),
  form("long", "a path or names wrap; nothing is cut", () => <Toast kind="success">Moved src/client/chat/attachment-strip.tsx to src/client/composer/</Toast>, "<Toast>", "overflow-wrap anywhere"),
];
const TOASTS_IN_APP: FormRow[] = [
  form("Files", "the workspace's own file actions, and changes it notices", () => <Toaster><Toast kind="info">Workspace files updated</Toast><Toast kind="success">Deleted notes/draft.md</Toast></Toaster>, "workspace/workspace-files.tsx · workspace-poll.ts", "success, info · no action"),
  form("Copied and renamed", "what a menu action did", () => <Toast kind="success">3 chat links copied</Toast>, "main.tsx", "success · no action"),
  form("Model fallbacks", "a model or thinking level that is gone, and what replaced it; one at a time (id)", () => <Toast kind="warning">This chat's previous model gpt-5 is no longer scoped. It resumed with gpt-5-mini.</Toast>, "main.tsx · state/model-settings.ts", "warning, info · 6–8 s · deduped by id"),
  form("Request failed", "a turn's error, with a way to ask about it", () => <Toast kind="error" action={{ label: "Ask Runtime" }}>The model stopped: context window exceeded.</Toast>, "main.tsx (diagnostic)", "error · 12 s · action"),
  form("A folder that is a workspace", "an offer: open it", () => <Toast kind="info" action={{ label: "Open workspace" }}>This folder is the Japan workspace.</Toast>, "main.tsx", "info · action · deduped by id"),
  form("Panes and layout", "why a pane could not open or move", () => <Toast kind="info">There is no room for another pane.</Toast>, "main.tsx", "info · no action"),
  form("Settings and voice", "a setting not saved, a microphone gone", () => <Toast kind="error">Voice not saved: the selected microphone is no longer available.</Toast>, "settings/settings-core.tsx · chat/composer.tsx", "error · no action"),
];

/* Transcript: a turn measured, each piece's forms, and a conversation, all from v2 (the orb is the library's Orb, passed in). */
const liveOrb = () => <Orb state="working" />;
const ANSWER_HTML = `<p>Created <code>lorem_ipsum.txt</code> in this folder, with <a href="#">three paragraphs</a> of lorem ipsum.</p><ul><li>The first is the classic opening.</li><li>The second is now two sentences.</li></ul><blockquote><p>Lorem ipsum dolor sit amet. Consectetur adipiscing elit.</p></blockquote>`;
const copyRetry = () => <><Button variant="ghost" size="icon-xs" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-xs" aria-label="Retry"><RefreshCwIcon /></Button></>;
const turnScene = () => <div class="g-card-scene"><Transcript><Turn>
  <TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" latest="Edited lorem_ipsum.txt" opens />
  <Answer html={ANSWER_HTML} />
  <MessageFoot time="22:16">{copyRetry()}</MessageFoot>
</Turn></Transcript></div>;
const TURN_MARKS: Mark[] = [
  { selector: ".ui-trace", label: "the trace header: the orb, Status · time · work (the Row role), the latest line muted", read: (el) => typeOf(el.querySelector(".ui-trace-line")!) },
  { selector: ".ui-answer", label: "the answer: the Body role at 1.66, no bubble", read: (el) => `${typeOf(el)} · ${px(getComputedStyle(el).lineHeight)}` },
  { selector: ".ui-answer > ul", label: "one gap between blocks: --answer-gap (0.75 units)", read: (el) => px(getComputedStyle(el).marginTop) },
  { selector: ".ui-answer code", label: "inline code: the code face on the tint", read: (el) => typeOf(el) },
  { selector: ".ui-answer blockquote", label: "a quote: a --tint line, muted", read: (el) => fg(el) },
  { selector: ".ui-message-foot", label: "the foot: the time first (caption, tabular), then icon-xs buttons", read: (el) => typeOf(el) },
  { selector: ".ui-turn", label: "a turn's parts, half a unit apart", read: (el) => px(getComputedStyle(el).rowGap) },
];
const ANSWER_FORMS: FormRow[] = [
  form("paragraph", "prose, with inline code and a link", () => <Answer html={'<p>Run <code>npm run gallery</code>, then open <a href="#">the gallery</a>.</p>'} />, "<Answer html>", "Body · 1.66 · link underline at 45%"),
  form("headings", "a title, then sections", () => <Answer html={"<h1>Trip notes</h1><p>Three days in Kyoto.</p><h2>Day one</h2><p>Fushimi Inari at dawn.</p>"} />, "h1 · h2 · h3", "h1 Heading; h2, h3 Body at strong"),
  form("lists", "bulleted and numbered", () => <Answer html={"<ol><li>Pack the night before.</li><li>Leave by seven.</li></ol><ul><li>Water</li><li>Rail pass</li></ul>"} />, "ul · ol", "1.5em in · 2xs between items"),
  form("quote", "quoted text", () => <Answer html={"<blockquote><p>Lorem ipsum dolor sit amet.</p></blockquote>"} />, "blockquote", "a --tint line · muted"),
  form("table", "scrolls inside itself when wide", () => <Answer html={"<table><thead><tr><th>Day</th><th>Where</th><th>Time</th></tr></thead><tbody><tr><td>1</td><td>Fushimi Inari</td><td>06:00</td></tr><tr><td>2</td><td>Arashiyama</td><td>08:30</td></tr></tbody></table>"} />, "table", "Row role · --tint cells · sm md padding"),
  form("in its scroll box", "a renderer's table (ANSWER_MARKDOWN.table): fills the column, scrolls when wide", () => <Answer html={`<div class="${ANSWER_MARKDOWN.table}"><table><thead><tr><th>Property</th><th>Reno</th><th>CUBIC</th></tr></thead><tbody><tr><td>Growth</td><td>Linear</td><td>Cubic in time since the last loss</td></tr></tbody></table></div>`} />, "ANSWER_MARKDOWN.table", "cells 5em to 32ch · words whole"),
  form("citations", "links whose text is their URL, as host chips", () => <Answer html={'<p>Slow start is in the standard. <a href="#" data-citation="true">rfc-editor.org</a><a href="#" data-citation="true">wikipedia.org</a></p>'} />, "[data-citation]", "caption · round · --tint line"),
  form("formula", "display math centred, scrolling from its start when wider", () => <Answer html={`<p>The window after a loss:</p>${katex.renderToString("cwnd \\leftarrow \\max(cwnd / 2,\\ 2 \\cdot MSS)", { displayMode: true })}`} />, ".katex-display", "centred · scrolls · paints alone"),
];
const MESSAGE_FORMS: FormRow[] = [
  form("a word", "never narrower than tall", () => <Transcript><Message time="00:08">hi</Message></Transcript>, "<Message time>", "min-width one line · --radius-message"),
  form("a line", "a third of a line above and below", () => <Transcript><Message time="00:08">use the question tool to ask me about dogs</Message></Transcript>, "", "padding md · lg (the composer's text inset)"),
  form("folded", "past its fold (Settings · Transcript): cut at the fold, the last line fading, Show more", () => <Transcript><Message time="00:08" fold={3}>{Array.from({ length: 6 }, (_, i) => `line ${i + 1} of a long message`).join("\n")}</Message></Transcript>, "<Message fold open onToggle>", "-webkit-line-clamp · caption"),
  form("several lines", "wraps inside the column, the radius held", () => <Transcript><Message time="00:08">{"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam."}</Message></Transcript>, "", "max-width --measure-2xl"),
];
const TRACE_FORMS: FormRow[] = [
  form("live", "a turn running: what it is doing, ticking", () => <TraceHeader orb={liveOrb()} status="Reading" time="12s" work="3 reads" latest="Reading src/client/chat/transcript.tsx" opens />, "<TraceHeader status time work latest opens>", "Row role · status strong · time tabular"),
  form("done", "settled", () => <TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" latest="Edited lorem_ipsum.txt" opens />, "", "the orb turns slowly"),
  form("interrupted", "stopped by the reader", () => <TraceHeader orb={orb(false)} status="Interrupted" time="41s" work="2 commands" opens />, "", "the orb sputters in --destructive"),
  form("no trail", "no thinking or tools: the first line alone, nothing to open", () => <TraceHeader orb={orb(true)} status="Done" time="3s" />, "<TraceHeader> without opens", "not a button you can press"),
  form("disclosure", "anything that folds: a header, one turning chevron, a body (the caller animates it)", () => <DisclosureDemo />, "<Disclosure header open onToggle>", "Row role, muted · chevron icon-sm, turns 180°"),
  form("trail", "the opened trace: a light line a step", () => <><TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" opens open /><Trail><Step icon={<FileTextIcon />} verb="Read" subject="src/main.tsx" time="0.4s" /><Step icon={<PencilIcon />} verb="Edited" subject="lorem_ipsum.txt" time="1.2s" /><Step icon={<TerminalIcon />} verb="Ran" subject="npm test" time="14s" state="failed" /><Step verb="Running" subject="npm run build" state="running" /></Trail></>, "<Trail><Step icon verb subject time state>", "Row role · subject code face, muted · failed in --destructive"),
  form("foot", "an answer's: time, Copy, Retry; a message's: time, Edit, at the right", () => <div class="g-feet"><MessageFoot time="22:16">{copyRetry()}</MessageFoot><MessageFoot time="22:14" end><Button variant="ghost" size="icon-xs" aria-label="Edit"><PencilIcon /></Button></MessageFoot></div>, "<MessageFoot time end>", "caption · tabular · icon-xs ghost"),
  form("foot · stopped", "an answer that did not finish says so after its time", () => <MessageFoot time="22:16" status="Interrupted">{copyRetry()}</MessageFoot>, "<MessageFoot status>", "status: Strong weight, foreground"),
  form("stopped before answering", "in the answer's place when nothing was written", () => <StopLine detail="before answering" />, "<StopLine detail>", "stop mark icon-xs, filled · Interrupted strong · Row size, muted"),
  form("foot · changes", "a turn that changed files: its counts open them in Agent changes", () => <MessageFoot time="22:16">{copyRetry()}<Changes added={42} removed={7} label="Open the turn's changes" /></MessageFoot>, "<Changes added removed onOpen>", "data face, caption · added --status-success, removed --destructive"),
  form("failed", "a request that failed, in the answer's place (in a trail it is a TraceError)", () => <Failure time="22:16" facts={["Model: gpt-5", "Provider: openai", "Profile: Assistant"]} message={"429 Too Many Requests: rate limit reached for requests"} />, "<Failure time facts message>", "head --destructive · facts data face, caption · the message in a code box"),
  form("harness prompt", "a prompt the harness sent on its own: a muted line, no bubble, no actions", () => <Transcript><HarnessPrompt>Background task finished: npm run build</HarnessPrompt></Transcript>, "<HarnessPrompt>", "Row size, muted · bell icon-sm"),
  form("rows", "a long chat drawn row by row: a turn's answer row goes on under its trace row", () => <Transcript><TranscriptRow><LoadingEarlier /></TranscriptRow><TranscriptRow><Message time="22:14">make it shorter</Message></TranscriptRow><TranscriptRow><TraceHeader orb={orb(true)} status="Done" time="9s" /></TranscriptRow><TranscriptRow turn><Answer html={"<p>Done: two paragraphs, half the length.</p>"} /></TranscriptRow></Transcript>, "<TranscriptRow turn> · <LoadingEarlier>", "message gap 3xl · a turn's row md under the row above"),
];
function DisclosureDemo() {
  const [open, setOpen] = createSignal(true);
  return <Disclosure header={<span>The second paragraph has four sentences</span>} open={open()} onToggle={() => setOpen(!open())}><Answer html={"<p>Keep the first two; they carry the point.</p>"} /></Disclosure>;
}
/* Trace: every behaviour, from the library's pieces. A step that opens holds its own open state here (the app's
   transcript holds it per tool). */
type StepProps = Parameters<typeof Step>[0];
const Fold = (props: StepProps & { initial?: boolean }) => { const [open, setOpen] = createSignal(props.initial ?? false); return <Step {...props} open={open()} onToggle={() => setOpen(!open())} />; };
const FoldTrace = (props: Omit<Parameters<typeof Trace>[0], "open" | "onToggle"> & { initial?: boolean }) => { const [open, setOpen] = createSignal(props.initial ?? true); return <Trace {...props} open={open()} onToggle={() => setOpen(!open())} />; };
const OUTPUT = Array.from({ length: 14 }, (_, i) => `drwxr-xr-x  ${String(i + 2).padStart(2)} jask  staff  ${448 + i * 32}  Oct 16 22:${String(10 + i).padStart(2, "0")}  dir-${i}`).join("\n");
function TruncatedOutput() { const [full, setFull] = createSignal(false); const text = () => full() ? OUTPUT : OUTPUT.split("\n").slice(-5).join("\n"); return <StepOutput text={text()} hidden={OUTPUT.length - text().length || OUTPUT.length - OUTPUT.split("\n").slice(-5).join("\n").length} full={full()} onToggleFull={() => setFull(!full())} />; }
const TRAIL_FORMS: FormRow[] = [
  form("read", "a tool, settled: its kind's icon, past verb, subject, time; opens to its output", () => <Trail><Fold icon={<FileTextIcon />} verb="Read" subject="lorem_ipsum.txt" time="0ms" initial><StepOutput text={"Lorem ipsum dolor sit amet, consectetur adipiscing elit.\nSed do eiusmod tempor incididunt ut labore."} /></Fold></Trail>, "<Step icon verb subject time><StepOutput text /></Step>", "verb foreground · subject code face · time caption tabular"),
  form("drawn once opened", "opens: its body is not drawn until first opened, then kept to fold away", () => <Trail><Fold icon={<SquareTerminalIcon />} verb="Ran" subject="npm run build" time="3s" opens><StepOutput text={"vite v7 building for production…\n✓ built in 2.9s"} /></Fold></Trail>, "<Step opens>", "foldBody"),
  form("running", "present verb, a spinner for its icon", () => <Trail><Step state="running" verb="Running" subject="npm run build" /></Trail>, "state=running", "ui-spinner icon-sm"),
  form("failed · stopped", "flagged at the end; failed tints its icon", () => <Trail><Fold icon={<SquareTerminalIcon />} verb="Ran" subject="npm test" time="14s" state="failed"><StepOutput text={"FAIL src/sum.test.ts\n  expected 3, received 4"} /></Fold><Step icon={<FilePenLineIcon />} verb="Edited" subject="src/sum.ts" state="stopped" /></Trail>, "state=failed · stopped", "flag strong · failed icon --destructive"),
  form("long output", "cut to a preview (a command's end, a file's start), the rest a click away", () => <Trail><Fold icon={<SquareTerminalIcon />} verb="Ran" subject="ls -la" time="0.2s" initial><TruncatedOutput /></Fold></Trail>, "<StepOutput hidden full onToggleFull>", "scrolls past 20 units"),
  form("thinking", "its summary (the last heading, or last sentence); opens to the whole text", () => <Trail><Fold icon={<LightbulbIcon />} summary="The second paragraph has four sentences; keep the first two" initial><StepProse><p>The second paragraph has four sentences; keep the first two, they carry the point. The rest repeats it.</p></StepProse></Fold></Trail>, "<Step summary><StepProse>", "prose a step quieter"),
  form("narration", "what the agent said between steps", () => <Trail><Fold icon={<MessageSquareTextIcon />} summary="I'll shorten it and check the word count."><StepProse><p>I'll shorten it and check the word count.</p></StepProse></Fold></Trail>, "<Step summary>", ""),
  form("not kept", "text a stop discarded: struck, flagged", () => <Trail><Fold icon={<LightbulbIcon />} summary="Then rename the file to lorem.txt" discarded><StepProse><p>Then rename the file to lorem.txt</p></StepProse></Fold></Trail>, "<Step discarded>", "struck · .55"),
  form("hidden reasoning", "reasoning the provider kept: a note, said once, nothing to open", () => <Trail><Step note icon={<LightbulbIcon />} summary="Reasoning not shared by the provider" /></Trail>, "<Step note summary>", "italic · no cursor"),
  form("group", "a run of one kind: how many, the steps on a rail under its icon", () => <Trail><Fold icon={<FileTextIcon />} verb="Read 3 files" time="1.2s" initial><Trail nested="group"><Fold icon={<FileTextIcon />} verb="Read" subject="src/main.tsx" time="0.4s"><StepOutput text="import { render } from 'solid-js/web';" /></Fold><Step icon={<FileTextIcon />} verb="Read" subject="src/app.tsx" time="0.3s" /><Step icon={<FileTextIcon />} verb="Read" subject="package.json" time="0.5s" /></Trail></Fold></Trail>, "<Step verb><Trail nested=group>", "rail --tint"),
  form("code mode", "a script: the tools it calls, in order, as quiet rows -- planned, running, failed, earlier -- then its output", () => <Trail><Fold icon={<CodeXmlIcon />} verb="Scripting tools" state="running" initial><Trail nested="calls">
    <Step state="earlier" verb="2 earlier calls" /><Step icon={<FileTextIcon />} verb="Read" subject="lorem_ipsum.txt" time="12ms" /><Step icon={<SquareTerminalIcon />} verb="Ran" subject="wc -w lorem_ipsum.txt" time="40ms" flags={["repeats"]} />
    <Step icon={<SearchIcon />} verb="Searched" subject="“lorem”" state="failed" time="8ms" /><Step state="running" verb="Editing" subject="lorem_ipsum.txt" /><Step icon={<WrenchIcon />} verb="Using" subject="format" state="planned" />
  </Trail></Fold></Trail>, "<Step><Trail nested=calls><Step state>", "planned .45 · earlier muted"),
  form("error", "a failed request in the trail", () => <Trail><TraceError time="16 Oct 2026, 22:18:04" facts={["Model: Muse Spark 1.3", "Provider: Meta", "Profile: Assistant"]} message="429 Too Many Requests: rate limit reached for this model." /></Trail>, "<TraceError time facts message>", "head --destructive · pre code face"),
];
/* Its states: every Status a trace can say, the orb it draws, and what its Latest line holds then. */
type TraceState = { status: string; orb: () => JSX.Element; when: string; latest: string; tone?: "failed"; live?: boolean };
const TRACE_STATES: { group: string; rows: TraceState[] }[] = [
  { group: "Before anything has shown", rows: [
    { status: "Starting", orb: () => <Orb state="connecting" />, when: "the prompt is sent", latest: "", live: true },
    { status: "Starting agent", orb: () => <Orb state="connecting" />, when: "sent, its agent's process still starting", latest: "", live: true },
    { status: "Waiting for model", orb: () => <Orb state="connecting" />, when: "sent, the agent up, nothing back from the model yet", latest: "", live: true },
  ] },
  { group: "Running", rows: [
    { status: "Thinking", orb: () => <Orb state="working" />, when: "between tools", latest: "The second paragraph has four sentences", live: true },
    { status: "Writing", orb: () => <Orb state="composing" />, when: "the answer is streaming", latest: "Ran wc -c lorem_ipsum.txt", live: true },
    { status: "Reading", orb: () => <Orb state="weaving" />, when: "a read is running", latest: "lorem_ipsum.txt", live: true },
    { status: "Editing", orb: () => <Orb state="working" frame={ORBITS_TRAILED} />, when: "an edit is running", latest: "lorem_ipsum.txt", live: true },
    { status: "Running", orb: () => <Orb state="solving" />, when: "a command is running", latest: "wc -c lorem_ipsum.txt", live: true },
    { status: "Searching", orb: () => <Orb state="searching" />, when: "a search is running (Fetching: a fetch)", latest: "“lorem ipsum”", live: true },
    { status: "Scripting tools", orb: () => <Orb state="solving" />, when: "a code-mode script is running", latest: "Reading lorem_ipsum.txt", live: true },
    { status: "Using format", orb: () => <Orb state="solving" />, when: "any other tool, by its name (Calling a tool: not named yet)", latest: "lorem_ipsum.txt", live: true },
    { status: "Running 3 tools", orb: () => <Orb state="solving" />, when: "several at once", latest: "npm test", live: true },
  ] },
  { group: "Settled", rows: [
    { status: "Done", orb: () => orb(true), when: "it finished", latest: "The second paragraph has four sentences" },
    { status: "Interrupted", orb: () => orb(false), when: "it was stopped", latest: "Ran npm test", tone: "failed" },
    { status: "Failed", orb: () => orb(false), when: "the request failed", latest: "429 Too Many Requests", tone: "failed" },
  ] },
];
const TraceStates = () => <table class="g-trace-states"><thead><tr><th>Status</th><th>When</th><th>The trace</th></tr></thead>
  <For each={TRACE_STATES}>{(group) => <tbody><tr><th colspan="3" class="g-trace-group">{group.group}</th></tr>
    <For each={group.rows}>{(row) => <tr><th>{row.status}</th><td>{row.when}</td><td class="ui-read"><TraceHeader orb={row.orb()} status={row.status} time={row.live ? "12s" : "1m 00s"} work={row.status.startsWith("Starting") || row.status === "Waiting for model" ? undefined : "1 read, 1 edit"} latest={row.latest || undefined} live={row.live} tone={row.tone} opens={row.status !== "Starting"} /></td></tr>}</For></tbody>}</For></table>;
/** A turn played, a second a beat: its Status, Work and Latest line follow the app's rules -- a running tool's Latest
 * is what it acts on, a finished one its past tense, thinking its summary; settled, the last thinking. */
function LiveTurn() {
  type Beat = { status: string; orb: () => JSX.Element; latest?: string; work?: string; steps: number; running?: boolean };
  const T = "The second paragraph has four sentences";
  const BEATS: Beat[] = [
    { status: "Starting", orb: () => <Orb state="connecting" />, steps: 0 },
    { status: "Thinking", orb: () => <Orb state="working" />, latest: T, steps: 1 },
    { status: "Reading", orb: () => <Orb state="weaving" />, latest: "lorem_ipsum.txt", work: "1 read", steps: 2, running: true },
    { status: "Thinking", orb: () => <Orb state="working" />, latest: "Read lorem_ipsum.txt", work: "1 read", steps: 2 },
    { status: "Editing", orb: () => <Orb state="working" frame={ORBITS_TRAILED} />, latest: "lorem_ipsum.txt", work: "1 read, 1 edit", steps: 3, running: true },
    { status: "Thinking", orb: () => <Orb state="working" />, latest: "Edited lorem_ipsum.txt", work: "1 read, 1 edit", steps: 3 },
    { status: "Running", orb: () => <Orb state="solving" />, latest: "wc -c lorem_ipsum.txt", work: "1 read, 1 edit, 1 command", steps: 4, running: true },
    { status: "Writing", orb: () => <Orb state="composing" />, latest: "Ran wc -c lorem_ipsum.txt", work: "1 read, 1 edit, 1 command", steps: 4 },
    { status: "Done", orb: () => orb(true), latest: T, work: "1 read, 1 edit, 1 command", steps: 4 },
  ];
  const STEPS: [StepProps, StepProps][] = [
    [{ icon: <LightbulbIcon />, summary: T }, { icon: <LightbulbIcon />, summary: T }],
    [{ state: "running", verb: "Reading", subject: "lorem_ipsum.txt" }, { icon: <FileTextIcon />, verb: "Read", subject: "lorem_ipsum.txt", time: "0.4s" }],
    [{ state: "running", verb: "Editing", subject: "lorem_ipsum.txt" }, { icon: <FilePenLineIcon />, verb: "Edited", subject: "lorem_ipsum.txt", time: "1.1s" }],
    [{ state: "running", verb: "Running", subject: "wc -c lorem_ipsum.txt" }, { icon: <SquareTerminalIcon />, verb: "Ran", subject: "wc -c lorem_ipsum.txt", time: "0ms" }],
  ];
  const [t, setT] = createSignal(0), [open, setOpen] = createSignal(true);
  const timer = setInterval(() => setT((v) => v >= BEATS.length + 2 ? 0 : v + 1), 1000);
  onCleanup(() => clearInterval(timer));
  const beat = () => BEATS[Math.min(t(), BEATS.length - 1)]!, done = () => beat().status === "Done";
  return <Trace orb={beat().orb()} status={beat().status} time={done() ? "08s" : `${String(t()).padStart(2, "0")}s`} work={beat().work} latest={beat().latest} live={!done()}
    open={open()} onToggle={() => setOpen(!open())}>
    {beat().steps ? <Trail><Index each={STEPS.slice(0, beat().steps)}>{(pair, index) => <Step {...(beat().running && index === beat().steps - 1 ? pair()[0] : pair()[1])} motion="entering" />}</Index></Trail> : undefined}
  </Trace>;
}
/** Forms drawn as what is read: in the transcript's scope (its scale, a row a step under the body). */
const reading = (rows: FormRow[]) => rows.map((row) => ({ ...row, sample: () => <Read class="g-read">{row.sample()}</Read> }));
const SNIPPET = "const total = items.reduce(\n  (sum, item) => sum + item.size, 0);";
const LONG = Array.from({ length: 20 }, (_, i) => i % 5 === 0 ? `// step ${i / 5 + 1}` : `  run(${i}, { size: ${i * 64} });`).join("\n");
/** Copy says so for a moment, as the app's does. */
const useCopied = () => { const [copied, setCopied] = createSignal(false); return [copied, () => { setCopied(true); setTimeout(() => setCopied(false), 1200); }] as const; };
/** A turn with a fence, live: Copy it, open and fold it, copy the answer. */
function codeScene() {
  const [code, copyCode] = useCopied(), [answer, copyAnswer] = useCopied(), [open, setOpen] = createSignal(false);
  return <div class="g-card-scene"><Transcript><Turn>
    <Answer><p>Each step runs in order; the build caches what it can.</p><CodeBlock lang="ts" code={LONG} fold={6} open={open()} onToggle={() => setOpen(!open())} copied={code()} onCopy={copyCode} /></Answer>
    <MessageFoot time="22:16"><CopyButton copied={answer()} label="Copy answer" onCopy={copyAnswer} /></MessageFoot>
  </Turn></Transcript></div>;
}
function FoldDemo() { const [open, setOpen] = createSignal(false); return <CodeBlock lang="ts" code={LONG} fold={4} open={open()} onToggle={() => setOpen(!open())} />; }
function LiveCopy() { const [copied, copy] = useCopied(); return <CodeBlock lang="sh" code={"npm run gallery"} copied={copied()} onCopy={copy} />; }
const CODE_MARKS: Mark[] = [
  { selector: ".ui-code", label: "a box: a --tint line at the control corner, no fill", read: (el) => rounding(el) },
  { selector: ".ui-code-lang", label: "the language, where the numbers start: Caption, the data face", read: (el) => typeOf(el) },
  { selector: ".ui-code .ui-copy", label: "Copy, and the fold's chevron beside it: icon-xs ghost buttons with caption-sized icons, their glyphs as far from the end as the language is from the start", read: (el) => px(`${el.getBoundingClientRect().width}px`) },
  { selector: ".ui-code-line", label: "line numbers (the block's counter): muted, tabular, as wide as the last one", read: (el) => getComputedStyle(el, "::before").color },
  { selector: ".ui-code > pre", label: "the code: the code face in the Row role, at 1.6", read: (el) => typeOf(el) },
  { selector: ".ui-code-more", label: "folded: the cut fades, the foot counts what it hides", read: (el) => px(`${el.getBoundingClientRect().height}px`) },
];
const CODE_FORMS: FormRow[] = [
  form("short", "a fence under the fold: no foot", () => <CodeBlock lang="ts" code={SNIPPET} />, "<CodeBlock lang code onCopy>"),
  form("folded", "past the fold: cut and fading, a chevron beside Copy", () => <CodeBlock lang="ts" code={LONG} fold={6} />, "<CodeBlock fold onToggle>"),
  form("copied", "the check, and the code washing --tint as it fades", () => <CodeBlock lang="ts" code={SNIPPET} copied />, "<CodeBlock copied>"),
  form("highlighted", "the caller's own lines (CODE_BLOCK.line), coloured by a highlighter's classes; the block numbers them", () => <CodeBlock lang="ts" lines={2}><code><span class={CODE_BLOCK.line}><span class="hljs-keyword">const</span> <span class="hljs-variable">fold</span> = <span class="hljs-number">15</span>; <span class="hljs-comment">// lines</span></span><span class={CODE_BLOCK.line}><span class="hljs-keyword">export</span> <span class="hljs-keyword">default</span> <span class="hljs-title">fold</span>;</span></code></CodeBlock>, "<CodeBlock lines>{code}", "--syntax-* by role"),
  form("as a string", "codeBlockHtml: the same block for a renderer that writes HTML, its icons put in by fillCodeBlocks", () => { const el = document.createElement("div"); el.innerHTML = codeBlockHtml({ lang: "sh", code: "npm run build\nnpm run gallery", lines: 2 }); fillCodeBlocks(el); return el.firstElementChild; }, "codeBlockHtml · fillCodeBlocks"),
];
const CODE_IN_APP: FormRow[] = [
  form("A fence in an answer", "the Markdown's fenced code (marked and Incremark): the language as written, numbered lines", () => <CodeBlock lang="sh" code={"npm run gallery"} />),
  form("Folded by Settings · Code blocks", "long ones (past 15 lines, or every one) fold; one opened by hand stays open", () => <CodeBlock lang="ts" code={LONG} fold={15} />),
  form("Still being written, folded", "the fold holds while the model writes into it, and the foot pulses as its count climbs", () => <CodeBlock lang="ts" code={LONG} fold={6} streaming />),
];
const conversation = () => <Transcript>
  <Message time="22:14" actions={<Button variant="ghost" size="icon-xs" aria-label="Edit"><PencilIcon /></Button>}>write a .txt file in this folder that contains lorem ipsum text</Message>
  <Turn><TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit" latest="Edited lorem_ipsum.txt" opens /><Answer html={"<p>Created <code>lorem_ipsum.txt</code> in this folder with lorem ipsum text.</p>"} /><MessageFoot time="22:16">{copyRetry()}</MessageFoot></Turn>
  <Message time="22:18" actions={<Button variant="ghost" size="icon-xs" aria-label="Edit"><PencilIcon /></Button>}>and make the second paragraph shorter</Message>
  <Turn><TraceHeader orb={orb(true)} status="Done" time="1m 00s" work="1 edit" opens /><Answer><p>Done. The second paragraph is now two sentences:</p><blockquote><p>Lorem ipsum dolor sit amet. Consectetur adipiscing elit.</p></blockquote><CodeBlock lang="txt" code="lorem_ipsum.txt  412 bytes" /></Answer><MessageFoot time="22:19">{copyRetry()}</MessageFoot></Turn>
</Transcript>;

/** The app's overlays, assembled: drawn in their gallery cells and over the desktop preview. */
export type OverlayView = "leader" | "palette" | "search" | "settings";
type Lit = { top: string; left: string; width: string; height: string; radius?: string };
export const overlayViews: Record<OverlayView, (props: { close: () => void; class?: string; lit?: Lit; leaderBottom?: string; phone?: boolean }) => JSX.Element> = {
  palette: (props) => <Scrim class={props.class}><Overlay label="Command palette" style={{ "--overlay-height": "480px" }}>
    <OverlayBar lead={glyph()} placeholder="Run a command…" onClose={props.close} />{paletteList()}{paletteHints()}</Overlay></Scrim>,
  search: (props) => <Scrim class={props.class}><ChatSearch close={props.close} /></Scrim>,
  settings: (props) => <Scrim class={props.class} placement={props.phone ? "top" : "center"}><Settings close={props.close} phone={props.phone} /></Scrim>,
  leader: (props) => <><Spotlight lit={props.lit} /><div class="g-page-leader" style={props.leaderBottom ? { bottom: props.leaderBottom } : undefined}><Leader path={<LeaderPath />} hints={leaderHints()}>{leaderRows()}</Leader></div></>,
};
const noop = () => {};
/** A phone's screen, a chat's transcript on it, an overlay drawn full screen over it. */
const PhoneStage = (props: { children: JSX.Element }) => <div class="g-phone-stage"><p>{"Created lorem_ipsum.txt in this folder. The second paragraph is now two sentences: lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6)}</p>
  <Scrim class="g-stage-scrim">{props.children}</Scrim></div>;
/** Busy content behind a swatch, as a chat's text is behind an overlay. */
const Busy = (props: { children: JSX.Element }) => <div class="g-busy"><p>{"Created lorem_ipsum.txt in this folder. The second paragraph is now two sentences: lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4)}</p>{props.children}</div>;

export const libraryFamilies: Family[] = [
  { title: "Connection", note: "Sign-in, first connection, server selection and recovery. Shared v2 markup and tokens in the app and the server-rendered login page.", groups: [
    { title: "Forms and states", note: "Desktop and phone; live menu behavior uses Kobalte, while sign-in remains a plain HTML form.", layout: "desktop", atoms: [
      lib("connection-forms", "Connection · forms × densities", "both", "connection", "components/ui/connection.tsx · components/menus.tsx", () => <FormTable rows={CONNECTIONS} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
  ] },
  { title: "Frost", note: "two materials: frost, and core -- frost on a solid backing, kept for the phone's full-screen overlays should what is behind them be too busy (off for now; nothing uses it). Over a plain ground they look alike; over text the difference shows. Lift is not a material, only its shadow: rest sits on the page, raised floats above it", groups: [{ atoms: [
    lib("frost", "Frost", "both", "material", "Frost", () => <div class="g-material"><Busy><Frost lift="raised" class="g-swatch" /></Busy><FrostTokens names={FROST_CSS} /></div>, true),
    lib("frost-core", "Core", "both", "material", "Frost core · Overlay core (off for now)", () => <div class="g-material"><Busy><Frost lift="raised" core class="g-swatch" /></Busy><FrostTokens names={["--frost-core-ground", ...FROST_CSS]} /></div>, true),
  ] }] },
  { title: "Nav", note: "the sidebar on the frame: a NavPane (head, list, foot) of NavGroups, NavRows and NavFolders, and the rail it folds to. Rows rest grey; the cursor is the wash and white; current is white at the current weight with no fill, and so is the folder holding it. The keys are the app's (navigation/sidebar-cursor.ts)", groups: [
    { title: "Forms", note: "each piece and state at each density", layout: "desktop", atoms: [
      lib("nav-forms", "Nav · forms", "both", "nav", "components/ui/nav.tsx", () => <FormTable rows={[
        form("NavRow", "rest, current, within (holds current), open beside, selected", () => <div data-surface="frame" class="g-nav-frame"><GNavRow icon={<MessageSquareIcon />}>Rest</GNavRow><GNavRow icon={<MessageSquareIcon />} current>Current</GNavRow><GNavRow icon={<FolderIcon />} within>Within</GNavRow><GNavRow icon={<MessageSquareIcon />} open>Open beside</GNavRow><GNavRow icon={<MessageSquareIcon />} selected>Selected</GNavRow></div>, "<NavRow current | within | open | selected>"),
        form("NavRow · indent, detail, meta, end, quiet", "a chat in its folder, a terminal, View all, a link out", () => <div data-surface="frame" class="g-nav-frame"><GNavRow indent icon={<MessageSquareIcon />}>In a folder</GNavRow><GNavRow icon={<GTerminalIcon />} detail="Japan · zsh · Active now">Shell</GNavRow><GNavRow quiet icon={<GSearchIcon />} meta="7 more">View all chats</GNavRow><GNavRow icon={<GTerminalIcon />} end={<ExternalLinkIcon />}>Terminal View</GNavRow></div>, "<NavRow indent detail meta end quiet>"),
        form("NavFolder", "its row (link and chevron, out of the tab order) and its rows, which slide", () => <div data-surface="frame" class="g-nav-frame"><States states={["Open", "Shut"] as const}>{(state) => <NavFolder open={state() === "Open"} row={<NavFolderRow icon={<FolderIcon />} open={state() === "Open"} link={{}} toggle={{ "aria-label": "Toggle" }}>Japan</NavFolderRow>}><GNavRow indent icon={<MessageSquareIcon />}>Plan the trip</GNavRow><GNavRow indent icon={<MessageSquareIcon />}>Gassho houses</GNavRow></NavFolder>}</States></div>, "<NavFolder open row={<NavFolderRow …>}>", "--duration-fold"),
        form("NavNote · NavSkeleton", "nothing here; not arrived yet", () => <div data-surface="frame" class="g-nav-frame"><NavNote>No chats</NavNote><NavSkeleton rows={3} /></div>, "<NavNote> · <NavSkeleton rows>"),
        form("NavLead", "a phone's first line of the list, on its ground: the server it is on, New chat, search and the palette beside it, and what the server has to say under it; it scrolls with the list, so the head never moves", () => <div data-surface="frame" class="g-nav-frame" data-density="phone"><NavLead server={<ServerControl name="Desktop-Dev" detail="Connected" connectivity="online" />} actions={<><GButton variant="ghost" size="icon" aria-label="New chat"><MessageSquarePlusIcon /></GButton><GButton variant="ghost" size="icon" aria-label="Search chats"><SearchIcon /></GButton><GButton variant="ghost" size="icon" aria-label="Open command palette"><TerminalIcon /></GButton></>}><NavNotice icon={<CheckIcon />}>Conduit updated</NavNotice></NavLead></div>, "<NavLead server actions><NavNotice /></NavLead>"),
        form("NavNotice · ServerControl inline", "a desktop's foot: an update working, one waiting on a person; the server on one line (the downloads are in its menu)", () => <div data-surface="frame" class="g-nav-frame"><NavNotice busy>Checking for updates…</NavNotice><NavNotice ready icon={<DownloadIcon />} action={{ label: "Restart", onClick: () => {} }}>New version ready</NavNotice><ServerControl inline name="Desktop-Dev" detail="Connected · 14 ms" connectivity="online" /></div>, "<NavNotice busy | ready action> · <ServerControl inline>"),
        form("RailButton", "rest, current, live (something works there)", () => <div data-surface="frame" class="g-nav-frame g-row"><RailButton aria-label="Dashboard"><LayoutDashboardIcon /></RailButton><RailButton aria-label="Japan" current><FolderIcon /></RailButton><RailButton aria-label="Chat" live><MessageSquareIcon /></RailButton></div>, "<RailButton current live>"),
      ]} on={["desktop", "phone"]} />, "row"),
    ] },
    { title: "Assembled", note: "a NavPane open, folded to its rail, and a phone's drawer", layout: "desktop", atoms: [
      lib("nav-pane", "NavPane · open and folded", "desktop", "nav", "navigation/sidebar.tsx", () => <div class="g-row g-top">{[false, true].map((folded) => <div class="g-nav-stage"><NavPane collapsed={folded} folded={folded}
        head={<><GButton variant="ghost" size="icon-sm" aria-label="Toggle Sidebar"><PanelLeftIcon /></GButton><NavBrand name="Conduit" /><GSegmented icons label="Sidebar section" value="conduit" onChange={() => {}} options={[{ value: "conduit", label: "Conduit", icon: <LayoutDashboardIcon /> }, { value: "computer", label: "Computer", icon: <MonitorIcon /> }]} /></>}
        foot={<NavNotice icon={<CheckIcon />}>Conduit is up to date</NavNotice>}>
        <NavRail label="Quick navigation"><RailButton aria-label="Dashboard" current><LayoutDashboardIcon /></RailButton><RailButton aria-label="New project"><FolderPlusIcon /></RailButton><NavRailSection><RailButton aria-label="Japan" live><FolderIcon /></RailButton></NavRailSection></NavRail>
        <GNavRow icon={<LayoutDashboardIcon />} current>Conduit Dashboard</GNavRow><GNavRow icon={<FolderPlusIcon />}>New project</GNavRow>
        <GNavGroup label="Projects"><NavFolder open row={<NavFolderRow icon={<FolderIcon />} open within link={{}} toggle={{ "aria-label": "Collapse" }}>Japan</NavFolderRow>}><GNavRow indent icon={<MessageSquareIcon />}>Plan the trip</GNavRow></NavFolder></GNavGroup>
        <GNavGroup label="Chats"><GNavRow icon={<MessageSquareIcon />}>Fix the build</GNavRow><GNavRow quiet icon={<GSearchIcon />} meta="7 more">View all chats</GNavRow></GNavGroup>
      </NavPane></div>)}</div>, true),
    ] },
  ] },
  { title: "Dashboard", note: "a place's page: a header, quick actions and composer, with chats beside projects and workspaces", groups: [
    { title: "Forms", note: "each piece and state at each density", layout: "desktop", atoms: [
      lib("dash-forms", "Dashboard · forms", "both", "dashboard", "components/ui/dashboard.tsx", () => <FormTable rows={[
        form("GroupHeading · the two section roles", "the strong one for dashboards and big lists; the quiet one for menus, Settings and the sidebar (Paper Mono capitals on both layouts, at each one's unit)", () => <div class="g-row g-top"><GroupHeading count={4}>Projects</GroupHeading><GNavGroup label="Projects"><GNavRow icon={<FolderIcon />}>Japan</GNavRow></GNavGroup></div>, "<GroupHeading count> · <NavGroup label>"),
        form("GroupToggle", "open and shut", () => <States states={["Open", "Shut"] as const}>{(state) => <GroupToggle open={state() === "Open"} count={4} onClick={() => {}}>Projects</GroupToggle>}</States>, "<GroupToggle open count onClick>"),
        form("Group", "switches and actions above chats, with a day and more below", () => <Group id="g-chats" labelled section="chats" heading={<GroupSwitches><span id="g-chats"><Segmented label="Show" value="all" onChange={() => {}} options={[{ value: "all", label: "All", count: 3 }, { value: "unread", label: "Unread", count: 0 }]} /></span></GroupSwitches>} actions={<GroupAction>Filters</GroupAction>}>
          <DashDay>Today</DashDay>
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Plan the trip" context="Japan" trailing="2d" />
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Fix the build" context="Conduit" trailing="3d" />
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Review the changes" context="Website" trailing="4d" />
          <DashMore count={12} onClick={() => {}}>Show more</DashMore>
        </Group>, "<Group labelled section heading actions> · <DashDay> · <DashRow> · <DashMore count>"),
        form("DashRow · ChangeRow · Counts", "modified and added files with line counts", () => <div><ChangeRow icon={<FileCode2Icon />} name="dashboard.tsx" directory="components/ui" added={24} removed={8} status="M" /><ChangeRow icon={<FileTextIcon />} name="notes.md" directory="docs" added={12} removed={0} status="A" /><Counts added={36} removed={8} /></div>, "<ChangeRow icon name directory added removed status> · <Counts added removed>"),
        form("DashPath", "a place's working path in its header's context: a tap copies it, and it says Copied for a moment", () => <States states={["Rest", "Copied"] as const}>{(state) => <DashPath path="~/Conduit" copied={state() === "Copied"} onCopy={() => {}} />}</States>, "<DashPath path copied onCopy />", "--font-data --text-caption · brightens on hover or focus"),
        form("DashEmpty · DashNote", "an empty list, a note and an error", () => <div><DashEmpty>No chats</DashEmpty><DashNote>Choose a project to start.</DashNote><DashNote error>Could not load projects.</DashNote></div>, "<DashEmpty> · <DashNote error>"),
        form("FolderShelf · FolderTile", "four projects, one live, and a new project action", () => <FolderShelf all><FolderTile name="Conduit" meta="3 chats" live /><FolderTile name="Japan" meta="2 chats" /><FolderTile name="Website" meta="1 chat" /><FolderTile name="Notes" meta="No chats" /><FolderTile name="New project" icon={<FolderPlusIcon />} /></FolderShelf>, "<FolderShelf all> · <FolderTile name meta live icon>"),
      ]} on={["desktop", "phone"]} />, "row"),
    ] },
    { title: "Assembled", note: "a page with chats beside projects and workspaces", layout: "desktop", atoms: [
      lib("dash-page", "Dashboard · a page", "desktop", "dashboard", "dashboard/primitives/split.tsx", () => <div style={{ width: "1100px", height: "640px", display: "flex" }}><Dashboard label="Conduit"
        head={<DashHeader title="Conduit" context={["Nothing running"]} />}
        actions={<QuickActions><QuickAction icon={<TerminalIcon />} label="Terminal" onClick={() => {}} /><QuickMore keep><DashIconButton aria-label="More" /></QuickMore></QuickActions>}
        composer={<div class="g-slot">Composer</div>}
        list={<Group id="g-page-chats" labelled section="chats" order="list" heading={<GroupSwitches><span id="g-page-chats"><Segmented label="Show" value="all" onChange={() => {}} options={[{ value: "all", label: "All", count: 6 }, { value: "unread", label: "Unread", count: 0 }]} /></span></GroupSwitches>} actions={<GroupAction>Filters</GroupAction>}>
          <DashDay>Today</DashDay>
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Plan the trip" context="Japan" trailing="2d" />
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Fix the build" context="Conduit" trailing="3d" />
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Review the changes" context="Website" trailing="4d" />
          <DashDay>Earlier</DashDay>
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Choose a route" context="Japan" trailing="5d" />
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Update the guide" context="Conduit" trailing="6d" />
          <DashRow element="button" lead={<MessageSquareIcon />} primary="Collect ideas" context="Notes" trailing="7d" />
          <DashMore count={12} onClick={() => {}}>Show more</DashMore>
        </Group>}
        aside={<><Group id="g-page-projects" labelled section="projects" heading={<GroupHeading id="g-page-projects" count={4}>Projects</GroupHeading>}><FolderShelf all><FolderTile name="Conduit" meta="3 chats" live /><FolderTile name="Japan" meta="2 chats" /><FolderTile name="Website" meta="1 chat" /><FolderTile name="Notes" meta="No chats" /><FolderTile name="New project" icon={<FolderPlusIcon />} /></FolderShelf></Group>
          <Group id="g-page-workspaces" labelled section="workspaces" heading={<GroupHeading id="g-page-workspaces" count={2}>Workspaces</GroupHeading>}><DashRow element="button" lead={<FolderIcon />} primary="Main" context="Conduit" trailing="2d" /><DashRow element="button" lead={<FolderIcon />} primary="Travel" context="Japan" trailing="3d" /></Group></>}
      /></div>, true),
    ] },
  ] },
  { title: "Panes", note: "where you work: a pane's tabs and edges, the workspace rail and dock header, and the tools inside", groups: [
    { title: "Tabs and edges", atoms: [
      lib("panes-tabs", "Tabs and edges", "both", "panes", "components/ui/pane.tsx", () => <FormTable rows={[
        form("PaneTabRow · PaneTabs · TabPlace · PaneTab", "This chat has a lit tab and an unsaved tab; Japan has a shown tab and a live tab; the empty side says No file open", () => <div style={{ width: "calc(32.8125 * var(--u-space))", display: "grid", gap: "var(--space-sm)", "justify-self": "start" }}><div style={{ width: "calc(32.8125 * var(--u-space))", height: "calc(2.5 * var(--u-space))", display: "flex" }}><PaneTabRow><PaneTabs><TabPlace label="This chat" current><PaneTab title="Chat" lit onClose={() => {}} /><PaneTab title="Draft" unsaved onClose={() => {}} /></TabPlace><TabPlace label="Japan"><PaneTab title="Guide" shown onClose={() => {}} /><PaneTab title="Terminal" live onClose={() => {}} /></TabPlace></PaneTabs></PaneTabRow></div><div style={{ width: "calc(32.8125 * var(--u-space))", height: "calc(2.5 * var(--u-space))", display: "flex" }}><PaneTabRow side="right"><PaneTabs><TabPlace><PaneTab title="No file open" none /></TabPlace></PaneTabs></PaneTabRow></div></div>, "<PaneTabRow><PaneTabs><TabPlace label><PaneTab lit shown unsaved live none /></TabPlace></PaneTabs></PaneTabRow>"),
        form("PaneActions · PaneAction", "dock and close controls", () => <PaneActions><PaneAction label="Dock"><PanelRightIcon /></PaneAction><PaneAction label="Close"><XIcon /></PaneAction></PaneActions>, "<PaneActions><PaneAction label /></PaneActions>"),
        form("PaneEdge", "plain and dock separator areas with a vertical boundary", () => <States states={["Plain", "Dock"] as const}>{(state) => <div style={{ position: "relative", width: "calc(18.75 * var(--u-space))", height: "calc(15.625 * var(--u-space))", "margin-left": "var(--space-lg)", "border-left": "1px solid var(--border)" }}><PaneEdge dock={state() === "Dock"} aria-label="Resize pane" /></div>}</States>, "<PaneEdge dock />"),
        form("DropWash", "a drop wash filling a rectangular area", () => <div style={{ position: "relative", width: "calc(18.75 * var(--u-space))", height: "calc(10.9375 * var(--u-space))" }}><DropWash within style={{ inset: "0" }} /></div>, "<DropWash within style />"),
        form("DragPill", "a file icon and Open beside in a contained drag pill", () => <div style={{ position: "relative", transform: "translateZ(0)", width: "calc(18.75 * var(--u-space))", height: "calc(4.6875 * var(--u-space))" }}><DragPill icon={<FileTextIcon />}>Open beside</DragPill></div>, "<DragPill icon>Open beside</DragPill>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Rail and header", atoms: [
      lib("panes-header", "Rail and header", "both", "panes", "components/ui/pane.tsx", () => <FormTable rows={[
        form("ToolRail · RailRule", "current Files, open Source Control, a rule and Search, with Settings at the foot", () => <ToolRail style={{ height: "calc(18.75 * var(--u-space))" }} foot={<PaneRailButton aria-label="Settings"><SettingsIcon /></PaneRailButton>}><PaneRailButton current aria-label="Files"><FolderIcon /></PaneRailButton><PaneRailButton data-open="" aria-label="Source Control"><FileDiffIcon /></PaneRailButton><RailRule /><PaneRailButton aria-label="Search"><SearchIcon /></PaneRailButton></ToolRail>, "<ToolRail foot><PaneRailButton current /><PaneRailButton data-open /><RailRule /></ToolRail>"),
        form("LayoutGlyph", "two equal panes, a wide left pane, and three equal panes", () => <div class="g-row"><LayoutGlyph weights={[1, 1]} /><LayoutGlyph weights={[2, 1]} /><LayoutGlyph weights={[1, 1, 1]} /></div>, "<LayoutGlyph weights />"),
        form("ToolHeader", "Source Control in Conduit with Changes and History modes and a refresh control; full, mode labels hidden, and name hidden", () => <States states={["Full", "Labels", "Name"] as const}>{(state) => <div style={{ width: "100%", "max-width": "calc(37.5 * var(--u-space))" }}><ToolHeader name="Source Control" place="Conduit" data-compact={state() === "Full" ? undefined : state() === "Labels" ? "labels" : "name"} modes={<Segmented label="Source control mode" value="changes" onChange={() => {}} options={[{ value: "changes", label: "Changes", icon: <FileDiffIcon /> }, { value: "history", label: "History", icon: <ClockIcon /> }]} />} actions={<PaneHeaderButton label="Refresh" icon={<RefreshCwIcon />} />} /></div>}</States>, "<ToolHeader name place data-compact modes actions />"),
        form("ToolViews · ToolView", "Files selected and Source Control unselected, with labels or icons only", () => <States states={["Labels", "Icons only"] as const}>{(state) => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><ToolViews iconsOnly={state() === "Icons only"}><ToolView icon={<FolderIcon />} label="Files" selected /><ToolView icon={<FileDiffIcon />} label="Source Control" /></ToolViews></div>}</States>, "<ToolViews iconsOnly><ToolView icon label selected /></ToolViews>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Tool strips and tree", atoms: [
      lib("panes-tools", "Tool strips and tree", "both", "panes", "components/ui/pane.tsx", () => <FormTable rows={[
        form("ToolBar · ToolButton", "bottom and top hairlines and a vertical strip; pressed Files and disabled Refresh", () => <States states={["Bottom", "Top", "Vertical"] as const}>{(state) => <ToolBar style={{ width: state() === "Vertical" ? "calc(3.125 * var(--u-space))" : "calc(28.125 * var(--u-space))" }} edge={state() === "Top" ? "top" : "bottom"} vertical={state() === "Vertical"}><ToolButton label="Files" aria-pressed="true"><FolderIcon /></ToolButton><ToolButton label="Refresh" disabled><RefreshCwIcon /></ToolButton></ToolBar>}</States>, "<ToolBar edge vertical><ToolButton aria-pressed /><ToolButton disabled /></ToolBar>"),
        form("ToolFilter", "a search field with Filter files placeholder", () => <ToolBar style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><ToolFilter aria-label="Filter files" placeholder="Filter files" /></ToolBar>, "<ToolBar><ToolFilter placeholder /></ToolBar>"),
        form("ToolNotice", "a plain file count or a warning with Retry", () => <States states={["Plain", "Warn"] as const}>{(state) => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><ToolNotice tone={state() === "Warn" ? "warn" : undefined} action={state() === "Warn" ? { label: "Retry", onClick: () => {} } : undefined}>{state() === "Warn" ? "Could not load files." : "2 files"}</ToolNotice></div>}</States>, "<ToolNotice tone action />"),
        form("Tree · TreeRow", "open src folder with two indented files: selected pane.tsx and focused source.tsx with a kept pin", () => <Tree aria-label="Files" style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><TreeRow folder open icon={<FolderIcon />} name="src" /><TreeRow depth={1} selected icon={<FileCode2Icon />} name="pane.tsx" /><TreeRow depth={1} data-open-file="focused" icon={<FileCode2Icon />} name="source.tsx" end={<PinIcon aria-label="Kept" />} /></Tree>, "<Tree><TreeRow folder open /><TreeRow depth selected /><TreeRow depth data-open-file end /></Tree>"),
        form("PaneEmpty · PaneLoading", "an empty pane or a loading capsule with a spinner", () => <States states={["Empty", "Loading"] as const}>{(state) => <div style={{ position: "relative", width: "calc(28.125 * var(--u-space))", height: "calc(10.9375 * var(--u-space))" }}><Show when={state() === "Empty"} fallback={<PaneLoading><Spinner />Loading files…</PaneLoading>}><PaneEmpty>No files open</PaneEmpty></Show></div>}</States>, "<PaneEmpty> · <PaneLoading><Spinner /></PaneLoading>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Source control", atoms: [
      lib("panes-source", "Source control", "both", "panes", "components/ui/source.tsx", () => <FormTable rows={[
        form("ToolLine", "main tracking origin/main, two commits ahead and zero behind, with refresh and publish controls", () => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><ToolLine title="main" detail="origin/main" end={<>↑ 2 ↓ 0<ToolButton label="Refresh"><RefreshCwIcon /></ToolButton><ToolButton label="Publish"><ArrowUpIcon /></ToolButton></>} /></div>, "<ToolLine title detail end />"),
        form("CommitBox", "empty message with disabled Commit, or a message with a count of two", () => <States states={["Empty", "With text"] as const}>{(state) => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><CommitBox value={state() === "Empty" ? "" : "Add pane gallery"} placeholder="Commit message" count={state() === "Empty" ? 0 : 2} disabled={state() === "Empty"} onInput={() => {}} onSubmit={() => {}} /></div>}</States>, "<CommitBox value count disabled onInput onSubmit />"),
        form("ChangeLedger · ChangeSection · ChangeList · ChangeItem", "open Changes with two files and stage actions; shut Staged changes with a count of one", () => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><ChangeLedger><ChangeSection open label="Changes" count={2} onToggle={() => {}} action={<ToolButton label="Stage all"><PlusIcon /></ToolButton>}><ChangeList><ChangeItem action={<ToolButton label="Stage pane.tsx"><PlusIcon /></ToolButton>}><ChangeRow icon={<FileCode2Icon />} name="pane.tsx" directory="src/components/ui" added={12} removed={3} status="M" /></ChangeItem><ChangeItem action={<ToolButton label="Stage notes.md"><PlusIcon /></ToolButton>}><ChangeRow icon={<FileTextIcon />} name="notes.md" directory="docs" added={4} removed={0} status="A" /></ChangeItem></ChangeList></ChangeSection><ChangeSection open={false} label="Staged changes" count={1} onToggle={() => {}}><ChangeEmpty>No changes</ChangeEmpty></ChangeSection></ChangeLedger></div>, "<ChangeLedger><ChangeSection open><ChangeList><ChangeItem action><ChangeRow /></ChangeItem></ChangeList></ChangeSection></ChangeLedger>"),
        form("ChangeEmpty", "an empty change group", () => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><ChangeEmpty>No changes</ChangeEmpty></div>, "<ChangeEmpty>No changes</ChangeEmpty>"),
        form("CommitList · CommitRow", "two commit rows with star and line graph marks; current HEAD → main and origin/main refs", () => <div style={{ width: "100%", "max-width": "calc(37.5 * var(--u-space))" }}><CommitList><CommitRow graph="*" subject="Add pane gallery" refs={[{ label: "HEAD → main", current: true }]} author="Jask" hash="a1b2c3d" /><CommitRow graph="|" subject="Update tools" refs={[{ label: "origin/main" }]} author="Jask" hash="d4e5f6a" /></CommitList></div>, "<CommitList><CommitRow graph subject refs author hash /></CommitList>"),
        form("ChangeRow · states", "at rest, selected (open in the review), a merge conflict (its letter in the warning colour), and a status letter with its title", () => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><ChangeList><ChangeItem><ChangeRow icon={<FileCode2Icon />} name="pane.tsx" directory="src/components/ui" added={12} removed={3} status="M" /></ChangeItem><ChangeItem><ChangeRow icon={<FileCode2Icon />} name="file.tsx" directory="src/components/ui" added={4} removed={1} status="M" selected /></ChangeItem><ChangeItem><ChangeRow icon={<FileTextIcon />} name="README.md" added={null} removed={null} status="U" conflict statusTitle="Both modified" /></ChangeItem><ChangeItem><ChangeRow icon={<FileTextIcon />} name="old.md" directory="docs" added={0} removed={8} status="D" statusTitle="Deleted" /></ChangeItem></ChangeList></div>, "<ChangeRow status selected conflict statusTitle />"),
        form("PatchLines", "a diff heading, hunk, removed line, added line and context line", () => <div style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><PatchLines lines={["diff --git a/title.txt b/title.txt", "@@ -1,2 +1,2 @@", "-Tools", "+Panes", " Source Control"]} /></div>, "<PatchLines lines />"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "History", atoms: [
      lib("panes-history", "History", "both", "panes", "components/ui/history.tsx", () => <FormTable rows={[
        form("HistoryList · HistoryRow · HistoryBranch", "user and assistant entries, a connected tick, an active reply, a discarded reply, open and shut tool runs, and a branch at depth one", () => <HistoryList style={{ width: "100%", "max-width": "calc(28.125 * var(--u-space))" }}><HistoryRow kind="user" time="10:00" connected>Show the changes</HistoryRow><HistoryRow kind="assistant" time="10:01" active>Reviewing the files</HistoryRow><HistoryRow kind="tool" run open time="10:01">Read two files</HistoryRow><HistoryRow kind="tool" run open={false} time="10:02">Run checks</HistoryRow><HistoryBranch depth={1}><HistoryRow kind="assistant" time="10:03" discarded>Try another approach</HistoryRow></HistoryBranch></HistoryList>, "<HistoryList><HistoryRow kind connected active discarded run open /><HistoryBranch depth /></HistoryList>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Terminal", atoms: [
      lib("panes-terminal", "Terminal", "both", "panes", "components/ui/terminal.tsx", () => <><style>{`.g-panes-term-scene { width: 100%; justify-self: stretch; } .g-panes-term-sample { width: calc(40.625 * var(--u-space)); } [data-density="phone"] .g-panes-term-sample { width: 100%; }`}</style><FormTable rows={[
        form("TermHeader · TermLead · TermIdentity · TermStatus · TermContext · TermShortcuts · TermShortcut · TermOverflow · TermActions", "on the ground over the terminal's darker canvas, no line between: the status, title and context, the shortcuts, then the sessions and Focus. Narrower, it folds by measure: the shortcuts into the ⋯ first, then Focus's label (live, muted or busy below)", () => <div class="g-panes-term-scene"><States states={["Wide", "Shortcuts folded", "Labels folded"] as const}>{(state) => <div style={{ width: state() === "Wide" ? "calc(36 * var(--u-space))" : state() === "Shortcuts folded" ? "calc(30 * var(--u-space))" : "calc(20 * var(--u-space))", background: "#121315" }}><TermHeader actions={<TermActions><TermButton variant="ghost" size="sm" aria-label="Active terminal sessions"><TerminalIcon /><span>2</span><ChevronDownIcon /></TermButton><TermButton variant="ghost" size="sm" aria-label="Focus terminal"><FocusIcon /><TermActionLabel>Focus</TermActionLabel></TermButton></TermActions>}><TermIdentity><TermStatus tone="success" label="Live" /><strong>zsh</strong><TermContext>Japan · npm run dev</TermContext></TermIdentity><TermShortcuts><TermShortcut>Dev</TermShortcut><TermShortcut>Test</TermShortcut><ToolButton label="Edit terminal shortcuts"><SettingsIcon /></ToolButton></TermShortcuts><TermOverflow><LiveMenu><LiveMenu.Trigger as={ToolButton} label="Terminal shortcuts"><EllipsisIcon /></LiveMenu.Trigger><LiveMenuContent><LiveMenuSection title="Shortcuts"><LiveMenuRow>Dev</LiveMenuRow><LiveMenuRow>Test</LiveMenuRow></LiveMenuSection></LiveMenuContent></LiveMenu></TermOverflow></TermHeader><div style={{ height: "calc(3 * var(--u-space))" }} /></div>}</States><States states={["Live", "Muted", "Busy"] as const}>{(state) => <TermStatus tone={state() === "Live" ? "success" : state() === "Busy" ? "busy" : "muted"} busy={state() === "Busy"} label={state()} />}</States></div>, "<TermHeader actions={<TermActions />}><TermLead /><TermIdentity><TermStatus tone busy /><strong /><TermContext /></TermIdentity><TermShortcuts /><TermOverflow /></TermHeader>", "data-surface ground · --background · folds: data-folded=\"shortcuts labels\""),
        form("TermState · TermError", "an empty terminal with an icon, title, text and New terminal button, or a connection error", () => <States states={["Empty", "Error"] as const}>{(state) => <div style={{ position: "relative", width: "calc(28.125 * var(--u-space))", height: "calc(18.75 * var(--u-space))" }}><Show when={state() === "Empty"} fallback={<TermError>Could not connect to the terminal.</TermError>}><TermState empty><TerminalIcon /><strong>No terminal</strong><p>Start a shell in Japan.</p><TermButton>New terminal</TermButton></TermState></Show></div>}</States>, "<TermState empty><TerminalIcon /><strong /><p /><Button /></TermState> · <TermError>"),
        form("TermKeys · TermKey", "a phone's key bar under the terminal: the keys its keyboard lacks, scrolling sideways; Ctrl armed (ringed until the next key); a tap never takes the terminal's focus", () => <div style={{ width: "100%", "max-width": "calc(25 * var(--u-space))" }}><TermKeys aria-label="Terminal keys"><TermKey onClick={() => {}}>Esc</TermKey><TermKey onClick={() => {}}>Tab</TermKey><TermKey armed onClick={() => {}}>Ctrl</TermKey><TermKey onClick={() => {}}>Alt</TermKey><TermKey onClick={() => {}}>←</TermKey><TermKey onClick={() => {}}>↓</TermKey><TermKey onClick={() => {}}>↑</TermKey><TermKey onClick={() => {}}>→</TermKey><TermKey onClick={() => {}}>^C</TermKey><TermKey onClick={() => {}}>/</TermKey><TermKey onClick={() => {}}>Paste</TermKey></TermKeys></div>, "<TermKeys><TermKey armed onClick /></TermKeys>", "keys --tint, --font-label --text-caption · --control-lg tall, --row-min wide · armed: a --stroke ring"),
      ]} on={["desktop", "phone"]} stacked /></>, "row"),
    ] },
  ] },
  ...filesFamilies(),
  { title: "Header", note: "a pane's top line: the name (a place's caps crumb, then the title) or the tab row at the left, what the page is beside it, quiet ghost controls at the right, the pane's swap and close last. It fades into what scrolls under it; a tab row's strip may be frost. On a phone the title gives way and the leading controls, the name (HeaderPill: its place's mark, a folder, a workspace's glyph or Conduit's for a chat in no folder, then the title wrapping to two lines; the chat menu's trigger) and the actions float as frost pills -- see the Phone preview, which draws the app's own ChatHeader", groups: [
    { title: "Forms", layout: "desktop", atoms: [
      lib("header-forms", "Header · forms", "desktop", "header", "components/ui/header.tsx", () => <FormTable rows={[
        form("HeaderCrumb", "under a place (a link to it); a place itself", () => <div style={{ display: "grid", gap: "var(--space-md)" }}><HeaderCrumb place="Japan" onPlace={() => {}} title="Planning the Kyoto leg" /><HeaderCrumb title="Japan" /></div>, "<HeaderCrumb place onPlace title>"),
        form("HeaderNote", "what the page is and the one thing to do about it; working", () => <div class="g-row"><HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: () => {} }} /><HeaderNote label="Not in Conduit" action={{ label: "Track", busy: true, busyLabel: "Tracking…", onClick: () => {} }} /></div>, "<HeaderNote label action>"),
        form("HeaderButton", "an icon with its label as its name; only one layout's", () => <div class="g-row"><HeaderButton label="Copy Tailscale chat link" icon={<ShareIcon />} /><HeaderButton label="Search chats" icon={<SearchIcon />} /></div>, "<HeaderButton label icon only>"),
      ]} on={["desktop"]} />, "row"),
    ] },
    { title: "Assembled", layout: "desktop", atoms: [
      lib("header-chat", "Header · a chat", "desktop", "header", "chat/chat-screen.tsx ChatHeader", () => <div style={{ width: "100%", "align-self": "stretch" }}><Header actions={<HeaderButton label="Copy Tailscale chat link" icon={<ShareIcon />} />}
        after={<HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: () => {} }} />}><HeaderCrumb place="Codex" onPlace={() => {}} title="Fix the flaky upload test" /></Header></div>, true),
    ] },
  ] },
  { title: "Reading", note: "what a gauge measures, read at a glance (reading.tsx): under its Meter one line of totals (the Meter's mark is quiet, its rule alone: the foot says where it compacts, beside Compact now); the parts as a legend, a dot, a name and a share, a part with parts of its own opening under itself; the cache as a line; compaction with Compact now; last, the account's figures (a plan's windows) as tiles under their name. All at the caption's size, numbers in the data face, so nothing outweighs the bar. The composer's gauge and the chat menu's Context draw it", groups: [
    { atoms: [
      lib("reading-forms", "Reading · parts", "both", "popover", "components/ui/reading.tsx", () => <FormTable rows={[
        form("ReadingTotal", "what is used of what there is, and a figure at the end", () => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingTotal label="84k of 200k tokens" value="$0.42" /></Reading></div>, "<ReadingTotal label value />"),
        form("ReadingParts · ReadingPart", "a legend: content, room (hollow), a part that opens (shut, then open with its own parts under it)", () => <States states={["Shut", "Open"] as const}>{(state) => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingParts><ReadingPart colour="oklch(0.72 0.15 300)" label="Messages" value="60k · 30.0%" /><ReadingPart role="button" opens expanded={state() === "Open"} colour="oklch(0.74 0.12 230)" label="Tools (3)" value="12k · 6.0%" /><Show when={state() === "Open"}><ReadingPart sub label="read_file" value="4k" /><ReadingPart sub label="shell" value="3k" /></Show><ReadingPart hollow label="Free space" value="112k · 56.0%" /></ReadingParts></Reading></div>}</States>, "<ReadingParts><ReadingPart colour hollow opens expanded sub label value /></ReadingParts>", "--control-sm rows · --icon-dot · values --font-data"),
        form("ReadingStats · ReadingStat", "the account's figures, last, under their name: side by side, as many as there are, a number over its name, a line under it", () => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingStats title="Plan · Plus"><ReadingStat label="5-hour" value="5%" detail="resets 1:47 pm" /><ReadingStat label="Weekly" value="17%" detail="resets Tue" /></ReadingStats></Reading></div>, "<ReadingStats><ReadingStat label value detail /></ReadingStats>", "--tint wells · --radius-inset · names in the label voice · numbers --text-row"),
        form("ReadingFoot", "a line and its one control: compaction and Compact now; the gauge's model and its session copy", () => <div style={{ width: "100%", "max-width": "calc(20 * var(--u-space))" }}><Reading><ReadingFoot action={<Button variant="ghost" outline size="sm"><ShrinkIcon />Compact now</Button>}>Compacts at 85% · 2 so far</ReadingFoot><ReadingFoot action={<Button variant="ghost" size="sm">019a3f…3e70</Button>}>gpt-6-luna · Plus</ReadingFoot></Reading></div>, "<ReadingFoot action />"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
      lib("reading-whole", "Reading · a context window", "both", "popover", "chat/context-gauge.tsx ContextBreakdown", () => <Menu width="lg" unfolds><ContextReadingDemo /></Menu>),
    ] },
  ] },
  { title: "Popover", note: "raised frost holding sections, separated by rules; a submenu is another popover", groups: [
    { atoms: [
      lib("anatomy", "Anatomy", "both", "popover", "Menu > Section > Item", () => <Anatomy scene={() => <Menu>
        <HeadingSection title="lorem_ipsum.txt" detail="Edited 2 minutes ago" />
        <SearchSection placeholder="Search models…" />
        <Section title="Attach"><Item icon={<PaperclipIcon />}>File</Item><Item meta="xai">Model</Item><Item opens>More</Item></Section>
        <Section kind="slider"><Levels label="Reasoning" /></Section>
      </Menu>} parts={[
        [".ui-heading", "Heading section", "HeadingSection", "what the popover is about: a title and a line under it"],
        [".ui-search-section", "Search section", "SearchSection", "a field filtering the list after it"],
        ['.ui-section[data-kind="list"] > .ui-title', "List section", "Section", "a titled group of Items"],
        ['.ui-section[data-kind="list"] > .ui-row:nth-child(2)', "Item", "Item · icon", "one choice; icon, meta, keys and opens are its parts"],
        ['.ui-section[data-kind="list"] > .ui-row:nth-child(3)', "Meta", "Item · meta", "a value or source at the row's end"],
        ['.ui-section[data-kind="list"] > .ui-row:nth-child(4)', "Opens", "Item · opens", "opens a submenu"],
        ['.ui-section[data-kind="slider"]', "Slider section", "Section kind=slider", "a level picked by dragging"],
      ]} />, "row"),
      lib("section-heading", "Heading", "both", "section", "HeadingSection + Item field", () => <Menu><ChatTitle /></Menu>),
      lib("section-search", "Search", "both", "section", "SearchSection: heads a pick list (SearchList, live: type, arrows, Enter; the list scrolls in its own height). A menu over a long list starts with a Search all… row that opens the palette instead", () => <div class="g-row g-top">
        <Menu><SearchSection placeholder="Search all models…" keys={["⌘", "⇧", "X"]} /></Menu>
        <Menu><SearchList items={PROJECTS} placeholder="Search projects and workspaces" matches={(project, needle) => project.name.toLowerCase().includes(needle)} isCurrent={(project) => project === PROJECTS[1]}
          onChoose={noop} row={(project) => ({ icon: <PlaceGlyph project={project} />, label: project.name, meta: "Project" })} /></Menu>
      </div>, true),
      lib("item", "List · items", "both", "section", "Section + Item: icon meta detail keys opens away field · checked (current: bold, no tick) disabled destructive · onCursor (a list keeping its own cursor; a hovering pointer only, never a tap)", () => <Menu><Section title="Title" note="note">
        <Item>Plain</Item>
        <Item icon={<PaperclipIcon />}>icon</Item>
        <Item meta="xai">meta</Item>
        <Item detail="192.168.1.4">detail</Item>
        <Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>keys</Item>
        <Item opens>opens a submenu</Item>
        <Item away detail="lan.example.com">away: opens elsewhere</Item>
        <Item away detail="laptop.ts.net" meta="29 ms">away with meta</Item>
        <Item field meta="Unavailable" opens>Field</Item>
        <Item checked>checked</Item>
        <Item active>highlighted</Item>
        <Item disabled>disabled: dimmer, struck through, no note</Item>
        <Item icon={<Trash2Icon />} destructive>destructive</Item>
      </Section></Menu>),
      lib("section-slider", "Slider", "both", "section", "Section kind=slider + Slider; its value a SliderValue that opens the levels (onOpen, or control: the caller's own, a submenu's trigger)", () => <Menu>
        <Section kind="slider"><Levels /></Section>
        <Section kind="slider"><Slider label="Effort" options={thinking} value="medium" onChange={noop} control={(shown) => <SliderValue>{shown()}</SliderValue>} /></Section>
      </Menu>),
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
    lib("d-context", "ContextGauge › breakdown", "desktop", "popover", "chat/context-gauge.tsx · the composer's gauge: a Reading in a Menu width lg that unfolds (a part with parts of its own opens under itself, the menu growing with it). Tools open here", () => <Menu width="lg" unfolds><ContextReadingDemo open /></Menu>),
    lib("d-profile", "ComposerPlusMenu › Profile", "desktop", "popover", "chat/composer-plus-menu.tsx", () => <Menu class="g-w18"><Profiles /></Menu>),
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
    lib("p-chat", "ChatHeader › menu", "phone", "popover", "chat/chat-screen.tsx · opened from the title pill (HeaderPill). unfolds: as wide as its cap, and as tall as what is open up to the room it has, so Context and Details grow their sections in place (Expand, the menu's edge running with the rows) rather than scrolling; a section inside a section draws no rule. The actions first, Delete chat last among them; Context with its meter, then Details in a section of its own (the thread's harness, version, profile, tools and session, folded to the harness), each opening in place. Context and Details open here", () => <Menu width="md" unfolds><Section><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<PanelRightIcon />}>Workspace panel</Item><Item icon={<Trash2Icon />} destructive>Delete chat</Item></Section><Rule /><Section><Item field meta="42% used" opens aria-expanded="true">Context</Item><Meter parts={[{ value: 60, colour: "oklch(0.72 0.15 300)" }, { value: 16, colour: "oklch(0.7 0.02 260)" }, { value: 12, colour: "oklch(0.74 0.12 230)" }, { value: 112, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%", quiet: true }} /><ContextReadingDemo bare /></Section><Section><Item field meta="Conduit Pi" opens aria-expanded="true">Details</Item><Readout label="Harness" value="Conduit Pi" /><Readout label="Version" value="v1.3.0" /><Readout label="Profile" value="Coding" /><Readout label="Tools" value="codemode: read / edit / shell / web search" /><Readout label="Session" value="019a3f2c-7b1e-7c40-9d2e-5f8a1b6c3e70" /></Section></Menu>, true),
    ] },
    { title: "Motion", note: "its own moves, from Foundations · Motion: it rises in with a fade and drops back the way it came; nothing in it answers the pointer as it goes. The app's popovers and menus (frost-arrive, 220ms) take these", layout: "desktop", atoms: [
      lib("popover-fit", "Popover · caps", "both", "popover", "Menu width, height: as big as its rows inside its caps (a phone's narrower and shorter by default, --menu-width-cap, --menu-height-cap; a menu sets its own in a measure) and its host's room (--menu-room: the adapter gives it Kobalte's, inside the safe area), scrolling past them", () => <div style={{ "--menu-room": "calc(8 * var(--control))" }}><Menu height="md"><Section title="Projects"><For each={["Engie", "Japan", "NHP", "Test", "Conduit", "Gallery", "Notes", "Lodge", "Sprint", "Reading"]}>{(name) => <Item icon={<FolderIcon />}>{name}</Item>}</For></Section></Menu></div>, "row"),
      lib("popover-row-actions", "Popover · a row's actions", "both", "popover", "RowGroup · RowAction (MenuRow actions): a row and its actions side by side, each a menu item, so Down reaches every one and Enter runs it; shown on the hovered row or the one holding the cursor (always on a phone). Here the second session holds the cursor on Rename", () => <Menu><Section title="Active terminals · Japan"><RowGroup actions={<><RowAction label="Open zsh beside" icon={<Columns2Icon />} /><RowAction label="Rename zsh" icon={<PencilIcon />} /><RowAction label="Destroy zsh" icon={<Trash2Icon />} destructive /></>}><Item checked detail="Japan · 2m">zsh</Item></RowGroup><RowGroup actions={<><RowAction label="Open build beside" icon={<Columns2Icon />} /><RowAction label="Rename build" icon={<PencilIcon />} data-highlighted="" /><RowAction label="Destroy build" icon={<Trash2Icon />} destructive /></>}><Item detail="Japan · npm run build">build</Item></RowGroup></Section><Rule /><Item icon={<PlusIcon />}>New terminal</Item></Menu>, "row"),
      lib("popover-motion", "Popover · motion", "both", "popover", "Menu motion", () => <FormTable rows={[form("arrives · leaves", "rises --space-md with a fade; drops back", () => <Replay leaves={["leaving"]}>{(m) => <Menu motion={m()}><Section><Item icon={<FolderIcon />}>Open</Item><Item icon={<CopyIcon />}>Copy link</Item></Section></Menu>}</Replay>, "<Menu motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
      lib("popover-submenu-motion", "Popover · a phone's submenu", "phone", "popover", "Menu under · Menu motion", () => <FormTable rows={[form("a submenu", "opens as a panel over its parent, which dims where it stands and takes no taps", () => <States states={["Menu", "Submenu open"] as const}>{(s) => <div class="g-panel-over">
        <Menu class="g-w16" under={s() === "Submenu open"}><Section title="Model"><Item opens>Meta: Muse Spark 1.3 Contributor</Item></Section><Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section></Menu>
        <Presence when={s() === "Submenu open"}>{(m) => <Menu class="g-w12 g-panel-over-panel" motion={m()}><Section title="Effort"><For each={thinking}>{(level) => <Item checked={level.value === "medium"}>{level.label}</Item>}</For></Section></Menu>}</Presence></div>}</States>,
        "<Menu under> · <Menu motion>", "the dim: --duration-quick · --ease-change")]} on={["phone"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Card", note: "raised frost at a dialog's width and padding: title · detail · body · actions, drawn from the library's Input and Buttons. Its actions: the primary one a white outline, the others ghost outline, a destructive confirm filled red", groups: [
    { title: "In use", note: "a confirm, measured: pink is the card's edge (--card-edge), green the gaps between its parts (--card-gap, --card-pair title to detail, half a unit between actions)", layout: "desktop", atoms: [
      lib("card-inuse", "Card in use", "both", "card", "Card title detail children actions", () => <InUse scene={cardScene} marks={CARD_MARKS} spacing={[".ui-card", ".ui-card-actions"]} />, "row"),
    ] },
    { title: "Forms", note: "each form at each density -- the phone's a phone wide. Every card: --frost-* raised, corner --radius-surface, and spacing it declares: --card-edge all round, which every box meets (1.25 units), --card-gap between parts (1 unit), --card-pair title to detail (0.5); text trimmed to its glyphs; actions share the widest's width. A phone's card is the screen's width", layout: "desktop", atoms: [
      lib("card-forms", "Card · forms × densities", "both", "card", "Card", () => <FormTable rows={CARDS} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
    { title: "In the app", note: "every dialog the app opens (Dialog), rebuilt from its real content with v2 alone: Card (wide, close), Field, Input, TextArea, Chip, Section and Items, the code preview, Segmented, Buttons. Under each, its file and what v2 still lacks for it", layout: "desktop", atoms: [
      lib("card-in-app", "Dialog · in the app", "both", "card", "client/**/Dialog", () => <FormTable rows={IN_APP} on={["desktop", "phone"]} widths={["minmax(0, 1fr)", "360px"]} stacked />, "row"),
    ] },
    { title: "Motion", note: "its own moves: a card rises in over the page and drops back when it closes", layout: "desktop", atoms: [
      lib("card-motion", "Card · motion", "both", "card", "Card motion", () => <FormTable rows={[form("arrives · leaves", "rises --space-md with a fade; drops back", () => <Replay leaves={["leaving"]}>{(m) => <Card title="Delete 3 chats?" motion={m()} actions={<><Button variant="ghost" outline>Cancel</Button><Button variant="destructive">Delete</Button></>} />}</Replay>, "<Card motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Toast", note: "raised frost at the window's edge, one sentence about what just happened: its kind a glyph in the state's colour, an action under it when there is one thing to do, a × to dismiss. Desktop: bottom right, above nothing; a phone: the top, inside the overlay's inset, clear of the composer and keyboard", groups: [
    { title: "In use", note: "two toasts stacked, measured", layout: "desktop", atoms: [
      lib("toast-inuse", "Toast in use", "both", "toast", "Toaster > Toast kind action", () => <InUse scene={toastScene} marks={TOAST_MARKS} spacing={[".ui-toast"]} />, "row"),
    ] },
    { title: "Live engine", note: "the app's real notification adapter and Sonner behavior: the animated element itself is the library's frost frame, so its blur works throughout the fade, stack and swipe", layout: "desktop", atoms: [
      lib("toast-live", "Live notifications", "desktop", "toast", "components/notifications.tsx > Toaster > Toast embedded", () => <LiveNotifications />, "row"),
    ] },
    { title: "Forms", note: "each kind and form at each density", layout: "desktop", atoms: [
      lib("toast-forms", "Toast · forms × densities", "both", "toast", "Toast", () => <FormTable rows={TOASTS} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
    { title: "In the app", note: "the app raises notifications through Sonner, rendered by the shared v2 Toast: success, info, error and warning. A notification can include a description and action; duration and IDs retain Sonner behavior. Grouped by where they come from", layout: "desktop", atoms: [
      lib("toast-in-app", "Toast · in the app", "both", "toast", "client/** toast.*", () => <FormTable rows={TOASTS_IN_APP} on={["desktop", "phone"]} widths={["minmax(0, 1fr)", "360px"]} stacked />, "row"),
    ] },
    { title: "Motion", note: "its own moves: it comes in from its edge and leaves back to it, so on a phone (the top) it comes down", layout: "desktop", atoms: [
      lib("toast-motion", "Toast · motion", "both", "toast", "Toast motion", () => <FormTable rows={[form("arrives · leaves", "from its edge, back to it", () => <Replay leaves={["leaving"]}>{(m) => <Toast kind="success" motion={m()}>Saved to Downloads</Toast>}</Replay>, "<Toast motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Overlay", note: "raised frost over a dimmed page, the large surfaces: sections edge to edge, ruled off -- a Bar, a body (a List, a List beside an aside, or a Rail beside a Page), Hints. Its rows are the popover's Items at its scale; its Rail is the sidebar's NavGroups", groups: [
    { atoms: [
      lib("overlay-anatomy", "Anatomy", "both", "overlay", "Scrim > Overlay > OverlayBar · OverlayList (Sections of Items) · OverlayHints", () => <Anatomy scene={() => <div class="g-overlay-demo"><Overlay label="Anatomy">
        <OverlayBar lead={glyph()} placeholder="Run a command…" onClose={() => {}} />
        <OverlayList><Section title="Chat"><Item icon={<PaperclipIcon />} active>Attach a file</Item><Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>Search chats</Item><Item opens>Model</Item></Section></OverlayList>
        <OverlayHints start={[[["↑", "↓"], "Move"]]} end={[[["Esc"], "Close"]]} />
      </Overlay></div>} parts={[
        [".ui-overlay-bar", "Bar", "OverlayBar", "lead · input · end · close: what you type to"],
        [".ui-overlay-list", "List", "OverlayList", "the scrolling body: Sections (titled groups) of Items"],
        [".ui-overlay-list .ui-row", "Item", "Item · active", "a choice; the cursor follows the pointer and the arrows"],
        [".ui-overlay-hints", "Hints", "OverlayHints", "the keys along the foot, start and end"],
      ]} />, true),
      lib("overlay-anatomy-rail", "Anatomy · rail", "desktop", "overlay", "Overlay layout=rail > OverlayRail (NavGroups) · OverlayPage (SettingGroups of SettingLines)", () => <Anatomy scene={() => <div class="g-overlay-demo"><Overlay label="Anatomy" layout="rail" style={{ "--overlay-width": "600px" }}>
        <OverlayRail title="Settings"><NavGroup label="App"><NavRow icon={<MonitorIcon />} current>Appearance</NavRow><NavRow icon={<KeyboardIcon />}>Shortcuts</NavRow></NavGroup></OverlayRail>
        <OverlayPage title="Appearance" onClose={() => {}}><SettingGroup title="Display"><SettingLine label="Density"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Reduce motion"><SwitchDemo /></SettingLine></SettingGroup></OverlayPage>
      </Overlay></div>} parts={[
        [".ui-overlay-rail", "Rail", "OverlayRail", "a title, NavGroups, a foot"],
        [".ui-nav-group .ui-nav-label", "Nav group", "NavGroup", "rows under a label"],
        [".ui-nav-row", "Nav row", "NavRow · current", "a page; the current one lit"],
        [".ui-overlay-page-head", "Page", "OverlayPage", "its title, save status and close, over its groups", "above"],
        [".ui-setting-group", "Setting group", "SettingGroup", "lines under a title", "below"],
        [".ui-setting-line:last-child > span:first-child", "Setting line", "SettingLine", "a name, then its control in the one control column", "below"],
      ]} />, "row"),
      lib("overlay-bar", "OverlayBar", "both", "overlay", "OverlayBar lead · input · end · close", () => <div class="g-stack g-overlay-demo">
        <Overlay label="Bar"><OverlayBar lead={glyph()} placeholder="Run a command…" onClose={() => {}} /></Overlay>
        <Overlay label="Bar"><OverlayBar lead={<SearchIcon />} placeholder="Search chats, projects, workspaces…" end={<SortToggle />} onClose={() => {}} /></Overlay>
        <Overlay label="Bar"><OverlayBar lead={<SearchIcon />} chips={<><OverlayChip onRemove={() => {}}>in:Japan</OverlayChip><OverlayChip onRemove={() => {}}>is:unread</OverlayChip></>} placeholder="Search Japan chats…" end={<SortToggle />} onClose={() => {}} /></Overlay>
        <Overlay label="Bar"><OverlayBar lead={<Button variant="ghost" size="icon-sm" aria-label="Back"><ArrowLeftIcon /></Button>} chips={<Crumbs label="Where you are" items={[{ label: "Commands" }, { label: "Workspace views", current: true }]} />} placeholder="Search workspace views…" onClose={() => {}} /></Overlay>
      </div>, true),
      lib("overlay-tree", "OverlayList · a tree, an edit, nothing", "both", "overlay", "Item opens · onOpens (aria-expanded) · reveal end · indent · picked; OverlayEmpty", () => <div class="g-stack g-overlay-demo">
        <Overlay label="Tree"><OverlayList managed role="tree">{chatTree(false)}</OverlayList></Overlay>
        <Overlay label="Edit"><OverlayList managed role="tree">{chatTree(true)}</OverlayList><OverlayHints count="2 selected" start={[[["Ctrl", "E"], "Done", () => {}], [["Ctrl", "K", "D"], "Delete", () => {}], [["Ctrl", "K", "M"], "Move", () => {}]]} /></Overlay>
        <Overlay label="Empty"><OverlayBar lead={<SearchIcon />} chips={<OverlayChip onRemove={() => {}}>in:NHP</OverlayChip>} placeholder="Search NHP chats…" onClose={() => {}} /><OverlayList><OverlayEmpty>No chats in NHP.</OverlayEmpty></OverlayList></Overlay>
      </div>, true),
      lib("overlay-list", "OverlayList", "both", "overlay", "OverlayList > Section (a group title) > Item: icon · keys · opens · meta", () => <div class="g-overlay-demo"><Overlay label="List">{paletteList()}</Overlay></div>, true),
      lib("overlay-hints", "OverlayHints", "desktop", "overlay", "OverlayHints start · end: keys and what they do", () => <div class="g-stack g-overlay-demo"><Overlay label="Hints">{paletteHints()}</Overlay><Overlay label="Hints">{searchHints()}</Overlay></div>, true),
      lib("overlay-actions", "OverlayActions", "phone", "overlay", "OverlayActions: on a phone, the hints give way to the view's actions as buttons", () => <div class="g-stack g-overlay-demo">
        <Overlay label="Actions" density="phone"><OverlayActions actions={[{ label: "Edit", onClick: () => {} }, { label: "Latest", onClick: () => {} }, { label: "Open Japan", onClick: () => {} }]} /></Overlay>
        <Overlay label="Actions" density="phone"><OverlayActions actions={[{ label: "Move 2", onClick: () => {} }, { label: "Delete 2", destructive: true, onClick: () => {} }, { label: "Done", onClick: () => {} }]} /></Overlay>
      </div>, true),
      lib("overlay-split", "OverlaySplit", "desktop", "overlay", "OverlaySplit: a List beside an aside", () => <div class="g-overlay-demo"><Overlay label="Split" style={{ "--overlay-width": "100%" }}><OverlaySplit aside={chatPreview()}>{chatRows()}</OverlaySplit></Overlay></div>, true),
      lib("overlay-settings", "SettingGroup · SettingLine · every kind", "both", "overlay", "SettingGroup > SettingLine (a field, or plain: a value, link, buttons, keys) · SettingNote · SettingDetails · SettingWide (TextArea, Progress) · SettingLoading", () => <div class="g-overlay-demo"><Overlay label="Settings" layout="rail" style={{ "--overlay-width": "100%" }}><OverlayPage title="Every kind of line">
        <SettingGroup title="Fields"><SettingLine label="Select"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Input"><Input value="20" /></SettingLine><SettingLine label="Switch"><SwitchDemo /></SettingLine><SettingLine label="Segmented"><Theme /></SettingLine><SettingLine label="With its state" state="paused while hidden"><SelectTrigger value="Adaptive" bare /></SettingLine></SettingGroup>
        <SettingGroup title="Plain lines"><SettingLine label="SettingValue" plain><SettingValue>Signed in</SettingValue></SettingLine><SettingLine label="SettingValue mono" plain><SettingValue mono>a91f03c2 · TLS verified</SettingValue></SettingLine><SettingLine label="SettingLink" plain><SettingLink href="#">Docs</SettingLink></SettingLine><SettingLine label="Buttons" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" outline size="sm">Forget</Button></SettingLine><SettingLine label="Keys" plain>{keys("Ctrl", "K")}{reset()}</SettingLine></SettingGroup>
        <SettingGroup title="Under a line"><SettingLine label="A field"><Input value="sk-or-••••3f2a" /></SettingLine><SettingNote tone="error">SettingNote error: that key was turned down (401).</SettingNote><SettingNote>SettingNote quiet: click a shortcut, then press its keys.</SettingNote><SettingDetails summary="SettingDetails"><p>Folded until asked for.</p></SettingDetails></SettingGroup>
        <SettingGroup title="Page width"><SettingWide><TextArea value="SettingWide > TextArea: a prompt's text." /></SettingWide><SettingWide><Progress label="Download" value={1.2} max={3.1} /></SettingWide><SettingLoading>SettingLoading…</SettingLoading></SettingGroup>
      </OverlayPage></Overlay></div>, true),
    ] },
    { title: "Assembled", note: "the app's own, at their sizes", layout: "desktop", atoms: [
      lib("o-palette", "CommandMenu", "desktop", "overlay", "navigation/command-menu.tsx", () => overlayViews.palette({ close: noop, class: "g-scrim" }), "row"),
      lib("o-search", "CommandMenu · chat search", "desktop", "overlay", "navigation/command-menu.tsx", () => overlayViews.search({ close: noop, class: "g-scrim" }), "row"),
      lib("o-settings", "Settings", "desktop", "overlay", "settings/settings-core.tsx", () => overlayViews.settings({ close: noop, class: "g-scrim" }), "row"),
      lib("o-settings-record", "Settings · recording a shortcut", "desktop", "overlay", "settings/shortcuts-settings.tsx · + opens a second line under the command; press keys, Esc cancels, Backspace clears", () => <Scrim class="g-scrim" placement="center"><Settings close={noop} start="shortcuts" /></Scrim>, "row"),
    ] },
    { title: "Chat search's preview", note: "Glance: what the cursor rests on, told apart without opening it. The app reads the chat (a moment after the cursor settles); these draw what it read. The orb is the library's Orb. Ctrl+P hides and shows it in the search overlay", atoms: [
      lib("glance-chat", "Glance · a chat", "desktop", "overlay", "navigation/chat-preview.tsx · GlanceHead · GlancePrompt · GlanceTurn · GlanceAnswer", () => <Frost lift="raised" class="g-glance">{glanceChat()}</Frost>),
      lib("glance-stopped", "Glance · stopped", "desktop", "overlay", "an interrupted or failed turn: the orb sputters red", () => <Frost lift="raised" class="g-glance">{glanceStopped()}</Frost>),
      lib("glance-math", "Glance · math", "desktop", "overlay", "GlanceAnswer html: the app's rendered KaTeX, faded where it is cut", () => <Frost lift="raised" class="g-glance">{glanceMath()}</Frost>),
      lib("glance-folder", "Glance · a folder", "desktop", "overlay", "FolderPreview: where it is, how it stands, its latest chats as rows", () => <Frost lift="raised" class="g-glance">{glanceFolder()}</Frost>),
      lib("glance-empty", "Glance · nothing highlighted", "desktop", "overlay", "GlanceEmpty", () => <Frost lift="raised" class="g-glance">{glanceEmpty("Nothing highlighted")()}</Frost>),
      lib("glance-unread", "Glance · no messages / couldn't read", "desktop", "overlay", "GlanceHead + GlanceEmpty", () => <Frost lift="raised" class="g-glance"><Glance label="Chat preview"><GlanceHead mark={<SquarePenIcon />} title="Untitled chat" facts={["Conduit · Chats · just now"]} /><GlanceEmpty>No messages yet</GlanceEmpty></Glance></Frost>),
    ] },
    { title: "Phone", note: "full screen, nothing round them dimmed; frost, not core -- the transcript shows through blurred. One column: search's preview and the hints go, settings' rail is a screen of its own", layout: "phone", atoms: [
      lib("o-palette-phone", "CommandMenu", "phone", "overlay", "navigation/command-menu.tsx", () => <PhoneStage><Overlay label="Command palette"><OverlayBar lead={glyph()} placeholder="Run a command…" onClose={noop} />{paletteList()}</Overlay></PhoneStage>),
      lib("o-search-phone", "CommandMenu · chat search", "phone", "overlay", "navigation/command-menu.tsx", () => <PhoneStage><Overlay label="Chat search"><OverlayBar lead={<SearchIcon />} placeholder="Search chats…" value="t" end={<SortToggle />} onClose={noop} /><OverlaySplit aside={chatPreview()}>{chatRows("t")}</OverlaySplit></Overlay></PhoneStage>),
      lib("o-settings-phone", "Settings · sections", "phone", "overlay", "settings/settings-core.tsx · a section opens over the rail, Back returns", () => <PhoneStage><Settings close={noop} phone /></PhoneStage>),
      lib("o-settings-page-phone", "Settings · a section", "phone", "overlay", "settings/settings-core.tsx · Back to the sections", () => <PhoneStage><Settings close={noop} phone start="models" /></PhoneStage>),
    ] },
    { title: "Motion", note: "its own moves: the scrim dims in and out; the overlay on it rises in and drops back", layout: "desktop", atoms: [
      lib("overlay-backdrop", "Backdrop", "phone", "overlay", "components/ui/overlay.tsx · the page dimmed under a phone's drawer; a tap on it dismisses the drawer. Here it is held in its frame (on a phone it covers the screen, one layer under its drawer: --layer-drawer for the sidebar, --layer-panel for the workspace panel)", () => <div data-density="phone" style={{ position: "relative", transform: "translateZ(0)", width: "100%", height: "calc(10 * var(--u-space))", overflow: "hidden", "border-radius": "var(--radius-surface)" }}><p style={{ margin: "var(--space-lg)" }}>The page under the drawer</p><Backdrop layer="drawer" label="Dismiss sidebar" onDismiss={() => {}} /></div>, "row"),
      lib("overlay-motion", "Overlay · motion", "both", "overlay", "Scrim motion · Overlay motion", () => <FormTable rows={[form("arrives · leaves", "the scrim fades; the overlay rises and drops back", () => <Replay leaves={["leaving"]}>{(m) => <Scrim placement="center" motion={m()}><Overlay label="Overlay" motion={m()}><OverlayList>{leaderRows()}</OverlayList></Overlay></Scrim>}</Replay>, "<Scrim motion> · <Overlay motion>", "the scrim: a fade, --ease-change · " + "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Leader", note: "a small Overlay card above the composer that does not cover the page: the page dims all but the current region", groups: [
    { atoms: [
      lib("leader-crumbs", "Crumbs", "both", "overlay", "Crumbs: the breadcrumb's places in the section label's caps; the current place white with no fill, the cursor washing the others", () => <div class="g-overlay-demo"><Overlay label="Crumbs" class="ui-leader"><OverlayHead><LeaderPath /></OverlayHead></Overlay></div>, true),
      lib("leader-rows", "Item keysFirst", "both", "overlay", "Item keysFirst: the key leads the row, in the text colour", () => <div class="g-overlay-demo"><Overlay label="Rows" class="ui-leader"><OverlayList>{leaderRows()}</OverlayList></Overlay></div>, true),
      lib("leader-spotlight", "Spotlight", "desktop", "overlay", "Spotlight: the dim is the shadow round the lit region, cut out with its corners", () => <div class="g-page"><div class="g-page-pane" /><div class="g-page-composer" /><Spotlight lit={{ top: "12px", left: "12px", width: "calc(100% - 24px)", height: "calc(100% - 24px)", radius: "16px" }} /></div>, true),
    ] },
    { title: "Assembled", note: "the app's own, at its size", layout: "desktop", atoms: [
      lib("o-leader", "LeaderPalette", "desktop", "overlay", "navigation/leader-palette.tsx · the composer region lit", () => <div class="g-page"><div class="g-page-pane" /><div class="g-page-composer" />
        {overlayViews.leader({ close: noop, lit: { top: "calc(100% - 76px)", left: "calc(50% - 230px)", width: "460px", height: "56px", radius: "17.6px" } })}</div>, "row"),
    ] },
    { title: "Motion", note: "an Overlay's moves: it rises above the composer and drops back (the app's leader: 220ms in, 150ms out)", layout: "desktop", atoms: [
      lib("leader-motion", "Leader · motion", "both", "overlay", "Leader motion", () => <FormTable rows={[form("arrives · leaves", "rises --space-md with a fade; drops back", () => <Replay leaves={["leaving"]}>{(m) => <Overlay label="Leader" class="ui-leader" motion={m()}><OverlayList>{leaderRows()}</OverlayList></Overlay>}</Replay>, "<Leader motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "DesktopComposer", note: "desktop only, one integrated piece: resting frost holding a TextArea above a Toolbar, with Riders on its top edge. A phone's is PhoneComposer (Pills), sharing the TextArea and the Riders", groups: [
    { atoms: [
      lib("composer-anatomy", "Anatomy", "desktop", "composer", "DesktopComposer > riders · ComposerField (a TextArea) · Toolbar (start · end · primary)", () => <Anatomy scene={() => <div class="g-composer"><DesktopComposer riders={queued()}>
        <ComposerField><TextArea placeholder="Send a message…" /></ComposerField>
        <Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} />
      </DesktopComposer></div>} parts={[
        [".ui-rider", "Riders", "Rider", "frost on the composer's top edge (Rider, its own section)"],
        [".ui-composer-field", "Field", "ComposerField · TextArea", "the draft, padded by the composer"],
        [".ui-toolbar-start", "Start", "Toolbar start", "ghost icon buttons and pickers"],
        [".ui-toolbar-end", "End", "Toolbar end", "the mic", "below"],
        [".ui-toolbar-primary", "Primary", "Toolbar primary", "Send, or Stop while the agent works", "below"],
      ]} />, true),
      lib("composer-toolbar", "Toolbar", "desktop", "composer", "Toolbar start · end · aside · primary, no frost of its own: ghost icon buttons, pickers; the primary its own slot (Send, or Stop while the agent works), Stop stepping in beside it as the aside", () => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></div>, "row"),
    ] },
    { title: "Assembled", atoms: [
      lib("composer", "Composer", "desktop", "composer", "chat/composer.tsx", () => <div class="g-composer"><DesktopComposer><ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, true),
      lib("composer-pickers", "Picker · Gauge", "desktop", "composer", "Picker: a small ghost button showing what is picked; Gauge: how full, as a ring", () => <FormTable rows={[
        form("a setting", "muted: a mark, its value cut short to its room", () => <div class="g-row"><Picker icon={<ShieldCheckIcon />} value="Ask before edits" /><Picker icon={<HarnessMark id="conduit" />} aria-label="Profile" /></div>, "<Picker icon value>", "--icon-sm · --control-sm"),
        form("the subject", "what the message goes to (the model), at full weight; a quieter second value", () => <Picker subject value="Meta: Muse Spark 1.3 Contributor" quiet="medium" />, "<Picker subject quiet>", "--weight-current"),
        form("connecting", "a Spinner as its mark until there is a value", () => <Picker icon={<Spinner />} value="Connecting…" disabled />, "<Picker icon={<Spinner />}>", ""),
        form("Gauge", "idle (nothing reported), normal, warning, critical", () => <div class="g-row"><Gauge value={0} tone="idle" /><Gauge value={42} /><Gauge value={78} tone="warning" /><Gauge value={94} tone="critical" /></div>, "<Gauge value tone>", "--warn · --destructive"),
        form("Swatch", "a part's colour beside its label; hollow for what sits outside; fill: the whole of a colour choice", () => <div class="g-row"><Swatch colour="oklch(0.72 0.15 300)" /><Swatch hollow /><Button variant="ghost" size="icon-sm" aria-label="Mauve"><Swatch colour="oklch(0.72 0.15 300)" fill /></Button></div>, "<Swatch colour hollow fill>", "--icon-dot"),
      ]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
      lib("composer-voice", "VoiceRider · Completion", "desktop", "composer", "VoiceRider · Completion", () => <FormTable rows={[
        form("dictating", "the voice rides over the composer as a wave Rider on an Aura, as a phone's voice track; the words go into the field as they come", () => <States states={["Off", "Listening"] as const}>{(s) => {
          const voice = speech(() => s() === "Listening");
          return <div class="g-composer"><DesktopComposer riders={<Show when={s() === "Listening"}><VoiceRider levels={voice.bars()} level={voice.level()} motion="entering" /></Show>}>
            <ComposerField><TextArea value={s() === "Listening" ? "rename the file to" : ""} placeholder="Send a message…" /></ComposerField>
            <Toolbar start={toolbarStart()} end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" aria-pressed={s() === "Listening"}><MicIcon /></Button>} primary={send()} /></DesktopComposer></div>; }}</States>, "<VoiceRider levels level>", "Rider wave: --control"),
        form("Completion", "a slash command the draft completes to: the rest ghosted after what is typed, then what it does", () => <div class="g-composer"><DesktopComposer><ComposerField><TextArea value="/" /><Completion typed="/" rest="attach" detail="Choose files to attach" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, "<Completion typed rest detail>", "--cmp-field-pad · --text-caption"),
      ]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
      lib("composer-ridden", "Composer · QueuedMessages + AttachmentStrip", "desktop", "composer", "chat/composer.tsx, queued-messages.tsx, attachment-strip.tsx", () => <div class="g-composer"><DesktopComposer riders={<>{queued()}{attachments()}</>}><ComposerField><TextArea value="see the attached notes" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, true),
    ] },
    { title: "Motion", note: "its own moves: the primary slot scales each action in where the last was, so nothing beside it moves, and Stop steps in beside Send when a draft is typed during a turn; dictating, the mic breathes; a question takes the composer's place -- the composer drops out of the pane keeping its room, and the card rises into the slot once it has gone", layout: "desktop", atoms: [
      lib("composer-motion", "DesktopComposer · motion", "desktop", "composer", "Toolbar primary · aside · DesktopComposer takeover", () => <FormTable rows={[
        form("the primary slot", "each action grows in from 60% where the last was; the aside steps in from the slot's side", () => <States states={["Ready", "Working", "Draft in a turn"] as const}>{(s) =>
          <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()} aside={<Show when={s() === "Draft in a turn"}>{ghost("Stop response", <StopGlyph />)}</Show>}
            primary={<Show when={s() === "Working"} fallback={send()}>{ghost("Stop response", <StopGlyph />)}</Show>} /></div>}</States>, "<Toolbar primary aside>", "--duration-quick · --ease-arrive · the aside: --duration-gentle"),
        form("dictating", "the held mic breathes from the text colour to muted and back", () => <States states={["Off", "Dictating"] as const}>{(s) =>
          <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" aria-pressed={s() === "Dictating"}><MicIcon /></Button>} primary={send()} /></div>}</States>, "aria-pressed in Toolbar end", "1.6s, its own"),
        form("a question takes over", "the composer drops out keeping its room; the card rises 2 units into the slot after it", () => <States states={["Composer", "Question"] as const}>{(s) =>
          <div class="g-composer"><DesktopComposer riders={queued()} takeover={<Show when={s() === "Question"}><Rider layout="card" label="Question" motion="entering"><span class="ui-title-text">Preferred language</span>
            <Choices><Choice n={1} label="Python" detail="Use Python for the task" chosen active /><Choice n={2} label="TypeScript" detail="Use TypeScript for the task" /><Choice n={3} label="Rust" detail="Use Rust for the task" /></Choices></Rider></Show>}>
            <ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>}</States>, "<DesktopComposer takeover>", "out: --duration-quick · --ease-leave · in: --duration-gentle · --ease-arrive, the card after --duration-quick"),
      ]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Rider", note: "resting frost at a composer, either composer's: a row or a strip on its top edge (queued messages, attachments), or a card that takes over its slot in its material (the question: the composer takeover)", groups: [
    { atoms: [
      lib("rider-anatomy", "Anatomy", "both", "rider", "Rider layout=row: RiderTitle · body · RiderActions", () => <Anatomy scene={() => <div class="g-composer">{queued()}</div>} parts={[
        [".ui-rider > .ui-title-text", "Title", "RiderTitle", "what it holds"],
        [".ui-lines", "Body", "Lines · Chips · Choices", "what waits: lines, chips or choices", "above"],
        [".ui-rider-actions", "Actions", "RiderActions", "ghost icon buttons for it", "below"],
      ]} />, true),
      lib("rider-line", "Line", "both", "rider", "Line: waiting text, one line until opened", () => <div class="g-composer"><Rider><Lines><Line text="and make the second paragraph shorter" /><Line text="then rename the file to lorem.txt, and add a heading at the top that says what it is, and then read it back to me" clipped /></Lines></Rider></div>, true),
      lib("rider-chip", "Chip", "both", "rider", "Chip: image · file · uploading · failed · queued · failed, retryable", () => <div class="g-row"><Chip name="photo.png" image={thumb} /><Chip name="notes.txt" detail="2.1 KB" icon={<FileTextIcon />} /><Chip name="big.pdf" detail="64%" icon={<FileTextIcon />} status="uploading" progress={64} /><Chip name="broken.txt" detail="Upload failed" icon={<FileTextIcon />} status="error" /><Chip name="queued.png" image={thumb} status="queued" progress={0} /><Chip name="draft.txt" detail="Upload failed · press to retry" icon={<FileTextIcon />} status="error" retry /></div>, true),
      lib("rider-references", "References", "both", "rider", "Reference: a file's mark, name, lines and note, cut short; a press goes to it. In the composer's Rider with edit and remove; under a sent message without", () => <div class="g-composer g-stack">
        <Rider label="File references"><References><Reference icon={<FileCode2Icon />} name="parser.ts" at=":12-18" note="this guard is never hit" onOpen={noop} onEdit={noop} onRemove={noop} /><Reference icon={<FileDiffIcon />} name="README.md" at=":4" onOpen={noop} onEdit={noop} onRemove={noop} /></References></Rider>
        <References><Reference icon={<FileCode2Icon />} name="parser.ts" at=":12-18" note="this guard is never hit" onOpen={noop} /></References></div>, true),
      lib("rider-choice", "Choice", "both", "rider", "Choices > Choice: number · label · detail. One answer: the current choice white and bold, no tick. Pick any: the wash on each chosen. The cursor follows the pointer", () => <div class="g-composer g-stack"><Rider layout="card"><Choices><Choice n={1} label="Chosen" detail="the current choice" chosen /><Choice n={2} label="Not chosen" active /><Choice n={3} label="Not chosen" detail="with a description" /><div class="ui-choice"><span class="ui-choice-key">4</span><TextArea placeholder="Type your own answer (a TextArea)" /></div></Choices></Rider>
        <Rider layout="card"><Choices multi><Choice n={1} label="Chosen" multi chosen /><Choice n={2} label="Chosen too" multi chosen active /><Choice n={3} label="Not chosen" multi /></Choices></Rider></div>, true),
    ] },
    { title: "Over the transcript", note: "RiderButton: resting frost at the surface radius, riding just above the composer -- scroll to latest (an icon), and cancel an edit (its words), which sits beside it when both show", atoms: [
      lib("rider-button", "RiderButton", "both", "rider", "chat/transcript.tsx · ride: centre (scroll to latest), beside (cancel editing, when both show); the transcript sets --ride-bottom", () => <div class="g-stack"><div class="g-row"><RiderButton icon={<XIcon />} label="Cancel editing" show="label" /><RiderButton icon={<ArrowDownIcon />} label="Scroll to latest" /></div>
        <div class="g-ride"><RiderButton ride="beside" icon={<XIcon />} label="Cancel editing" show="label" /><RiderButton ride="centre" icon={<ArrowDownIcon />} label="Scroll to latest" /></div></div>),
    ] },
    { title: "Assembled", atoms: [
      lib("rider-queued", "QueuedMessages", "both", "rider", "chat/queued-messages.tsx", () => <div class="g-composer">{queued()}</div>, true),
      lib("rider-attachments", "AttachmentStrip", "both", "rider", "chat/attachment-strip.tsx", () => <div class="g-composer">{attachments()}</div>, true),
      lib("rider-question", "QuestionCard", "both", "rider", "chat/question-card.tsx · the composer takeover: in the composer's slot and material. One question: its title, Choices, own answer, Stop · Submit", () => questionCard([LANGUAGE]), true),
      lib("rider-question-tabs", "QuestionCard · tabs", "both", "rider", "chat/question-card.tsx · tabs (ticked when answered), pick any, a preview, a multi-line own answer, notes", () => questionCard(TABS, { notes: true }), true),
      lib("rider-question-submit", "QuestionCard · Submit page", "both", "rider", "chat/question-card.tsx · the review page; a secret answer", () => questionCard(SUMMARY, { page: "submit" }), true),
    ] },
    { title: "Motion", note: "its own moves: a rider rises out of the composer and drops back into it when the composer takes it; removed by hand, it fades in place. A takeover card rises further (2 units), once the composer has gone (DesktopComposer · Motion). A RiderButton fades. A chip arrives growing from 85%", layout: "desktop", atoms: [
      lib("rider-motion", "Rider · motion", "both", "rider", "Rider motion · Chip motion", () => <FormTable rows={[
        form("arrives · taken · removed", "rises out of the composer; drops back into it; fades in place", () => <Replay leaves={["leaving", "removing"]}>{(m) => <div class="g-composer">{queued(m())}</div>}</Replay>, "<Rider motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave"),
        form("RiderButton", "fades in where it rides when there is more below, out when there is not", () => <States states={["At the latest", "Scrolled up"] as const}>{(s) => <div class="g-row"><Presence when={s() === "Scrolled up"}>{(m) => <RiderButton icon={<ArrowDownIcon />} label="Scroll to latest" motion={m()} />}</Presence></div>}</States>, "<RiderButton motion>", "in: --duration-gentle · out: --duration-quick"),
        form("RiderButton hidden", "always there, hidden in place: fades out and back in, never drawn again (the transcript's scroll to latest)", () => <States states={["At the latest", "Scrolled up"] as const}>{(s) => <div class="g-row"><RiderButton icon={<ArrowDownIcon />} label="Scroll to latest" hidden={s() === "At the latest"} /></div>}</States>, "<RiderButton hidden>", "out: --duration-quick, leave · in: --duration-gentle, arrive"),
        form("a chip", "grows in from 85%; removed, it fades", () => <Replay leaves={["removing"]}>{(m) => <div class="g-row"><Chip name="notes.txt" detail="2.1 KB" icon={<FileTextIcon />} motion={m()} /></div>}</Replay>, "<Chip motion>", "--duration-gentle · --ease-arrive · out: --duration-quick"),
      ]} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Pill", note: "resting frost floating over the page, the phone's controls. The kind sets the shape: a button is a circle, a group a capsule", groups: [
    { layout: "phone", atoms: [
      lib("pill-button", "PillButton", "phone", "pill", "PillButton: one action, a circle · haptic: a press that acts at once (the mic, Send, Stop) is felt on a phone", () => <div class="g-row"><PillButton {...icon("Sidebar", <PanelLeftIcon />)} /><PillButton {...icon("Add", <PlusIcon />)} /></div>),
      lib("pill-stretch", "PillButton · stretch", "phone", "pill", "PillButton stretch: across its row", () => <div class="g-row g-fill"><PillButton stretch {...icon("Dictate", <MicIcon />)} /></div>),
      lib("pill-group", "PillGroup", "phone", "pill", "PillGroup: several actions, one capsule", () => <div class="g-row"><PillGroup actions={[icon("Sidebar", <PanelLeftIcon />), icon("New chat", <MessageSquarePlusIcon />)]} /><PillGroup actions={[icon("Search", <SearchIcon />), icon("Terminal", <TerminalIcon />), icon("More", <EllipsisIcon />)]} /></div>),
      lib("pill-switch", "PillSwitch", "phone", "pill", "PillSwitch: a group where one slot is chosen", () => <Area />),
      lib("pill-field", "PillField", "phone", "pill", "PillField: text in the capsule", () => <div class="g-fill"><PillField placeholder="Send a message…" /></div>),
    ] },
    { title: "Assembled", layout: "phone", atoms: [
      lib("pill-header", "ChatHeader · the phone's pills", "phone", "pill", "Header (components/ui/header.tsx): its lead and actions groups", () => <div class="g-bar-demo"><PillGroup actions={[icon("Sidebar", <PanelLeftIcon />), icon("New chat", <MessageSquarePlusIcon />)]} /><PillGroup actions={[icon("Search", <SearchIcon />), icon("Terminal", <TerminalIcon />), icon("More", <EllipsisIcon />)]} /></div>, true),
      lib("pill-sidebar", "Sidebar · header", "phone", "pill", "navigation/sidebar.tsx (the phone's drawer has no toggle: a swipe or the backdrop closes it)", () => <div class="g-bar-demo"><Area /></div>, true),
      lib("pill-composer", "Composer · bar layout", "phone", "pill", "chat/composer.tsx (bar)", () => <div class="g-composer-demo"><PillField placeholder="Send a message…" /><div class="g-bar-demo">
        <PillButton {...icon("Message options", <PlusIcon />)} /><PillButton {...icon("Take a photo", <CameraIcon />)} /><PillButton {...icon("Type a message", <KeyboardIcon />)} /><PillButton stretch {...icon("Dictate", <MicIcon />)} /><PillButton {...icon("Send", <ArrowUpIcon />)} />
      </div></div>, true),
    ] },
    { title: "Motion", note: "its own moves: a circle that comes and goes in a row grows from nothing and shrinks back, its gap with it, so a stretched neighbour gives and takes the room -- Send beside the mic, once there is something to send", layout: "phone", atoms: [
      lib("pill-motion", "Pill · motion", "phone", "pill", "PillButton folded", () => <FormTable rows={[
        form("comes and goes", "unfolds beside the mic, which gives it room, and fades into it; fades, then gives the room back", () => <States states={["Empty", "Typed"] as const}>{(s) => <div class="g-bar-demo"><PillButton {...icon("Message options", <PlusIcon />)} /><PillButton stretch {...icon("Dictate", <MicIcon />)} />
          <PillButton folded={s() === "Empty"} {...icon("Send", <ArrowUpIcon />)} /></div>}</States>, "<PillButton folded>", "the room: --duration-gentle · --ease-arrive; the fade: --duration-quick, after the room opens or before it closes"),
      ]} on={["phone"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "PhoneComposer", note: "the phone's composer: Pills on the page, a PillField over a row of PillButtons, one gap apart. Its mode says what shows, and nothing reflows between them: idle (the row), typing (the field above it), listening (the voice track and captions). Circles that come and go fold (Scroll to latest, Stop and send, Send)", groups: [
    { title: "Anatomy", note: "an assembly, not a base component: Pills and foundations (Aura, icons, type), each part named for what it does", layout: "phone", atoms: [
      lib("phone-anatomy", "Anatomy", "phone", "pill", "PhoneComposer > edit · field · row (the mode's pills)", () => <Anatomy scene={() => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, away: true, editing: true })}</div>} parts={PHONE_PARTS} />, "row"),
      lib("phone-anatomy-listening", "Anatomy · listening", "phone", "pill", "PhoneComposer mode=listening > captions · row (track · Dictate · Stop and send)", () => <Anatomy scene={() => <div class="g-phone-composer">{phoneComposer("listening")}</div>} parts={PHONE_VOICE_PARTS} />, "row"),
    ] },
    { title: "State table", note: "what each state shows (PHONE_COMPOSER_STATES, rendered as data-show). Every move between two states follows from it and three moves, none depending on where it came from: in (room at once, fade in over gentle, from the first frame), out (fade over quick from the first frame; room after, or a row pill slides under its neighbour at its own size), in place (the mic's shape, the track's wipe, over gentle). Declared waits: the captions come in after the quick duration. The motion check reads the same table", layout: "phone", atoms: [
      lib("phone-table", "State table", "phone", "pill", "PHONE_COMPOSER_STATES", () => <StateTable />, "row"),
    ] },
    { title: "Forms", note: "each mode, and the field's edit pills", layout: "phone", atoms: [
      lib("phone-idle", "Idle", "phone", "pill", "PhoneComposer mode=idle: the row alone; nothing to send, so Send is folded", () => <div class="g-phone-composer">{phoneComposer("idle")}</div>),
      lib("phone-typing", "Typing", "phone", "pill", "mode=typing: the field above the row, Send beside the mic", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true })}</div>),
      lib("phone-listening", "Listening", "phone", "pill", "mode=listening: the mic an orb pill at the row's end, Stop and send beside it, the track and captions", () => <div class="g-phone-composer">{phoneComposer("listening")}</div>),
      lib("phone-editing", "Editing", "phone", "pill", "edit · editing: pills over the field while its cursor is moved by hand", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, editing: true })}</div>),
      lib("phone-under", "Menu open", "phone", "pill", "under · PillButton open: the + menu is open, so the rest dims at once and its opener stays lit", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, under: true })}</div>),
      lib("phone-riders", "Riding", "phone", "pill", "riders: Riders over the field, as on a DesktopComposer's top edge (queued messages, attachments, a question)", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, riders: true })}</div>),
      lib("phone-surface", "Surface", "phone", "pill", "layout=surface: the row one frost capsule, its pills slots in it, the mic at its end", () => <div class="g-phone-composer">{phoneComposer("idle", { layout: "surface" })}</div>),
      lib("phone-surface-listening", "Surface · listening", "phone", "pill", "layout=surface · mode=listening: an Aura fills the capsule under the waveform; Stop and send beside the mic", () => <div class="g-phone-composer">{phoneComposer("listening", { layout: "surface" })}</div>),
    ] },
    { title: "Motion", note: "its own moves: the field fades in place and gives up its room once faded; listening, the other pills fade where they stand, the mic shrinks to an orb pill at the row's end, its icon crossfading to the orb, and the track sweeps out of it to the row's start (back, quicker, on stop); captions fade in; folding circles open their room and fade in, or fade and then close it; edit pills fade each", layout: "phone", atoms: [
      lib("phone-motion", "PhoneComposer · motion", "phone", "pill", "PhoneComposer mode · PillButton folded · orb", () => <FormTable rows={[
        ...(["bar", "surface"] as const).map((layout) => form(layout === "bar" ? "its modes" : "its modes · surface", "pick one, then another", () => <States states={["Idle", "Scrolled up", "Typing", "Typing a draft", "Editing", "Menu open", "Listening"] as const}>{(s) => <div class="g-phone-composer">{phoneComposer(
          () => s() === "Listening" ? "listening" : s().startsWith("Typing") || s() === "Editing" || s() === "Menu open" ? "typing" : "idle",
          { layout, draft: () => ["Typing a draft", "Editing", "Menu open"].includes(s()), away: () => s() === "Scrolled up", editing: () => s() === "Editing", under: () => s() === "Menu open" })}</div>}</States>,
          `<PhoneComposer mode${layout === "surface" ? ' layout="surface"' : ""}>`, "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")),
      ]} on={["phone"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Trace", rail: "Transcript", note: "a turn's work, over its answer. Its head is two lines -- the Status line (Status · Time · Work) and the Latest line -- beside the Orb; opened, its Trail of Steps", groups: [
    { title: "Anatomy", note: "each part named", layout: "desktop", atoms: [
      lib("trace-anatomy", "Anatomy", "both", "transcript", "Trace > TraceHeader (Orb · Status line · Latest line) · Trail > Step", () => <Anatomy scene={() => <div class="ui-read g-read g-trace-anatomy">
        <FoldTrace orb={orb(true)} status="Done" time="1m 00s" work="1 read, 1 edit, 1 command" latest="The second paragraph has four sentences"><Trail><Step icon={<LightbulbIcon />} summary="The second paragraph has four sentences" /><Step icon={<FileTextIcon />} verb="Read" subject="lorem_ipsum.txt" time="0ms" /><Step icon={<FilePenLineIcon />} verb="Edited" subject="lorem_ipsum.txt" time="1m 00s" /></Trail></FoldTrace>
      </div>} parts={[
        [".ui-trace-orb", "Orb", "Orb", "what it is doing, as motion (Foundations · Orbs)"],
        [".ui-trace-line > b", "Status", "Status line", "one word for what it is doing or how it ended (States below)", "above"],
        [".ui-trace-time", "Time", "Status line", "from the prompt: counting while it runs, then how long it took", "above"],
        [".ui-trace-line > span:last-child", "Work", "Status line", "its tools counted by kind, most first", "above"],
        [".ui-trace-latest", "Latest line", "the second line", "running: what the running tool acts on, else the last step in the past tense, or the last thinking; settled: the last thinking"],
        [".ui-trail", "Trail", "Trail, opened", "its steps, one line each"],
        [".ui-step-item:nth-child(2) .ui-step", "Step", "a line of the Trail", "Icon · Verb · Subject · Flags · Time; opens to what it did (Steps below)"],
      ]} />, "row"),
    ] },
    { title: "States", note: "every Status the Status line can say, the orb with it, and what the Latest line holds", layout: "desktop", atoms: [lib("trace-states", "States", "both", "transcript", "<TraceHeader status orb latest live tone>", () => <TraceStates />, "row")] },
    { title: "A turn", note: "played, a second a beat; open and close it", layout: "desktop", atoms: [lib("trace-live", "A turn", "both", "transcript", "Trace > TraceHeader · Trail > Step", () => <Read class="g-read g-live-turn"><LiveTurn /></Read>, "row")] },
    { title: "Steps", note: "every line the Trail can hold, open where it opens. Verb: present while running (Reading), past once done (Read)", layout: "desktop", atoms: [
      lib("trace-trail", "Steps", "both", "transcript", "Step · StepOutput · StepProse · Trail nested · TraceError", () => <FormTable rows={reading(TRAIL_FORMS)} on={["desktop"]} widths={["220px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "CodeBlock", rail: "Transcript", note: "a fenced block in an answer: a box, its language and Copy, numbered lines; a long one folds. Not frosted: it reads in the transcript's units and scale", groups: [
    { title: "In use", note: "in an answer, measured; Copy it, open and fold it", layout: "desktop", atoms: [
      lib("code-inuse", "CodeBlock in use", "both", "transcript", "Answer > CodeBlock · MessageFoot > CopyButton", () => <InUse scene={codeScene} marks={CODE_MARKS} spacing={[".ui-answer"]} />, "row"),
    ] },
    { title: "Forms", note: "each form at each density", layout: "desktop", atoms: [
      lib("code-forms", "CodeBlock · forms × densities", "both", "transcript", "CodeBlock", () => <FormTable rows={reading(CODE_FORMS)} on={["desktop", "phone"]} widths={["180px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
    { title: "In the app", note: "where the app draws one", layout: "desktop", atoms: [
      lib("code-in-app", "CodeBlock · in the app", "both", "transcript", "chat/code-block.ts", () => <FormTable rows={reading(CODE_IN_APP)} on={["desktop", "phone"]} widths={["minmax(0, 1fr)", "minmax(0, 1fr)"]} stacked />, "row"),
    ] },
    { title: "Motion", note: "its own moves: it unfolds (gentle) and folds back (quick); Copied washes it; a folded fence still being written breathes", layout: "desktop", atoms: [
      lib("code-motion", "CodeBlock · motion", "both", "transcript", "CodeBlock fold · copied · streaming", () => <FormTable rows={reading([
        form("unfolds · folds", "in height: the one move that pushes what is below", () => <FoldDemo />, "<CodeBlock fold open onToggle>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave"),
        form("copied", "a --tint wash over all of it, fading", () => <LiveCopy />, "<CodeBlock copied>", ".7s ease-out"),
        form("writing", "the foot breathes while the fence is written", () => <CodeBlock lang="ts" code={LONG} fold={4} streaming />, "<CodeBlock streaming>", "1.6s ease-in-out"),
      ])} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
  { title: "Transcript", rail: "Transcript", note: "what is read, at the transcript's size (Space · Scale); a row's text there (a trace, a trail) is a step under the body on both densities: the user's Message (a Bubble and its foot) and a Turn (its trace header, the answer, the answer's foot). The answer is Markdown with no bubble in the Body role, one gap between blocks; the trail sits a step under it", groups: [
    { title: "In use", note: "a turn, measured: green the gaps (a turn's parts half a unit apart, blocks three quarters)", layout: "desktop", atoms: [
      lib("transcript-inuse", "Turn in use", "both", "transcript", "Turn > TraceHeader · Answer · MessageFoot", () => <InUse scene={turnScene} marks={TURN_MARKS} spacing={[".ui-turn", ".ui-answer"]} />, "row"),
    ] },
    { title: "Forms", note: "each piece at each density", layout: "desktop", atoms: [
      lib("transcript-message", "Message · lengths × densities", "both", "transcript", "Message > Bubble · MessageFoot", () => <FormTable rows={reading(MESSAGE_FORMS)} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
      lib("transcript-answer", "Answer · blocks × densities", "both", "transcript", "Answer", () => <FormTable rows={reading(ANSWER_FORMS)} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
      lib("transcript-trace", "TraceHeader · Trail · MessageFoot", "both", "transcript", "TraceHeader · Trail · Step · MessageFoot", () => <FormTable rows={reading(TRACE_FORMS)} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
    { title: "Assembled", note: "a conversation, drawn with v2 alone", atoms: [
      lib("transcript-welcome", "Welcome", "both", "transcript", "chat/transcript.tsx · an empty chat's greeting, centred above the room its host keeps for the composer (--welcome-room)", () => <div class="g-transcript-stage"><Welcome title="How can I help you today?" /></div>),
      lib("transcript-desktop", "Transcript", "desktop", "transcript", "Transcript > Message · Turn", () => <div class="g-transcript-stage">{conversation()}</div>, "row"),
      lib("transcript-phone", "Transcript", "phone", "transcript", "Transcript > Message · Turn", () => <div class="g-transcript-stage" data-phone>{conversation()}</div>),
    ] },
    { title: "Motion", note: "its pieces' own moves: a step arriving in an open trail rises a little (its height at once, so nothing above moves); a sent message fades in where it lands; an answer's foot fades in when it is done; a Disclosure unfolds", layout: "desktop", atoms: [
      lib("transcript-motion", "Transcript · motion", "both", "transcript", "Step motion · Message motion · MessageFoot motion · Disclosure", () => <FormTable rows={reading([
        form("a step arrives", "rises --space-xs with a fade", () => <Replay>{(m) => <Trail><Step icon={<FileTextIcon />} verb="Read" subject="src/main.tsx" time="0.4s" /><Step icon={<FileTextIcon />} verb="Read" subject="src/app.tsx" time="0.2s" motion={m()} /></Trail>}</Replay>, "<Step motion>", "--duration-gentle · --ease-arrive"),
        form("a message lands", "fades in where it lands", () => <Replay>{(m) => <Message time="22:18" motion={m()}>and make the second paragraph shorter</Message>}</Replay>, "<Message motion>", "--duration-gentle · --ease-arrive"),
        form("the foot", "fades in when the answer is done", () => <Replay>{(m) => <MessageFoot time="22:19" motion={m()}>{copyRetry()}</MessageFoot>}</Replay>, "<MessageFoot motion>", "--duration-gentle · --ease-arrive"),
        form("a disclosure", "unfolds in height; folds away quicker", () => <DisclosureDemo />, "<Disclosure open onToggle>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave"),
      ])} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] },
];
