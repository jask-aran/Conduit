import { chatView, isChatId } from "../../chat-store.js";
import { applyTranscriptOps } from "../../transcript-fold.js";
import {
  moveDurableChat,
  discardSession,
} from "../../session-operations.js";

const transcriptFromMessages = (messages) => messages
  .filter((message) => message.content.trim())
  .map((message) => {
    const role = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Tool result";
    return `## ${role}\n\n${message.content.trim()}`;
  })
  .join("\n\n");

export function registerSessionRoutes(app, {
  attachments,
  backends,
  chatLogs,
  drafts,
  findChatContext,
  lifecycle,
  sessionNames,
  projects,
  registry,
}) {
  // Only the newest page is overlaid with the live log: folded into an older page, the tail's statements would land in
  // the wrong place. Its log position is read in the same tick as the fold, so the browser is not replayed what it holds.
  const upToDate = (context, projection, page, requestedBefore = "") => {
    if (page?.before || requestedBefore) return projection;
    const log = chatLogs?.peek(context.chat.id);
    return { ...projection, ...applyTranscriptOps(projection, log?.entries || []), ...(log ? { log: log.state() } : {}) };
  };
  // Until the browser's socket attaches, this is what says a running turn has not ended: its prompt has no outcome yet.
  const turnOpen = (chatId) => {
    // A compaction outside a turn is not one: the transcript has no prompt waiting on it.
    const record = backends.getByChatId(chatId);
    return Boolean(record && (record.active || record.turnStarting || record.stopping));
  };

  async function transcriptFor(context) {
    const projection = await backends.forChat(context.chat).readTranscript({
      chatId: context.chat.id,
      opaqueSession: context.chat.backend?.opaqueSession,
      project: context.project,
    });
    if (context.chat.backend?.implementation !== "conduit-runtime") return transcriptFromMessages(projection.messages || []).trim();
    const tools = new Map((projection.tools || []).map((tool) => [tool.toolCallId, tool]));
    const sections = [];
    // Bound added tool text per result and per export; message text stays unchanged.
    let remaining = 1024 * 1024;
    let truncated = false;
    // Fenced longer than any run of backticks inside, so tool text cannot end its own block.
    const includeTool = (text, info = "") => {
      const limit = Math.min(32 * 1024, remaining);
      if (!limit) { truncated = true; return ""; }
      const kept = text.slice(0, limit);
      remaining -= kept.length;
      const fence = "`".repeat(Math.max(3, ...[...kept.matchAll(/`+/g)].map((run) => run[0].length + 1)));
      return `${fence}${info}\n${kept.replace(/\n+$/, "")}\n${fence}${text.length > limit ? "\n\n[Tool text truncated]" : ""}`;
    };
    for (const message of projection.messages || []) {
      const text = transcriptFromMessages([message]);
      if (text) sections.push(text);
      for (const block of Array.isArray(message.blocks) ? message.blocks : []) {
        if (block?.kind !== "tool_call") continue;
        if (!remaining) { truncated = true; continue; }
        const tool = tools.get(block.toolCallId);
        const input = block.input ?? tool?.input;
        let argumentsText;
        try { argumentsText = JSON.stringify(input ?? {}, null, 2); }
        catch { argumentsText = "[Tool arguments unavailable]"; }
        const call = includeTool(argumentsText, "json");
        if (call) sections.push(`## Tool call: ${block.name || tool?.name || "tool"}\n\n${call}`);
        if (typeof tool?.output === "string" && tool.output.trim()) {
          const output = includeTool(tool.output);
          if (output) sections.push(`## Tool result\n\n${output}`);
        }
      }
    }
    if (truncated) sections.push("[Further tool text omitted: export tool-text limit reached]");
    return sections.join("\n\n").trim();
  }

  app.get("/v0/sessions/:id/context", async (request, response) => {
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
  });

  app.post("/v0/sessions/:id/context/breakdown", async (request, response) => {
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const adapter = backends.forChat(context.chat);
    if (!adapter.contextBreakdown) return response.status(409).json({ error: "breakdown_unavailable" });
    response.json(await adapter.contextBreakdown({ opaqueSession: context.chat.backend?.opaqueSession, project: context.project }) || {});
  });

  app.get("/v0/sessions/:id", async (request, response) => {
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
    if (chatLogs?.timings) projection.messages = await chatLogs.timings.decorate(context.chat.id, projection.messages);
    response.json({ ...chatView(context.chat), turnOpen: turnOpen(context.chat.id),
      ...upToDate(context, projection, projection.page, request.query.before), attachments: [],
      page: projection.page || { before: null } });
  });

  app.get("/v0/sessions/:id/transcript", async (request, response) => {
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    response.type("text/markdown").send(await transcriptFor(context));
  });

  app.post("/v0/sessions/:id/read", async (request, response) => {
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    // The body echoes a completion timestamp this server issued, so the
    // watermark never depends on the browser's clock.
    const upTo = typeof request.body?.upTo === "string" ? request.body.upTo : null;
    await registry.markRead(context.chat.id, upTo);
    response.json(chatView(registry.metadata(context.chat.id)));
  });

  app.patch("/v0/sessions/:id", async (request, response) => {
    const name = String(request.body?.name || "").trim();
    if (!name) return response.status(400).json({ error: "session_name_required" });
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    await registry.update(context.chat.id, { title: name });
    response.json(chatView(registry.metadata(context.chat.id)));
  });

  app.post("/v0/sessions/:id/auto-name", async (request, response) => {
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

  app.delete("/v0/sessions/:id", async (request, response) => {
    if (!isChatId(request.params.id)) return response.status(404).json({ error: "chat_not_found" });
    const deleted = await lifecycle.deleteChat(request.params.id, async () => {
      const context = await findChatContext(request.params.id);
      if (!context) return false;
      return lifecycle.withProjects([context.project.id], async () => {
        await discardSession(backends, context.chat, registry);
        await registry.remove(context.chat.id, context.project);
        // The draft goes with the chat; nothing else ever removes one.
        await drafts.dropChat(context.chat.id);
        await chatLogs?.timings?.forget(context.chat.id);
        return true;
      });
    });
    if (!deleted) return response.status(404).json({ error: "chat_not_found" });
    response.status(204).end();
  });
}
