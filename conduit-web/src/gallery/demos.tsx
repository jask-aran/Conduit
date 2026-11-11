import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { ConnectionForm, ConnectionChoices, ConnectionChoice, ConnectionGroup, ConnectionAddress, ConnectionStatus, ConnectionPassword, type AddressState } from "@/components/ui/connection";
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { SquarePenIcon } from "lucide-solid";
import { type Motion, Meter, Orb, settledOrbRate, PLAIN_SPHERE, SPUTTERING_SPHERE, SettingRecorder, Crumbs, Match, OverlayBar, OverlayHints, OverlayList, OverlayPage, OverlayRail, OverlayFacts, Fact, OverlaySplit, Glance, GlanceHead, GlancePrompt, GlanceTurn, GlanceAnswer, Overlay, SettingLine, SettingValue, SettingLink, SettingDetails, SettingWide, Progress, Keycap, Segmented, SelectTrigger, Button, Chip, Line, TextArea, Rider, RiderMark, Input, Item, Section, Slider, Switch, Chips, Lines, Row } from "@/components/ui";
import { scaleOf, setScale } from "./foundations";
import { NotebookTextIcon } from "lucide-solid";
import { px } from "./specs";
import { Reading, ReadingTotal, ReadingParts, ReadingPart, ReadingStats, ReadingStat, ReadingFoot, Group, Note, Loading, Actions } from "@/components/ui";
import katex from "katex";

