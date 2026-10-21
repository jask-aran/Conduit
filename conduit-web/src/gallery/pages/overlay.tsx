import { HarnessMark } from "@/components/ui";
import { LiveNote } from "@/components/ui";
import { Icons } from "@/components/ui";
import { type JSX } from "solid-js";
import { SquarePenIcon } from "lucide-solid";
import { Backdrop, Leader, Crumbs, Spotlight, OverlayBar, OverlayChip, OverlayEmpty, OverlayActions, OverlayHints, OverlayList, OverlayPage, OverlayRail, OverlaySplit, Glance, GlanceHead, GlancePrompt, GlanceTurn, GlanceAnswer, GlanceEmpty, Overlay, Scrim, SettingGroup, SettingLine, SettingValue, SettingLink, SettingNote, SettingDetails, SettingWide, SettingLoading, Progress, Keycap, NavGroup, NavRow, SelectTrigger, Button, TextArea, Frost, Input, Item, Section } from "@/components/ui";
import { Replay } from "../specs";
import { orb, glanceChat, type Lit, glyph, paletteList, paletteHints, ChatSearch, Settings, LeaderPath, leaderHints, leaderRows, SwitchDemo, SortToggle, searchHints, chatRows, Theme, reset, noop, glanceMath } from "../demos";
import { row, token, type Page } from "../model";

export const glanceStopped = () => <Glance label="Chat preview"><GlanceHead mark={<HarnessMark id="claude" />} title="Short Sprint Workout Plan" facts={["Claude Code · Japan · 9 Oct"]} />
  <GlancePrompt>make the plan two weeks, three sessions a week, and keep each under 30 minutes</GlancePrompt><GlanceTurn orb={orb(false)} outcome="Interrupted" detail="2m 10s · 3 edits · 2 commands" />
  <GlanceAnswer>Here's a two-week plan, three sessions a week. Week one builds the base: short sprints with long rests, then</GlanceAnswer></Glance>;
export const glanceFolder = () => <Glance label="Folder preview"><GlanceHead mark={<Icons.Folder />} title="Japan" facts={["~/projects/japan", "3 chats · 1 running"]} />
  <Section><Item icon={<HarnessMark id="claude" />} meta="9 Oct">Short Sprint Workout Plan</Item><Item icon={<HarnessMark id="opencode" />} meta="26 Sept">Gassho House Stays in Japan</Item><Item icon={<HarnessMark id="opencode" />} meta="25 Sept">Varied dog question formats</Item></Section></Glance>;
export const glanceEmpty = (text: string) => () => <Glance label="Chat preview"><GlanceEmpty>{text}</GlanceEmpty></Glance>;
export const chatPreview = glanceChat;
/* Chat search's tree: a folder open in place (its chevron turns; its search shows under the cursor), its chats in under it, Browse all; picked: an edit's check column. */
export const chatTree = (edit: boolean) => <>
  <Section title="Recent"><Item role="treeitem" icon={<HarnessMark id="claude" />} meta="9 Oct" picked={edit ? true : undefined} active={edit}>Short Sprint Workout Plan</Item><Item role="treeitem" icon={<HarnessMark id="opencode" />} meta="8 Oct" picked={edit ? false : undefined}>Wispah V3 Lodge</Item></Section>
  <Section title="Folders">
    <Item role="treeitem" aria-expanded={true} icon={<Icons.Folder />} meta="3 · 25 Sept" opens onOpens={() => {}} opensLabel="Collapse Japan" active={!edit} reveal end={<Button variant="ghost" size="icon-xs" aria-label="Search in Japan"><Icons.Search /></Button>}>Japan</Item>
    <Item role="treeitem" indent icon={<HarnessMark id="claude" />} meta="9 Oct" picked={edit ? true : undefined}>Gassho House Stays in Japan</Item>
    <Item role="treeitem" indent icon={<HarnessMark id="opencode" />} meta="26 Sept" picked={edit ? false : undefined}>Gassho Houses for Six</Item>
    <Item role="treeitem" indent opens>Browse all 3 chats</Item>
    <Item role="treeitem" aria-expanded={false} icon={<Icons.Folder />} meta="0" opens onOpens={() => {}} opensLabel="Expand NHP">NHP</Item>
  </Section>
