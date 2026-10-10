import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import { CopyIcon, MessageSquarePlusIcon, EllipsisIcon, FolderPlusIcon, LayoutDashboardIcon, MicIcon, PanelLeftIcon, PanelRightIcon, PaperclipIcon, PlusIcon, QrCodeIcon, RefreshCwIcon, SearchIcon, ShareIcon, SquarePenIcon, TerminalIcon, ChevronDownIcon, CameraIcon, KeyboardIcon, ArrowUpIcon, Trash2Icon, PencilIcon, ShieldCheckIcon, CircleIcon } from "lucide-solid";
import { Bubble, Button, Frost, Item, Menu, NavGroup, NavRow, Pill, Section } from "@/components/ui";
import { projects } from "./sidebar-story";
import { SEED } from "./fake-chat";
import { TurnTrace } from "../client/chat/turn-trace";
import type { Message } from "../client/api/contracts";
import { ChatMarkdown } from "../client/chat/markdown";
import { selectedMarkdownRenderer } from "../client/chat/markdown-settings";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import { ChatTitle, Levels, ModelList, Profiles, Projects, SegmentedIcons, thinking } from "./library";
import { PROJECTS } from "./seed";

/**
 * The transcript over the same seed the live screens show (fake-chat.ts
 * SEED), in the app's own structure: bubbles and the action buttons from the
 * library; the turn's header (TurnTrace) and the answer's markdown are the
 * app's, which the library has no piece for yet.
 */
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function Time(props: { at: string }) { return <time class="response-time" dateTime={props.at}>{clock(props.at)}</time>; }

function SeededTranscript() {
  const turns: { user: Message; answer: Message }[] = [];
  for (let i = 0; i + 1 < SEED.length; i += 2) turns.push({ user: SEED[i]!, answer: SEED[i + 1]! });
  return <div class="transcript" data-part="transcript" data-slot="message-scroller" data-markdown-renderer={selectedMarkdownRenderer()}><div class="transcript-motion-shell">
    <div class="message-scroller-viewport" data-slot="message-scroller-viewport"><div class="thread" data-slot="message-scroller-content">
      <For each={turns}>{(turn) => <>
        <div data-slot="message-scroller-item"><article class="message-user" data-slot="message" data-align="end"><div data-slot="message-content">
          <Bubble>{String(turn.user.content)}</Bubble>
          <div class="response-actions"><Time at={turn.user.timestamp!} /><Button variant="ghost" size="icon-xs" aria-label="Edit from here"><PencilIcon /></Button></div>
        </div></article></div>
        <div data-slot="message-scroller-item"><TurnTrace trace={{ active: false, status: "complete", segments: [], startedAt: turn.user.timestamp, endedAt: turn.answer.timestamp }} writing sessionId="gallery" renderer={selectedMarkdownRenderer()} /></div>
        <div data-slot="message-scroller-item"><article class="message-assistant" data-slot="message" data-align="start"><div data-slot="message-content">
          <div class="bubble bubble-assistant" data-slot="bubble" data-align="start"><div data-slot="bubble-content"><ChatMarkdown renderer={selectedMarkdownRenderer()}>{String(turn.answer.content)}</ChatMarkdown></div></div>
          <div class="response-actions"><Time at={turn.answer.timestamp!} /><Button variant="ghost" size="icon-xs" aria-label="Copy Markdown"><CopyIcon /></Button><Button variant="ghost" size="icon-xs" aria-label="Regenerate response"><RefreshCwIcon /></Button></div>
        </div></article></div>
      </>}</For>
    </div></div>
  </div></div>;
}

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
  const toggle = (which: Popover) => setOpen(open() === which ? null : which);
  const plusPanel = () => open()?.startsWith("plus-");

  return <div class="g-live chat-main" data-region="chat" data-density="phone" onClick={() => setOpen(null)}>
    <header class="g-live-header">
      <Pill icons={[{ label: "Sidebar", icon: <PanelLeftIcon /> }, { label: "New chat", icon: <MessageSquarePlusIcon /> }]} />
      <Pill icons={[{ label: "Search", icon: <SearchIcon /> }, { label: "Palette", icon: <TerminalIcon /> }, { label: "More", icon: <EllipsisIcon /> }]} onPick={(label) => label === "More" && toggle("chat")} />
    </header>
    <div class="work-area"><section class="work-area-conversation" aria-label="Conversation"><SeededTranscript /><div class="composer-stack"><footer class="g-live-composer">
      <Pill icons={[{ label: "Attach and more", icon: <PlusIcon /> }]} solo onPick={() => toggle("plus")} />
      <Pill icons={[{ label: "Camera", icon: <CameraIcon /> }]} solo />
      <Pill icons={[{ label: "Keyboard", icon: <KeyboardIcon /> }]} solo />
      <div class="ui-frost g-live-mic"><MicIcon /></div>
</footer></div></section></div>

    <Show when={open() === "chat"}><Float at="top-right"><Menu class="g-live-menu g-live-chat-menu">
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

  </div>;
}

type DesktopPopover = "plus" | "model" | "chat" | null;

/**
 * The desktop chat screen in the app's structure (the inset chat-main, its
 * header, the conversation over the composer stack). From the library: the
 * composer's frost surface, the bubbles, the action buttons and every popover.
 * Still the app's markup, for want of a library piece: the header's title,
 * the composer's controls (+, context gauge, profile and model triggers, mic,
 * send) and the turn header.
 */
