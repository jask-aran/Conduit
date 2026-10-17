import { createSignal, onMount, Show } from "solid-js";
import { api } from "../client/api/client";
import type { ChatSummary, Project, TranscriptDetail } from "../client/api/contracts";
import { createCatalogueStore } from "../client/state/catalogue";
import { createChatSession } from "../client/state/chat-session";
import { createDrafts } from "../client/state/drafts";
import { createRuntimeStore } from "../client/state/runtime";
import { ChatScreen } from "./stories";
import { isIncremarkRenderer, selectedMarkdownRenderer } from "../client/chat/markdown-settings";

/*
 * The phone preview on a real chat: the app's own chat store, socket and all, against the server the gallery
 * proxies to (vite.config.js, preview), so a turn streams into the library's pieces exactly as into the app's.
 * gallery.html?frame=live&chat=<id>, opened from 127.0.0.1 so the server's sign-in cookie comes with it.
 */
export function LiveChatScreen(props: { chatId: string }) {
  // The renderer loaded at once, as the app does opening a chat (main.tsx), so a first line is not drawn while it loads.
  void import("../client/chat/markdown").catch(() => {});
  void (isIncremarkRenderer(selectedMarkdownRenderer()) ? import("../client/chat/incremark-markdown") : import("../client/chat/marked-markdown")).catch(() => {});
  const catalogue = createCatalogueStore();
  const session = createChatSession({
    catalogue, selectedChat: () => catalogue.selected()?.chat, projects: catalogue.projects, runtime: createRuntimeStore(), drafts: createDrafts(console.error),
    maxAttachmentBytes: () => 25_000_000, harnessCapabilities: () => ({}), profiles: () => [], defaultTemplateId: () => "assistant",
    saveWorkspaceDefault: async () => undefined, onError: console.error,
  });
  const [ready, setReady] = createSignal(false);
  onMount(async () => {
    const projects: Project[] = await catalogue.refresh();
    const summary = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(props.chatId)}`);
    const detail = await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(props.chatId)}`);
    const project = projects.find((item) => item.id === summary.projectId)!;
    catalogue.select(summary, project);
    await session.chat.initialize(summary, project, detail);
    setReady(true);
  });
  return <Show when={ready()} fallback={<p class="g-muted">Opening the chat…</p>}><ChatScreen chat={session.chat as never} /></Show>;
}
