import { createMemo, type Accessor } from "solid-js";
import { api } from "../api/client";
import type { BooleanCapability, ChatSummary, HarnessManifestView, Project, Template } from "../api/contracts";
import { manifestForChat, resolveCapability, resolveHistory } from "../chat-capabilities";
import { createActiveChat, type ChatCatalogue } from "./active-chat";
import { createAttachments } from "./attachments";
import type { DraftsStore } from "./drafts";
import { createModelSettings, notifyModelFallback } from "./model-settings";
import { createPermissionSettings } from "./permission-settings";
import type { RuntimeStore } from "./runtime";
import { createServiceLevelSettings } from "./service-level-settings";

/** One per pane that shows a chat; the drafts store is shared, keyed by chat. */
export function createChatSession(options: {
  catalogue: ChatCatalogue;
  selectedChat: Accessor<ChatSummary | null | undefined>;
  projects: Accessor<Project[]>;
  runtime: RuntimeStore;
  drafts: DraftsStore;
  maxAttachmentBytes: Accessor<number>;
  harnessCapabilities: Accessor<Record<string, HarnessManifestView>>;
  profiles: Accessor<Template[]>;
  defaultTemplateId: Accessor<string>;
  saveWorkspaceDefault: (workspaceId: string, templateId: string | null) => Promise<unknown>;
  onError: (error: unknown) => void;
  onThinkingLevelRecovered?: (details: { from: string; to: string }) => void;
  onModelRecovered?: (details: { from: string; to: string; reason?: string }) => void;
}) {
  const models = createModelSettings(options.onError, options.onThinkingLevelRecovered ?? (() => {}), notifyModelFallback);
  const permissions = createPermissionSettings(options.onError);
  const serviceLevels = createServiceLevelSettings(options.onError);
  const attachments = createAttachments(options.onError, options.maxAttachmentBytes);
  const chat = createActiveChat({
    catalogue: options.catalogue,
    runtime: options.runtime,
    models,
    permissions,
    serviceLevels,
    attachments,
    drafts: options.drafts,
    onError: options.onError,
    onModelRecovered: options.onModelRecovered ?? (() => {}),
    defaultTemplateId: options.defaultTemplateId,
    saveWorkspaceDefault: options.saveWorkspaceDefault,
  });
  const activeProfile = createMemo(() => options.profiles().find((item) => item.id === chat.templateId())
    || options.profiles().find((item) => item.id === options.defaultTemplateId()) || null);
  /**
   * Capability-gated UI asks `capability`, never the manifest or the reported capabilities alone: either one saying
   * no is enough, and reading just one let a control survive a chat switch.
   */
  // With no chat yet, as on the dashboard, the composer is the chosen profile's.
  const manifest = createMemo(() => manifestForChat(options.harnessCapabilities(), options.selectedChat())
    || (activeProfile() ? options.harnessCapabilities()[activeProfile()!.implementation || "conduit-runtime"] : null) || null);
  const capability = (name: BooleanCapability, fallback = false): boolean =>
    resolveCapability(manifest(), chat.capabilities(), name, fallback);
  const history = createMemo(() => resolveHistory(manifest(), chat.capabilities()));
  let attachInput: HTMLInputElement | undefined;
  const switchProfile = async (id: string) => {
    const chatId = chat.loadedId();
    if (!chatId) return;
    // Chosen for a new chat, it becomes the place's default for the next new chat there.
    const remember = chat.status() === "draft";
    const payload = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify({ profileId: id }),
    });
    const project = options.projects().find((item) => item.id === payload.projectId);
    if (!project) throw new Error("The selected profile returned a chat outside the current catalogue");
    // A profile changes the harness and every capability-scoped value, so the normal selection lifecycle runs
    // rather than a second list of stores to refresh.
    options.catalogue.patchChat(chatId, payload);
    if (remember && project.defaultTemplateId !== id) void options.saveWorkspaceDefault(project.id, id).catch(() => {});
    await chat.initialize(payload, project, undefined, { warm: true });
  };
  return {
    chat, models, permissions, serviceLevels, attachments,
    activeProfile, manifest, capability, history, switchProfile,
    setAttachInput: (element: HTMLInputElement) => { attachInput = element; },
    openAttachments: () => attachInput?.click(),
  };
}
export type ChatSession = ReturnType<typeof createChatSession>;
