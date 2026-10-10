import { createSignal, For, Show, type JSX } from "solid-js";
import { EllipsisIcon, FolderPlusIcon, LayoutDashboardIcon, MicIcon, PanelLeftIcon, PanelRightIcon, PaperclipIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, SearchIcon, ShareIcon, SquarePenIcon, TerminalIcon, ChevronDownIcon, CameraIcon, KeyboardIcon } from "lucide-solid";
import { Bubble, Item, Menu, Pill, Section } from "@/components/ui";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import { ChatTitle, Levels, ModelList, Profiles, Projects, SegmentedIcons, thinking } from "./library";
import { PROJECTS } from "./seed";

/*
 * The phone, built only from the library: header pills, the transcript's
 * bubbles, the composer's frost buttons, the sidebar, and every popover they
 * open. Density comes from the frame (data-density="phone"), as it will come
 * from the phone layout in the app. Not wired to anything.
 */

type Popover = "plus" | "plus-model" | "plus-profile" | "plus-effort" | "plus-project" | "chat" | "server" | null;

function Float(props: { at: "top-right" | "bottom-left" | "top-left"; children: JSX.Element }) {
  return <div class="g-live-float" data-at={props.at} onClick={(event) => event.stopPropagation()}>{props.children}</div>;
}

export function LivePhone() {
  const [open, setOpen] = createSignal<Popover>(null);
  const [sidebar, setSidebar] = createSignal(false);
  const toggle = (which: Popover) => setOpen(open() === which ? null : which);
  const plusPanel = () => open()?.startsWith("plus-");

  return <div class="g-live" data-density="phone" onClick={() => setOpen(null)}>
    <header class="g-live-header">
      <Pill icons={[{ label: "Sidebar", icon: <PanelLeftIcon /> }, { label: "New chat", icon: <SquarePenIcon /> }]} onPick={(label) => label === "Sidebar" && setSidebar(true)} />
      <Pill icons={[{ label: "Search", icon: <SearchIcon /> }, { label: "Palette", icon: <TerminalIcon /> }, { label: "More", icon: <EllipsisIcon /> }]} onPick={(label) => label === "More" && toggle("chat")} />
    </header>
    <main class="g-live-transcript">
      <Bubble>write a .txt file in this folder that contains lorem ipsum text</Bubble>
      <p class="g-live-answer">Created <code>lorem_ipsum.txt</code> in this folder with lorem ipsum text.</p>
      <Bubble>and make the second paragraph shorter</Bubble>
      <p class="g-live-answer">Done. The second paragraph is now two sentences.</p>
    </main>
    <footer class="g-live-composer">
      <Pill icons={[{ label: "Attach and more", icon: <PlusIcon /> }]} onPick={() => toggle("plus")} />
      <Pill icons={[{ label: "Camera", icon: <CameraIcon /> }]} />
      <Pill icons={[{ label: "Keyboard", icon: <KeyboardIcon /> }]} />
      <div class="ui-frost g-live-mic"><MicIcon /></div>
    </footer>

    <Show when={open() === "chat"}><Float at="top-right"><Menu class="g-live-menu">
      <ChatTitle />
      <Section><Item icon={<RefreshCwIcon />}>Update app</Item></Section>
      <Section><Item icon={<PanelRightIcon />}>Workspace panel</Item><Item icon={<ShareIcon />}>Share</Item></Section>
    </Menu></Float></Show>

    <Show when={open() === "plus" || plusPanel()}><Float at="bottom-left">
      <div class="g-live-panels" data-panel-open={plusPanel() ? "" : undefined}>
        <Menu class="g-live-menu g-live-parent">
          <Section title="Profile"><Item icon={<HarnessMark id="conduit" class="size-4" />} opens onClick={() => setOpen("plus-profile")}>Assistant</Item></Section>
          <Section title="Model"><Item opens onClick={() => setOpen("plus-model")}>Meta: Muse Spark 1.3 Contributor</Item></Section>
          <Section kind="slider"><Levels label="Effort" onOpen={() => setOpen("plus-effort")} /></Section>
          <Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section>
          <Section title="Project"><Item icon={<PlaceGlyph project={null} />} opens onClick={() => setOpen("plus-project")}>Add to a project folder</Item></Section>
        </Menu>
        <Show when={plusPanel()}><div class="g-live-panel" onClick={() => setOpen("plus")}><div onClick={(event) => event.stopPropagation()}>
          <Show when={open() === "plus-model"}><Menu class="g-live-menu"><ModelList title="Model" /></Menu></Show>
          <Show when={open() === "plus-profile"}><Menu class="g-live-menu"><Profiles /></Menu></Show>
          <Show when={open() === "plus-effort"}><Menu class="g-live-menu"><Section title="Effort"><For each={thinking}>{(level) => <Item checked={level.value === "medium"} onClick={() => setOpen("plus")}>{level.label}</Item>}</For></Section></Menu></Show>
          <Show when={open() === "plus-project"}><Menu class="g-live-menu"><Projects /></Menu></Show>
        </div></div></Show>
      </div>
    </Float></Show>

    <Show when={sidebar()}>
      <div class="g-live-backdrop" onClick={(event) => { event.stopPropagation(); setSidebar(false); setOpen(null); }} />
      <aside class="g-live-sidebar" onClick={(event) => { event.stopPropagation(); setOpen(null); }}>
        <header class="g-live-sidebar-head">
          <Pill icons={[{ label: "Close sidebar", icon: <PanelLeftIcon /> }]} onPick={() => setSidebar(false)} />
          <button type="button" class="g-live-server" onClick={(event) => { event.stopPropagation(); toggle("server"); }}><span class="g-live-dot" />Desktop-Dev<ChevronDownIcon /></button>
          <SegmentedIcons pill />
        </header>
        <nav class="g-live-sidebar-list">
          <Section><Item icon={<LayoutDashboardIcon />}>Dashboard</Item><Item icon={<FolderPlusIcon />}>New project</Item></Section>
          <For each={PROJECTS.slice(2, 5)}>{(project, index) => <Section title={project.name}>
            <Item icon={<PlaceGlyph project={project} />} checked={index() === 0}>Lorem ipsum file</Item>
            <Item icon={<PlaceGlyph project={project} />}>Plan the trip</Item>
          </Section>}</For>
        </nav>
        <Show when={open() === "server"}><Float at="top-left"><Menu class="g-live-menu">
          <Section title="Servers"><Item checked meta="12 ms">Desktop-Dev</Item><Item checked={false} meta="48 ms">Laptop</Item></Section>
          <Section><Item opens>Route</Item></Section>
          <Section><Item icon={<QrCodeIcon />}>Pair a device</Item><Item icon={<PlusIcon />}>Add server</Item></Section>
        </Menu></Float></Show>
      </aside>
    </Show>
  </div>;
}
