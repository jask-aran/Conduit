import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { SearchList } from "@/components/menus";
import { Show } from "solid-js";
import { createSignal, For } from "solid-js";
import { Match, Meta, MenuNote, MenuAction, MenuParent, MenuPanel, Button } from "@/components/ui";
import { RowGroup, RowAction, Rule, Meter, Readout, SliderValue, Item, Menu, HeadingSection, SearchSection, Section, Slider } from "@/components/ui";
import { PlaceGlyph } from "../../client/chat/place-picker";
import { MODELS, PROFILES, PROJECTS } from "../seed";
import { Replay, Presence } from "../specs";
import { Levels, noop, thinking, ContextReadingDemo } from "../demos";
import { row, token, type Page } from "../model";

/** A menu over a long list starts with a Search all… row that opens the palette (DESIGN Dropdown menu), then the list; the current choice is bold. */
export function ModelList(props: { keys?: string[]; title?: string }) {
  const [current, setCurrent] = createSignal(MODELS[2]!.spec);
  return <>
    <Section><Item icon={<Icons.Search />} keys={props.keys}>Search all models…</Item></Section>
    <Section title={props.title}><For each={MODELS}>{(model) => <Item meta={model.provider} checked={model.spec === current()} onClick={() => setCurrent(model.spec)}>{model.label}</Item>}</For></Section>
  </>;
}
export const Profiles = () => <Section title="Profile"><For each={PROFILES}>{(profile, index) => <Item checked={index() === 0} icon={<HarnessMark id={profile.implementation || "conduit"} />} meta={profile.implementation}>{profile.label}</Item>}</For></Section>;
export const Projects = () => <Section title="Project"><Item icon={<Icons.Folder />}>No folder</Item><For each={PROJECTS.slice(2, 7)}>{(project) => <Item icon={<PlaceGlyph project={project} />}>{project.name}</Item>}</For></Section>;
export const ChatTitle = () => <HeadingSection title="Lorem ipsum file" detail="Chats · Assistant"><Item field meta="Unavailable" opens>Context</Item></HeadingSection>;

