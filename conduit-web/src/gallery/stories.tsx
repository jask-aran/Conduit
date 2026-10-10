
import { Composer } from "../client/chat/composer";
import { loadVoiceDictationSettings } from "../client/chat/voice-dictation.js";
import { fakeAttachments, fakeChat } from "./fake-chat";
import { seededModels, seededPlace, seededProfile } from "./seed";
import { ChatHeader, Conversation } from "../client/chat/chat-screen";
import { Transcript } from "../client/chat/transcript";
import { selectedMarkdownRenderer } from "../client/chat/markdown-settings";
import { createComposerSurfaceSignal } from "../client/chat/composer-surface";

/* The previews: the app's own chat screen over a seeded chat. */


/** The user's message, as transcript.tsx draws it. */
export function UserBubble(props: { text: string }) {
  const surface = createComposerSurfaceSignal();
  return <article data-slot="message" data-align="end" class="message-user">
    <div data-slot="message-content"><div data-slot="bubble" data-align="end" class="bubble bubble-user composer-surface-material" data-composer-surface={surface()}>
      <div data-slot="bubble-content"><span class="user-message-text">{props.text}</span></div>
    </div></div>
  </article>;
}

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
