import { createSignal, For, type JSX } from "solid-js";
import { Composer } from "../client/chat/composer";
import { loadVoiceDictationSettings } from "../client/chat/voice-dictation.js";
import { fakeAttachments, fakeChat } from "./fake-chat";
import { seededModels, seededPlace, seededProfile } from "./seed";
import { ChatHeader, Conversation } from "../client/chat/chat-screen";
import { Transcript } from "../client/chat/transcript";
import { selectedMarkdownRenderer } from "../client/chat/markdown-settings";
import { Button, Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, PopoverSearchList } from "@/components/primitives";
import { StepSlider } from "../client/chat/step-slider";
import { createComposerSurfaceSignal } from "../client/chat/composer-surface";

/*
 * The frosted family: one material, and what is built from it. Desktop pieces
 * render on the canvas; the phone pieces render in one frame that passes for
 * a phone, because their styles only apply on one.
 */

export interface Entry { id: string; name: string; render: () => JSX.Element }


/** A menu held open, anchored where it is drawn: the real Menu, so its rows hover and choose. */
function OpenMenu() {
  return <Menu open modal={false} placement="bottom-start" gutter={6}>
    <MenuTrigger as={Button} variant="outline">Menu</MenuTrigger>
    <MenuContent>
      <MenuGroup><MenuLabel>Servers</MenuLabel><MenuItem closeOnSelect={false}>Desktop-Dev</MenuItem><MenuItem closeOnSelect={false}>Laptop</MenuItem></MenuGroup>
      <MenuSeparator />
      <MenuSub><MenuSubTrigger>Route</MenuSubTrigger><MenuSubContent><MenuItem closeOnSelect={false}>Automatic</MenuItem><MenuItem closeOnSelect={false}>Local network</MenuItem><MenuItem closeOnSelect={false}>Internet</MenuItem></MenuSubContent></MenuSub>
      <MenuItem closeOnSelect={false}>Manage settings</MenuItem>
    </MenuContent>
  </Menu>;
}

/** A popover's panel drawn in place: the same slot and material, without the floating, which flips off-canvas. */
const Panel = (props: { label: string; children: JSX.Element }) =>
  <div data-slot="popover-content" role="dialog" aria-label={props.label} class="g-panel-inline">{props.children}</div>;

function OpenSearchList() {
  const models = ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Fable 5.1", "Muse Spark 1.3"];
  const [current, setCurrent] = createSignal(models[0]!);
  return <Panel label="Models">
      <PopoverSearchList items={models} placeholder="Search models" matches={(item, needle) => item.toLowerCase().includes(needle)} isCurrent={(item) => item === current()} onChoose={setCurrent}>{(item) => <span>{item}</span>}</PopoverSearchList>
  </Panel>;
}

function OpenSlider() {
  const options = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "max", label: "Max" }];
  const [value, setValue] = createSignal("medium");
  return <Panel label="Effort"><div style={{ width: "220px", padding: "4px 6px" }}><StepSlider label="Effort" options={options} value={value()} onChange={setValue} /></div></Panel>;
}

/** The user's message, as transcript.tsx draws it. */
export function UserBubble(props: { text: string }) {
  const surface = createComposerSurfaceSignal();
  return <article data-slot="message" data-align="end" class="message-user">
    <div data-slot="message-content"><div data-slot="bubble" data-align="end" class="bubble bubble-user composer-surface-material" data-composer-surface={surface()}>
      <div data-slot="bubble-content"><span class="user-message-text">{props.text}</span></div>
    </div></div>
  </article>;
}

export const pieces: Entry[] = [
  { id: "material", name: "Frost material", render: () => <div class="g-swatch composer-surface-material" data-composer-surface="frosted-live" /> },
  { id: "bubble", name: "User message", render: () => <div style={{ width: "360px" }}><UserBubble text="write a .txt file in this folder that contains lorem ipsum text" /></div> },
  { id: "menu", name: "Menu · submenu", render: () => <div class="g-menu-slot"><OpenMenu /></div> },
  { id: "search", name: "Popover · search", render: () => <OpenSearchList /> },
  { id: "slider", name: "Popover · slider", render: () => <OpenSlider /> },
  { id: "card", name: "Overlay card", render: () => <div class="frost-card g-card-demo"><strong>Delete this chat?</strong><div class="g-row"><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></div></div> },
];

/** A chat screen of the app's own header, transcript and composer over a seeded chat, not wired to a server. */
export function ChatScreen() {
  const chat = fakeChat();
  const models = seededModels();
  const place = seededPlace();
  const profile = seededProfile();
  return <main data-slot="sidebar-inset" data-region="chat" class="chat-main">
    <ChatHeader title="Lorem ipsum file" chat={chat} profile={profile.active()} panelOpen={false} mobileSidebarOpen={false} connectivity="online"
      onToggleMobileSidebar={() => {}} onNewChat={() => {}} onOpenPalette={() => {}} onOpenSearch={() => {}} onTogglePanel={() => {}} onShare={() => {}} onUpdatePwa={() => {}} pwaUpdating={() => false} />
    <Conversation chat={chat}
      transcript={<Transcript chat={chat} supports={() => true} partialContinue={false} markdownRenderer={selectedMarkdownRenderer()} profileLabel={profile.active().label} />}
      composer={<Composer chat={chat} attachments={fakeAttachments()} models={models} profiles={profile.profiles} activeProfile={profile.active()} place={place} serverOnline voiceSettings={loadVoiceDictationSettings()}
        onChooseProfile={profile.choose} onOpenSettings={() => {}} onOpenAttachments={() => {}} />} />
  </main>;
}
