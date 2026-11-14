import crypto from "node:crypto";
import { messageDrop } from "../harnesses/transcript-ops.js";
import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { manifestForImplementation } from "../harnesses/index.js";
import { startWebSocketKeepalive } from "./ws-keepalive.js";
import { ServerConcurrency } from "./effect-concurrency.js";
import { liveCommandIs } from "../live-session-api.js";
import { hostsOf } from "../harnesses/host-requests.js";

/** Only Conduit's own shape, so a client cannot reuse an existing message id or one derived from a session entry. */
const CLIENT_MESSAGE_ID = /^m_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const offeredMessageId = (value) => (typeof value === "string" && CLIENT_MESSAGE_ID.test(value) ? value : null);

const UNDRIVEN_THREAD_GRACE_MS = 15_000;

export function interruptedPromptInput(taken, message, attachmentIds = []) {
  const queued = [...(taken?.steering || []), ...(taken?.followUp || [])]
    .map((item) => parseAttachmentEnvelope(typeof item === "string" ? item : item?.message || ""));
  return {
    message: [...queued.map((item) => item.message), String(message || "")]
      .map((item) => item.trim()).filter(Boolean).join("\n"),
    attachmentIds: [...new Set([
      ...queued.flatMap((item) => item.attachments.map((attachment) => attachment.id)),
      ...[...(taken?.steering || []), ...(taken?.followUp || [])]
        .flatMap((item) => item?.attachmentIds || item?.attachments?.map((attachment) => attachment.id) || []),
      ...(Array.isArray(attachmentIds) ? attachmentIds : []),
    ])],
  };
}

/** Events arrive already in the contract's words (the adapter translated them), so nothing is translated here. */
function sendClientEvent(ws, event) {
  if (!event || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(event));
  return true;
}

