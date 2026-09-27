import { createSignal, type Accessor } from "solid-js";
import type { ChatSummary, HarnessManifestView, Project, Template } from "../api/contracts";
import type { ChatCatalogue } from "./active-chat";
import { createChatSession } from "./chat-session";
import type { DraftsStore } from "./drafts";
import type { RuntimeStore } from "./runtime";

/**
 * The chat open beside the main one, in the main pane's split
 * (docs/design/panes-and-rail.md, stage 4).
 *
 * A chat session of its own -- transcript, stream, composer, model,
 * attachments and permissions -- on the drafts store the main chat uses,
 * which is keyed by chat. What it does not have is the URL or the
 * catalogue's selection -- the left side owns both -- so its catalogue is a
 * slice of the real one with a selection of its own.
 */
export function createSideChat(options: {
  runtime: RuntimeStore;
  projects: Accessor<Project[]>;
  refresh: () => Promise<Project[]>;
  patchChat: (chatId: string, patch: Partial<ChatSummary>) => unknown;
  drafts: DraftsStore;
  maxAttachmentBytes: Accessor<number>;
  harnessCapabilities: Accessor<Record<string, HarnessManifestView>>;
  profiles: Accessor<Template[]>;
  onError: (error: unknown) => void;
  defaultTemplateId: Accessor<string>;
  saveWorkspaceDefault: (workspaceId: string, templateId: string | null) => Promise<unknown>;
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [projectId, setProjectId] = createSignal("");
  const catalogue: ChatCatalogue = {
    selectedId,
    projectId,
    select: (chat, project) => { setSelectedId(chat.id); setProjectId(project.id); },
    refresh: options.refresh,
    patchChat: options.patchChat,
  };
  /** The open chat as the catalogue lists it, with its place. */
  const selected = () => {
    const id = selectedId();
    if (!id) return null;
    for (const project of options.projects()) {
      const found = project.sessions.find((item) => item.id === id);
      if (found) return { chat: found, project };
    }
    return null;
  };
  const session = createChatSession({
    catalogue,
    selectedChat: () => selected()?.chat,
    projects: options.projects,
    runtime: options.runtime,
    drafts: options.drafts,
    maxAttachmentBytes: options.maxAttachmentBytes,
    harnessCapabilities: options.harnessCapabilities,
    profiles: options.profiles,
    defaultTemplateId: options.defaultTemplateId,
    saveWorkspaceDefault: options.saveWorkspaceDefault,
    onError: options.onError,
  });
  return {
    ...session, selectedId, selected,
    open: (target: ChatSummary, project: Project) => session.chat.select(target, project, { history: "none" }),
    close: () => {
      session.chat.reset();
      setSelectedId(null);
      setProjectId("");
    },
  };
}
export type SideChat = ReturnType<typeof createSideChat>;
