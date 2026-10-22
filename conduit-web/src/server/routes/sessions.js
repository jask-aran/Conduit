import path from "node:path";
import { conduitPiSessionFile } from "../../backend-session.js";
import { chatView, isChatId } from "../../chat-store.js";
import { applyTranscriptOps } from "../../transcript-fold.js";
import {
  removeSessionFamily,
  sessionFamilyFiles,
  transcriptFromMessages,
} from "../../session-store.js";
import {
  findDeletableSession,
  moveDurableChat,
  sessionDirectoryForChat,
  sessionDirectoryRootForChat,
  stopSessionProcesses,
} from "../../session-operations.js";

export function registerSessionRoutes(app, {
  attachments,
  backends,
  chatLogs,
  config,
  drafts,
  findChatContext,
  lifecycle,
  sessionNames,
  projects,
  registry,
}) {
  /**
   * What the server believes this chat holds, not only what the harness wrote.
   *
   * Only for the end of the transcript: an older page is history the log has
   * nothing to say about, and folding the tail's statements into it would put
   * them in the wrong place.
   */
  // Only the newest page is overlaid with the live log; an older page is
  // asked for with a cursor even when it turns out to be the last.
  // It also says how far into the log it reaches, read in the same tick as the
  // fold, so the browser takes that as its place rather than starting from
  // zero and being replayed every statement it was just handed.
  const upToDate = (context, projection, page, requestedBefore = "") => {
    if (page?.before || requestedBefore) return projection;
    const log = chatLogs?.peek(context.chat.id);
    return { ...projection, ...applyTranscriptOps(projection, log?.entries || []), ...(log ? { log: log.state() } : {}) };
  };
  /*
   * Whether a turn is still running in this chat. The transcript holds the
   * steps of a running turn that have finished, and its prompt has no outcome
   * until the turn ends; the browser draws the turn from the socket once it
   * attaches, and until then this is what says the turn has not ended yet.
   */
  const turnOpen = (chatId) => {
    const process = backends.list().find((item) => item.chatId === chatId);
    return Boolean(process && (process.active || process.stopping
      || process.generation && !process.generation.settled));
  };

  async function transcriptFor(context) {
    const projection = await backends.forChat(context.chat).readTranscript({
      chatId: context.chat.id,
      opaqueSession: context.chat.backend?.opaqueSession,
      project: context.project,
    });
    return transcriptFromMessages(projection.messages || []).trim();
  }

  /*
   * The context a chat last had, for one with no live process to ask: read
   * from the harness's stored history. A live process answers for itself.
   */
  app.get("/v0/sessions/:id/context", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const live = backends.getByChatId?.(context.chat.id);
      if (live?.contextUsage?.tokens != null) {
        return response.json({ contextUsage: live.contextUsage, sessionStats: live.sessionStats || null, cacheStats: live.cacheStats || live.cache?.stats || null });
      }
      const adapter = backends.forChat(context.chat);
      const usage = await adapter.contextFromHistory?.({ chatId: context.chat.id,
        opaqueSession: context.chat.backend?.opaqueSession, project: context.project }).catch(() => null);
      response.json(usage || {});
    } catch (error) {
      next(error);
    }
  });

  // The full breakdown for a thread whose harness can only give it running.
  app.post("/v0/sessions/:id/context/breakdown", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const adapter = backends.forChat(context.chat);
      if (!adapter.contextBreakdown) return response.status(409).json({ error: "breakdown_unavailable" });
      response.json(await adapter.contextBreakdown({ opaqueSession: context.chat.backend?.opaqueSession, project: context.project }) || {});
    } catch (error) {
      next(error);
    }
  });

  app.get("/v0/sessions/:id", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const adapter = backends.forChat(context.chat);
      const projection = await adapter.readTranscript({
        chatId: context.chat.id,
        opaqueSession: context.chat.backend?.opaqueSession,
        project: context.project,
        before: request.query.before,
      });
      projection.messages = await attachments.decorateMessages(context.project, context.chat.id, projection.messages);
      response.json({ ...chatView(context.chat), turnOpen: turnOpen(context.chat.id),
        ...upToDate(context, projection, projection.page, request.query.before), attachments: [],
        page: projection.page || { before: null } });
    } catch (error) { next(error); }
  });

  app.get("/v0/sessions/:id/transcript", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      response.type("text/markdown").send(await transcriptFor(context));
    } catch (error) { next(error); }
  });

  app.post("/v0/sessions/:id/read", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      // The body echoes a completion timestamp this server issued, so the
      // watermark never depends on the browser's clock.
      const upTo = typeof request.body?.upTo === "string" ? request.body.upTo : null;
      await registry.markRead(context.chat.id, upTo);
      response.json(chatView(registry.metadata(context.chat.id)));
    } catch (error) { next(error); }
  });

  app.patch("/v0/sessions/:id", async (request, response, next) => {
    try {
      const name = String(request.body?.name || "").trim();
      if (!name) return response.status(400).json({ error: "session_name_required" });
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      await registry.update(context.chat.id, { title: name });
      response.json(chatView(registry.metadata(context.chat.id)));
    } catch (error) { next(error); }
  });

  app.post("/v0/sessions/:id/auto-name", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const transcript = await transcriptFor(context);
      if (!transcript) return response.status(409).json({
        error: "session_context_required",
        message: "This chat has no persisted context to name.",
      });
      await sessionNames.run({
        chatId: context.chat.id,
        cwd: context.project.workingRoot,
        source: "command",
        message: transcript,
        apply: async (name) => {
          await registry.update(context.chat.id, { title: name });
          return "applied";
        },
      });
      response.json(chatView(registry.metadata(context.chat.id)));
    } catch (error) { next(error); }
  });

  app.post("/v0/sessions/:id/move", async (request, response, next) => {
    try {
      if (!isChatId(request.params.id)) return response.status(404).json({ error: "chat_not_found" });
      const moved = await lifecycle.run(request.params.id, async () => {
        const context = await findChatContext(request.params.id);
        if (!context) return null;
        const target = (await projects.list()).find((item) => item.id === request.body?.projectId || item.slug === request.body?.projectId);
        if (!target) throw Object.assign(new Error("Project not found"), { code: "project_not_found", status: 404 });
        return lifecycle.withProjects([context.project.id, target.id], async () => {
          const current = await findChatContext(request.params.id);
          if (!current) return null;
          await projects.validate(target);
          lifecycle.assertAvailable(current.chat.id, current.project.id);
          lifecycle.assertAvailable(current.chat.id, target.id);
          return moveDurableChat({ chat: current.chat, source: current.project, target, backends, registry });
        });
      });
      if (!moved) return response.status(404).json({ error: "chat_not_found" });
      response.json(chatView(moved));
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.code, message: error.message });
      next(error);
    }
  });

  app.post("/v0/sessions/:id/duplicate", (_request, response) => {
    response.status(409).json({ error: "chat_duplication_deferred", message: "Chat duplication is unavailable while attachment ownership is unsettled." });
  });

  app.delete("/v0/sessions/:id", async (request, response, next) => {
    try {
      if (!isChatId(request.params.id)) return response.status(404).json({ error: "chat_not_found" });
      const deleted = await lifecycle.deleteChat(request.params.id, async () => {
        const context = await findChatContext(request.params.id);
        if (!context) return false;
        return lifecycle.withProjects([context.project.id], async () => {
          const session = await findDeletableSession(registry, await projects.list(), context.chat);
          const installationRoot = sessionDirectoryRootForChat(config, context.chat);
          const sessionOptions = session && installationRoot
            ? { sessionsDir: path.dirname(session.file), allowedRoot: installationRoot }
            : { sessionsDir: sessionDirectoryForChat(config, context.chat, context.project) };
          // A transcript outside this installation (written by another checkout)
          // is not Conduit's to remove, but the chat that names it still is:
          // the file is left where it is and the chat goes.
          let family = [];
          let foreign = false;
          try { family = session ? await sessionFamilyFiles(session.file, context.project, sessionOptions) : []; }
          catch (error) {
            if (error?.reason !== "outside-installation") throw error;
            foreign = true;
            console.warn("Chat deleted; its transcript is outside this installation and was left in place", { chatId: context.chat.id, file: session.file });
          }
          await stopSessionProcesses(backends, context.chat);
          if (session && !foreign) await removeSessionFamily(session.file, context.project, sessionOptions);
          // A converted chat's classic session goes too: left behind, startup
          // recovers it as a lost session and the chat comes back.
          const convertedFrom = context.chat.backend?.convertedFrom;
          if (convertedFrom && installationRoot) {
            await removeSessionFamily(convertedFrom, context.project, { sessionsDir: path.dirname(convertedFrom), allowedRoot: installationRoot })
              .catch((error) => console.warn("Chat deleted; its classic session was left in place", { chatId: context.chat.id, file: convertedFrom, error: error.message }));
          }
          const familyFiles = new Set(family.map((file) => path.resolve(file)));
          const relatedChats = registry.listProject(context.project.id, { includeHidden: true })
            .filter((chat) => chat.id === context.chat.id
              || (conduitPiSessionFile(chat) && familyFiles.has(path.resolve(conduitPiSessionFile(chat)))));
          await Promise.all(relatedChats.map((chat) => registry.remove(chat.id, context.project)));
          // The draft goes with the chat. Nothing else ever removes one, so a
          // chat deleted with something unsent left its text and its
          // attachments held for as long as the store kept them.
          await Promise.all(relatedChats.map((chat) => drafts.dropChat(chat.id)));
          return true;
        });
      });
      if (!deleted) return response.status(404).json({ error: "chat_not_found" });
      response.status(204).end();
    } catch (error) { next(error); }
  });
}
