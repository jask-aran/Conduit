import { messageDrop } from "../harnesses/transcript-ops.js";
import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { manifestForImplementation } from "../harnesses/index.js";
import { startWebSocketKeepalive } from "./ws-keepalive.js";
import { ServerConcurrency } from "./effect-concurrency.js";

/**
 * An id a client chose for the message it is sending.
 *
 * Accepted only in Conduit's own shape, so a client cannot name a message
 * something that already means something else -- an existing message, or an id
 * derived from a session entry.
 */
const CLIENT_MESSAGE_ID = /^m_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const offeredMessageId = (value) => (typeof value === "string" && CLIENT_MESSAGE_ID.test(value) ? value : null);

/** How long an untracked thread's process outlives its last page. */
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

/**
 * One event, one path out.
 *
 * Every frame this stream sends a browser is the adapter's translation of the
 * event, stringified -- there is no second spelling of that anywhere. It used
 * to be written out at each send site, and the one site that forgot it was the
 * replay a reconnecting browser reads first, so it was the one path that put
 * native harness events in front of the client.
 *
 * The exception is Conduit refusing a command, which is Conduit's own
 * statement about its own API rather than a harness event, and is written in
 * the contract's words where it is raised.
 */
export function sendClientEvent(ws, adapter, event) {
  if (!event || ws.readyState !== 1) return false;
  // An adapter may answer that the browser has no use for this one, and then
  // nothing is sent rather than an envelope with the payload taken out of it.
  const neutral = adapter.toClientEvent(event);
  if (neutral == null) return false;
  ws.send(JSON.stringify(neutral));
  return true;
}

