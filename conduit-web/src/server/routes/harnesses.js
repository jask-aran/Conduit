import crypto from "node:crypto";
import { rememberModel, rememberedModel } from "../../profile-model-memory.js";
import fs from "node:fs/promises";
import { chatView } from "../../chat-store.js";
import { computerContext } from "../../computer-context.js";
import { groupThreadsByFolder, trackedByThread } from "../../harness-threads.js";
import { MANIFESTS } from "../../harnesses/index.js";

// Pi is built in rather than a harness the dashboard offers, so it is the one
// manifest this surface excludes.
const HARNESS_MANIFESTS = MANIFESTS.filter((manifest) => !manifest.builtIn);
const SUPPORTED = new Set(HARNESS_MANIFESTS.map((manifest) => manifest.id));

// `discovery` says how far a harness can see: "machine" lists every thread it
// knows about, "none" has no history to offer. The dashboard renders from this
// rather than special-casing an implementation.
export function harnessCatalog(backends) {
  return HARNESS_MANIFESTS.map((manifest) => ({
    id: manifest.id,
    label: manifest.label,
    profileLabel: manifest.profileLabel || manifest.label,
    available: backends.adapters.has(manifest.id),
    sessions: manifest.discovery !== "none",
    drive: manifest.drive,
    discovery: manifest.discovery,
  }));
}

const isDirectory = (target) => fs.stat(target).then((stat) => stat.isDirectory(), () => false);

// A folder named by the client is untrusted: resolve it once, and report a
// missing or unreadable path as a bad request rather than a server fault.
const resolveFolder = async (target) => {
  try { return await computerContext(target); }
  catch (cause) {
    throw Object.assign(new Error("Folder is unavailable on this Computer"), {
      status: cause.status || 400, code: cause.code || "computer_path_invalid",
    });
  }
};

const opaqueSessionId = (chat) => typeof chat.backend?.opaqueSession === "string"
  ? chat.backend.opaqueSession
  : chat.backend?.opaqueSession?.threadId || null;

