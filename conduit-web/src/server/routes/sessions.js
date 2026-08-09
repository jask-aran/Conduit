import path from "node:path";
import { chatView, isChatId } from "../../chat-store.js";
import {
  messagesFromEntries,
  removeSessionFamily,
  renameSession,
  sessionFamilyFiles,
  toolsFromEntries,
  transcriptFromEntries,
} from "../../session-store.js";
import {
  findDeletableSession,
  moveRegisteredChat,
  sessionDirectoryForChat,
  stopSessionFamilyProcesses,
  stopSessionProcesses,
} from "../../session-operations.js";

export function registerSessionRoutes(app, {
  config,
  findChatContext,
  findRegisteredSession,
  lifecycle,
  manager,
  projects,
  readSessionPage,
  registry,
}) {
  app.get("/v0/sessions/:id", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      if (!context.chat.piSessionFile) return response.json({
        ...chatView(context.chat), messages: [], tools: [], attachments: [], page: { before: null },
      });
      let session;
      try {
        session = await readSessionPage(context.chat.piSessionFile, context.project, { before: request.query.before });
      } catch (error) {
        if (error.code === "ENOENT") return response.json({
          ...chatView(context.chat), messages: [], tools: [], attachments: [], page: { before: null },
        });
        throw error;
      }
      const messages = messagesFromEntries(session.entries).filter((message) => ["user", "assistant"].includes(message.role));
      response.json({
        ...chatView(context.chat),
        model: session.model,
        thinkingLevel: session.thinkingLevel,
        messages,
        tools: toolsFromEntries(session.entries).map((tool) => ({ ...tool, result: tool.result?.length > 4000 ? null : tool.result, resultDeferred: tool.result?.length > 4000 })),
        page: session.page,
      });
    } catch (error) { next(error); }
  });

  app.get("/v0/sessions/:id/transcript", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const session = await findRegisteredSession(request.params.id);
      response.type("text/markdown").send(session ? transcriptFromEntries(session.entries) : "");
    } catch (error) { next(error); }
  });

  app.get("/v0/sessions/:id/tools/:toolId", async (request, response, next) => {
    try {
      const session = await findRegisteredSession(request.params.id);
      if (!session) return response.status(404).json({ error: "session_not_found" });
      const tool = toolsFromEntries(session.entries).find((item) => item.id === request.params.toolId);
      if (!tool) return response.status(404).json({ error: "tool_not_found" });
      response.json({ id: tool.id, result: tool.result ?? null });
    } catch (error) { next(error); }
  });

  app.patch("/v0/sessions/:id", async (request, response, next) => {
    try {
      const name = String(request.body?.name || "").trim();
      if (!name) return response.status(400).json({ error: "session_name_required" });
      const projectList = await projects.list();
      const context = await findChatContext(request.params.id);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const live = manager.list().find((item) => (
        item.chatId === context.chat.id && ["starting", "running"].includes(item.status)
      ));
      if (live?.status === "running") {
        await manager.setSessionName(live.id, name);
        await registry.update(context.chat.id, { title: name });
      } else if (live) {
        await registry.update(context.chat.id, { title: name });
      } else {
        const session = await registry.find(projectList, request.params.id);
        if (session) {
          const renamed = await renameSession(session, context.project, name);
          await registry.commitSession(context.chat.id, renamed);
        } else {
          await registry.update(context.chat.id, { title: name });
        }
      }
      response.json(chatView(registry.metadata(context.chat.id)));
    } catch (error) { next(error); }
  });

  app.post("/v0/sessions/:id/duplicate", (_request, response) => {
    response.status(409).json({ error: "chat_duplication_deferred", message: "Chat duplication is unavailable while attachment ownership is unsettled." });
  });

  app.post("/v0/sessions/:id/move", async (request, response, next) => {
    try {
      if (!isChatId(request.params.id)) return response.status(404).json({ error: "chat_not_found" });
      const moved = await lifecycle.run(request.params.id, async () => {
        const context = await findChatContext(request.params.id);
        if (!context) return null;
        const projectList = await projects.list();
        const target = projectList.find((item) => item.id === request.body?.projectId || item.slug === request.body?.projectId);
        if (!target) return { error: "project_not_found", status: 404 };
        return lifecycle.withProjects([context.project.id, target.id], async () => {
          const current = await findChatContext(request.params.id);
          if (!current) return null;
          if (current.chat.runtime?.kind === "native_pi") return { error: "chat_move_not_supported", status: 409, message: "Host Pi chats cannot move between working roots." };
          if (current.chat.projectId === target.id) return { error: "session_project_unchanged", status: 409 };
          await projects.validate(target);
          const session = await registry.find(await projects.list(), current.chat.id);
          await stopSessionProcesses(manager, current.chat);
          lifecycle.assertAvailable(current.chat.id, current.project.id);
          lifecycle.assertAvailable(current.chat.id, target.id);
          await moveRegisteredChat({ chat: current.chat, source: current.project, target, session, registry });
          return { chat: chatView(registry.metadata(current.chat.id)) };
        });
      });
      if (!moved) return response.status(404).json({ error: "chat_not_found" });
      if (moved.error) return response.status(moved.status).json({ error: moved.error, message: moved.message });
      response.json(moved.chat);
    } catch (error) { next(error); }
  });

  app.delete("/v0/sessions/:id", async (request, response, next) => {
    try {
      if (!isChatId(request.params.id)) return response.status(404).json({ error: "chat_not_found" });
      const deleted = await lifecycle.deleteChat(request.params.id, async () => {
        const context = await findChatContext(request.params.id);
        if (!context) return false;
        return lifecycle.withProjects([context.project.id], async () => {
          const session = await findDeletableSession(registry, await projects.list(), context.chat);
          const sessionOptions = { sessionsDir: sessionDirectoryForChat(config, context.chat, context.project) };
          const family = session ? await sessionFamilyFiles(session.file, context.project, sessionOptions) : [];
          await stopSessionFamilyProcesses(manager, context.chat, family);
          if (session) await removeSessionFamily(session.file, context.project, sessionOptions);
          const familyFiles = new Set(family.map((file) => path.resolve(file)));
          const relatedChats = registry.listProject(context.project.id, { includeHidden: true })
            .filter((chat) => chat.id === context.chat.id
              || (chat.piSessionFile && familyFiles.has(path.resolve(chat.piSessionFile))));
          await Promise.all(relatedChats.map((chat) => registry.remove(chat.id, context.project)));
          return true;
        });
      });
      if (!deleted) return response.status(404).json({ error: "chat_not_found" });
      response.status(204).end();
    } catch (error) { next(error); }
  });
}
