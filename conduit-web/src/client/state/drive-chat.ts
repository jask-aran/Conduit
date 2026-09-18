import { createSignal } from "solid-js";
import { api } from "../api/client";
import type { ChatSummary, LiveRecord, ModelOption, ModelState, TranscriptDetail } from "../api/contracts";
import type { RuntimeStore } from "./runtime";
import { createActiveChat, HARNESS_OWNED_MODELS, NO_CHAT_ATTACHMENTS, type ChatCatalogue } from "./active-chat";

/**
 * A chat store for an ephemeral harness thread.
 *
 * Driving a Codex thread from the Computer is the same streaming problem as a
 * Conduit chat - the same live-session socket, the same events - so it runs on
 * the same `createActiveChat` rather than a second, poorer transcript. What it
 * lacks is a Conduit chat: the thread is deliberately not in the registry until
 * somebody tracks it. These stubs stand in for the catalogue so the store's
 * "is this still the selected chat?" guards resolve, and every path that would
 * mutate the registry does nothing.
 */
export function createDriveChat(options: {
  runtime: RuntimeStore;
  onError: (error: unknown) => void;
}) {
  const [chatId, setChatId] = createSignal("");
  const [liveId, setLiveId] = createSignal("");
  const [modelOptions, setModelOptions] = createSignal<ModelOption[]>([]);
  const [model, setModel] = createSignal("");
  const [effort, setEffort] = createSignal("");
  const [notice, setNotice] = createSignal("");

  // The harness owns the catalogue and the selection, both keyed to the live
  // record. Nothing here touches a chat, because there isn't one.
  const patchModel = async (body: { model?: string; thinkingLevel?: string }) => {
    const id = liveId();
    if (!id) return false;
    const previous = { model: model(), thinkingLevel: effort() };
    try {
      const payload = await api<ModelState>(`/v0/live-sessions/${encodeURIComponent(id)}/models`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      setModel(payload.model || previous.model);
      setEffort(payload.thinkingLevel || previous.thinkingLevel);
      return true;
    } catch (error) { options.onError(error); return false; }
  };

  const models = {
    models: modelOptions,
    model,
    effort,
    notice,
    chooseModel: (spec: string) => patchModel({ model: spec }),
    chooseEffort: (level: string) => patchModel({ model: model(), thinkingLevel: level }),
  };

  /** The thread's settled history, which the harness holds rather than Conduit. */
  const loadTranscript = async (id: string) => {
    try { return await api<TranscriptDetail>(`/v0/live-sessions/${encodeURIComponent(id)}/transcript`); }
    catch { return undefined; }
  };

  const loadModels = async (id: string) => {
    try {
      const payload = await api<ModelState>(`/v0/live-sessions/${encodeURIComponent(id)}/models`);
      setModelOptions(payload.models || []);
      setModel(payload.model || "");
      setEffort(payload.thinkingLevel || "");
      setNotice("");
    } catch { setNotice("Model catalogue is unavailable for this thread"); }
  };
  // The thread is deliberately not in the registry until somebody tracks it, so
  // the store's "is this still the open chat?" guards answer from here instead.
  const catalogue: ChatCatalogue = {
    selectedId: chatId,
    projectId: () => "",
    refresh: async () => [],
    select: () => {},
    patchChat: () => {},
  };

  const chat = createActiveChat({
    catalogue,
    runtime: options.runtime,
    // An ephemeral thread carries the harness's own model and has no Conduit
    // model settings or attachment pipeline behind it. These are the real
    // no-op implementations of the slices the store uses, not casts: a cast
    // here is how a missing method reached a surface and took it down.
    models: HARNESS_OWNED_MODELS,
    attachments: NO_CHAT_ATTACHMENTS,
    onError: options.onError,
    onModelRecovered: () => {},
    defaultTemplateId: () => "",
    saveWorkspaceDefault: async () => undefined,
  });

  /** Point the store at a live record the harness drive endpoint just opened. */
  const attach = async (record: LiveRecord & { nativeSessionId?: string }, title: string) => {
    chat.reset();
    setChatId(record.chatId || record.id);
    setLiveId(record.id);
    chat.setTitle(title);
    await chat.ensureAgent({ record, detail: await loadTranscript(record.id) });
    void loadModels(record.id);
  };

  const detach = () => {
    chat.reset();
    setChatId("");
    setLiveId("");
    setModelOptions([]);
    setModel("");
    setEffort("");
  };

  return { chat, models, attach, detach, chatId };
}

export type DriveChatStore = ReturnType<typeof createDriveChat>;
export type { ChatSummary };
