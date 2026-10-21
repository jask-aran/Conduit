
import { Composer } from "../client/chat/composer";
import { loadVoiceDictationSettings } from "../client/chat/voice-dictation.js";
import { fakeAttachments, fakeChat } from "./fake-chat";
import { seededModels, seededProfile } from "./seed";
import { ChatHeader, Conversation } from "../client/chat/chat-screen";
import { Transcript } from "../client/chat/transcript";
import { selectedMarkdownRenderer } from "../client/chat/markdown-settings";

/* The previews: the app's own chat screen over a seeded chat. */


/** A chat screen of the app's own header, transcript and composer over a seeded chat, not wired to a server. */
/** chat: a real one (live-chat.ts) in place of the seeded chat; the pickers stay seeded. */
export function ChatScreen(props: { chat?: ReturnType<typeof fakeChat> } = {}) {
  const chat = props.chat ?? fakeChat();
  const models = seededModels();
  const profile = seededProfile();
  const attachments = fakeAttachments();
  return <main data-slot="sidebar-inset" data-region="chat" class="chat-main">
    <ChatHeader title="Lorem ipsum file" chat={chat} profile={profile.active()} panelOpen={false} mobileSidebarOpen={false}
      onToggleMobileSidebar={() => {}} onNewChat={() => {}} onOpenPalette={() => {}} onOpenSearch={() => {}} onTogglePanel={() => {}} onShare={() => {}} />
    <Conversation chat={chat}
      transcript={<Transcript chat={chat} supports={() => true} markdownRenderer={selectedMarkdownRenderer()} profileLabel={profile.active().label} />}
      composer={<Composer chat={chat} attachments={attachments} models={models} profiles={profile.profiles} activeProfile={profile.active()} serverOnline voiceSettings={loadVoiceDictationSettings()}
        onChooseProfile={profile.choose} onOpenSettings={() => {}} onOpenAttachments={() => {}} />} />
  </main>;
}