export function createLiveSessionStream({
  wss,
  attachments,
  registry,
  turnCheckpoints,
  // Null where the project's place takes no checkpoints.
  checkpointWorkspace = async (project) => project.workingRoot,
  findChatContext,
  chatModelView,
  chatLogs,
  backends,
  concurrency = new ServerConcurrency(),
  maxGeneratingProcesses = () => 0,
  lifecycle,
  autoNameSession = async () => {},
  sentFrom = () => {},
}) {
  if (!lifecycle) throw new TypeError("Live session stream requires a chat lifecycle");
  if (!backends) throw new TypeError("Live session stream requires a backend registry");
  const namingChats = new Set();

  const startGeneration = (record, work, { reuseSlot = false } = {}) =>
    concurrency.runGenerationStart(() => {
      const max = Math.trunc(Number(maxGeneratingProcesses()) || 0);
      if (!reuseSlot && max > 0) {
        const generating = backends.generatingRecords();
        if (!generating.includes(record) && generating.length >= max) {
          throw Object.assign(
            new Error(`Too many concurrent generations (max ${max}). Wait for another chat to finish.`),
            { code: "generation_limit", status: 429, maxGeneratingProcesses: max, generatingCount: generating.length },
          );
        }
      }
      return work();
    });

  const logFor = (record) => (record?.chatId && !record.ephemeral
    ? chatLogs?.get(record.chatId) || null : null);

  function adapterFor(record) {
    if (record.ephemeral) return backends.adapterForRecord(record);
    return backends.forChat(registry.metadata(record.chatId));
  }

  async function promptForChat(record, command, message) {
    const context = await findChatContext(record.chatId);
    if (!context) throw new Error("Chat no longer exists");
    const selectedAttachments = await attachments.resolveMany(context.project, context.chat.id, command.attachmentIds);
    const prompt = message;
    const files = selectedAttachments.map((item) => ({
      ...item, path: attachments.pathFor(context.project, context.chat.id, item),
    }));
    return { context, prompt, message, attachments: files };
  }

  // `resume_log` has already sent `log_reset`, so a snapshot must follow: the last attempt publishes even if the
  // log moved, rather than leave the client with a reset and nothing to fold.
  const SNAPSHOT_TURNS = 10;
  const SNAPSHOT_ATTEMPTS = 3;

  async function publishSnapshot(record) {
    const adapter = adapterFor(record);
    if (record.ephemeral) return;
    try {
      for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
        const log = logFor(record);
        const logSeq = log?.state().seq;
        const context = await findChatContext(record.chatId);
        if (!context) return;
        const projection = await adapter.readTranscript({
          liveSessionId: record.id, chatId: record.chatId, project: context.project, turns: SNAPSHOT_TURNS,
        });
        projection.messages ||= [];
        projection.tools ||= [];
        projection.messages = await attachments.decorateMessages(context.project, context.chat.id, projection.messages, { fromStart: false });
        if (log && log.state().seq !== logSeq && attempt < SNAPSHOT_ATTEMPTS - 1) continue;
        adapter.publish(record, { type: "transcript_sync", generationId: null, replace: true, ...projection });
        return;
      }
    } catch (error) {
      console.warn("Could not sync transcript", error.message);
    }
  }

  async function sendPrompt(record, prepared, options) {
    const { sourceCheckpointId = null, messageId = null, markup = null, ...promptOptions } = options || {};
    const namingOwner = manifestForImplementation(record.adapterImplementation)?.nameGeneration;
    // A headless run is in no list, and naming costs a model call.
    const run = prepared.context.chat.run;
    const needsName = namingOwner === "conduit" && !prepared.context.chat.title
      && !namingChats.has(prepared.context.chat.id) && (!run || run.autoName === true);
    const adapter = adapterFor(record);
    if (prepared.attachments.length && !adapter.getCapabilities().attachments) {
      throw Object.assign(new Error("This agent does not support attachments"), { code: "attachments_unsupported", status: 400 });
    }
    let checkpoint = null;
    try {
      const at = await checkpointWorkspace(prepared.context.project);
      if (at) checkpoint = await turnCheckpoints?.capture({
        chatId: prepared.context.chat.id,
        projectId: prepared.context.project.id,
        workingRoot: at,
        sourceCheckpointId,
      });
    } catch (error) {
      console.warn("Could not capture turn checkpoint", error.message);
    }
    let accepted;
    try {
      accepted = await startGeneration(record, () => adapter.prompt(record.id, prepared.prompt,
        { ...promptOptions, attachments: prepared.attachments,
          ...(messageId ? { clientUserMessageId: messageId } : {}) }),
        { reuseSlot: promptOptions.streamingBehavior === "steer" || promptOptions.streamingBehavior === "followUp" });
    } catch (error) { throw error; }
    const generationId = typeof accepted === "string" ? accepted : accepted?.generationId;
    // Without this, a reopened chat puts the message's files back in the composer.
    await attachments.recordMessage(prepared.context.project, prepared.context.chat.id,
      (typeof accepted === "object" ? accepted?.attachmentIdentity : null) || (messageId ? { messageId } : null), prepared.attachments, markup);
    if (checkpoint && generationId) {
      const messageId = typeof accepted === "object" ? accepted?.attachmentIdentity?.messageId : null;
      try { await turnCheckpoints.assignTurn(checkpoint, generationId, messageId); }
      catch (error) { console.warn("Could not assign turn checkpoint", error.message); }
    }
    await registry.markUserMessage(prepared.context.chat.id);
    if (prepared.context.chat.status === "draft") {
      await registry.update(prepared.context.chat.id, { status: "active", backend: {
        ...prepared.context.chat.backend,
        opaqueSession: adapter.opaqueSessionOf?.(record) ?? record.sessionId ?? null,
      } });
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

  async function withComposerModel(record, command, preparing) {
    const [, prepared] = await Promise.all([applyComposerModel(record, command), preparing]);
    return prepared;
  }

  function announceTruncation(record, messageId, { keep = false } = {}) {
    if (!messageId) return;
    const adapter = adapterFor(record);
    // A regenerate keeps the prompt it re-asks and abandons only what it produced.
    adapter.publish(record, keep
      ? { type: "history_truncated", afterMessageId: messageId }
      : { type: "history_truncated", beforeMessageId: messageId });
    if (logFor(record)) {
      adapter.publish(record, messageDrop({ messageId, keep, inclusive: !keep }));
    }
  }

  /** No re-sync: the truncation states what changed, and a fork keeps the ids of the entries it retains. */
  async function syncForkedChat(record, forked) {
    const context = await findChatContext(record.chatId);
    if (!context) throw new Error("Chat no longer exists");
    await registry.update(context.chat.id, { backend: {
      ...context.chat.backend,
      opaqueSession: forked?.opaqueSession,
    } });
    return registry.metadata(context.chat.id);
  }

  async function clearQueuedMessages(record, adapter) {
    const taken = await adapter.clearQueue(record.id);
    if (record.ephemeral) return taken;
    const context = await findChatContext(record.chatId);
    if (!context) return taken;
    if (taken?.discardedAttachmentIdentities?.length) {
      await attachments.discardMessages(context.project, context.chat.id, taken.discardedAttachmentIdentities);
    }
    return taken;
  }

  const assertChildCommand = (record, command) => {
    if ((record.readOnly || registry.metadata(record.chatId)?.status === "subagent")
      && !liveCommandIs(command?.type, "child")) {
      throw Object.assign(new Error("subagent_read_only"), { code: "subagent_read_only", status: 409 });
    }
  };

  async function handleClientCommand(record, command) {
    assertChildCommand(record, command);
    const adapter = adapterFor(record);
    if (command.client && liveCommandIs(command.type, "origin")) sentFrom(record.chatId, command.client);
    if (command.type === "prompt") {
      if (record.ephemeral) return startGeneration(record,
        () => adapter.prompt(record.id, String(command.message || "")));
      const prepared = await promptForChat(record, command, String(command.message || ""));
      const streamingBehavior = command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
        ? command.streamingBehavior
        : null;
      // The approval model trusts only words authored by the person.
      return sendPrompt(record, prepared, { streamingBehavior, messageId: offeredMessageId(command.messageId), author: "person" });
    }
    if (command.type === "follow_up" || command.type === "steer") {
      const prepared = await promptForChat(record, command, String(command.message || ""));
      if (prepared.attachments.length && !adapter.getCapabilities().attachments) {
        throw Object.assign(new Error("This agent does not support attachments"), { code: "attachments_unsupported", status: 400 });
      }
      const queuedMessageId = offeredMessageId(command.messageId);
      const accepted = await adapter.queue(record.id, command.type, prepared.prompt,
        { attachments: prepared.attachments, messageId: queuedMessageId, author: "person" });
      await attachments.recordMessage(prepared.context.project, prepared.context.chat.id,
        accepted?.attachmentIdentity || null, prepared.attachments);
      return null;
    }
    if (command.type === "clear_queue") {
      const capabilities = adapter.getCapabilities();
      return capabilities.steer || capabilities.followUpQueue ? clearQueuedMessages(record, adapter) : null;
    }
    if (command.type === "interrupt_and_send") {
      // Clearing must succeed first: aborting with the queue in place makes the backend deliver it anyway,
      // duplicating the message.
      let taken = { steering: [], followUp: [] };
      const capabilities = adapter.getCapabilities();
      if (capabilities.steer || capabilities.followUpQueue) {
        try {
          taken = await clearQueuedMessages(record, adapter);
        } catch (error) {
          throw Object.assign(new Error(`Cannot interrupt and send: the agent rejected clear_queue (${error.message})`),
            { code: "clear_queue_unsupported" });
        }
      }
      const cancelledGenerationId = command.generationId || record.activeGeneration?.id || null;
      await adapter.cancel(record.id, cancelledGenerationId);
      const interrupted = interruptedPromptInput(taken, command.message, command.attachmentIds);
      if (!interrupted.message) return null;
      const prepared = await withComposerModel(record, command, promptForChat(record, {
        ...command,
        attachmentIds: interrupted.attachmentIds,
      }, interrupted.message));
      return sendPrompt(record, prepared, { messageId: offeredMessageId(command.messageId), author: "person" });
    }
    if (command.type === "stop_generation") {
      const stoppedGenerationId = command.generationId || record.activeGeneration?.id || null;
      const capabilities = adapter.getCapabilities();
      if (capabilities.steer || capabilities.followUpQueue) {
        await clearQueuedMessages(record, adapter).catch((error) => console.warn("Could not clear the queue before stopping", error.message));
      }
      const result = await adapter.cancel(record.id, stoppedGenerationId);
      if (!record.active) adapter.publish(record, { type: "runtime_state", session: adapter.view(record) });
      return result;
    }
    if (command.type === "fork_and_prompt") {
      if (!adapter.getCapabilities().fork) throw Object.assign(new Error("This agent does not support forks"), { code: "fork_unsupported", status: 409 });
      const context = await findChatContext(record.chatId);
      const entryId = command.entryId;
      const at = context ? await checkpointWorkspace(context.project) : null;
      const sourceCheckpointId = at ? await turnCheckpoints?.checkpointForMessage(context.chat.id, at, entryId) : null;
      const forked = await adapter.fork(record.id, { nodeId: entryId });
      announceTruncation(record, command.entryId);
      await syncForkedChat(record, forked);
      const prepared = await withComposerModel(record, command, promptForChat(record, command, String(command.message || "")));
      return sendPrompt(record, prepared, { sourceCheckpointId, messageId: offeredMessageId(command.messageId), author: "person" });
    }
    if (command.type === "regenerate") {
      if (!adapter.getCapabilities().regenerate) throw Object.assign(new Error("This agent does not support regeneration"), { code: "regenerate_unsupported", status: 409 });
      const context = await findChatContext(record.chatId);
      const entryId = command.entryId;
      const at = context ? await checkpointWorkspace(context.project) : null;
      const sourceCheckpointId = at ? await turnCheckpoints?.checkpointForMessage(context.chat.id, at, entryId) : null;
      const forked = await adapter.fork(record.id, { nodeId: entryId });
      announceTruncation(record, command.entryId, { keep: true });
      await syncForkedChat(record, forked);
      const prepared = await withComposerModel(record, command, promptForChat(record, command, forked.sourceMessage?.text || forked.text));
      const messageId = CLIENT_MESSAGE_ID.test(String(command.entryId || "")) ? command.entryId : null;
      return sendPrompt(record, prepared, { sourceCheckpointId, messageId });
    }
    if (command.type === "extension_ui_response") {
      // Awaited: a harness answering over the network can refuse, and the refusal belongs to this command.
      await adapter.respondHostUi(record.id, command);
      return null;
    }
    if (command.type === "refresh_context") return adapter.refreshContext(record.id);
    if (command.type === "compact") return adapter.compact(record.id, typeof command.instructions === "string" ? command.instructions.trim().slice(0, 2000).trim() || undefined : undefined);
    throw Object.assign(new Error(`Unknown live-session command: ${String(command.type || "")}`), {
      code: "invalid_request", status: 400,
    });
  }

  /**
   * `markup`: the hand-offs a notice carries (`hand`, server/documents.js), kept in the send ledger beside the text the
   * model reads, and laid on the prompt as it is stated (`record.marked`, harnesses/session-records.js). `steer`: the
   * chat is busy, and the notice steers it.
   */
  async function submitPrompt(chatId, message, { model = "", thinkingLevel = "", notice = false, markup = null, steer = false } = {}) {
    if (registry.metadata(chatId)?.status === "subagent") throw Object.assign(new Error("subagent_read_only"), { code: "subagent_read_only", status: 409 });
    return lifecycle.run(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) throw Object.assign(new Error("Chat not found"), { code: "chat_not_found", status: 404 });
      lifecycle.assertAvailable(chatId, context.project.id);
      const record = backends.getByChatId(chatId);
      if (!record) throw Object.assign(new Error("This chat has no live agent process"), { code: "no_live_process", status: 409 });
      const messageId = markup?.length ? `m_${crypto.randomUUID()}` : null;
      if (messageId) (record.marked ??= new Map()).set(messageId, markup);
      if (steer) {
        const adapter = adapterFor(record);
        if (!adapter.getCapabilities().steer) throw new Error("This harness cannot steer a busy chat");
        const accepted = await adapter.queue(record.id, "steer", message, { notice, ...(messageId ? { messageId } : {}) });
        // A harness that names the steer itself (Codex) is found by its own id.
        const named = accepted?.attachmentIdentity?.messageId;
        if (messageId && named) record.marked.set(named, markup);
        await attachments.recordMessage(context.project, chatId, accepted?.attachmentIdentity || null, [], markup);
        return null;
      }
      const prepared = await withComposerModel(record, { model, thinkingLevel }, promptForChat(record, { attachmentIds: [] }, String(message || "")));
      return sendPrompt(record, prepared, { notice, messageId, markup });
    });
  }

  const handleUpgrade = (id, request, socket, head) => wss.handleUpgrade(request, socket, head, (ws) => {
    startWebSocketKeepalive(ws);
    const record = backends.get(id);
    if (!record) {
      ws.close(1011, "Live session unavailable");
      return;
    }
    const adapter = adapterFor(record);
    const send = (event) => sendClientEvent(ws, event);
    const log = logFor(record);
    // Seq 0 before the replay, so a retained suffix shows as a gap the client asks the log to fill, not as complete.
    if (log) send({ type: "log_state", log: { ...log.state(), seq: 0 } });
    send(adapter.attach(id, ws));
    if (record.status === "running" && !record.contextUsage?.contextWindow) adapter.refreshContext(record.id).catch(() => {});
    send({
      type: "runtime_state",
      session: adapter.view(record),
      hostUiRequests: hostsOf(record),
      queue: record.queue || { steering: [], followUp: [] },
      contextUsage: record.contextUsage || null,
      sessionStats: record.sessionStats || null,
      cacheStats: record.cacheStats || null,
    });
    send(record.lastCheckpoint);
    if (log) send({ type: "log_state", log: log.state() });
    // An untracked thread is Conduit's only while a page drives it; a page's own close cannot be relied on as it
    // unloads, so the process closes when no page is back within the grace.
    ws.on("close", () => {
      if (!record.ephemeral) return;
      setTimeout(() => {
        const current = backends.get(id);
        if (current?.ephemeral && !current.clients?.size) void backends.stop(id).catch(() => {});
      }, UNDRIVEN_THREAD_GRACE_MS).unref?.();
    });
    // A later clear, steer or prompt must not overtake an earlier one while attachment paths or an abort resolve.
    let commands = Promise.resolve();
    ws.on("message", (data) => {
      const report = (error) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({
          type: "error", scope: "request", generationId: null,
          error: { code: error.code || "invalid_request", message: error.message },
        }));
      };
      let command;
      try { command = JSON.parse(String(data)); }
      catch (error) { report(Object.assign(error, { code: "invalid_request" })); return; }
      try { assertChildCommand(record, command); } catch (error) { report(error); return; }
      if (command.type === "frame_interval") {
        adapter.setFrameInterval?.(record.id, ws, command.ms);
        return;
      }
      if (command.type === "resume_log") {
        const chatLog = logFor(record);
        const missed = chatLog?.since(command.logId, Number(command.since));
        if (missed) {
          for (const event of missed) send(event);
          return;
        }
        send({ type: "log_reset", log: chatLog?.state() || null });
        void publishSnapshot(record);
        return;
      }
      const bypassLifecycle = record.ephemeral || liveCommandIs(command.type, "urgent");
      const run = () => bypassLifecycle ? handleClientCommand(record, command) : lifecycle.run(record.chatId, async () => {
        const context = await findChatContext(record.chatId);
        if (!context) throw Object.assign(new Error("Chat no longer exists"), { code: "chat_not_found" });
        lifecycle.assertAvailable(record.chatId, context.project.id);
        return handleClientCommand(record, command);
      });
      // Stop bypasses the chain so it can interrupt work an earlier command started.
      if (command.type === "stop_generation") {
        void run().catch(report);
        return;
      }
      commands = commands
        .then(run)
        .catch(report);
    });
  });

  async function stopGeneration(chatId) {
    const record = backends.getByChatId(chatId);
    if (!record) return null;
    return handleClientCommand(record, { type: "stop_generation" });
  }

  async function respondHostUi(chatId, response) {
    return lifecycle.run(chatId, async () => {
      const record = backends.getByChatId(chatId);
      if (!record) throw Object.assign(new Error("This chat has no live agent process"), { code: "no_live_process", status: 409 });
      return handleClientCommand(record, { type: "extension_ui_response", ...response });
    });
  }

  /** The browser's first message when the person left the chat before its agent started, so it is not dropped. */
  async function promptChat(chatId, command) {
    return lifecycle.run(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) throw Object.assign(new Error("Chat no longer exists"), { code: "chat_not_found", status: 404 });
      lifecycle.assertAvailable(chatId, context.project.id);
      const record = backends.getByChatId(chatId);
      if (!record) throw Object.assign(new Error("This chat has no live agent process"), { code: "no_live_process", status: 409 });
      return handleClientCommand(record, { type: "prompt", messageId: command.messageId, message: command.message, attachmentIds: command.attachmentIds });
    });
  }

  return { handleUpgrade, submitPrompt, stopGeneration, respondHostUi, promptChat };
}