export function registerHarnessRoutes(app, { backends, harnessModels, preferences, projects, registry }) {

  // Listing permission modes without a chat costs a throwaway harness process,
  // so the answer is cached per folder and refreshed in the background exactly
  // as the model catalogue is.
  const permissionCatalogs = new Map();
  const permissionCatalogRequests = new Map();
  const refreshPermissionModes = (implementation, cwd, adapter) => {
    const key = `${implementation}\0${cwd}`;
    const existing = permissionCatalogRequests.get(key);
    if (existing) return existing;
    const request = adapter.listAvailablePermissionModes(cwd)
      .then((modes) => { permissionCatalogs.set(key, modes); return modes; })
      .finally(() => permissionCatalogRequests.delete(key));
    permissionCatalogRequests.set(key, request);
    return request;
  };

  // `?refresh=1` re-probes, so installing a harness does not need a restart.
  app.get("/v0/harnesses", async (request, response) => {
    if (request.query.refresh) await backends.refreshDetection?.();
    const harnesses = await Promise.all(harnessCatalog(backends).map(async (item) => {
      // Detection already answered installed / version / signed-in for every
      // harness; only a backend that can report live health refines it.
      const probe = backends.detection?.get(item.id) || null;
      const row = probe ? { ...item, status: probe.status, version: probe.version } : item;
      const adapter = item.available ? backends.adapters.get(item.id) : null;
      if (!adapter?.health) return row;
      try {
        const health = await adapter.health();
        return { ...row, status: health.configured ? "ready" : "authentication_required",
          version: health.transportVersion || row.version || null };
      } catch {
        return { ...row, status: "unavailable" };
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

  // Machine-wide thread discovery. Folders come from the threads themselves,
  // so this deliberately does not require - or create - a Conduit project.
  app.get("/v0/harnesses/:implementation/threads", async (request, response, next) => {
    try {
      const implementation = request.params.implementation;
      if (!SUPPORTED.has(implementation) || !backends.adapters.has(implementation)) {
        return response.status(404).json({ error: "harness_not_found" });
      }
      const adapter = backends.forImplementation(implementation);
      if (!adapter.listThreads) return response.json({ scope: "none", groups: [], truncated: false });
      const limit = Math.min(Math.max(Number(request.query.limit) || 60, 1), 200);
      const requested = typeof request.query.path === "string" && request.query.path ? request.query.path : null;
      const cwd = requested ? (await resolveFolder(requested)).workingRoot : undefined;
      const threads = await adapter.listThreads({ cwd, limit });
      const tracked = trackedByThread(registry.list({ includeHidden: true }), implementation);
      const groups = groupThreadsByFolder(threads, { tracked });
      await Promise.all(groups.map(async (group) => { group.missing = !(await isDirectory(group.path)); }));
      response.json({ scope: requested ? "folder" : "machine", groups, truncated: threads.length >= limit });
    } catch (error) { next(error); }
  });

  app.get("/v0/harnesses/:implementation/models", async (request, response, next) => {
    try {
      const implementation = request.params.implementation;
      if (!SUPPORTED.has(implementation) || !backends.adapters.has(implementation)) {
        return response.status(404).json({ error: "harness_not_found" });
      }
      const adapter = backends.forImplementation(implementation);
      if (!adapter.listAvailableModels) return response.status(409).json({ error: "harness_models_unavailable" });
      const requested = typeof request.query.path === "string" && request.query.path ? request.query.path : null;
      const cwd = requested ? (await resolveFolder(requested)).workingRoot : (await computerContext()).workingRoot;
      const remembered = rememberedModel(preferences, implementation);
      const models = await harnessModels.list(implementation, cwd, adapter, { require: remembered?.model || "" });
      const rememberedModel = models.some((item) => item.spec === remembered?.model) ? remembered.model : "";
      const model = rememberedModel || models[0]?.spec || "";
      // The profile's model is gone and this is a stand-in, which the composer
      // says out loud rather than opening on a model nobody chose.
      const modelFallback = remembered?.model && !rememberedModel && model
        ? { from: remembered.model, to: model }
        : null;
      const selected = models.find((item) => item.spec === model);
      const thinkingLevel = rememberedModel && selected?.thinkingLevels.includes(remembered?.thinkingLevel)
        ? remembered.thinkingLevel
        : selected?.defaultThinkingLevel || selected?.thinkingLevels[0] || "";
      response.json({
        installationId: backends.manifestFor(implementation)?.installationId || implementation,
        runtimeKind: implementation,
        models,
        model,
        thinkingLevel,
        defaultModel: models[0]?.spec || "",
        defaultThinkingLevel: selected?.defaultThinkingLevel || selected?.thinkingLevels[0] || "",
        requiresAuthentication: false,
        warnings: [],
        ...(modelFallback ? { modelFallback } : {}),
        source: "catalog",
      });
    } catch (error) { next(error); }
  });

  // The launch composer has no chat to PATCH, so a model chosen there would
  // otherwise only stick once a message created one. The choice is the
  // decision: it is remembered for the profile the moment it is made.
  app.patch("/v0/harnesses/:implementation/models", async (request, response, next) => {
    try {
      const implementation = request.params.implementation;
      if (!SUPPORTED.has(implementation) || !backends.adapters.has(implementation)) {
        return response.status(404).json({ error: "harness_not_found" });
      }
      const adapter = backends.forImplementation(implementation);
      if (!adapter.listAvailableModels) return response.status(409).json({ error: "harness_models_unavailable" });
      const model = String(request.body?.model || "").trim();
      const thinkingLevel = String(request.body?.thinkingLevel || "").trim();
      if (!model) return response.status(400).json({ error: "invalid_model" });
      const requested = typeof request.body?.path === "string" && request.body.path ? request.body.path : null;
      const cwd = requested ? (await resolveFolder(requested)).workingRoot : (await computerContext()).workingRoot;
      const models = await harnessModels.list(implementation, cwd, adapter, { require: model });
      const selected = models.find((item) => item.spec === model);
      if (!selected) return response.status(400).json({ error: "invalid_model" });
      if (thinkingLevel && selected.thinkingLevels.length && !selected.thinkingLevels.includes(thinkingLevel)) {
        return response.status(400).json({ error: "invalid_thinking_level" });
      }
      await rememberModel(preferences, implementation, model, thinkingLevel);
      response.json({ model, thinkingLevel });
    } catch (error) { next(error); }
  });

  // The same answer `/v0/chats/:chatId/permission-profiles` gives, for a chat
  // that does not exist yet: the launch composer offers the choice up front so
  // the first message starts under the mode somebody picked, rather than under
  // whatever the harness defaults to.
  app.get("/v0/harnesses/:implementation/permission-modes", async (request, response, next) => {
    try {
      const implementation = request.params.implementation;
      if (!SUPPORTED.has(implementation) || !backends.adapters.has(implementation)) {
        return response.status(404).json({ error: "harness_not_found" });
      }
      const adapter = backends.forImplementation(implementation);
      if (!adapter.getCapabilities().permissionModes || typeof adapter.listAvailablePermissionModes !== "function") {
        return response.json({ modes: [], selected: "" });
      }
      const requested = typeof request.query.path === "string" && request.query.path ? request.query.path : null;
      const cwd = requested ? (await resolveFolder(requested)).workingRoot : (await computerContext()).workingRoot;
      const key = `${implementation}\0${cwd}`;
      let modes = permissionCatalogs.get(key);
      if (modes) void refreshPermissionModes(implementation, cwd, adapter).catch(() => {});
      else modes = await refreshPermissionModes(implementation, cwd, adapter);
      const selected = (modes.some((mode) => mode.id === "custom") ? "custom" : modes[0]?.id) || "";
      response.json({ modes, selected });
    } catch (error) { next(error); }
  });

  app.post("/v0/harnesses/:implementation/drive", async (request, response, next) => {
    try {
      const implementation = request.params.implementation;
      if (!backends.manifestFor?.(implementation)?.drive || !backends.adapters.has(implementation)) {
        return response.status(409).json({ error: "harness_drive_unavailable" });
      }
      // A drive target is either a registered project or any folder on the
      // Computer - threads live wherever the harness was run, not only in
      // workspaces Conduit knows about.
      const requestedPath = typeof request.body?.path === "string" && request.body.path ? request.body.path : null;
      const project = requestedPath ? await resolveFolder(requestedPath) : await projects.get(request.body?.projectId);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (!requestedPath) await projects.validate(project);
      const adapter = backends.forImplementation(implementation);
      const chatId = `drive:${crypto.randomUUID()}`;
      if (request.body?.newThread) {
        const started = await adapter.create({ chatId, project });
        started.ephemeral = true;
        return response.status(201).json({ ...adapter.view(started), nativeSessionId: started.sessionId,
          streamUrl: `/v0/live-sessions/${started.id}/stream` });
      }
      const session = (await adapter.listThreads({ cwd: project.workingRoot }))
        .find((item) => item.id === request.body?.sessionId);
      if (!session) return response.status(404).json({ error: "backend_session_not_found" });
      const record = await adapter.restore({ threadId: session.id }, {
        chatId,
        project,
      });
      record.ephemeral = true;
      response.status(201).json({ ...adapter.view(record), nativeSessionId: session.id,
        streamUrl: `/v0/live-sessions/${record.id}/stream` });
    } catch (error) { next(error); }
  });
}
