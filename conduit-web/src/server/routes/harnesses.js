import crypto from "node:crypto";
import { chatView } from "../../chat-store.js";

const SUPPORTED = new Set(["codex", "chatgpt-web"]);

export function harnessCatalog(backends) {
  return [
    { id: "codex", label: "Codex", available: backends.adapters.has("codex"), sessions: true, drive: true },
    { id: "chatgpt-web", label: "ChatGPT Web", available: backends.adapters.has("chatgpt-web"), sessions: false, drive: false },
  ];
}

const opaqueSessionId = (chat) => typeof chat.backend?.opaqueSession === "string"
  ? chat.backend.opaqueSession
  : chat.backend?.opaqueSession?.threadId || null;

export function registerHarnessRoutes(app, { backends, projects, registry }) {
  app.get("/v0/harnesses", async (_request, response) => {
    const harnesses = await Promise.all(harnessCatalog(backends).map(async (item) => {
      if (!item.available || item.id !== "chatgpt-web") return item;
      try {
        const health = await backends.forImplementation(item.id).health();
        return { ...item, status: health.configured ? "ready" : "authentication_required", version: health.transportVersion || null };
      } catch {
        return { ...item, status: "unavailable" };
      }
    }));
    response.json({ harnesses });
  });

  app.get("/v0/harnesses/:implementation/sessions", async (request, response, next) => {
    try {
      const implementation = request.params.implementation;
      if (!SUPPORTED.has(implementation) || !backends.adapters.has(implementation)) {
        return response.status(404).json({ error: "harness_not_found" });
      }
      const project = await projects.get(request.query.projectId);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await projects.validate(project);
      const adapter = backends.forImplementation(implementation);
      if (!adapter.listSessions) return response.json({ tracked: [], sessions: [], replayFidelity: "from-now" });
      const sessions = await adapter.listSessions({ cwd: project.workingRoot });
      const tracked = registry.list({ includeHidden: true }).filter((chat) =>
        chat.projectId === project.id && chat.backend?.implementation === implementation);
      const trackedIds = new Set(tracked.map(opaqueSessionId).filter(Boolean));
      response.json({ tracked: tracked.map(chatView), sessions: sessions.filter((session) => !trackedIds.has(session.id)), replayFidelity: "full" });
    } catch (error) { next(error); }
  });

  app.post("/v0/harnesses/:implementation/drive", async (request, response, next) => {
    try {
      const implementation = request.params.implementation;
      if (implementation !== "codex" || !backends.adapters.has(implementation)) {
        return response.status(409).json({ error: "harness_drive_unavailable" });
      }
      const project = await projects.get(request.body?.projectId);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await projects.validate(project);
      const adapter = backends.forImplementation(implementation);
      const session = (await adapter.listSessions({ cwd: project.workingRoot }))
        .find((item) => item.id === request.body?.sessionId);
      if (!session) return response.status(404).json({ error: "backend_session_not_found" });
      const record = await adapter.restore({ threadId: session.id }, {
        chatId: `drive:${crypto.randomUUID()}`,
        project,
      });
      record.ephemeral = true;
      response.status(201).json({ ...adapter.view(record), nativeSessionId: session.id,
        streamUrl: `/v0/live-sessions/${record.id}/stream` });
    } catch (error) { next(error); }
  });
}
