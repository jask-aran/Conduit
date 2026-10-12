import { ArrowDownIcon, PanelLeftIcon, MessageSquarePlusIcon, EllipsisIcon, CameraIcon, KeyboardIcon, MicIcon, ArrowUpIcon, ChevronDownIcon, CircleIcon, FileTextIcon, ClockIcon, Maximize2Icon, SendHorizontalIcon, XIcon, CheckIcon } from "lucide-solid";
import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import { PanelRightIcon, ClipboardCopyIcon, Columns2Icon, CopyIcon, FolderIcon, FolderInputIcon, LayoutDashboardIcon, MenuIcon, MonitorIcon, PaperclipIcon, PencilIcon, PinIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, SearchIcon, ShareIcon, ShieldCheckIcon, SquarePenIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { Leader, Crumbs, Spotlight, OverlayHead, Match, Choices, OverlayBar, OverlayHints, OverlayList, OverlayPage, OverlayRail, OverlaySplit, Glance, GlanceHead, GlancePrompt, GlanceTurn, GlanceAnswer, GlanceEmpty, RiderButton, Overlay, Scrim, SettingGroup, SettingLine, SettingValue, SettingLink, SettingNote, SettingDetails, SettingWide, SettingLoading, Progress, Keycap, NavGroup, NavRow, Segmented, SelectTrigger, Bubble, Button, Card, Chip, Choice, ComposerField, DesktopComposer, Line, TextArea, Rider, RiderActions, RiderTitle, Toolbar, Frost, Input, Item, Menu, PillButton, PillField, PillGroup, PillSwitch, HeadingSection, SearchSection, Section, Slider } from "@/components/ui";
import { Switch } from "../client/settings/settings-controls";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import { MODELS, PROFILES, PROJECTS } from "./seed";
import { QuestionCard } from "../client/chat/question-card";
import { ActivityIcon, BrainIcon, ChevronRightIcon, GlobeIcon, MessageSquareIcon, MicIcon as VoiceIcon, NotebookTextIcon, PanelLeftCloseIcon, ServerIcon } from "lucide-solid";
import type { Question } from "../client/api/contracts";
import { LibraryContext } from "@/components/ui/swap";
import katex from "katex";
import { ThinkingOrb, settledOrbRate } from "../client/chat/thinking-orb";
import { PLAIN_SPHERE, SPUTTERING_SPHERE } from "../client/chat/orb-frames";

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
/* Chat search's preview, drawn by the library's Glance from what the app would read; the orb is the app's own. */
const orb = (done: boolean) => <ThinkingOrb state="working" frame={done ? PLAIN_SPHERE : SPUTTERING_SPHERE} tint={done ? undefined : "var(--destructive)"} rate={settledOrbRate(!done)} />;
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
const searchHints = () => <OverlayHints start={[[["Ctrl", "E"], "Edit"], [["Alt", "R"], "Rename"], [["Ctrl", "K", "D"], "Delete"]]} end={[[["/"], "Search in"], [["Ctrl", "P"], "Preview"], [["Enter"], "Open"], [["Esc"], "Close"]]} />;
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
const SETTING_PAGES: Record<SettingsSection, { status?: string; failed?: boolean; body: () => JSX.Element }> = {
  appearance: { status: "Saved", body: () => <>
    <SettingGroup title="Interface"><SettingLine label="Theme"><Theme /></SettingLine><SettingLine label="Scale"><SelectTrigger value="75%" bare /></SettingLine><SettingLine label="Sidebar chats"><Input value="20" /></SettingLine><SettingLine label="Tab row"><SwitchDemo /></SettingLine><SettingLine label="Streaming" state="paused while hidden"><SelectTrigger value="Adaptive" bare /></SettingLine></SettingGroup>
    <SettingGroup title="Reading"><SettingLine label="Transcript width"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Wide blocks"><SelectTrigger value="Off" bare /></SettingLine><SettingLine label="Terminal font"><SelectTrigger value="Meslo" bare /></SettingLine></SettingGroup>
  </> },
  shortcuts: { status: "Saved", body: () => <Shortcuts /> },
  models: { status: "Not saved", failed: true, body: () => <>
    <SettingGroup title="Accounts"><SettingLine label="OpenAI" plain><SettingValue>Signed in</SettingValue><Button variant="ghost" size="sm">Sign out</Button></SettingLine><SettingLine label="Anthropic" plain><SettingLink href="#">Open sign-in</SettingLink></SettingLine>
      <SettingLine label="OpenRouter key"><Input value="sk-or-••••••••3f2a" /></SettingLine><SettingNote tone="error">That key was turned down (401). Check it has credit.</SettingNote>
      <SettingDetails summary="Where to find them"><ol><li>Open openrouter.ai/keys</li><li>Create a key, then paste it here</li></ol><p>Keys stay on this server, in <code>~/.conduit/data</code>.</p></SettingDetails></SettingGroup>
    <SettingGroup title="Providers"><SettingLine label="Gemini" plain><SettingLink href="#">Docs</SettingLink></SettingLine><SettingLine label="Default model"><SelectTrigger value="GPT-6 Luna" bare /></SettingLine></SettingGroup>
  </> },
  prompts: { status: "Saved", body: () => <SettingGroup title="System prompt"><SettingLine label="Assistant" state="edited" plain>{reset()}</SettingLine>
    <SettingWide><TextArea value={"You are Conduit's assistant. Answer briefly, then offer to go further.\nPrefer the user's own words for things."} /></SettingWide></SettingGroup> },
  runtime: { body: () => <>
    <SettingGroup title="Processes"><SettingLine label="Running" plain><SettingValue mono>3 of 8</SettingValue></SettingLine><SettingLine label="Idle timeout"><SelectTrigger value="10 minutes" bare /></SettingLine></SettingGroup>
    <SettingGroup title="Harnesses"><SettingLoading>Loading runtime settings…</SettingLoading></SettingGroup>
  </> },
  servers: { body: () => <>
    <SettingGroup title="This server"><SettingLine label="Name" plain><SettingValue>Desktop-Dev</SettingValue></SettingLine><SettingLine label="Address" plain><SettingValue mono>a91f03c2 · TLS verified</SettingValue></SettingLine></SettingGroup>
    <SettingGroup title="Others"><SettingLine label="Laptop" state="9 ms" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" size="sm">Forget</Button></SettingLine>
      <SettingLine label="VPS" state="offline" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" size="sm">Forget</Button></SettingLine><SettingNote tone="error">Couldn't reach VPS: the connection timed out.</SettingNote></SettingGroup>
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
  const add = () => <Button variant="ghost" size="icon-xs" aria-label="Add a shortcut"><PlusIcon /></Button>;
  return <>
    <SettingGroup title="Keyboard"><SettingLine label="Keys for" state="Chrome · Windows · Browser tab" plain><Button variant="ghost" size="sm"><RefreshCwIcon />Reset all</Button></SettingLine>
      <SettingLine label="Leader menu" state="Ctrl G"><SelectTrigger value="After a pause" bare /></SettingLine>
      <Input placeholder="Search commands, contexts, or keys…" /></SettingGroup>
    <SettingGroup title="Application"><For each={Object.keys(bound())}>{(command) => <SettingLine label={command} plain>
      <Show when={bound()[command]!.length} fallback={<SettingValue>Not assigned</SettingValue>}>
        <For each={bound()[command]}>{(chord) => <Keycap label={`${command}: ${chord}`} onClick={() => {}} onRemove={() => clear(command, chord)}>{chord}</Keycap>}</For>
      </Show>{add()}</SettingLine>}</For></SettingGroup>
  </>;
}

/** Settings: on a desktop the rail beside the page; on a phone one at a time, the page with Back to the rail. */
function Settings(props: { close: () => void; phone?: boolean; start?: SettingsSection | null }) {
  const [section, setSection] = createSignal<SettingsSection | null>(props.start === undefined ? (props.phone ? null : "appearance") : props.start);
  const rail = () => <OverlayRail title="Settings" foot={<span>Interface 0.8.1-dev</span>}>
    <For each={SETTINGS}>{(group) => <NavGroup label={group.label}><For each={group.sections}>{([id, label, glyph]) =>
      <NavRow icon={glyph()} current={!props.phone && section() === id} onClick={() => setSection(id)}>{label}</NavRow>}</For></NavGroup>}</For>
  </OverlayRail>;
  const page = (id: SettingsSection) => { const view = SETTING_PAGES[id]; return <OverlayPage title={titleOf(id)} status={view.status} failed={view.failed} onBack={props.phone ? () => setSection(null) : undefined} onClose={props.close}>{view.body()}</OverlayPage>; };
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
  { title: "Frost", note: "two materials: frost, and core -- frost on a solid backing, kept for the phone's full-screen overlays should what is behind them be too busy (off for now; nothing uses it). Over a plain ground they look alike; over text the difference shows. Lift is not a material, only its shadow: rest sits on the page, raised floats above it", groups: [{ atoms: [
    lib("frost", "Frost", "both", "material", "Frost", () => <div class="g-material"><Busy><Frost lift="raised" class="g-swatch" /></Busy><FrostTokens names={FROST_CSS} /></div>, true),
    lib("frost-core", "Core", "both", "material", "Frost core · Overlay core (off for now)", () => <div class="g-material"><Busy><Frost lift="raised" core class="g-swatch" /></Busy><FrostTokens names={["--frost-core-ground", ...FROST_CSS]} /></div>, true),
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
      lib("section-search", "Search", "both", "section", "SearchSection: heads a pick list (PopoverSearchList). A menu over a long list starts with a Search all… row that opens the palette instead", () => <Menu><SearchSection placeholder="Search all models…" keys={["⌘", "⇧", "X"]} /></Menu>),
      lib("item", "List · items", "both", "section", "Section + Item: icon meta detail keys opens field · checked (current: bold, no tick) disabled destructive", () => <Menu><Section title="Title" note="note">
        <Item>Plain</Item>
        <Item icon={<PaperclipIcon />}>icon</Item>
        <Item meta="xai">meta</Item>
        <Item detail="192.168.1.4">detail</Item>
        <Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>keys</Item>
        <Item opens>opens a submenu</Item>
        <Item field meta="Unavailable" opens>Field</Item>
        <Item checked>checked</Item>
        <Item active>highlighted</Item>
        <Item disabled>disabled: dimmer, struck through, no note</Item>
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
      lib("card-anatomy", "Anatomy", "both", "card", "Card title detail children actions", () => <div class="g-anatomy"><Card title="Title" detail="Detail: a line under the title" class="g-card" actions={<><Button variant="secondary">Action</Button><Button>Action</Button></>}><div class="g-slot">Body</div></Card></div>),
      lib("card-head", "Title · detail", "both", "card", "Card title detail", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" />),
      lib("card-body", "Body", "both", "card", "Card children", () => <Card title="Rename chat" class="g-card"><Input value="Lorem ipsum file" /></Card>),
      lib("card-actions", "Actions", "both", "card", "Card actions", () => <Card title="Actions" class="g-card" actions={<><Button variant="ghost">Cancel</Button><Button>Save</Button><Button variant="destructive">Delete</Button></>} />),
    ] },
    { title: "Assembled", atoms: [
      lib("confirm", "FrostDialog alert", "both", "card", "Card", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" actions={<><Button variant="ghost">Cancel</Button><Button variant="destructive">Delete</Button></>} />),
      lib("prompt", "FrostDialog", "both", "card", "Card + Input", () => <Card title="Rename chat" class="g-card" actions={<><Button variant="ghost">Cancel</Button><Button>Save</Button></>}><Input value="Lorem ipsum file" /></Card>),
    ] },
  ] },
  { title: "Overlay", note: "raised frost over a dimmed page, the large surfaces: sections edge to edge, ruled off -- a Bar, a body (a List, a List beside an aside, or a Rail beside a Page), Hints. Its rows are the popover's Items at its scale; its Rail is the sidebar's NavGroups", groups: [
    { atoms: [
      lib("overlay-anatomy", "Anatomy", "both", "overlay", "Scrim > Overlay > OverlayBar · OverlayList (Sections of Items) · OverlayHints", () => <div class="g-anatomy g-overlay-demo"><Overlay label="Anatomy">
        <OverlayBar lead={glyph()} placeholder="OverlayBar: lead · input · end · close" onClose={() => {}} />
        <OverlayList><Section title="OverlayList · Section"><Item icon={<PaperclipIcon />} active>Item</Item><Item icon={<SearchIcon />} keys={["Ctrl", "K"]}>Item with keys</Item><Item opens>Item that opens a page</Item></Section></OverlayList>
        <OverlayHints start={[[["↑", "↓"], "OverlayHints"]]} end={[[["Esc"], "Close"]]} />
      </Overlay></div>, true),
      lib("overlay-anatomy-rail", "Anatomy · rail", "desktop", "overlay", "Overlay layout=rail > OverlayRail (NavGroups) · OverlayPage (SettingGroups of SettingLines)", () => <div class="g-anatomy g-overlay-demo"><Overlay label="Anatomy" layout="rail" style={{ "--overlay-width": "100%" }}>
        <OverlayRail title="OverlayRail"><NavGroup label="NavGroup"><NavRow icon={<MonitorIcon />} current>NavRow</NavRow><NavRow icon={<KeyboardIcon />}>NavRow</NavRow></NavGroup></OverlayRail>
        <OverlayPage title="OverlayPage" onClose={() => {}}><SettingGroup title="SettingGroup"><SettingLine label="SettingLine"><SelectTrigger value="Control" bare /></SettingLine><SettingLine label="SettingLine"><SwitchDemo /></SettingLine></SettingGroup></OverlayPage>
      </Overlay></div>, true),
      lib("overlay-bar", "OverlayBar", "both", "overlay", "OverlayBar lead · input · end · close", () => <div class="g-stack g-overlay-demo">
        <Overlay label="Bar"><OverlayBar lead={glyph()} placeholder="Run a command…" onClose={() => {}} /></Overlay>
        <Overlay label="Bar"><OverlayBar lead={<SearchIcon />} placeholder="Search chats, projects, workspaces…" end={<SortToggle />} onClose={() => {}} /></Overlay>
      </div>, true),
      lib("overlay-list", "OverlayList", "both", "overlay", "OverlayList > Section (a group title) > Item: icon · keys · opens · meta", () => <div class="g-overlay-demo"><Overlay label="List">{paletteList()}</Overlay></div>, true),
      lib("overlay-hints", "OverlayHints", "desktop", "overlay", "OverlayHints start · end: keys and what they do", () => <div class="g-stack g-overlay-demo"><Overlay label="Hints">{paletteHints()}</Overlay><Overlay label="Hints">{searchHints()}</Overlay></div>, true),
      lib("overlay-split", "OverlaySplit", "desktop", "overlay", "OverlaySplit: a List beside an aside", () => <div class="g-overlay-demo"><Overlay label="Split" style={{ "--overlay-width": "100%" }}><OverlaySplit aside={chatPreview()}>{chatRows()}</OverlaySplit></Overlay></div>, true),
      lib("overlay-settings", "SettingGroup · SettingLine · every kind", "both", "overlay", "SettingGroup > SettingLine (a field, or plain: a value, link, buttons, keys) · SettingNote · SettingDetails · SettingWide (TextArea, Progress) · SettingLoading", () => <div class="g-overlay-demo"><Overlay label="Settings" layout="rail" style={{ "--overlay-width": "100%" }}><OverlayPage title="Every kind of line">
        <SettingGroup title="Fields"><SettingLine label="Select"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Input"><Input value="20" /></SettingLine><SettingLine label="Switch"><SwitchDemo /></SettingLine><SettingLine label="Segmented"><Theme /></SettingLine><SettingLine label="With its state" state="paused while hidden"><SelectTrigger value="Adaptive" bare /></SettingLine></SettingGroup>
        <SettingGroup title="Plain lines"><SettingLine label="SettingValue" plain><SettingValue>Signed in</SettingValue></SettingLine><SettingLine label="SettingValue mono" plain><SettingValue mono>a91f03c2 · TLS verified</SettingValue></SettingLine><SettingLine label="SettingLink" plain><SettingLink href="#">Docs</SettingLink></SettingLine><SettingLine label="Buttons" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" size="sm">Forget</Button></SettingLine><SettingLine label="Keys" plain>{keys("Ctrl", "K")}{reset()}</SettingLine></SettingGroup>
        <SettingGroup title="Under a line"><SettingLine label="A field"><Input value="sk-or-••••3f2a" /></SettingLine><SettingNote tone="error">SettingNote error: that key was turned down (401).</SettingNote><SettingNote>SettingNote quiet: click a shortcut, then press its keys.</SettingNote><SettingDetails summary="SettingDetails"><p>Folded until asked for.</p></SettingDetails></SettingGroup>
        <SettingGroup title="Page width"><SettingWide><TextArea value="SettingWide > TextArea: a prompt's text." /></SettingWide><SettingWide><Progress label="Download" value={1.2} max={3.1} /></SettingWide><SettingLoading>SettingLoading…</SettingLoading></SettingGroup>
      </OverlayPage></Overlay></div>, true),
    ] },
    { title: "Assembled", note: "the app's own, at their sizes", layout: "desktop", atoms: [
      lib("o-palette", "CommandMenu", "desktop", "overlay", "navigation/command-menu.tsx", () => overlayViews.palette({ close: noop, class: "g-scrim" }), "row"),
      lib("o-search", "CommandMenu · chat search", "desktop", "overlay", "navigation/command-menu.tsx", () => overlayViews.search({ close: noop, class: "g-scrim" }), "row"),
      lib("o-settings", "Settings", "desktop", "overlay", "settings/settings-core.tsx", () => overlayViews.settings({ close: noop, class: "g-scrim" }), "row"),
    ] },
    { title: "Chat search's preview", note: "Glance: what the cursor rests on, told apart without opening it. The app reads the chat (a moment after the cursor settles); these draw what it read. The orb is the app's ThinkingOrb. Ctrl+P hides and shows it in the search overlay", atoms: [
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
  { title: "Rider", note: "resting frost at a composer, either composer's: a row or a strip on its top edge (queued messages, attachments), or a card that takes over its slot in its material (the question: the composer takeover)", groups: [
    { atoms: [
      lib("rider-anatomy", "Anatomy", "both", "rider", "Rider layout=row: RiderTitle · body · RiderActions", () => <div class="g-anatomy g-composer"><Rider label="Rider"><RiderTitle>Title</RiderTitle><ul class="ui-lines"><Line text="Body: lines, chips or choices" /></ul><RiderActions>{ghost("Action", <PencilIcon />)}{ghost("Action", <XIcon />)}</RiderActions></Rider></div>, true),
      lib("rider-line", "Line", "both", "rider", "Line: waiting text, one line until opened", () => <div class="g-composer"><Rider><ul class="ui-lines"><Line text="and make the second paragraph shorter" /><Line text="then rename the file to lorem.txt, and add a heading at the top that says what it is, and then read it back to me" clipped /></ul></Rider></div>, true),
      lib("rider-chip", "Chip", "both", "rider", "Chip: image · file · uploading · failed", () => <div class="g-row"><Chip name="photo.png" image={thumb} /><Chip name="notes.txt" detail="2.1 KB" icon={<FileTextIcon />} /><Chip name="big.pdf" detail="64%" icon={<FileTextIcon />} status="uploading" progress={64} /><Chip name="broken.txt" detail="Upload failed" icon={<FileTextIcon />} status="error" /></div>, true),
      lib("rider-choice", "Choice", "both", "rider", "Choices > Choice: number · label · detail. One answer: the current choice white and bold, no tick. Pick any: the wash on each chosen. The cursor follows the pointer", () => <div class="g-composer g-stack"><Rider layout="card"><Choices><Choice n={1} label="Chosen" detail="the current choice" chosen /><Choice n={2} label="Not chosen" active /><Choice n={3} label="Not chosen" detail="with a description" /><div class="ui-choice"><span class="ui-choice-key">4</span><TextArea placeholder="Type your own answer (a TextArea)" /></div></Choices></Rider>
        <Rider layout="card"><Choices multi><Choice n={1} label="Chosen" multi chosen /><Choice n={2} label="Chosen too" multi chosen active /><Choice n={3} label="Not chosen" multi /></Choices></Rider></div>, true),
    ] },
    { title: "Over the transcript", note: "RiderButton: resting frost at the surface radius, riding just above the composer -- scroll to latest (an icon), and cancel an edit (its words), which sits beside it when both show", atoms: [
      lib("rider-button", "RiderButton", "both", "rider", "chat/transcript.tsx · message-scroller-button, message-cancel-edit", () => <div class="g-row"><RiderButton icon={<XIcon />} label="Cancel editing" show="label" /><RiderButton icon={<ArrowDownIcon />} label="Scroll to latest" /></div>),
    ] },
    { title: "Assembled", atoms: [
      lib("rider-queued", "QueuedMessages", "both", "rider", "chat/queued-messages.tsx", () => <div class="g-composer">{queued()}</div>, true),
      lib("rider-attachments", "AttachmentStrip", "both", "rider", "chat/attachment-strip.tsx", () => <div class="g-composer">{attachments()}</div>, true),
      lib("rider-question", "QuestionCard", "both", "rider", "chat/question-card.tsx · the composer takeover: in the composer's slot and material. One question: its title, Choices, own answer, Stop · Submit", () => questionCard([LANGUAGE]), true),
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
];