export const popoverPage: Page = {
  title: "Menu",
  summary: "Raised frost holding sections, separated by rules; a submenu is another popover.",
  preview: () => <Menu>
        <HeadingSection title="lorem_ipsum.txt" detail="Edited 2 minutes ago" />
        <SearchSection placeholder="Search models…" />
        <Section title="Attach"><Item icon={<Icons.Attach />}>File</Item><Item meta="xai">Model</Item><Item opens>More</Item></Section>
        <Section kind="slider"><Levels label="Reasoning" /></Section>
      </Menu>,
  usage: `import { Menu, Section, Item } from "@/components/ui/popover";
import { Icons } from "@/components/ui";

<Menu>
  <Section>
    <Item icon={<Icons.Folder />}>Open workspace</Item>
    <Item icon={<Icons.Copy />}>Copy link</Item>
  </Section>
</Menu>`,
  anatomy: { scene: () => <Menu>
        <HeadingSection title="lorem_ipsum.txt" detail="Edited 2 minutes ago" />
        <SearchSection placeholder="Search models…" />
        <Section title="Attach"><Item icon={<Icons.Attach />}>File</Item><Item meta="xai">Model</Item><Item opens>More</Item></Section>
        <Section kind="slider"><Levels label="Reasoning" /></Section>
      </Menu>, parts: [
    { selector: ".ui-heading", name: "Heading section", does: "what the popover is about: a title and a line under it", from: "HeadingSection" },
    { selector: ".ui-search-section", name: "Search section", does: "a field filtering the list after it", from: "SearchSection" },
    { selector: '.ui-section[data-kind="list"] > .ui-title', name: "List section", does: "a titled group of Items", from: "Section" },
    { selector: '.ui-section[data-kind="list"] > .ui-row:nth-child(2)', name: "Item", does: "one choice; icon, meta, keys and opens are its parts", from: "Item · icon" },
    { selector: '.ui-section[data-kind="list"] > .ui-row:nth-child(3)', name: "Meta", does: "a value or source at the row's end", from: "Item · meta" },
    { selector: '.ui-section[data-kind="list"] > .ui-row:nth-child(4)', name: "Opens", does: "opens a submenu", from: "Item · opens" },
    { selector: '.ui-section[data-kind="slider"]', name: "Slider section", does: "a level picked by dragging", from: "Section kind=slider" }
  ] },
  examples: [
    row("Popover · caps", "Menu width, height: as big as its rows inside its caps (a phone's narrower and shorter by default, --menu-width-cap, --menu-height-cap; a menu sets its own in a measure) and its host's room (--menu-room: the adapter gives it Kobalte's, inside the safe area), scrolling past them", () => <div style={{ "--menu-room": "calc(8 * var(--control))" }}><Menu height="md"><Section title="Projects"><For each={["Engie", "Japan", "NHP", "Test", "Conduit", "Gallery", "Notes", "Lodge", "Sprint", "Reading"]}>{(name) => <Item icon={<Icons.Folder />}>{name}</Item>}</For></Section></Menu></div>, { surfaces: ["ground"], phone: true }),
    row("Popover · a row's actions", "RowGroup · RowAction (MenuRow actions): a row and its actions side by side, each a menu item, so Down reaches every one and Enter runs it; shown on the hovered row or the one holding the cursor (always on a phone). Here the second session holds the cursor on Rename", () => <Menu><Section title="Active terminals · Japan"><RowGroup actions={<><RowAction label="Open zsh beside" icon={<Icons.Split />} /><RowAction label="Rename zsh" icon={<Icons.Edit />} /><RowAction label="Destroy zsh" icon={<Icons.Delete />} destructive /></>}><Item checked detail="Japan · 2m">zsh</Item></RowGroup><RowGroup actions={<><RowAction label="Open build beside" icon={<Icons.Split />} /><RowAction label="Rename build" icon={<Icons.Edit />} data-highlighted="" /><RowAction label="Destroy build" icon={<Icons.Delete />} destructive /></>}><Item detail="Japan · npm run build">build</Item></RowGroup></Section><Rule /><Item icon={<Icons.Add />}>New terminal</Item></Menu>, { surfaces: ["ground"], phone: true }),
    ...(["xs", "sm", "lg", "xl", "2xl"] as const).map((measure) => row(`Cap · ${measure}`, "Width and height caps with a scrolling section", () => <Menu width={measure} height={measure}><Section title="Workspaces" kind="list" scroll><For each={PROJECTS}>{(project) => <Item icon={<Icons.Folder />}>{project.name}</Item>}</For></Section></Menu>, { surfaces: ["ground"], phone: true, code: `<Menu width="${measure}" height="${measure}"><Section scroll /></Menu>` })),
    ...(["xs", "md", "lg", "xl", "2xl"] as const).map((measure) => row(`Panel cap · ${measure}`, "Submenu width and height caps", () => <MenuPanel width={measure} height={measure}><Section title="Projects"><For each={PROJECTS}>{(project) => <Item icon={<Icons.Folder />}>{project.name}</Item>}</For></Section></MenuPanel>, { surfaces: ["ground"], phone: true, code: `<MenuPanel width="${measure}" height="${measure}" />` })),
    row("Wide readout", "Legacy wide surface with long session details", () => <Menu wide><HeadingSection title="Review microphone input and workspace configuration" /><Readout label="Session" value="019a3f2c-7b1e-7c40-9d2e-5f8a1b6c3e70" /><Readout label="Waiting for usage" /></Menu>, { surfaces: ["ground"], phone: true, code: "<Menu wide><HeadingSection title /><Readout label value /></Menu>" }),
    row("Search and match", "Controlled query; matching and unmatched labels", () => {
          const [query, setQuery] = createSignal("con");
          return <Menu><SearchSection placeholder="Search workspaces…" value={query()} onInput={setQuery} field={{ "aria-label": "Search gallery workspaces" }} /><Section><Item><Match text="Conduit" query={query()} /></Item><Item><Match text="Japan" query={query()} /></Item></Section></Menu>;
        }, { surfaces: ["ground"], phone: true, code: "<SearchSection value onInput field /> · <Match text query />" }),
    row("Folder tree", "Independent chevron; nested row; data detail", () => {
          const [open, setOpen] = createSignal(false), [selected, setSelected] = createSignal(false);
          return <Menu><Section><Item icon={<Icons.Folder />} opens opensLabel="Expand Conduit folder" aria-expanded={open()} onOpens={() => setOpen(!open())} onClick={() => setSelected(!selected())} picked={selected()} detailData detail="/work/conduit">Conduit</Item><Show when={open()}><Item indent picked={false}>Microphone input review</Item></Show></Section></Menu>;
        }, { surfaces: ["ground"], phone: true, code: "<Item opens onOpens opensLabel picked detailData /> · <Item indent />" }),
    row("Leading keys", "Leader key before the action label", () => <Menu><Section><Item keysFirst keys={["W"]}>Open workspace</Item></Section></Menu>, { surfaces: ["ground"], phone: true, code: '<Item keysFirst keys={["W"]}>' }),
    row("Reveal end action", "End control appears on hover or cursor", () => {
          const [removed, setRemoved] = createSignal(false);
          return <Menu><Section><Show when={!removed()} fallback={<MenuNote>No recent workspaces.</MenuNote>}><Item reveal end={<Button variant="ghost" size="icon-xs" aria-label="Remove Japan from recent workspaces" onClick={() => setRemoved(true)}><Icons.Close /></Button>}>Japan</Item></Show></Section></Menu>;
        }, { surfaces: ["ground"], phone: true, code: "<Item reveal end={<Button onClick />} />" }),
    row("Cursor and fixed end", "Pointer cursor with an always visible end control", () => {
          const [cursor, setCursor] = createSignal(false), [copied, setCopied] = createSignal(false);
          return <Menu><Section><Item active={cursor()} onCursor={() => setCursor(true)} end={<Button variant="ghost" size="icon-xs" aria-label="Copy workspace path" onClick={() => setCopied(true)}><Icons.Copy /></Button>}>{copied() ? "Workspace path copied" : "Conduit"}</Item><Item onCursor={() => setCursor(false)}>Japan</Item></Section></Menu>;
        }, { surfaces: ["ground"], phone: true, code: "<Item active onCursor end={<Button onClick />} />" }),
    row("Notices", "Neutral hint and an error in their menu", () => <Menu><MenuNote>No active terminals in Japan.</MenuNote><MenuNote error>Could not connect to Desktop-Dev.</MenuNote></Menu>, { surfaces: ["ground"], phone: true, code: "<MenuNote /> · <MenuNote error />" }),
    row("Action shell", "Adapter content with a separate metadata slot", () => {
          const [copied, setCopied] = createSignal(false);
          return <Menu><MenuAction role="menuitem" tabIndex={0} onClick={() => setCopied(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setCopied(true); } }}>{copied() ? "Link copied" : "Copy workspace link"}<Meta>Japan</Meta></MenuAction></Menu>;
        }, { surfaces: ["ground"], phone: true, code: '<MenuAction role="menuitem"><Meta /></MenuAction>' }),
    row("Panel and parent", "Dimmed parent while the submenu is open", () => {
          const [open, setOpen] = createSignal(false);
          return <><Button variant="ghost" outline size="sm" onClick={() => setOpen(!open())}>{open() ? "Back to servers" : "Open routes"}</Button><MenuParent under={open()}><Menu><Section><Item opens onClick={() => setOpen(true)}>Route</Item></Section></Menu></MenuParent><Show when={open()}><MenuPanel width="sm" height="sm"><Section><Item checked>Automatic</Item><Item checked={false} onClick={() => setOpen(false)}>Local network</Item></Section></MenuPanel></Show></>;
        }, { surfaces: ["ground"], phone: true, code: '<MenuParent under /><MenuPanel width="sm" height="sm" />' }),
    row("Heading", "HeadingSection + Item field", () => <Menu><ChatTitle /></Menu>, { surfaces: ["ground"] }),
    row("Search", "SearchSection: heads a pick list (SearchList, live: type, arrows, Enter; the list scrolls in its own height). A menu over a long list starts with a Search all… row that opens the palette instead", () => <div class="g-row g-top">
        <Menu><SearchSection placeholder="Search all models…" keys={["⌘", "⇧", "X"]} /></Menu>
        <Menu><SearchList items={PROJECTS} placeholder="Search projects and workspaces" matches={(project, needle) => project.name.toLowerCase().includes(needle)} isCurrent={(project) => project === PROJECTS[1]}
          onChoose={noop} row={(project) => ({ icon: <PlaceGlyph project={project} />, label: project.name, meta: "Project" })} /></Menu>
      </div>, { surfaces: ["ground"] }),
    row("List · items", "Section + Item: icon meta detail keys opens away field · checked (current: bold, no tick) disabled destructive · onCursor (a list keeping its own cursor; a hovering pointer only, never a tap)", () => <Menu><Section title="Title" note="note">
        <Item>Plain</Item>
        <Item icon={<Icons.Attach />}>icon</Item>
        <Item meta="xai">meta</Item>
        <Item detail="192.168.1.4">detail</Item>
        <Item icon={<Icons.Search />} keys={["Ctrl", "K"]}>keys</Item>
        <Item opens>opens a submenu</Item>
        <Item away detail="lan.example.com">away: opens elsewhere</Item>
        <Item away detail="laptop.ts.net" meta="29 ms">away with meta</Item>
        <Item field meta="Unavailable" opens>Field</Item>
        <Item checked>checked</Item>
        <Item active>highlighted</Item>
        <Item disabled>disabled: dimmer, struck through, no note</Item>
        <Item icon={<Icons.Delete />} destructive>destructive</Item>
      </Section></Menu>, { surfaces: ["ground"] }),
    row("Slider", "Section kind=slider + Slider; its value a SliderValue that opens the levels (onOpen, or control: the caller's own, a submenu's trigger)", () => <Menu>
        <Section kind="slider"><Levels /></Section>
        <Section kind="slider"><Slider label="Effort" options={thinking} value="medium" onChange={noop} control={(shown) => <SliderValue>{shown()}</SliderValue>} /></Section>
      </Menu>, { surfaces: ["ground"] }),
    row("Submenu", "Menu beside an Item that opens", () => <div class="g-row g-top g-submenu">
        <Menu><Section title="Servers"><Item checked>Desktop-Dev</Item><Item checked={false}>Laptop</Item></Section><Section><Item opens active>Route</Item><Item>Manage settings</Item></Section></Menu>
        <Menu><Section><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Section></Menu>
      </div>, { surfaces: ["ground"] }),
    row("ModelSelector", "chat/model-selector.tsx", () => <Menu class="g-w18"><ModelList keys={["⌘", "⇧", "X"]} /><Section kind="slider"><Levels /></Section></Menu>, { surfaces: ["ground"] }),
    row("ComposerPlusMenu", "chat/composer-plus-menu.tsx", () => <Menu class="g-w18">
      <Section><Item meta="Muse Spark 1.3" opens>Model</Item><Item icon={<HarnessMark id="conduit" />} meta="Assistant" opens>Profile</Item><Item icon={<Icons.Permissions />} meta="Default" opens>Permissions</Item></Section>
      <Section><Item icon={<PlaceGlyph project={null} />} meta="None" opens>Project</Item></Section>
      <Section><Item icon={<Icons.Attach />}>Attach files</Item></Section>
    </Menu>, { surfaces: ["ground"] }),
    row("ContextGauge › breakdown", "chat/context-gauge.tsx · the composer's gauge: a Reading in a Menu width lg that unfolds (a part with parts of its own opens under itself, the menu growing with it). Tools open here", () => <Menu width="lg" unfolds><ContextReadingDemo open /></Menu>, { surfaces: ["ground"] }),
    row("ComposerPlusMenu › Profile", "chat/composer-plus-menu.tsx", () => <Menu class="g-w18"><Profiles /></Menu>, { surfaces: ["ground"] }),
    row("Sidebar › ChatMenu", "navigation/sidebar.tsx", () => <div class="g-row g-top g-submenu">
      <Menu class="g-w18"><Section><Item icon={<Icons.Edit />}>Rename</Item><Item icon={<Icons.MoveToFolder />} opens active>Move to folder…</Item><Item icon={<Icons.Copy />}>Copy transcript</Item><Item icon={<Icons.Split />}>Open beside</Item><Item icon={<Icons.Terminal />}>Open terminal</Item><Item icon={<Icons.Pin />}>Pin to sidebar</Item></Section><Section><Item icon={<Icons.Delete />} destructive>Delete chat</Item></Section></Menu>
      <Menu><Section><For each={PROJECTS.slice(2, 6)}>{(project, index) => <Item checked={index() === 0}>{project.name}</Item>}</For></Section></Menu>
    </div>, { surfaces: ["ground"] }),
    row("ServerSwitcher", "navigation/server-switcher.tsx", () => <div class="g-row g-top g-submenu">
      <Menu class="g-w18"><Section title="Servers"><Item checked meta="12 ms">Desktop-Dev</Item><Item checked={false} meta="48 ms">Laptop</Item></Section><Section><Item meta="LAN · 192.168.1.4" opens active>Route</Item></Section><Section><Item icon={<Icons.QrCode />}>Pair a device</Item><Item icon={<Icons.Add />}>Add server</Item></Section></Menu>
      <Menu><Section><Item checked>Automatic</Item><Item checked={false}>Local network</Item><Item checked={false}>Internet</Item></Section></Menu>
    </div>, { surfaces: ["ground"] }),
    row("MobileComposerOptions", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16">
      <Section title="Profile"><Item icon={<HarnessMark id="conduit" />} opens>Assistant</Item></Section>
      <Section title="Model"><Item opens>Meta: Muse Spark 1.3 Contributor</Item></Section>
      <Section kind="slider"><Levels label="Effort" /></Section>
      <Section><Item icon={<Icons.Attach />}>Attach files</Item></Section>
      <Section title="Project"><Item icon={<PlaceGlyph project={null} />} opens>Add to a project folder</Item></Section>
    </Menu>, { surfaces: ["ground"], phone: "only" }),
    row("MobileComposerOptions › models", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><ModelList title="Model" /></Menu>, { surfaces: ["ground"], phone: "only" }),
    row("MobileComposerOptions › profiles", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><Profiles /></Menu>, { surfaces: ["ground"], phone: "only" }),
    row("MobileComposerOptions › effort", "chat/mobile-composer-options.tsx", () => <Menu class="g-w12"><Section title="Effort"><For each={thinking}>{(level) => <Item checked={level.value === "medium"}>{level.label}</Item>}</For></Section></Menu>, { surfaces: ["ground"], phone: "only" }),
    row("MobileComposerOptions › places", "chat/mobile-composer-options.tsx", () => <Menu class="g-w16"><Projects /></Menu>, { surfaces: ["ground"], phone: "only" }),
    row("ChatHeader › menu", "chat/chat-screen.tsx · opened from the title pill (HeaderPill). unfolds: as wide as its cap, and as tall as what is open up to the room it has, so Context and Details grow their sections in place (Expand, the menu's edge running with the rows) rather than scrolling; a section inside a section draws no rule. The actions first, Delete chat last among them; Context with its meter, then Details in a section of its own (the thread's harness, version, profile, tools and session, folded to the harness), each opening in place. Context and Details open here", () => <Menu width="md" unfolds><Section><Item icon={<Icons.Share />}>Share</Item><Item icon={<Icons.Edit />}>Rename</Item><Item icon={<Icons.Workspace />}>Workspace panel</Item><Item icon={<Icons.Delete />} destructive>Delete chat</Item></Section><Rule /><Section><Item field meta="42% used" opens aria-expanded="true">Context</Item><Meter parts={[{ value: 60, colour: "oklch(0.72 0.15 300)" }, { value: 16, colour: "oklch(0.7 0.02 260)" }, { value: 12, colour: "oklch(0.74 0.12 230)" }, { value: 112, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%", quiet: true }} /><ContextReadingDemo bare /></Section><Section><Item field meta="Conduit Pi" opens aria-expanded="true">Details</Item><Readout label="Harness" value="Conduit Pi" /><Readout label="Version" value="v1.3.0" /><Readout label="Profile" value="Coding" /><Readout label="Tools" value="codemode: read / edit / shell / web search" /><Readout label="Session" value="019a3f2c-7b1e-7c40-9d2e-5f8a1b6c3e70" /></Section></Menu>, { surfaces: ["ground"], phone: "only" })
  ],
  motion: [
    row("Removing", "The third shared motion state", () => <Replay leaves={["removing"]}>{(motion) => <Menu motion={motion()}><Section><Item>Workspace files updated</Item></Section></Menu>}</Replay>, { surfaces: ["ground"], phone: true, code: '<Menu motion="removing" />' }),
    row("arrives · leaves", "rises --space-md with a fade; drops back · in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave", () => <Replay leaves={["leaving"]}>{(m) => <Menu motion={m()}><Section><Item icon={<Icons.Folder />}>Open</Item><Item icon={<Icons.Copy />}>Copy link</Item></Section></Menu>}</Replay>, { surfaces: ["ground"], phone: true, code: "<Menu motion>" }),
    row("a submenu · Menu", "opens as a panel over its parent, which dims where it stands and takes no taps · the dim: --duration-quick · --ease-change", () => { const [s, setState] = createSignal<string>("Menu"); return <><Button variant="ghost" outline size="sm" onClick={() => setState(s() === "Menu" ? "Submenu open" : "Menu")}>Toggle submenu</Button><div class="g-panel-over">
        <Menu class="g-w16" under={s() === "Submenu open"}><Section title="Model"><Item opens>Meta: Muse Spark 1.3 Contributor</Item></Section><Section><Item icon={<Icons.Attach />}>Attach files</Item></Section></Menu>
        <Presence when={s() === "Submenu open"}>{(m) => <Menu class="g-w12 g-panel-over-panel" motion={m()}><Section title="Effort"><For each={thinking}>{(level) => <Item checked={level.value === "medium"}>{level.label}</Item>}</For></Section></Menu>}</Presence></div></>; }, { surfaces: ["ground"], phone: "only", code: "<Menu under> · <Menu motion>" }),
    row("a submenu · Submenu open", "opens as a panel over its parent, which dims where it stands and takes no taps · the dim: --duration-quick · --ease-change", () => { const [s, setState] = createSignal<string>("Submenu open"); return <><Button variant="ghost" outline size="sm" onClick={() => setState(s() === "Menu" ? "Submenu open" : "Menu")}>Toggle submenu</Button><div class="g-panel-over">
        <Menu class="g-w16" under={s() === "Submenu open"}><Section title="Model"><Item opens>Meta: Muse Spark 1.3 Contributor</Item></Section><Section><Item icon={<Icons.Attach />}>Attach files</Item></Section></Menu>
        <Presence when={s() === "Submenu open"}>{(m) => <Menu class="g-w12 g-panel-over-panel" motion={m()}><Section title="Effort"><For each={thinking}>{(level) => <Item checked={level.value === "medium"}>{level.label}</Item>}</For></Section></Menu>}</Presence></div></>; }, { surfaces: ["ground"], phone: "only", code: "<Menu under> · <Menu motion>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--menu-width-cap", "width cap"),
    token("--menu-height-cap", "height cap"),
    token("--menu-room", "available height"),
    token("--radius-surface", "surface corner")
  ] }],
  api: ["Menu", "Section", "SearchSection", "HeadingSection", "RowGroup", "Item", "RowAction", "Match", "Readout", "Rule", "Meta", "MenuNote", "MenuAction", "MenuParent", "MenuPanel", "components/menus.tsx#Menu", "MenuTrigger", "MenuPillTrigger", "MenuContent", "MenuSection", "MenuRow", "MenuItem", "MenuRadioItem", "MenuSub", "MenuSubTrigger", "MenuSubValue", "MenuSubContent", "ContextMenu", "ContextMenuContent", "ContextMenuItem", "Popover", "PopoverContent", "SearchList"]
};