export function createLiveSessionStream({
  wss,
  attachments,
  registry,
  turnCheckpoints,
  findChatContext,
  chatModelView,
  chatLogs,
  backends,
  concurrency = new ServerConcurrency(),
  maxGeneratingProcesses = () => 0,
  lifecycle,
  autoNameSession = async () => {},
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

  /**
   * The chat's order.
   *
   * Every chat has one, because every adapter states its transcript through it.
   * What does not is a record with no chat to keep an order for: an ephemeral
   * one behind a driven thread, a probe, a throwaway daemon started to answer a
   * question about models.
   */
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
    // The harness owns transcript text. Conduit sends native attachment inputs
    // and keeps only metadata that the harness cannot retain.
    const files = selectedAttachments.map((item) => ({
      ...item, path: attachments.pathFor(context.project, context.chat.id, item),
    }));
    return { context, prompt, message, attachments: files };
  }

  /**
   * Publish what the backend has actually recorded for the latest turn.
   *
   * A turn that ends early leaves Conduit's live model holding a version of the
   * turn it assembled from deltas. Reading the backend's own transcript and
   * publishing that is how the client stops having to be right on its own.
   */
  // The answer to a client that has lost its place in the chat's order and
  // cannot be replayed back into it: the latest turns, as the record has them,
  // replacing what it holds from the first of them on.
  // A read that races the log must not spin: `resume_log` has already sent
  // `log_reset`, so a snapshot has to follow. Three attempts cover a quiet
  // moment; the last publishes even if the log moved, rather than leaving the
  // client with a reset and nothing to fold.
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
        // A read outside the event loop can straddle a numbered transcript
        // change. Retry while attempts remain; the last publish stands.
        if (log && log.state().seq !== logSeq && attempt < SNAPSHOT_ATTEMPTS - 1) continue;
        adapter.publish(record, { type: "transcript_sync", generationId: null, replace: true, ...projection });
        return;
      }
    } catch (error) {
      // A sync is a repair, never the only path to correctness.
      console.warn("Could not sync transcript", error.message);
    }
  }

  async function sendPrompt(record, prepared, options) {
    const { sourceCheckpointId = null, messageId = null, ...promptOptions } = options || {};
    const namingOwner = manifestForImplementation(record.adapterImplementation)?.nameGeneration;
    // A headless run is not named unless it asked to be: nobody reads a list
    // it is not in, and naming costs a model call.
    const run = prepared.context.chat.run;
    const needsName = namingOwner === "conduit" && !prepared.context.chat.title
      && !namingChats.has(prepared.context.chat.id) && (!run || run.autoName === true);
    const adapter = adapterFor(record);
    if (prepared.attachments.length && !adapter.getCapabilities().attachments) {
      throw Object.assign(new Error("This agent does not support attachments"), { code: "attachments_unsupported", status: 400 });
    }
    let checkpoint = null;
    try {
      checkpoint = await turnCheckpoints?.capture({
        chatId: prepared.context.chat.id,
        projectId: prepared.context.project.id,
        projectKind: prepared.context.project.kind,
        workingRoot: prepared.context.project.workingRoot,
        // The transcript as it stands, so the checkpoint anchors on the entry
        // the turn about to start will hang under. Without it nothing ties a
        // checkpoint to its own turn, and they all reach for the newest one.
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

  /**
   * Say where the history now ends.
   *
   * A fork abandons the message it was pointed at and everything after it, and
   * the client is told that directly rather than being left to work it out from
   * a transcript that may not exist yet.
   */
  function announceTruncation(record, messageId, { keep = false } = {}) {
    if (!messageId) return;
    const adapter = adapterFor(record);
    // A regenerate ends the history *after* the prompt it is re-asking, not
    // before it: the prompt stands, and only what it produced is abandoned.
    adapter.publish(record, keep
      ? { type: "history_truncated", afterMessageId: messageId }
      : { type: "history_truncated", beforeMessageId: messageId });
    // The same fact in the chat's order, so the cut has a place in the sequence
    // a client rebuilds from rather than only a message of its own.
    if (logFor(record)) {
      adapter.publish(record, messageDrop({ messageId, keep, inclusive: !keep }));
    }
  }

  /**
   * Repoint the chat at the branch the fork created.
   *
   * It used to read the whole forked transcript back and republish it. The
   * truncation above states what changed, and a fork keeps the ids of the
   * entries it retains, so there is nothing left to re-sync.
   *
   * Which file the chat now points at is the server's business. This also
   * published a `history_forked` carrying the updated row, but the one field a
   * fork changes is `opaqueSession`, and `chatView` strips it -- so the row
   * went out identical to the one the browser already had, and no client ever
   * read the event.
   */
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

  async function handleClientCommand(record, command) {
    const adapter = adapterFor(record);
    if (command.type === "prompt") {
      if (record.ephemeral) return startGeneration(record,
        () => adapter.prompt(record.id, String(command.message || "")));
      const prepared = await promptForChat(record, command, String(command.message || ""));
      const streamingBehavior = command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
        ? command.streamingBehavior
        : null;
      return sendPrompt(record, prepared, { streamingBehavior, messageId: offeredMessageId(command.messageId) });
    }
    if (command.type === "follow_up" || command.type === "steer") {
      const prepared = await promptForChat(record, command, String(command.message || ""));
      if (prepared.attachments.length && !adapter.getCapabilities().attachments) {
        throw Object.assign(new Error("This agent does not support attachments"), { code: "attachments_unsupported", status: 400 });
      }
      if (command.type === "steer") {
        try {
          await turnCheckpoints?.capture({
            chatId: prepared.context.chat.id,
            projectId: prepared.context.project.id,
            projectKind: prepared.context.project.kind,
            workingRoot: prepared.context.project.workingRoot,
              });
        } catch (error) {
          console.warn("Could not capture steering checkpoint", error.message);
        }
      }
      const queuedMessageId = offeredMessageId(command.messageId);
      const accepted = await adapter.queue(record.id, command.type, prepared.prompt,
        { attachments: prepared.attachments, messageId: queuedMessageId });
      await attachments.recordMessage(prepared.context.project, prepared.context.chat.id,
        accepted?.attachmentIdentity || null, prepared.attachments);
      return null;
    }
    if (command.type === "clear_queue") {
      const capabilities = adapter.getCapabilities();
      return capabilities.steer || capabilities.followUpQueue ? clearQueuedMessages(record, adapter) : null;
    }
    // Clear the queue before cancellation, then send the replacement prompt.
    if (command.type === "interrupt_and_send") {
      // Clearing comes first and must succeed: aborting with the queue still in
      // place makes the backend deliver it anyway, so a half-run sequence
      // duplicates the message rather than steering with it.
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
      await applyComposerModel(record, command);
      const prepared = await promptForChat(record, {
        ...command,
        attachmentIds: interrupted.attachmentIds,
      }, interrupted.message);
      return sendPrompt(record, prepared, { messageId: offeredMessageId(command.messageId) });
    }
    if (command.type === "stop_generation" || command.type === "abort") {
      const stoppedGenerationId = command.generationId || record.activeGeneration?.id || null;
      // A stop clears the queue before it cancels the turn. The client puts
      // the reader's own queued words back in the composer.
      const capabilities = adapter.getCapabilities();
      if (capabilities.steer || capabilities.followUpQueue) {
        await clearQueuedMessages(record, adapter).catch((error) => console.warn("Could not clear the queue before stopping", error.message));
      }
      return adapter.cancel(record.id, stoppedGenerationId);
    }
    if (command.type === "fork_and_prompt") {
      if (!adapter.getCapabilities().fork) throw Object.assign(new Error("This agent does not support forks"), { code: "fork_unsupported", status: 409 });
      const context = await findChatContext(record.chatId);
      const entryId = command.entryId;
      const sourceCheckpointId = context ? await turnCheckpoints?.checkpointForMessage(
        context.chat.id, context.project.workingRoot, entryId,
      ) : null;
      const forked = await adapter.fork(record.id, { nodeId: entryId });
      announceTruncation(record, command.entryId);
      await syncForkedChat(record, forked);
      await applyComposerModel(record, command);
      const prepared = await promptForChat(record, command, String(command.message || ""));
      return sendPrompt(record, prepared, { sourceCheckpointId, messageId: offeredMessageId(command.messageId) });
    }
    if (command.type === "regenerate") {
      if (!adapter.getCapabilities().regenerate) throw Object.assign(new Error("This agent does not support regeneration"), { code: "regenerate_unsupported", status: 409 });
      const context = await findChatContext(record.chatId);
      const entryId = command.entryId;
      const sourceCheckpointId = context ? await turnCheckpoints?.checkpointForMessage(
        context.chat.id, context.project.workingRoot, entryId,
      ) : null;
      const forked = await adapter.fork(record.id, { nodeId: entryId });
      announceTruncation(record, command.entryId, { keep: true });
      await syncForkedChat(record, forked);
      await applyComposerModel(record, command);
      const prepared = await promptForChat(record, command, forked.sourceMessage?.text || forked.text);
      const messageId = CLIENT_MESSAGE_ID.test(String(command.entryId || "")) ? command.entryId : null;
      return sendPrompt(record, prepared, { sourceCheckpointId, messageId });
    }
    if (command.type === "extension_ui_response" || command.type === "host_ui_response") {
      // Awaited: a harness that answers over the network can refuse, and a
      // refusal belongs to this command, not to the process.
      await adapter.respondHostUi(record.id, command);
      return null;
    }
    if (command.type === "refresh_context") return adapter.refreshContext(record.id);
    if (command.type === "compact") return adapter.compact(record.id);
    throw Object.assign(new Error(`Unknown live-session command: ${String(command.type || "")}`), {
      code: "invalid_request", status: 400,
    });
  }

  /**
   * Send a prompt to a chat's live agent from the server itself.
   *
   * The same path a browser's prompt takes -- the chat's lock, its model, the
   * generation cap -- for a
   * caller with no socket: a headless run.
   */
  async function submitPrompt(chatId, message, { model = "", thinkingLevel = "" } = {}) {
    return lifecycle.run(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) throw Object.assign(new Error("Chat not found"), { code: "chat_not_found", status: 404 });
      lifecycle.assertAvailable(chatId, context.project.id);
      const record = backends.getByChatId(chatId);
      if (!record) throw Object.assign(new Error("This chat has no live agent process"), { code: "no_live_process", status: 409 });
      await applyComposerModel(record, { model, thinkingLevel });
      const prepared = await promptForChat(record, { attachmentIds: [] }, String(message || ""));
      return sendPrompt(record, prepared, {});
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
    const send = (event) => sendClientEvent(ws, adapter, event);
    const log = logFor(record);
    // Establish the order before replay. A fresh browser starts at zero, so a
    // retained suffix begins with a visible gap and asks the log for its
    // missing prefix instead of adopting that suffix as complete.
    if (log) send({ type: "log_state", log: { ...log.state(), seq: 0 } });
    send(adapter.attach(id, ws));
    if (record.status === "running" && !record.contextUsage?.contextWindow) adapter.refreshContext(record.id).catch(() => {});
    send({
      type: "runtime_state",
      session: adapter.view(record),
      hostUiRequests: record.hostUiRequests || [],
      queue: record.queue || { steering: [], followUp: [] },
      contextUsage: record.contextUsage || null,
      sessionStats: record.sessionStats || null,
      cacheStats: record.cacheStats || null,
    });
    send(record.lastCheckpoint);
    // Where the order actually stands. A client that already held this log
    // compares against the seq: 0 frame above and asks for what it missed; a
    // suffix in the attach replay is a hole against zero rather than a number
    // it could adopt as complete.
    if (log) send({ type: "log_state", log: log.state() });
    // An untracked thread is Conduit's only while a page drives it. Once the
    // last one has gone -- a reload, a closed tab, a lost connection -- and
    // none is back within the grace, its process closes; the page's own
    // close cannot be relied on to leave as it unloads. Tracking clears
    // `ephemeral`, and a chat's process is residency's to decide.
    ws.on("close", () => {
      if (!record.ephemeral) return;
      setTimeout(() => {
        const current = backends.get(id);
        if (current?.ephemeral && !current.clients?.size) void backends.stop(id).catch(() => {});
      }, UNDRIVEN_THREAD_GRACE_MS).unref?.();
    });
    // One browser connection is one ordered command stream. Native harness
    // operations can be asynchronous, but a later clear, steer, or prompt must
    // not overtake an earlier one while attachment paths or an abort resolve.
    let commands = Promise.resolve();
    ws.on("message", (data) => {
      // Conduit rejecting a command the browser sent is Conduit's own
      // statement, not a harness event, so it is written in the contract's
      // words here rather than handed to a harness translator. Routing it
      // through `toClientEvent` let backends rename it, so it read as the backend
      // going away -- which failed a turn that was still running fine.
      const report = (error) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({
          type: "error", scope: "request", generationId: null,
          error: { code: error.code || "invalid_request", message: error.message },
        }));
      };
      let command;
      try { command = JSON.parse(String(data)); }
      catch (error) { report(Object.assign(error, { code: "invalid_request" })); return; }
      // How fast this reader draws, measured by the only party that can see it.
      // About this one socket; it never joins the ordered command chain.
      if (command.type === "frame_interval") {
        adapter.setFrameInterval?.(record.id, ws, command.ms);
        return;
      }
      // Catching one client up is answered on its own socket and changes
      // nothing, so it never joins the ordered command chain. Either the log
      // still holds what it missed, or it is told to take the transcript again.
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
      const bypassLifecycle = record.ephemeral || command.type === "stop_generation" || command.type === "abort";
      const run = () => bypassLifecycle ? handleClientCommand(record, command) : lifecycle.run(record.chatId, async () => {
        const context = await findChatContext(record.chatId);
        if (!context) throw Object.assign(new Error("Chat no longer exists"), { code: "chat_not_found" });
        lifecycle.assertAvailable(record.chatId, context.project.id);
        return handleClientCommand(record, command);
      });
      // Stop bypasses the ordered command chain so it can interrupt work that
      // an earlier command started. Prompt acceptance normally resolves fast.
      if (command.type === "stop_generation" || command.type === "abort") {
        void run().catch(report);
        return;
      }
      commands = commands
        .then(run)
        .catch(report);
    });
  });

  /** Stop a chat's running turn, as the browser's Stop does. */
  async function stopGeneration(chatId) {
    const record = backends.getByChatId(chatId);
    if (!record) return null;
    return handleClientCommand(record, { type: "stop_generation" });
  }

  /**
   * Answer a harness's question or approval request from anywhere: the same
   * chat lock and adapter mapping the composer's card goes through.
   */
  async function respondHostUi(chatId, response) {
    return lifecycle.run(chatId, async () => {
      const record = backends.getByChatId(chatId);
      if (!record) throw Object.assign(new Error("This chat has no live agent process"), { code: "no_live_process", status: 409 });
      return handleClientCommand(record, { type: "host_ui_response", ...response });
    });
  }

  return { handleUpgrade, submitPrompt, stopGeneration, respondHostUi };
}