export function LiveDesktop() {
  const [open, setOpen] = createSignal<DesktopPopover>(null);
  const toggle = (which: DesktopPopover) => (event: MouseEvent) => { event.stopPropagation(); setOpen(open() === which ? null : which); };
  return <div class="g-desktop-screen g-live-desktop" data-density="desktop" onClick={() => setOpen(null)}>
    <main class="chat-main" data-slot="sidebar-inset" data-region="chat">
      <header class="chat-header">
        <nav class="chat-header-title" aria-label="breadcrumb"><span class="chat-header-place">Chats</span><strong>Lorem ipsum file</strong></nav>
        <div class="chat-header-actions"><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button></div>
      </header>
      <div class="work-area"><section class="work-area-conversation" aria-label="Conversation">
        <SeededTranscript />
        <div class="composer-stack"><div class="composer-wrap" data-part="composer"><div class="composer-surface-shell">
          <Frost class="composer g-live-composer-frost"><div class="composer-content">
            <div class="composer-input-shell"><textarea aria-label="Message the agent" placeholder="Send a message..." rows={1} /></div>
            <div class="composer-actions">
              <div class="composer-actions-left">
                <button type="button" class="composer-plus-trigger" aria-label="Attach and more" onClick={toggle("plus")}><PlusIcon /></button>
                <div class="composer-desktop-setting"><button type="button" class="chat-context-trigger" aria-label="Context usage: 0%"><svg class="chat-context-gauge" viewBox="0 0 24 24" aria-hidden="true"><circle class="chat-context-gauge-track" cx="12" cy="12" r="9" pathLength="100" /><circle class="chat-context-gauge-value" cx="12" cy="12" r="9" pathLength="100" style="stroke-dasharray: 0 100" /></svg></button></div>
                <div class="composer-desktop-setting"><button type="button" class="model-trigger composer-profile-trigger" aria-label="Profile Assistant"><HarnessMark id="conduit" class="size-4" /><ChevronDownIcon /></button></div>
                <div class="composer-desktop-setting"><button type="button" class="model-trigger" onClick={toggle("model")}><span>Meta: Muse Spark 1.3 Contributor</span><span class="text-muted-foreground">medium</span><ChevronDownIcon /></button></div>
              </div>
              <div class="composer-actions-right">
                <Button variant="ghost" size="icon-sm" aria-label="Start voice dictation"><MicIcon /></Button>
                <span class="composer-primary-slot"><Button variant="ghost" size="icon-sm" class="composer-send-trigger" aria-label="Send message"><ArrowUpIcon /></Button></span>
              </div>
            </div>
          </div></Frost>
        </div>
        <Show when={open() === "model"}><div class="g-live-anchor" data-at="model" onClick={(event) => event.stopPropagation()}><Menu class="g-live-desk-menu"><ModelList keys={["⌘", "⇧", "X"]} /><Section kind="slider"><Levels /></Section></Menu></div></Show>
        <Show when={open() === "plus"}><div class="g-live-anchor" data-at="plus" onClick={(event) => event.stopPropagation()}><Menu class="g-live-desk-menu">
          <Section><Item meta="Muse Spark 1.3" opens>Model</Item><Item icon={<HarnessMark id="conduit" class="size-4" />} meta="Assistant" opens>Profile</Item><Item icon={<ShieldCheckIcon />} meta="Default" opens>Permissions</Item></Section>
          <Section><Item icon={<PlaceGlyph project={null} />} meta="None" opens>Project</Item></Section>
          <Section><Item icon={<PaperclipIcon />}>Attach files</Item></Section>
        </Menu></div></Show>
        </div></div>
      </section></div>
    </main>
  </div>;
}

/** The phone sidebar, built from the library: the same screen as the app's (header pill, brand, server, area toggle; then nav rows). */
export function LivePhoneSidebar() {
  const list = projects();
  const chats = list.find((project) => project.slug === "chat")!;
  const folders = list.filter((project) => project.slug !== "chat" && project.kind === "project");
  let scroller!: HTMLElement;
  // As the app does: the current chat scrolled into view (block: nearest), within the list only.
  onMount(() => requestAnimationFrame(() => { const row = scroller.querySelector<HTMLElement>("[aria-current]"); if (!row) return;
    const bottom = row.offsetTop + row.offsetHeight - scroller.offsetTop; if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight; }));
  return <div class="g-live g-live-sb" data-density="phone" data-surface="frame">
    <header class="g-live-sb-head">
      <Pill icons={[{ label: "Toggle Sidebar", icon: <PanelLeftIcon /> }]} />
      <button type="button" class="g-live-brand"><span>Conduit</span></button>
      <div class="g-live-sb-server"><button type="button"><span><strong>localhost:5180</strong><small>Connected</small></span><span class="g-live-sb-dot"><i /></span></button></div>
      <SegmentedIcons pill />
    </header>
    <nav class="g-live-sb-list" ref={scroller}>
      <NavGroup><NavRow icon={<LayoutDashboardIcon />}>Conduit Dashboard</NavRow><NavRow icon={<SquarePenIcon />}>New chat</NavRow><NavRow icon={<FolderPlusIcon />}>New project</NavRow></NavGroup>
      <NavGroup label="Projects"><For each={folders}>{(project) => <div>
        <NavRow icon={<PlaceGlyph project={project} />} toggle={<ChevronDownIcon />}>{project.name}</NavRow>
        <For each={project.sessions}>{(chat) => <NavRow indent icon={<HarnessMark id="conduit" />}>{chat.title}</NavRow>}</For>
      </div>}</For></NavGroup>
      <NavGroup label="Chats"><For each={chats.sessions}>{(chat, index) => <NavRow current={index() === 0} icon={<HarnessMark id="conduit" />}>{chat.title}</NavRow>}</For></NavGroup>
    </nav>
  </div>;
}
