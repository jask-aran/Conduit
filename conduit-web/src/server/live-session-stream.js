import { CONTINUE_PROMPT } from "../continuation.js";
import { messageDrop, messageOpen } from "../harnesses/transcript-ops.js";
import { messagesFromEntries } from "../session-store.js";
import { chatView } from "../chat-store.js";
import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { ChatBackendRegistry } from "../pi-rpc-adapter.js";
import { manifestForImplementation } from "../harnesses/index.js";
import { startWebSocketKeepalive } from "./ws-keepalive.js";
import { applyMessageIds } from "../message-ids.js";

/**
 * An id a client chose for the message it is sending.
 *
 * Accepted only in Conduit's own shape, so a client cannot name a message
 * something that already means something else -- an existing message, or an id
 * derived from a session entry.
 */
const CLIENT_MESSAGE_ID = /^m_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const offeredMessageId = (value) => (typeof value === "string" && CLIENT_MESSAGE_ID.test(value) ? value : null);

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

export function createLiveSessionStream({
  manager,
  wss,
  attachments,
  registry,
  config,
  turnCheckpoints,
  findChatContext,
  findRegisteredSession,
  chatModelView,
  messageIds,
  chatLogs,
  backends = new ChatBackendRegistry(manager),
  lifecycle,
  autoNameSession = async () => {},
}) {
  if (!lifecycle) throw new TypeError("Live session stream requires a chat lifecycle");
  const namingChats = new Set();

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

  // A target the client names is a Conduit message id; the harness knows only
  // its own entry. Unknown ids pass straight through, so Pi's own history tree
  // and any client that predates this still work.
  async function harnessEntryId(context, messageId) {
    if (!context) return messageId;
    return messageIds.entryIdFor(context.project, context.chat, messageId);
  }

  /**
   * Let the process name anything the chat writes, not just what Conduit sent.
   *
   * Pi writes messages nobody here asked for: the answers to a turn it started
   * off its own queue, a message typed into the CLI of a thread driven from
   * here, the second and third answers of a turn that only claimed one. Those
   * used to reach the transcript unnamed, streaming under an id invented for
   * the stream and settling under one derived from the entry -- the same
   * message twice. The process cannot reach the ledger itself, so it is handed
   * the one way in, and the ledger is warmed so a name can be taken from inside
   * the event loop where there is nothing to await.
   */
  function bindNaming(record, context) {
    if (!record || record.ephemeral || !context || !messageIds.owns(context.chat)) return;
    void messageIds.load(context.project, context.chat.id).catch(() => {});
    record.claimMessage = (role, after = null) => messageIds.claimNow(context.chat, role, after);
  }

  async function promptForChat(record, command, message) {
    const context = await findChatContext(record.chatId);
    if (!context) throw new Error("Chat no longer exists");
    bindNaming(record, context);
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
  // The generation the sync closes: the client's copy of that turn is frozen
  // out of a live generation and carries the same id, which is the only handle
  // an unwritten turn has. Without it the client has to guess where the range
  // belongs.
  // `replace` says the window is the whole of what the client should hold: it
  // is the answer to a client that has lost its place in the chat's order and
  // cannot be replayed back into it.
  async function syncTranscript(record, turns = 1, generationId = null, { replace = false } = {}) {
    const adapter = adapterFor(record);
    if (record.ephemeral) return;
    try {
      const context = await findChatContext(record.chatId);
      if (!context) return;
      const projection = await adapter.readTranscript({
        liveSessionId: record.id, chatId: record.chatId, project: context.project, turns,
      });
      if (projection.messages?.length) {
        // A window is often the first sight of entries Pi has only just
        // written, so the ids claimed for them are bound here rather than left
        // until the turn checkpoints. Without this the sync an interrupt
        // publishes names the prompt `pi:<entryId>` while the client holds the
        // id it was handed, and the same message arrives a second time.
        await messageIds.bind(context.project, context.chat, projection.messages);
        projection.messages = await attachments.decorateMessages(context.project, context.chat.id, projection.messages, { fromStart: !turns });
        projection.messages = applyMessageIds(projection.messages,
          await messageIds.resolver(context.project, context.chat));
        adapter.publish(record, { type: "transcript_sync", generationId, ...(replace ? { replace: true } : {}), ...projection });
      }
    } catch (error) {
      // A sync is a repair, never the only path to correctness.
      console.warn("Could not sync transcript", error.message);
    }
  }

  async function sendPrompt(record, prepared, options) {
    const { sourceCheckpointId = null, messageId = null, ...promptOptions } = options || {};
    const namingOwner = manifestForImplementation(record.adapterImplementation)?.nameGeneration;
    const needsName = namingOwner === "conduit" && !prepared.context.chat.title
      && !namingChats.has(prepared.context.chat.id);
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
        sessionFile: record.sessionFile,
        sourceCheckpointId,
      });
    } catch (error) {
      console.warn("Could not capture turn checkpoint", error.message);
    }
    // Claimed before the prompt goes out, so the commit event that comes back
    // can carry the id the transcript will eventually agree on.
    // Both halves of the turn are named before it starts: the prompt, and the
    // answer it will produce. They are handed to the harness with the prompt so
    // they belong to that generation and nothing else can consume them. The
    // answer is claimed against the prompt, so it can only ever name an entry
    // this turn wrote: a turn that produces more than one answer runs out of
    // claims, and the extras derive their ids from their entries like any
    // message Conduit did not send.
    // The browser names the message it is sending, so the row already on
    // screen is that message rather than a stand-in; a caller that offers no
    // name gets one here. A harness that names its own messages claims
    // nothing and this stays null.
    const user = await messageIds.claim(prepared.context.project, prepared.context.chat, "user", messageId);
    const claimed = user
      ? {
        user,
        assistant: await messageIds.mint(prepared.context.project, prepared.context.chat, "assistant", user),
        // Every further message this turn writes is named as it starts, so no
        // message is ever streamed under one name and stored under another.
        claimAnswer: (after) => messageIds.claimNow(prepared.context.chat, "assistant", after || user),
      }
      : null;
    // Stated before it is sent, not after it is accepted. The harness can begin
    // answering while the prompt's own acceptance is still in flight, and an
    // answer placed before its prompt existed put the prompt underneath its own
    // reply -- and, because an answer belongs to the prompt it names, took the
    // whole turn with it into the turn above.
    if (claimed?.user) {
      adapter.publish(record, messageOpen({ id: claimed.user, role: "user",
        content: prepared.message, timestamp: new Date().toISOString() }));
    }
    let accepted;
    try {
      accepted = await adapter.prompt(record.id, prepared.prompt,
        { ...promptOptions, attachments: prepared.attachments,
          // A harness that names its own messages still has to name this one
          // what the browser already calls it. The row is on screen before the
          // prompt is sent, so an adapter that invents an id here states a
          // second row for a message that is already drawn -- the same prompt,
          // twice, which is what claiming an id prevents for everyone else.
          ...(claimed ? { messageIds: claimed } : messageId ? { clientUserMessageId: messageId } : {}) });
    } catch (error) {
      // A prompt the harness refused writes nothing, so its names go back
      // rather than waiting for messages that will never be written -- and the
      // row stated for it goes with them.
      await messageIds.release(prepared.context.project, prepared.context.chat, claimed);
      if (claimed?.user) {
        adapter.publish(record, messageDrop({ messageId: claimed.user }));
      }
      throw error;
    }
    const generationId = typeof accepted === "string" ? accepted : accepted?.generationId;
    // With an id of its own, a Pi prompt's attachments are found by that id
    // like every other harness's, instead of by counting from an anchor.
    // `attachmentIdentity` itself stays as the harness gave it: the turn
    // checkpoint below anchors on harness entries, not on Conduit ids.
    await attachments.recordMessage(prepared.context.project, prepared.context.chat.id,
      claimed ? { ...(accepted?.attachmentIdentity || {}), messageId: claimed.user } : accepted?.attachmentIdentity || null,
      prepared.attachments);
    if (checkpoint && generationId) {
      const messageId = typeof accepted === "object" ? accepted?.attachmentIdentity?.messageId : null;
      try { await turnCheckpoints.assignTurn(checkpoint, generationId, messageId); }
      catch (error) { console.warn("Could not assign turn checkpoint", error.message); }
    }
    await registry.markUserMessage(prepared.context.chat.id);
    if (prepared.context.chat.status === "draft") {
      await registry.update(prepared.context.chat.id, { status: "active", backend: {
        ...prepared.context.chat.backend,
        opaqueSession: manifestForImplementation(record.adapterImplementation)?.profile ? record.sessionId : record.sessionFile,
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
   * a transcript that may not exist yet: when the retained branch has no
   * assistant message, Pi names the fork's file before writing it, and the sync
   * below has nothing to read.
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
   * It used to read the whole forked transcript back and republish it, which
   * was the only statement the client got about what the fork removed -- and
   * the one it never got when the retained branch has no assistant message,
   * because Pi names the fork's file before writing it and there was nothing
   * to read. The truncation above says that directly, and a fork keeps the
   * entry ids of everything it retains, so there is nothing left to re-sync.
   */
  async function syncForkedChat(record, forked) {
    const context = await findChatContext(record.chatId);
    if (!context) throw new Error("Chat no longer exists");
    await registry.update(context.chat.id, { backend: {
      ...context.chat.backend,
      opaqueSession: forked?.opaqueSession,
    } });
    const updated = registry.metadata(context.chat.id);
    adapterFor(record).publish(record, { type: "history_forked", chat: chatView(updated) });
    return updated;
  }

  async function clearQueuedMessages(record, adapter) {
    const taken = await adapter.clearQueue(record.id);
    if (record.ephemeral) return taken;
    const context = await findChatContext(record.chatId);
    if (!context) return taken;
    if (taken?.discardedAttachmentIdentities?.length) {
      await attachments.discardMessages(context.project, context.chat.id, taken.discardedAttachmentIdentities);
    }
    // A queued message taken back is a message that will never be written, so
    // its name goes back too. Left in the queue it would be handed to the next
    // entry along and shift every binding after it by one.
    for (const messageId of taken?.discardedMessageIds || []) {
      await messageIds.release(context.project, context.chat, { user: messageId });
    }
    return taken;
  }

  async function handleClientCommand(record, command) {
    const adapter = adapterFor(record);
    if (command.type === "prompt") {
      if (record.ephemeral) return adapter.prompt(record.id, String(command.message || ""));
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
            sessionFile: record.sessionFile,
          });
        } catch (error) {
          console.warn("Could not capture steering checkpoint", error.message);
        }
      }
      // A queued message is named before it goes, exactly like a prompt. Pi
      // writes it as an ordinary user entry whenever it takes it off the queue,
      // and this is the name that entry binds to -- so the message the browser
      // drew and the message the transcript records are one thing, rather than
      // two that have to be matched up afterwards.
      const queuedMessageId = await messageIds.claim(prepared.context.project, prepared.context.chat,
        "user", offeredMessageId(command.messageId));
      // A turn Pi starts for itself, off its own queue, still writes messages
      // that need names. It cannot reach the ledger, so it is given the one way
      // in that it needs.
      if (queuedMessageId) {
        record.claimAnswer = (after) => messageIds.claimNow(prepared.context.chat, "assistant", after || queuedMessageId);
      }
      const accepted = await adapter.queue(record.id, command.type, prepared.prompt,
        { attachments: prepared.attachments, messageId: queuedMessageId });
      await attachments.recordMessage(prepared.context.project, prepared.context.chat.id,
        queuedMessageId ? { ...(accepted?.attachmentIdentity || {}), messageId: queuedMessageId } : accepted?.attachmentIdentity || null,
        prepared.attachments);
      return null;
    }
    if (command.type === "clear_queue") {
      const capabilities = adapter.getCapabilities();
      return capabilities.steer || capabilities.followUpQueue ? clearQueuedMessages(record, adapter) : null;
    }
    // Pi's documented interrupt recipe, run in order on this side of the
    // socket. Clearing first is what stops the abort from continuing the queue
    // itself; the client used to sequence these three steps by watching
    // generation state, which raced.
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
      if (!interrupted.message) {
        await syncTranscript(record, 1, cancelledGenerationId);
        return null;
      }
      // Before the replacement, not only after it: the interrupted turn is
      // already written by the time cancel resolves, and syncing it now settles
      // it while the client still has nothing else arriving. Leaving it until
      // after the replacement prompt meant the client carried an unreconciled
      // interrupted turn for the whole of the next response.
      await syncTranscript(record, 1, cancelledGenerationId);
      await applyComposerModel(record, command);
      const prepared = await promptForChat(record, {
        ...command,
        attachmentIds: interrupted.attachmentIds,
      }, interrupted.message);
      const generationId = await sendPrompt(record, prepared, { messageId: offeredMessageId(command.messageId) });
      // Pi can write the aborted tool result just after cancel resolves, and
      // the steered message has no id until Pi writes it, so a two-turn sync
      // once the replacement is accepted is what names both turns.
      await syncTranscript(record, 2, generationId);
      return generationId;
    }
    if (command.type === "stop_generation" || command.type === "abort") {
      const stoppedGenerationId = command.generationId || record.activeGeneration?.id || null;
      const stopped = await adapter.cancel(record.id, stoppedGenerationId);
      await syncTranscript(record, 1, stoppedGenerationId);
      return stopped;
    }
    if (command.type === "fork_and_prompt") {
      if (!adapter.getCapabilities().fork) throw Object.assign(new Error("This agent does not support forks"), { code: "fork_unsupported", status: 409 });
      const context = await findChatContext(record.chatId);
      const entryId = await harnessEntryId(context, command.entryId);
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
      const entryId = await harnessEntryId(context, command.entryId);
      const sourceCheckpointId = context ? await turnCheckpoints?.checkpointForMessage(
        context.chat.id, context.project.workingRoot, entryId,
      ) : null;
      const forked = await adapter.fork(record.id, { nodeId: entryId });
      announceTruncation(record, command.entryId, { keep: true });
      await syncForkedChat(record, forked);
      await applyComposerModel(record, command);
      const prepared = await promptForChat(record, command, forked.sourceMessage?.text || forked.text);
      // The prompt keeps the name the row on screen already has, so the harness
      // writing a new entry for it is invisible: the message is restated where
      // it already sits instead of being taken away and sent back as a copy.
      // A prompt adopted from history has no Conduit name to keep, and gets a
      // fresh one as before.
      const messageId = context
        ? await messageIds.reclaim(context.project, context.chat, command.entryId) : null;
      return sendPrompt(record, prepared, { sourceCheckpointId, messageId });
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
    if (command.type === "compact") return adapter.compact(record.id);
    throw Object.assign(new Error(`Unknown live-session command: ${String(command.type || "")}`), {
      code: "invalid_request", status: 400,
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
    // Where this chat's order stands right now. A client that was here before
    // answers with how far it got, and is either caught up or told to start
    // again from a snapshot; one arriving fresh simply adopts the number.
    const log = logFor(record);
    if (log) ws.send(JSON.stringify(adapter.toClientEvent({ type: "log_state", log: log.state() })));
    // A chat can be written to without anyone prompting from here, so naming is
    // set up on attach rather than waiting for the first prompt.
    if (record.chatId) void findChatContext(record.chatId).then((context) => bindNaming(record, context)).catch(() => {});
    // One browser connection is one ordered command stream. Native harness
    // operations can be asynchronous, but a later clear, steer, or prompt must
    // not overtake an earlier one while attachment paths or an abort resolve.
    let commands = Promise.resolve();
    ws.on("message", (data) => {
      const report = (error) => {
        if (ws.readyState === 1) ws.send(JSON.stringify(adapter.toClientEvent({
          type: "client_error", code: error.code, message: error.message,
        })));
      };
      let command;
      try { command = JSON.parse(String(data)); }
      catch (error) { report(Object.assign(error, { code: "invalid_request" })); return; }
      // Catching one client up is answered on its own socket and changes
      // nothing, so it never joins the ordered command chain or the chat
      // lifecycle. Either the log still holds what it missed, and it is sent
      // exactly that, or it is told to take the transcript again from scratch.
      if (command.type === "resume_log") {
        const chatLog = logFor(record);
        const missed = chatLog?.since(command.logId, Number(command.since));
        if (missed) {
          for (const event of missed) ws.send(JSON.stringify(adapter.toClientEvent(event)));
          return;
        }
        ws.send(JSON.stringify(adapter.toClientEvent({ type: "log_reset", log: chatLog?.state() || null })));
        void syncTranscript(record, 10, null, { replace: true });
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

  return { handleUpgrade };
}