</>;
export const keys = (...names: string[]) => <span class="g-keys">{names.map((name) => <Keycap>{name}</Keycap>)}</span>;
/** The app's overlays, assembled: drawn in their gallery cells and over the desktop preview. */
export type OverlayView = "leader" | "palette" | "search" | "settings";
export const overlayViews: Record<OverlayView, (props: { close: () => void; class?: string; lit?: Lit; leaderBottom?: string; phone?: boolean }) => JSX.Element> = {
  palette: (props) => <Scrim class={props.class}><Overlay label="Command palette" style={{ "--overlay-height": "480px" }}>
    <OverlayBar lead={glyph()} placeholder="Run a command…" onClose={props.close} />{paletteList()}{paletteHints()}</Overlay></Scrim>,
  search: (props) => <Scrim class={props.class}><ChatSearch close={props.close} /></Scrim>,
  settings: (props) => <Scrim class={props.class} placement={props.phone ? "top" : "center"}><Settings close={props.close} phone={props.phone} /></Scrim>,
  leader: (props) => <><Spotlight lit={props.lit} /><div class="g-page-leader" style={props.leaderBottom ? { bottom: props.leaderBottom } : undefined}><Leader path={<LeaderPath />} hints={leaderHints()}>{leaderRows()}</Leader></div></>,
};
/** A phone's screen, a chat's transcript on it, an overlay drawn full screen over it. */
export const PhoneStage = (props: { children: JSX.Element }) => <div class="g-phone-stage"><p>{"Created lorem_ipsum.txt in this folder. The second paragraph is now two sentences: lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6)}</p>
  <Scrim class="g-stage-scrim">{props.children}</Scrim></div>;

const overlayScene = () => overlayViews.palette({ close: noop, class: "g-scrim" });

export const overlayPage: Page = {
  title: "Overlay", rail: "Blocks",
  summary: "Raised frost over a dimmed page, the large surfaces: sections edge to edge, ruled off -- a Bar, a body (a List, a List beside an aside, or a Rail beside a Page), Hints. Its rows are the popover's Items at its scale; its Rail is the sidebar's NavGroups.",
  preview: overlayScene,
  usage: `import { Scrim, Overlay, Section, Icons } from "@/components/ui";
import { OverlayBar, OverlayList, OverlayHints } from "@/components/ui/overlay";
import { Item } from "@/components/ui/popover";

<Scrim>
  <Overlay label="Command palette">
    <OverlayBar placeholder="Run a command…" value={query()} onInput={setQuery} onClose={close} />
    <OverlayList>
      <Section title="This chat"><Item icon={<Icons.Attach />} onClick={attachFiles}>Attach files</Item></Section>
    </OverlayList>
    <OverlayHints start={[[["Enter"], "Open"]]} end={[[["Esc"], "Close"]]} />
  </Overlay>
</Scrim>`,
  anatomy: { scene: () => <div class="g-overlay-demo"><Overlay label="Parts">
        <OverlayBar lead={glyph()} placeholder="Run a command…" onClose={() => {}} />
        <OverlayList><Section title="Chat"><Item icon={<Icons.Attach />} active>Attach a file</Item><Item icon={<Icons.Search />} keys={["Ctrl", "K"]}>Search chats</Item><Item opens>Model</Item></Section></OverlayList>
        <OverlayHints start={[[["↑", "↓"], "Move"]]} end={[[["Esc"], "Close"]]} />
      </Overlay></div>, parts: [
    { selector: ".ui-overlay-bar", name: "Bar", does: "lead · input · end · close: what you type to", from: "OverlayBar" },
    { selector: ".ui-overlay-list", name: "List", does: "the scrolling body: Sections (titled groups) of Items", from: "OverlayList" },
    { selector: ".ui-overlay-list .ui-row", name: "Item", does: "a choice; the cursor follows the pointer and the arrows", from: "Item · active" },
    { selector: ".ui-overlay-hints", name: "Hints", does: "the keys along the foot, start and end", from: "OverlayHints" }
  ] },
  examples: [
    row("LiveNote", "“Shortcut saved” is announced (aria-live polite) and draws nothing", () => <LiveNote>Shortcut saved</LiveNote>, { phone: true, code: "<LiveNote>{status}</LiveNote>" }),
    row("Rail anatomy scene", "Settings rail beside its page: navigation groups and setting lines.", () => <div class="g-overlay-demo"><Overlay label="Settings parts" layout="rail" style={{ "--overlay-width": "600px" }}>
        <OverlayRail title="Settings"><NavGroup label="App"><NavRow icon={<Icons.Monitor />} current>Appearance</NavRow><NavRow icon={<Icons.Keyboard />}>Shortcuts</NavRow></NavGroup></OverlayRail>
        <OverlayPage title="Appearance" onClose={() => {}}><SettingGroup title="Display"><SettingLine label="Density"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Reduce motion"><SwitchDemo /></SettingLine></SettingGroup></OverlayPage>
      </Overlay></div>, { surfaces: ["ground"] }),
    row("OverlayBar", "OverlayBar lead · input · end · close", () => <div class="g-stack g-overlay-demo">
        <Overlay label="Bar"><OverlayBar lead={glyph()} placeholder="Run a command…" onClose={() => {}} /></Overlay>
        <Overlay label="Bar"><OverlayBar lead={<Icons.Search />} placeholder="Search chats, projects, workspaces…" end={<SortToggle />} onClose={() => {}} /></Overlay>
        <Overlay label="Bar"><OverlayBar lead={<Icons.Search />} chips={<><OverlayChip onRemove={() => {}}>in:Japan</OverlayChip><OverlayChip onRemove={() => {}}>is:unread</OverlayChip></>} placeholder="Search Japan chats…" end={<SortToggle />} onClose={() => {}} /></Overlay>
        <Overlay label="Bar"><OverlayBar lead={<Button variant="ghost" size="icon-sm" aria-label="Back"><Icons.Back /></Button>} chips={<Crumbs label="Where you are" items={[{ label: "Commands" }, { label: "Workspace views", current: true }]} />} placeholder="Search workspace views…" onClose={() => {}} /></Overlay>
      </div>, { surfaces: ["ground"] }),
    row("OverlayList · a tree, an edit, nothing", "Item opens · onOpens (aria-expanded) · reveal end · indent · picked; OverlayEmpty", () => <div class="g-stack g-overlay-demo">
        <Overlay label="Tree"><OverlayList managed role="tree">{chatTree(false)}</OverlayList></Overlay>
        <Overlay label="Edit"><OverlayList managed role="tree">{chatTree(true)}</OverlayList><OverlayHints count="2 selected" start={[[["Ctrl", "E"], "Done", () => {}], [["Ctrl", "K", "D"], "Delete", () => {}], [["Ctrl", "K", "M"], "Move", () => {}]]} /></Overlay>
        <Overlay label="Empty"><OverlayBar lead={<Icons.Search />} chips={<OverlayChip onRemove={() => {}}>in:NHP</OverlayChip>} placeholder="Search NHP chats…" onClose={() => {}} /><OverlayList><OverlayEmpty>No chats in NHP.</OverlayEmpty></OverlayList></Overlay>
      </div>, { surfaces: ["ground"] }),
    row("OverlayList", "OverlayList > Section (a group title) > Item: icon · keys · opens · meta", () => <div class="g-overlay-demo"><Overlay label="List">{paletteList()}</Overlay></div>, { surfaces: ["ground"] }),
    row("OverlayHints", "OverlayHints start · end: keys and what they do", () => <div class="g-stack g-overlay-demo"><Overlay label="Hints">{paletteHints()}</Overlay><Overlay label="Hints">{searchHints()}</Overlay></div>, { surfaces: ["ground"] }),
    row("OverlayActions", "OverlayActions: on a phone, the hints give way to the view's actions as buttons", () => <div class="g-stack g-overlay-demo">
        <Overlay label="Actions" density="phone"><OverlayActions actions={[{ label: "Edit", onClick: () => {} }, { label: "Latest", onClick: () => {} }, { label: "Open Japan", onClick: () => {} }]} /></Overlay>
        <Overlay label="Actions" density="phone"><OverlayActions actions={[{ label: "Move 2", onClick: () => {} }, { label: "Delete 2", destructive: true, onClick: () => {} }, { label: "Done", onClick: () => {} }]} /></Overlay>
      </div>, { phone: "only", surfaces: ["ground"] }),
    row("OverlaySplit", "OverlaySplit: a List beside an aside", () => <div class="g-overlay-demo"><Overlay label="Split" style={{ "--overlay-width": "100%" }}><OverlaySplit aside={chatPreview()}>{chatRows()}</OverlaySplit></Overlay></div>, { surfaces: ["ground"] }),
    row("SettingGroup · SettingLine · every kind", "SettingGroup > SettingLine (a field, or plain: a value, link, buttons, keys) · SettingNote · SettingDetails · SettingWide (TextArea, Progress) · SettingLoading", () => <div class="g-overlay-demo"><Overlay label="Settings" layout="rail" style={{ "--overlay-width": "100%" }}><OverlayPage title="Every kind of line">
        <SettingGroup title="Fields"><SettingLine label="Select"><SelectTrigger value="Compact" bare /></SettingLine><SettingLine label="Input"><Input value="20" /></SettingLine><SettingLine label="Switch"><SwitchDemo /></SettingLine><SettingLine label="Segmented"><Theme /></SettingLine><SettingLine label="With its state" state="paused while hidden"><SelectTrigger value="Adaptive" bare /></SettingLine></SettingGroup>
        <SettingGroup title="Plain lines"><SettingLine label="SettingValue" plain><SettingValue>Signed in</SettingValue></SettingLine><SettingLine label="SettingValue mono" plain><SettingValue mono>a91f03c2 · TLS verified</SettingValue></SettingLine><SettingLine label="SettingLink" plain><SettingLink href="#">Docs</SettingLink></SettingLine><SettingLine label="Buttons" plain><Button variant="ghost" size="sm">Switch to</Button><Button variant="destructive" outline size="sm">Forget</Button></SettingLine><SettingLine label="Keys" plain>{keys("Ctrl", "K")}{reset()}</SettingLine></SettingGroup>
        <SettingGroup title="Under a line"><SettingLine label="A field"><Input value="sk-or-••••3f2a" /></SettingLine><SettingNote tone="error">SettingNote error: that key was turned down (401).</SettingNote><SettingNote>SettingNote quiet: click a shortcut, then press its keys.</SettingNote><SettingDetails summary="SettingDetails"><p>Folded until asked for.</p></SettingDetails></SettingGroup>
        <SettingGroup title="Page width"><SettingWide><TextArea value="SettingWide > TextArea: a prompt's text." /></SettingWide><SettingWide><Progress label="Download" value={1.2} max={3.1} /></SettingWide><SettingLoading>SettingLoading…</SettingLoading></SettingGroup>
      </OverlayPage></Overlay></div>, { surfaces: ["ground"] }),
    row("CommandMenu", "navigation/command-menu.tsx", overlayScene, { surfaces: ["ground"] }),
    row("CommandMenu · chat search", "navigation/command-menu.tsx", () => overlayViews.search({ close: noop, class: "g-scrim" }), { surfaces: ["ground"] }),
    row("Settings", "settings/settings-core.tsx", () => overlayViews.settings({ close: noop, class: "g-scrim" }), { surfaces: ["ground"] }),
    row("Settings · recording a shortcut", "settings/shortcuts-settings.tsx · + opens a second line under the command; press keys, Esc cancels, Backspace clears", () => <Scrim class="g-scrim" placement="center"><Settings close={noop} start="shortcuts" /></Scrim>, { surfaces: ["ground"] }),
    row("Glance · a chat", "navigation/chat-preview.tsx · GlanceHead · GlancePrompt · GlanceTurn · GlanceAnswer", () => <Frost lift="raised" class="g-glance">{glanceChat()}</Frost>, { surfaces: ["ground"] }),
    row("Glance · stopped", "an interrupted or failed turn: the orb sputters red", () => <Frost lift="raised" class="g-glance">{glanceStopped()}</Frost>, { surfaces: ["ground"] }),
    row("Glance · math", "GlanceAnswer html: the app's rendered KaTeX, faded where it is cut", () => <Frost lift="raised" class="g-glance">{glanceMath()}</Frost>, { surfaces: ["ground"] }),
    row("Glance · a folder", "FolderPreview: where it is, how it stands, its latest chats as rows", () => <Frost lift="raised" class="g-glance">{glanceFolder()}</Frost>, { surfaces: ["ground"] }),
    row("Glance · nothing highlighted", "GlanceEmpty", () => <Frost lift="raised" class="g-glance">{glanceEmpty("Nothing highlighted")()}</Frost>, { surfaces: ["ground"] }),
    row("Glance · no messages / couldn't read", "GlanceHead + GlanceEmpty", () => <Frost lift="raised" class="g-glance"><Glance label="Chat preview"><GlanceHead mark={<SquarePenIcon />} title="Untitled chat" facts={["Conduit · Chats · just now"]} /><GlanceEmpty>No messages yet</GlanceEmpty></Glance></Frost>, { surfaces: ["ground"] }),
    row("CommandMenu", "navigation/command-menu.tsx", () => <PhoneStage><Overlay label="Command palette"><OverlayBar lead={glyph()} placeholder="Run a command…" onClose={noop} />{paletteList()}</Overlay></PhoneStage>, { phone: "only", surfaces: ["ground"] }),
    row("CommandMenu · chat search", "navigation/command-menu.tsx", () => <PhoneStage><Overlay label="Chat search"><OverlayBar lead={<Icons.Search />} placeholder="Search chats…" value="t" end={<SortToggle />} onClose={noop} /><OverlaySplit aside={chatPreview()}>{chatRows("t")}</OverlaySplit></Overlay></PhoneStage>, { phone: "only", surfaces: ["ground"] }),
    row("Settings · sections", "settings/settings-core.tsx · a section opens over the rail, Back returns", () => <PhoneStage><Settings close={noop} phone /></PhoneStage>, { phone: "only", surfaces: ["ground"] }),
    row("Settings · a section", "settings/settings-core.tsx · Back to the sections", () => <PhoneStage><Settings close={noop} phone start="models" /></PhoneStage>, { phone: "only", surfaces: ["ground"] }),
  ],
  motion: [
    row("Backdrop", "components/ui/overlay.tsx · the page dimmed under a phone's drawer; a tap on it dismisses the drawer. Here it is held in its frame (on a phone it covers the screen, one layer under its drawer: --layer-drawer for the sidebar, --layer-panel for the workspace panel)", () => <div data-density="phone" style={{ position: "relative", transform: "translateZ(0)", width: "100%", height: "calc(10 * var(--u-space))", overflow: "hidden", "border-radius": "var(--radius-surface)" }}><p style={{ margin: "var(--space-lg)" }}>The page under the drawer</p><Backdrop layer="drawer" label="Dismiss sidebar" onDismiss={() => {}} /></div>, { phone: "only", surfaces: ["ground"] }),
    row("arrives · leaves", "the scrim fades; the overlay rises and drops back; the scrim: a fade, --ease-change · in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave", () => <Replay leaves={["leaving"]}>{(m) => <Scrim placement="center" motion={m()}><Overlay label="Overlay" motion={m()}><OverlayList>{leaderRows()}</OverlayList></Overlay></Scrim>}</Replay>, { phone: true, surfaces: ["ground"], code: "<Scrim motion> · <Overlay motion>" }),
  ],
  tokens: [{ title: "Its surface", tokens: [
    token("--overlay-width", "Overlay width"),
    token("--overlay-height", "Overlay height"),
    token("--dim", "Scrim dim"),
    token("--hairline", "Section rules"),
    token("--duration-gentle", "Arrival duration")
  ] }],
  api: ["Overlay", "Scrim", "Backdrop", "OverlayBar", "OverlayChip", "Crumbs", "Button", "Segmented", "OverlaySplit", "OverlayList", "Section", "Item", "Match", "HarnessMark", "OverlayEmpty", "OverlayHints", "OverlayActions", "OverlayRail", "NavGroup", "NavRow", "OverlayFacts", "OverlayFact", "OverlayPage", "SettingGroup", "SettingLine", "SelectTrigger", "Input", "Switch", "SettingValue", "SettingLink", "SettingNote", "SettingDetails", "SettingWide", "TextArea", "Progress", "SettingLoading", "SettingRecorder", "Keycap", "Glance", "GlanceHead", "GlancePrompt", "GlanceTurn", "Orb", "GlanceAnswer", "GlanceEmpty", "Frost", "LiveNote"],
};
