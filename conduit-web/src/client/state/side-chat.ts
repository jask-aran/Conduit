import { createSignal, type Accessor } from "solid-js";
import type { ChatSummary, Project } from "../api/contracts";
import { createActiveChat, type ChatCatalogue } from "./active-chat";
import { createAttachments } from "./attachments";
import type { DraftsStore } from "./drafts";
import { createModelSettings, notifyModelFallback } from "./model-settings";
import { createPermissionSettings } from "./permission-settings";
import type { RuntimeStore } from "./runtime";
import { createServiceLevelSettings } from "./service-level-settings";

/**
 * The chat open beside the main one, in the main pane's split
 * (docs/design/panes-and-rail.md, stage 4).
 *
 * It is a whole second chat on the same `createActiveChat`: its own
 * transcript, stream, composer, model, attachments and permissions, and the
 * drafts store the main chat uses, which is keyed by chat. What it does not
 * have is the URL or the catalogue's selection -- the left side owns both --
 * so its catalogue is a slice of the real one with a selection of its own.
 */
export function createSideChat(options: {
  runtime: RuntimeStore;
  projects: Accessor<Project[]>;
  refresh: () => Promise<Project[]>;
  patchChat: (chatId: string, patch: Partial<ChatSummary>) => unknown;
  drafts: DraftsStore;
  maxAttachmentBytes: Accessor<number>;
  onError: (error: unknown) => void;
  defaultTemplateId: Accessor<string>;
  saveWorkspaceDefault: (workspaceId: string, templateId: string | null) => Promise<unknown>;
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [projectId, setProjectId] = createSignal("");
  const models = createModelSettings(options.onError, () => {}, notifyModelFallback);
  const permissions = createPermissionSettings(options.onError);
  const serviceLevels = createServiceLevelSettings(options.onError);
  const attachments = createAttachments(options.onError, options.maxAttachmentBytes);
  const catalogue: ChatCatalogue = {
    selectedId,
    projectId,
    select: (chat, project) => { setSelectedId(chat.id); setProjectId(project.id); },
    refresh: options.refresh,
    patchChat: options.patchChat,
  };
  const chat = createActiveChat({
    catalogue,
    runtime: options.runtime,
    models,
    permissions,
    serviceLevels,
    attachments,
    drafts: options.drafts,
    onError: options.onError,
    onModelRecovered: () => {},
    defaultTemplateId: options.defaultTemplateId,
    saveWorkspaceDefault: options.saveWorkspaceDefault,
  });
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
  return {
    chat, models, permissions, serviceLevels, attachments, selectedId, selected,
    open: (target: ChatSummary, project: Project) => chat.select(target, project, { history: "none" }),
    close: () => {
      chat.reset();
      setSelectedId(null);
      setProjectId("");
    },
  };
}
export type SideChat = ReturnType<typeof createSideChat>;