export const thinking = ["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
export function Levels(props: { label?: string; onOpen?: () => void }) {
  const [value, setValue] = createSignal("medium");
  return <Slider label={props.label ?? "Thinking"} options={thinking} value={value()} onChange={setValue} onOpen={props.onOpen ?? (() => {})} />;
}
export function SwitchDemo() { const [on, setOn] = createSignal(true); return <Switch label="Example" checked={on()} onChange={setOn} />; }
export function SegmentedText() { const [value, setValue] = createSignal("cloud"); return <Segmented label="Source" value={value()} onChange={setValue} options={[{ value: "off", label: "Off" }, { value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />; }
export function SegmentedCount() { const [value, setValue] = createSignal("all"); return <Segmented label="Show" value={value()} onChange={setValue} options={[{ value: "all", label: "All", count: 0 }, { value: "unread", label: "Unread", count: 0 }]} />; }
export const areas = () => [{ value: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> }, { value: "computer", label: "Computer", icon: <Icons.Monitor /> }];
export function SegmentedIcons(props: { pill?: boolean }) { const [value, setValue] = createSignal("dashboard"); return <Segmented icons pill={props.pill} label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }
export const READING_PARTS = [{ label: "Messages", value: "60k · 30.0%", colour: "oklch(0.72 0.15 300)" }, { label: "System prompt", value: "16k · 8.0%", colour: "oklch(0.7 0.02 260)" }, { label: "Tools (3)", value: "12k · 6.0%", colour: "oklch(0.74 0.12 230)", opens: true }, { label: "Free space", value: "112k · 56.0%", hollow: true }];
export const ContextReadingDemo = (props: { bare?: boolean; open?: boolean }) => <Reading>
  <Show when={!props.bare}><ReadingTotal label={<strong>Context</strong>} value="42% used" /></Show>
  <Show when={!props.bare}><Meter parts={[{ value: 60, colour: "oklch(0.72 0.15 300)" }, { value: 16, colour: "oklch(0.7 0.02 260)" }, { value: 12, colour: "oklch(0.74 0.12 230)" }, { value: 112, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%", quiet: true }} /></Show>
  <ReadingTotal label="84k of 200k tokens" value="$0.42" />
  <ReadingParts label="What fills the window"><For each={READING_PARTS}>{(part) => <>
    <ReadingPart role={part.opens ? "button" : undefined} opens={part.opens} expanded={part.opens && props.open} colour={part.colour} hollow={part.hollow} label={part.label} value={part.value} />
    <Show when={part.opens && props.open}><ReadingPart sub label="read_file" value="4k" /><ReadingPart sub label="edit_file" value="5k" /><ReadingPart sub label="shell" value="3k" /></Show>
  </>}</For></ReadingParts>
  <ReadingTotal label="Cache hits · 54% of what could be reused" value="71%" />
  <ReadingFoot action={<Button variant="ghost" outline size="sm"><Icons.Compact />Compact now</Button>}>Compacts at 85% · 2 so far</ReadingFoot>
  <Show when={!props.bare}><ReadingFoot action={<Button variant="ghost" size="sm">019a3f…3e70</Button>}>gpt-6-luna</ReadingFoot></Show>
  <ReadingStats title="Plan · Plus"><ReadingStat label="5-hour" value="5%" detail="resets 1:47 pm" /><ReadingStat label="Weekly" value="17%" detail="resets Tue" /></ReadingStats>
</Reading>;
export const icon = (label: string, glyph: JSX.Element) => ({ label, icon: glyph });
export const ghost = (label: string, glyph: JSX.Element) => <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>{glyph}</Button>;
export const WAVE = [3, 5, 8, 6, 4, 7, 11, 8, 5, 3, 6, 9, 12, 8, 5, 4, 7, 10, 6, 4, 3, 5, 8, 6];
export const speech = (on: () => boolean) => {
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
export const thumb = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#6b8afd"/><stop offset="1" stop-color="#d97706"/></linearGradient></defs><rect width="48" height="48" fill="url(#g)"/></svg>');
export const attachments = (motion?: Motion) => <Rider label="Attachments" layout="strip" motion={motion}><Chips><Chip name="photo.png" image={thumb} /><Chip name="notes.txt" detail="2.1 KB" icon={<Icons.FileText />} /><Chip name="lorem_ipsum.txt" detail="412 bytes" icon={<Icons.FileText />} status="uploading" progress={60} /></Chips>
  <Actions kind="rider" stack>{ghost("Show all attachments", <Icons.Maximize />)}{ghost("Remove all attachments", <Icons.Delete />)}</Actions></Rider>;
export const queued = (motion?: Motion) => <Rider label="Queued" motion={motion}><RiderMark icon={<Icons.Steer />} label="Steering" title="Steering: sent when the current step finishes" /><Lines><Line text="and make the second paragraph shorter" /><Line text="then rename the file to lorem.txt, and add a heading at the top that says what it is" clipped /></Lines>
  <Actions kind="rider">{ghost("Interrupt and send now", <Icons.Send />)}{ghost("Edit", <Icons.Edit />)}{ghost("Discard", <Icons.Close />)}</Actions></Rider>;
export const glyph = () => <Icons.ChevronRight />;
export const paletteList = () => <OverlayList>
  <Section title="This chat"><Item icon={<Icons.Attach />} active>Attach files</Item><Item icon={<Icons.FileText />} keys={["Ctrl", "Shift", "S"]}>Stash prompt</Item><Item icon={<Icons.Edit />}>Rename chat</Item><Item icon={<Icons.Copy />}>Copy last response</Item></Section>
  <Section title="Go to"><Item icon={<SquarePenIcon />} opens keys={["Ctrl", ","]}>Settings…</Item><Item icon={<Icons.Chat />} opens keys={["Ctrl", "Shift", "K"]}>Search chats…</Item><Item icon={<Icons.Sidebar />} opens>Workspace views…</Item></Section>
  <Section title="View"><Item icon={<Icons.CollapseFiles />} keys={["Ctrl", "B"]}>Toggle sidebar</Item><Item icon={<Icons.Workspace />} keys={["Ctrl", "."]}>Toggle workspace panel</Item></Section>
</OverlayList>;
export const paletteHints = () => <OverlayHints start={[[["↑", "↓"], "Navigate"], [["Enter"], "Open"]]} end={[[["Esc"], "Close"]]} />;
export const SortToggle = () => { const [sort, setSort] = createSignal<"latest" | "created">("created"); return <Segmented label="Chat sort" size="sm" value={sort()} onChange={setSort} options={[{ value: "latest", label: "Latest" }, { value: "created", label: "Created" }]} />; };
export const chatRows = (query = "") => <OverlayList>
  <Section title="Recent"><Item icon={<SquarePenIcon />} meta="18:29" active><Match text="Untitled chat" query={query} /></Item><Item icon={<HarnessMark id="opencode" />} meta="9 Oct"><Match text="Short Sprint Workout Plan" query={query} /></Item><Item icon={<HarnessMark id="opencode" />} meta="8 Oct"><Match text="Wispah V3 Lodge" query={query} /></Item></Section>
  <Section title="Folders"><Item icon={<Icons.Folder />} meta="3 · 25 Sept" opens>Japan</Item><Item icon={<Icons.Folder />} meta="0" opens>NHP</Item><Item icon={<Icons.Folder />} meta="3 · 26 Sept" opens>Conduit</Item></Section>
</OverlayList>;
export const orb = (done: boolean) => <Orb state="working" frame={done ? PLAIN_SPHERE : SPUTTERING_SPHERE} tint={done ? undefined : "var(--destructive)"} rate={settledOrbRate(!done)} />;
export const glanceChat = () => <Glance label="Chat preview"><GlanceHead mark={<HarnessMark id="opencode" />} title="Untitled chat" facts={["OpenCode · Chats · 18:30"]} />
  <GlancePrompt>ask me a question using the question tool</GlancePrompt><GlanceTurn orb={orb(true)} outcome="Done" detail="42s · 1 tool" />
  <GlanceAnswer>I'll ask you a question using the question tool. Which of these would you like to try first: a short sprint workout, a longer endurance session, or a mobility routine?</GlanceAnswer></Glance>;
export const math = katex.renderToString("\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}", { displayMode: true, throwOnError: false });
export const glanceMath = () => <Glance label="Chat preview"><GlanceHead mark={<HarnessMark id="opencode" />} title="Wispah V3 Lodge" facts={["OpenCode · Chats · 8 Oct"]} />
  <GlancePrompt>why does the sum of the first n numbers come to n(n+1)/2?</GlancePrompt><GlanceTurn orb={orb(true)} outcome="Done" detail="18s" />
  <GlanceAnswer html={`<p>Pair the first term with the last, the second with the second-to-last, and so on:</p>${math}<p>Each pair sums to n + 1, and there are n/2 of them.</p>`} /></Glance>;
export const searchHints = () => <OverlayHints start={[[["Ctrl", "E"], "Edit", () => {}], [["Alt", "R"], "Rename"], [["Ctrl", "K", "D"], "Delete"]]} end={[[["/"], "Search in"], [["Ctrl", "P"], "Preview"], [["Enter"], "Open"], [["Esc"], "Close"]]} />;
export const LeaderPath = () => { const [at, setAt] = createSignal(2); const levels = ["Conduit", "Chat", "Composer"];
  return <Crumbs label="Where you are" items={levels.map((label, index) => ({ label, current: index === at(), onClick: () => setAt(index) }))} />; };
export const leaderRows = () => <Section><Item keysFirst keys={["1"]} active>Model</Item><Item keysFirst keys={["2"]}>Thinking level</Item><Item keysFirst keys={["A"]}>Attach files</Item><Item keysFirst keys={["S"]}>Stash prompt</Item><Item keysFirst keys={["V"]}>Toggle voice dictation</Item></Section>;
export const leaderHints = () => <OverlayHints start={[[["←", "→"], "level"], [["Ctrl+Shift+1"], "Sidebar"], [["Ctrl+Shift+2"], "Main"]]} />;
export type SettingsSection = "appearance" | "shortcuts" | "models" | "prompts" | "runtime" | "servers" | "voice" | "web";
export const SETTINGS: { label: string; sections: [SettingsSection, string, () => JSX.Element][] }[] = [
  { label: "Personal", sections: [["appearance", "Appearance", () => <Icons.Monitor />], ["shortcuts", "Shortcuts", () => <Icons.Keyboard />]] },
  { label: "AI", sections: [["models", "Models & accounts", () => <Icons.Reasoning />], ["prompts", "Prompts", () => <NotebookTextIcon />]] },
  { label: "System", sections: [["runtime", "Runtime", () => <Icons.Runtime />], ["servers", "Servers", () => <Icons.Server />]] },
  { label: "Services", sections: [["voice", "Voice", () => <Icons.Microphone />], ["web", "Web search", () => <Icons.Fetch />]] },
];
export const titleOf = (id: SettingsSection) => SETTINGS.flatMap((group) => group.sections).find(([key]) => key === id)![1];
export function Theme() { const [value, setValue] = createSignal("dark"); return <Segmented size="sm" label="Theme" value={value()} onChange={setValue} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />; }
export const reset = () => <Button variant="ghost" size="icon-sm" aria-label="Reset to default"><Icons.Refresh /></Button>;
export const SETTING_PAGES: Record<SettingsSection, { status?: string; busy?: boolean; failed?: boolean; why?: string; body: () => JSX.Element }> = {
  appearance: { status: "Saved", body: () => <>
    <Group title="Interface"><SettingLine label="Theme"><Theme /></SettingLine><SettingLine label="Interface size"><ScaleSetting /></SettingLine><SettingLine label="Sidebar chats"><Input value="20" /></SettingLine><SettingLine label="Tab row"><SwitchDemo /></SettingLine><SettingLine label="Streaming" state="paused while hidden"><SelectTrigger value="Adaptive" bare /></SettingLine></Group>
    <Group title="Reading"><SettingLine label="Transcript width"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Wide blocks"><SelectTrigger value="Off" bare /></SettingLine><SettingLine label="Terminal font"><SelectTrigger value="Meslo" bare /></SettingLine></Group>
  </> },
  shortcuts: { status: "Saved", body: () => <Shortcuts /> },
  models: { status: "Not saved", failed: true, why: "The server answered 502.", body: () => <>
    <Group title="Accounts"><SettingLine label="OpenAI" plain><SettingValue>Signed in</SettingValue><Button variant="ghost" size="sm">Sign out</Button></SettingLine><SettingLine label="Anthropic" plain><SettingLink href="#">Open sign-in</SettingLink></SettingLine>
      <SettingLine label="OpenRouter key"><Input value="sk-or-••••••••3f2a" /></SettingLine><Note tone="error">That key was turned down (401). Check it has credit.</Note>
      <SettingDetails summary="Where to find them"><ol><li>Open openrouter.ai/keys</li><li>Create a key, then paste it here</li></ol><p>Keys stay on this server, in <code>~/.conduit/data</code>.</p></SettingDetails></Group>
    <Group title="Providers"><SettingLine label="Gemini" plain><SettingLink href="#">Docs</SettingLink></SettingLine><SettingLine label="Default model"><SelectTrigger value="GPT-6 Luna" bare /></SettingLine></Group>
  </> },
  prompts: { status: "Saving", busy: true, body: () => <Group title="System prompt"><SettingLine label="Assistant" state="edited" plain>{reset()}</SettingLine>
    <SettingWide><TextArea value={"You are Conduit's assistant. Answer briefly, then offer to go further.\nPrefer the user's own words for things."} /></SettingWide></Group> },
  runtime: { body: () => <>
    <Group title="Processes"><SettingLine label="Running" plain><SettingValue mono>3 of 8</SettingValue></SettingLine><SettingLine label="Idle timeout"><SelectTrigger value="10 minutes" bare /></SettingLine></Group>
    <Group title="Harnesses"><Loading>Loading runtime settings…</Loading></Group>
  </> },
  servers: { body: () => <>
    <Group title="This server"><SettingLine label="Name" plain><SettingValue>Desktop-Dev</SettingValue></SettingLine><SettingLine label="Address" plain><SettingValue mono>a91f03c2 · TLS verified</SettingValue></SettingLine></Group>
    <Group title="Others"><SettingLine label="Laptop" state="9 ms" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" outline size="sm">Forget</Button></SettingLine>
      <SettingLine label="VPS" state="offline" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" outline size="sm">Forget</Button></SettingLine><Note tone="error">Couldn't reach VPS: the connection timed out.</Note></Group>
  </> },
  voice: { status: "Saved", body: () => <>
    <Group title="Dictation"><SettingLine label="Shortcut"><Input value="Ctrl+Space" readOnly title="Focus and press a shortcut" /></SettingLine><SettingLine label="Engine"><SelectTrigger value="Local" bare /></SettingLine><SettingLine label="Live captions"><SwitchDemo /></SettingLine></Group>
    <Group title="Local model"><SettingLine label="Moonshine Streaming Tiny" state="downloading" plain><SettingValue mono>25 / 50 MB</SettingValue></SettingLine><SettingWide><Progress label="Download" value={25} max={50} /></SettingWide></Group>
  </> },
  web: { body: () => <Group title="Search"><SettingLine label="Web search"><SwitchDemo /></SettingLine><SettingLine label="Provider"><SelectTrigger value="Brave" bare /></SettingLine><SettingLine label="Brave" plain><SettingLink href="#">Docs</SettingLink></SettingLine></Group> },
};
export function Shortcuts() {
  const [bound, setBound] = createSignal<Record<string, string[]>>({ "Open command palette": ["Ctrl K"], "Search chats…": ["Ctrl Shift K"], "Settings…": ["Ctrl ,"], "Model selector…": ["Ctrl Shift X"], "Workspace views…": [], "New chat": ["Ctrl Shift C"], "New folder": [], "Stash prompt": ["Ctrl Shift S"], "Toggle sidebar": ["Ctrl B"] });
  const clear = (command: string, chord: string) => setBound((all) => ({ ...all, [command]: all[command]!.filter((key) => key !== chord) }));
  const [recording, setRecording] = createSignal<string | null>("Open command palette");
  const [heard, setHeard] = createSignal<string[]>([]);
  const add = (command: string) => <Button variant="ghost" size="icon-xs" aria-label="Add a shortcut" onClick={() => { setHeard([]); setRecording(command); }}><Icons.Add /></Button>;
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
    <Group title="Keyboard"><SettingLine label="Keys for" state="Chrome · Windows · Browser tab" plain><Button variant="ghost" size="sm"><Icons.Refresh />Reset all</Button></SettingLine>
      <SettingLine label="Leader menu" state="Ctrl G"><SelectTrigger value="After a pause" bare /></SettingLine>
      <Input placeholder="Search commands, contexts, or keys…" /></Group>
    <Group title="Application"><For each={Object.keys(bound())}>{(command) => <><SettingLine label={command} plain>
      <Show when={bound()[command]!.length} fallback={<SettingValue>Not assigned</SettingValue>}>
        <For each={bound()[command]}>{(chord) => <Keycap label={`${command}: ${chord}`} onClick={() => {}} onRemove={() => clear(command, chord)}>{chord}</Keycap>}</For>
      </Show>{add(command)}</SettingLine>
      <Show when={recording() === command}><SettingRecorder keys={heard()} onCancel={() => setRecording(null)} onSave={() => { setBound((all) => ({ ...all, [command]: [...all[command]!, heard().join(" ")] })); setRecording(null); }} /></Show></>}</For></Group>
  </>;
}
export const SCALE_STEPS = [["0.9", "90%"], ["1", "100%"], ["1.1", "110%"], ["1.25", "125%"]] as const;
export function ScaleSetting() {
  const options = SCALE_STEPS.map(([value, label]) => ({ value, label }));
  const value = () => SCALE_STEPS.find(([step]) => Number(step) === scaleOf("--ui-scale"))?.[0] ?? "1";
  return <Segmented size="sm" label="Interface size" value={value()} options={options} onChange={(next) => setScale("--ui-scale", Number(next) === 1 ? null : Number(next))} />;
}
export function Settings(props: { close: () => void; phone?: boolean; start?: SettingsSection | null }) {
  const [section, setSection] = createSignal<SettingsSection | null>(props.start === undefined ? (props.phone ? null : "appearance") : props.start);
  const rail = () => <OverlayRail title="Settings" foot={<OverlayFacts title="About"><Fact label="Interface" value="0.8.1-dev.20261020063706.abb9a10" /><Fact label="Running as" value="Browser tab" /><Fact label="Server" value="0.8.1-dev.20261020063706.abb9a10 · modified" /></OverlayFacts>} onClose={props.phone ? props.close : undefined}>
    <For each={SETTINGS}>{(group) => <Group kind="nav" title={group.label}><For each={group.sections}>{([id, label, glyph]) =>
      <Row density="nav" element="button" lead={glyph()} current={!props.phone && section() === id} onClick={() => setSection(id)}>{label}</Row>}</For></Group>}</For>
  </OverlayRail>;
  const page = (id: SettingsSection) => { const view = SETTING_PAGES[id]; return <OverlayPage title={titleOf(id)} status={view.status} busy={view.busy} failed={view.failed} why={view.why} onRetry={view.failed ? () => {} : undefined} onBack={props.phone ? () => setSection(null) : undefined} onClose={props.close}>{view.body()}</OverlayPage>; };
  return <Overlay label="Settings" layout="rail" style={props.phone ? undefined : { "--overlay-width": "calc(70.3125 * var(--u-space))", "--overlay-height": "560px" }}>
    <Show when={!props.phone || section() === null}>{rail()}</Show>
    <Show when={section()} keyed>{(id) => page(id)}</Show>
  </Overlay>;
}
export function ChatSearch(props: { close: () => void }) {
  const stored = () => { try { return localStorage.getItem("gallery:search-preview") !== "closed"; } catch { return true; } };
  const [preview, setPreview] = createSignal(stored());
  const toggle = () => { const next = !preview(); setPreview(next); try { localStorage.setItem("gallery:search-preview", next ? "open" : "closed"); } catch { /* private window */ } };
  return <Overlay label="Chat search" style={{ "--overlay-width": preview() ? "calc(81.25 * var(--u-space))" : "calc(56.25 * var(--u-space))", "--overlay-height": "576px" }}>
    <div class="g-contents" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") { event.preventDefault(); toggle(); } }}>
      <OverlayBar lead={<Icons.Search />} placeholder="Search chats, projects, workspaces…" value="t" end={<SortToggle />} onClose={props.close} />
      <OverlaySplit aside={preview() ? glanceChat() : undefined}>{chatRows("t")}</OverlaySplit>{searchHints()}
    </div></Overlay>;
}
export const typeOf = (el: HTMLElement) => { const s = getComputedStyle(el); return px(`${s.fontSize} · ${s.fontWeight}`); };
export function ConnectionDemo() {
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
    <ConnectionChoices><ConnectionChoice type="button" icon={<Icons.QrCode />} detail="conduit-server pair" onClick={() => setCameraError(true)}>Scan QR code</ConnectionChoice><ConnectionChoice type="button" icon={<Icons.Monitor />} detail="localhost:4310" onClick={() => choose("localhost:4310")}>This computer</ConnectionChoice></ConnectionChoices>
    <ConnectionGroup>On this network</ConnectionGroup>
    <ConnectionChoices><ConnectionChoice type="button" icon={<Icons.Server />} detail="laptop.ts.net" onClick={() => choose("laptop.ts.net")}>Laptop</ConnectionChoice></ConnectionChoices>
    <ConnectionAddress placeholder="Address or pair link" aria-label="Server address" value={address()} state={state()} onInput={(event) => {
      reset(); setAddress(event.currentTarget.value);
      timer = setTimeout(check, 600);
    }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); check(); } }} />
    <Show when={state()}>{(current) => <ConnectionStatus state={current()} title={current() === "checking" ? `Looking for ${address()}…` : current() === "found" ? "Laptop" : "Nothing answered"} detail={current() === "found" ? "laptop.ts.net · 0.8.1" : current() === "missing" ? address() : undefined} />}</Show>
    <Show when={state() === "found"}><Show when={!signedIn()} fallback={<ConnectionStatus state="found" title="Signed in" />}><ConnectionPassword reveal busy={busy()} error={error()} value={password()} disabled={busy()} onInput={(event) => setPassword(event.currentTarget.value)} /></Show></Show>
    <Show when={cameraError()}><Note kind="card" tone="error">Camera unavailable. Paste the pairing link.</Note></Show>
  </ConnectionForm>;
}
export const LONG = Array.from({ length: 20 }, (_, i) => i % 5 === 0 ? `// step ${i / 5 + 1}` : `  run(${i}, { size: ${i * 64} });`).join("\n");
export type Lit = { top: string; left: string; width: string; height: string; radius?: string };
export const noop = () => {};
