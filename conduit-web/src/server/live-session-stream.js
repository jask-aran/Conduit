import { CONTINUE_PROMPT } from "../continuation.js";
import { messagesFromEntries } from "../session-store.js";
import { chatView } from "../chat-store.js";
import { serializeAttachmentEnvelope } from "../attachment-envelope.js";
import { ChatBackendRegistry } from "../pi-rpc-adapter.js";

export function createLiveSessionStream({
  manager,
  wss,
  attachments,
  registry,
  config,
  findChatContext,
  findRegisteredSession,
  chatModelView,
  backends = new ChatBackendRegistry(manager),
  autoNameSession = async () => {},
}) {
  const namingChats = new Set();

  function adapterFor(record) {
    return backends.forChat(registry.metadata(record.chatId));
  }

  async function promptForChat(record, command, message) {
    const context = await findChatContext(record.chatId);
    if (!context) throw new Error("Chat no longer exists");
    const selectedAttachments = await attachments.resolveMany(context.project, context.chat.id, command.attachmentIds);
    const prompt = serializeAttachmentEnvelope({ chatId: context.chat.id, attachments: selectedAttachments, message });
    return { context, prompt, message };
  }

  async function sendPrompt(record, prepared, options) {
    const needsName = !prepared.context.chat.title && !namingChats.has(prepared.context.chat.id);
    const adapter = adapterFor(record);
    const generationId = await adapter.prompt(record.id, prepared.prompt, options);
    await registry.markUserMessage(prepared.context.chat.id);
    if (prepared.context.chat.status === "draft") {
      await registry.update(prepared.context.chat.id, record.adapterImplementation === "codex"
        ? { status: "active", backend: { ...prepared.context.chat.backend, opaqueSession: record.sessionId } }
        : { status: "active", piSessionId: record.sessionId || null, piSessionFile: record.sessionFile });
    }
    if (needsName) {
      namingChats.add(prepared.context.chat.id);
      void autoNameSession(record, prepared.context, prepared.message).catch((error) => {
        console.warn("Could not name chat automatically", error.message);
      }).finally(() => namingChats.delete(prepared.context.chat.id));
    }
    return generationId;
  }

  async function applyComposerModel(record, command) {
    const model = String(command.model || "").trim();
    const thinkingLevel = String(command.thinkingLevel || "").trim();
    if (!model && !thinkingLevel) return;
    const context = await findChatContext(record.chatId);
    if (!context) throw new Error("Chat no longer exists");
    const current = await chatModelView(context);
    if (model && !current.models.some((item) => item.spec === model)) {
      throw Object.assign(new Error("Selected model is unavailable for this chat"), { code: "invalid_model" });
    }
    const adapter = adapterFor(record);
    if (model && model !== current.model) await adapter.setModel(record.id, model);
    if (thinkingLevel && thinkingLevel !== current.thinkingLevel) await adapter.setThinkingLevel(record.id, thinkingLevel);
  }

  async function syncForkedChat(record) {
    const context = await findChatContext(record.chatId);
    if (!context) throw new Error("Chat no longer exists");
    await registry.update(context.chat.id, {
      piSessionId: record.sessionId || context.chat.piSessionId,
      piSessionFile: record.sessionFile,
    });
    manager.publish(record, { type: "history_forked", chat: chatView(registry.metadata(context.chat.id)) });
    return registry.metadata(context.chat.id);
  }

  async function handleClientCommand(record, command) {
    const adapter = adapterFor(record);
    if (command.type === "prompt") {
      const prepared = await promptForChat(record, command, String(command.message || ""));
      const streamingBehavior = command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
        ? command.streamingBehavior
        : null;
      return sendPrompt(record, prepared, { streamingBehavior });
    }
    if (command.type === "follow_up" || command.type === "steer") {
      const prepared = await promptForChat(record, command, String(command.message || ""));
      await adapter.queue(record.id, command.type, prepared.prompt);
      return null;
    }
    if (command.type === "stop_generation" || command.type === "abort") {
      return adapter.cancel(record.id, command.generationId || null);
    }
    if (command.type === "fork_and_prompt") {
      await adapter.fork(record.id, command.entryId);
      await syncForkedChat(record);
      await applyComposerModel(record, command);
      const prepared = await promptForChat(record, command, String(command.message || ""));
      return sendPrompt(record, prepared);
    }
    if (command.type === "regenerate") {
      const forked = await adapter.fork(record.id, command.entryId);
      await syncForkedChat(record);
      await applyComposerModel(record, command);
      return adapter.prompt(record.id, forked.text);
    }
    if (command.type === "continue") {
      if (!config.enablePartialContinue) throw Object.assign(new Error("Partial continuation is disabled"), { code: "partial_continue_disabled" });
      const persisted = await findRegisteredSession(record.chatId);
      const previous = persisted ? messagesFromEntries(persisted.entries).findLast((message) => message.role === "assistant") : null;
      const partial = previous?.content || record.generation?.partial || "";
      if (!partial || (!previous?.stopped && !record.generation?.closed)) throw new Error("There is no stopped response to continue");
      return adapter.prompt(record.id, CONTINUE_PROMPT, { continuationBase: partial });
    }
    if (command.type === "extension_ui_response" || command.type === "host_ui_response") {
      adapter.respondHostUi(record.id, command);
      return null;
    }
    if (command.type === "refresh_context") return adapter.refreshContext(record.id);
    adapter.sendPi(record.id, command);
    return null;
  }

  const handleUpgrade = (id, request, socket, head) => wss.handleUpgrade(request, socket, head, (ws) => {
    const record = backends.get(id);
    const adapter = adapterFor(record);
    const generationResume = adapter.attach(id, ws);
    if (generationResume) ws.send(JSON.stringify(generationResume));
    if (record.status === "running" && !record.contextUsage?.contextWindow) adapter.refreshContext(record.id).catch(() => {});
    ws.send(JSON.stringify(adapter.toClientEvent({
      type: "runtime_state",
      session: adapter.view(record),
      hostUiRequests: record.hostUiRequests || [],
      queue: record.queue || { steering: [], followUp: [] },
      contextUsage: record.contextUsage || null,
      sessionStats: record.sessionStats || null,
      cacheStats: record.cacheStats || null,
    })));
    if (record.lastCheckpoint) ws.send(JSON.stringify(adapter.toClientEvent(record.lastCheckpoint)));
    ws.on("message", (data) => {
      Promise.resolve()
        .then(() => handleClientCommand(record, JSON.parse(String(data))))
        .catch((error) => ws.send(JSON.stringify(adapter.toClientEvent({ type: "client_error", code: error.code, message: error.message }))));
    });
  });

  return { handleUpgrade };
}
