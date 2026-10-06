import { resolveTemplate } from "../../config.js";
import { isChatId } from "../../chat-store.js";
import { agentProfiles } from "../../chat-backend.js";

const failure = (code, message, status) => Object.assign(new Error(message), { code, status });
const text = (content) => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part) => part?.text || "").join("") : "";

/**
 * Agent runs with no chat page behind them.
 *
 * A run is a chat like any other -- the same launch, caps, warm agents, names
 * and transcript -- that nobody opened: it is untracked, so no list of chats
 * shows it, and it is driven and read over HTTP instead of a browser socket.
 * What a run says is what its chat's log says, so a run is read from the same
 * statements every client folds.
 */
export function registerRunRoutes(app, {
  backends, chatLogs, config, defaultTemplate, launchLiveSession, projects, registry, runtimeFor, stopGeneration, submitPrompt,
}) {
  /** Where a run stands, from what its chat has stated. */
  const runView = (chat) => {
    const stated = chatLogs.get(chat.id)?.stated || { messages: [] };
    const promptIndex = stated.messages.findLastIndex((message) => message.role === "user");
    const prompt = stated.messages[promptIndex];
    const answer = promptIndex < 0 ? null
      : stated.messages.slice(promptIndex + 1).findLast((message) => message.role === "assistant" && !message.interim);
    const live = backends.getByChatId(chat.id);
    const status = prompt?.outcome ? "settled" : live ? "running" : "lost";
    return {
      id: chat.id, chatId: chat.id, projectId: chat.projectId, status,
      outcome: prompt?.outcome || null,
      answer: answer ? text(answer.content) : null,
      waiting: Boolean(live?.hostUiRequests?.length),
      createdAt: chat.createdAt, updatedAt: chat.updatedAt,
    };
  };

  const runChat = (id) => {
    const chat = isChatId(id) ? registry.metadata(id) : null;
    return chat?.untracked && chat.run ? chat : null;
  };

  app.post("/v0/runs", async (request, response, next) => {
    try {
      const prompt = String(request.body?.prompt || "").trim();
      if (!prompt) throw failure("invalid_prompt", "A run needs a prompt", 400);
      const project = await projects.get(request.body?.projectId || "chat");
      if (!project) throw failure("project_not_found", "Project not found", 404);
      await projects.validate(project);
      const profileId = request.body?.profileId || project.defaultTemplateId || null;
      // Any profile a chat can be made with: a harness's own, or a Conduit Pi one.
      const harness = profileId && agentProfiles(config.piTemplates, { available: new Set(backends.adapters.keys()) })
        .find((profile) => profile.id === profileId && profile.management === "agent");
      let chat;
      if (harness) {
        if (harness.disabled || !backends.adapters.has(harness.agent.implementation)) throw failure(`${profileId}_unavailable`, `${profileId} is unavailable`, 409);
        chat = await registry.create(project, { untracked: true, run: true, backend: {
          profileId, profileRevision: null, management: harness.management, ...harness.agent, opaqueSession: null,
        } });
      } else {
        const template = profileId ? resolveTemplate(config, profileId) : defaultTemplate();
        if (!template || template.defaultable === false) throw failure("unknown_profile", `Unknown profile: ${profileId}`, 400);
        chat = await registry.create(project, {
          templateId: template.id, templateVersion: template.version,
          runtime: runtimeFor({ runtimeKind: "conduit_profile", template }), untracked: true, run: true,
        });
      }
      const model = String(request.body?.model || "");
      const thinkingLevel = String(request.body?.thinkingLevel || "");
      await launchLiveSession({ chatId: chat.id, requestedProject: project.id, model, thinkingLevel, forceModel: Boolean(model) });
      const generationId = await submitPrompt(chat.id, prompt);
      response.status(201).json({ ...runView(registry.metadata(chat.id)), generationId,
        eventsUrl: `/v0/runs/${chat.id}/events` });
    } catch (error) { next(error); }
  });

  app.get("/v0/runs/:id", (request, response) => {
    const chat = runChat(request.params.id);
    if (!chat) return response.status(404).json({ error: "run_not_found" });
    response.json(runView(chat));
  });

  /**
   * The run as it is written, as server-sent events: each numbered statement
   * of its chat's log, from `since` on, then live until the turn settles or
   * the reader leaves. Paint (deltas) is not sent; every message is stated in
   * full when it closes.
   */
  app.get("/v0/runs/:id/events", (request, response) => {
    const chat = runChat(request.params.id);
    if (!chat) return response.status(404).json({ error: "run_not_found" });
    const log = chatLogs.get(chat.id);
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (event) => response.write(`id: ${event.log?.seq ?? ""}\ndata: ${JSON.stringify(event)}\n\n`);
    const since = Number(request.query.since ?? request.headers["last-event-id"] ?? 0);
    for (const event of log.since(log.id, Number.isInteger(since) ? since : 0) || log.entries) send(event);
    const end = () => { stop(); response.end(); };
    const stop = log.follow((event) => {
      send(event);
      if (event.type === "transcript_op" && event.op === "turn.settle") end();
    });
    if (runView(chat).status !== "running") end();
    request.on("close", stop);
  });

  /** Another prompt in the same run, once the last has settled. */
  app.post("/v0/runs/:id/messages", async (request, response, next) => {
    try {
      const chat = runChat(request.params.id);
      if (!chat) return response.status(404).json({ error: "run_not_found" });
      const prompt = String(request.body?.prompt || "").trim();
      if (!prompt) throw failure("invalid_prompt", "A run needs a prompt", 400);
      if (runView(chat).status === "running") throw failure("run_busy", "The run is still answering", 409);
      const model = String(request.body?.model || "");
      await launchLiveSession({ chatId: chat.id, model, forceModel: Boolean(model) });
      const generationId = await submitPrompt(chat.id, prompt);
      response.status(201).json({ ...runView(registry.metadata(chat.id)), generationId });
    } catch (error) { next(error); }
  });

  app.post("/v0/runs/:id/stop", async (request, response, next) => {
    try {
      const chat = runChat(request.params.id);
      if (!chat) return response.status(404).json({ error: "run_not_found" });
      if (backends.getByChatId(chat.id)) await stopGeneration(chat.id);
      response.json(runView(chat));
    } catch (error) { next(error); }
  });
}
