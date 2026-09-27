import { createMemo, createSignal, type Accessor } from "solid-js";
import { api } from "../api/client";
import type { BooleanCapability, ChatSummary, HarnessManifestView, Project, Template } from "../api/contracts";
import { manifestForChat, resolveCapability, resolveHistory } from "../chat-capabilities";
import type { ComposerStatus } from "../chat/composer";
import { createActiveChat, type ChatCatalogue } from "./active-chat";
import { createAttachments } from "./attachments";
import type { DraftsStore } from "./drafts";
import { createModelSettings, notifyModelFallback } from "./model-settings";
import { createPermissionSettings } from "./permission-settings";
import type { RuntimeStore } from "./runtime";
import { createServiceLevelSettings } from "./service-level-settings";

/**
 * One chat's worth of state: the `createActiveChat` store and every store it
 * drives (models, permissions, service levels, attachments), what the chat
 * can do (its harness manifest and reported capabilities), its profile and
 * switching it, and its composer's status and file input.
 *
 * Each pane that shows a chat has one (docs/design/panes-and-rail.md, stage
 * 5). The drafts store is shared: it is keyed by chat.
 */
export function createChatSession(options: {
  catalogue: ChatCatalogue;
  /** The open chat as the catalogue lists it, for its harness manifest. */
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
  onModelRecovered?: (details: { from: string; to: string }) => void;
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
   * Whether a capability is on for this chat.
   *
   * Two sources describe a session: the harness manifest carried by its
   * profile, which says what this harness can ever do, and the capabilities the
   * chat itself reported, which arrive with a live record and refine it. Either
   * one saying no is enough. Reading them separately is what let a control
   * survive a chat switch -- a signal belonging to the session before this one
   * is still a signal, and it lit up a control the new session could not
   * honour. Capability-gated UI asks here rather than reaching for either
   * source, so there is one place to be right as more of it appears.
   */
  // With no chat yet, as on the dashboard, the composer is the chosen profile's.
  const manifest = createMemo(() => manifestForChat(options.harnessCapabilities(), options.selectedChat())
    || (activeProfile() ? options.harnessCapabilities()[activeProfile()!.implementation || "conduit_pi"] : null) || null);
  const capability = (name: BooleanCapability, fallback = false): boolean =>
    resolveCapability(manifest(), chat.capabilities(), name, fallback);
  const history = createMemo(() => resolveHistory(manifest(), chat.capabilities()));
  const [composerStatus, setComposerStatus] = createSignal<ComposerStatus | null>(null);
  let attachInput: HTMLInputElement | undefined;
  const switchProfile = async (id: string) => {
    const chatId = chat.loadedId();
    if (!chatId) return;
    const payload = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify({ profileId: id }),
    });
    const project = options.projects().find((item) => item.id === payload.projectId);
    if (!project) throw new Error("The selected profile returned a chat outside the current catalogue");
    // A profile changes the harness and every capability-scoped value below
    // it. Re-enter the normal selection lifecycle instead of maintaining a
    // second, incomplete list of stores to refresh here.
    options.catalogue.patchChat(chatId, payload);
    await chat.initialize(payload, project, undefined, { warm: true });
  };
  return {
    chat, models, permissions, serviceLevels, attachments,
    activeProfile, manifest, capability, history, switchProfile,
    composerStatus, setComposerStatus,
    /** The composer's hidden file input, which its attach button opens. */
    setAttachInput: (element: HTMLInputElement) => { attachInput = element; },
    openAttachments: () => attachInput?.click(),
  };
}
export type ChatSession = ReturnType<typeof createChatSession>;
