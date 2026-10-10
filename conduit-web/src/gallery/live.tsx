import { createSignal, For, Show, type JSX } from "solid-js";
import { EllipsisIcon, FolderPlusIcon, LayoutDashboardIcon, MicIcon, PanelLeftIcon, PanelRightIcon, PaperclipIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, SearchIcon, ShareIcon, SquarePenIcon, TerminalIcon, ChevronDownIcon, CameraIcon, KeyboardIcon, ArrowUpIcon, Trash2Icon, PencilIcon, ShieldCheckIcon, CircleIcon } from "lucide-solid";
import { Bubble, Button, Item, Menu, Pill, Section } from "@/components/ui";
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

type DesktopPopover = "plus" | "model" | "chat" | null;

/** The desktop chat screen, built only from the library, in a desktop layout. */
export function LiveDesktop() {
  const [open, setOpen] = createSignal<DesktopPopover>(null);
  const toggle = (which: DesktopPopover) => (event: MouseEvent) => { event.stopPropagation(); setOpen(open() === which ? null : which); };
  return <div class="g-live g-live-desktop" data-density="desktop" onClick={() => setOpen(null)}>
    <aside class="g-live-rail">
      <Section><Item icon={<LayoutDashboardIcon />}>Dashboard</Item><Item icon={<FolderPlusIcon />}>New project</Item></Section>
      <For each={PROJECTS.slice(2, 5)}>{(project, index) => <Section title={project.name}>
        <Item icon={<PlaceGlyph project={project} />} checked={index() === 0}>Lorem ipsum file</Item>
        <Item icon={<PlaceGlyph project={project} />}>Plan the trip</Item>
      </Section>}</For>
    </aside>
    <div class="g-live-main">
      <header class="g-live-desk-head">
        <Button variant="ghost" size="icon-sm" aria-label="Sidebar"><PanelLeftIcon /></Button>
        <strong>Lorem ipsum file</strong>
        <span class="g-live-grow" />
        <Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="More" onClick={toggle("chat")}><EllipsisIcon /></Button>
      </header>
      <main class="g-live-transcript g-live-desk-transcript">
        <Bubble>write a .txt file in this folder that contains lorem ipsum text</Bubble>
        <p class="g-live-answer">Created <code>lorem_ipsum.txt</code> in this folder with lorem ipsum text.</p>
        <Bubble>and make the second paragraph shorter</Bubble>
        <p class="g-live-answer">Done. The second paragraph is now two sentences.</p>
      </main>
      <footer class="ui-frost g-live-desk-composer">
        <textarea placeholder="Send a message…" rows={1} />
        <div class="g-live-desk-row">
          <Button variant="ghost" size="icon-sm" aria-label="Attach and more" onClick={toggle("plus")}><PlusIcon /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Context"><CircleIcon /></Button>
          <button type="button" class="g-live-model" onClick={toggle("model")}>Meta: Muse Spark 1.3 Contributor<span>medium</span><ChevronDownIcon /></button>
          <span class="g-live-grow" />
          <Button variant="ghost" size="icon-sm" aria-label="Dictate"><MicIcon /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Send"><ArrowUpIcon /></Button>
        </div>
        <Show when={open() === "model"}><div class="g-live-anchor" data-at="model" onClick={(event) => event.stopPropagation()}><Menu class="g-live-desk-menu"><ModelList keys={["⌘", "⇧", "X"]} /><Section kind="slider"><Levels /></Section></Menu></div></Show>
        <Show when={open() === "plus"}><div class="g-live-anchor" data-at="plus" onClick={(event) => event.stopPropagation()}><Menu class="g-live-desk-menu">
          <Section><Item meta="Muse Spark 1.3" opens>Model</Item><Item icon={<HarnessMark id="conduit" class="size-4" />} meta="Assistant" opens>Profile</Item><Item icon={<ShieldCheckIcon />} meta="Default" opens>Permissions</Item></Section>
          <Section><Item icon={<PlaceGlyph project={null} />} meta="None" opens>Project</Item></Section>
          <Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section>
        </Menu></div></Show>
      </footer>
      <Show when={open() === "chat"}><div class="g-live-anchor" data-at="chat" onClick={(event) => event.stopPropagation()}><Menu class="g-live-desk-menu">
        <ChatTitle />
        <Section><Item icon={<RefreshCwIcon />}>Update app</Item></Section>
        <Section><Item icon={<ShareIcon />}>Share</Item><Item icon={<PencilIcon />}>Rename</Item><Item icon={<Trash2Icon />} destructive>Delete</Item></Section>
      </Menu></div></Show>
    </div>
  </div>;
}
