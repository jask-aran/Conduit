import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { WebSocketServer } from "ws";
import { loadConfig, resolveTemplate } from "./config.js";
import { PiModelCatalog } from "./pi-model-catalog.js";
import { ProjectStore } from "./project-store.js";
import { duplicateSession, messagesFromEntries, readAnnouncedAttachmentIds, readSessionMetadata, readSessionPage, removeProjectSessions, removeSession, removeSessionFamily, renameSession, sessionDirectoryFor, sessionFamilyFiles, settingsFromEntries, toolsFromEntries, transcriptFromEntries, validateSessionFile, validateSessionHeader } from "./session-store.js";
import { PiManager } from "./pi-manager.js";
import { ChatStore, chatView, isChatId } from "./chat-store.js";
import { AttachmentStore } from "./attachment-store.js";
import { RuntimeHub } from "./runtime-hub.js";
import { defaultsFromEnv, RuntimeSettingsStore } from "./runtime-settings.js";
import { PreferencesStore } from "./preferences-store.js";
import { templatePublicView } from "../../scripts/pi-runtime.mjs";
import { isPathInside, listDirectorySuggestions } from "./workspace-paths.js";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import { resolvePiLaunch } from "./pi-launch.js";
import { validateNativeProjectResources } from "./native-resource-validation.js";
import { AuthStore } from "./auth-store.js";
import { PiAuthBroker } from "./pi-auth-broker.js";
import { ChatLifecycle } from "./chat-lifecycle.js";
import {
  authStartupViolation,
  prepareAuthMiddleware,
  validateSession,
} from "./auth-middleware.js";
import { listWorkspaceDirectory, readWorkspaceDiff, readWorkspaceFile } from "./workspace-inspector.js";
import { currentMagicDnsOrigin } from "./tailscale-share.js";
import { buildProjectDashboard } from "./project-dashboard.js";
import { PtyManager } from "./pty-manager.js";
import { createLiveSessionStream } from "./server/live-session-stream.js";
import { createTerminalStream } from "./server/terminal-stream.js";
import { registerAttachmentRoutes } from "./server/routes/attachments.js";
import { registerAuthRoutes } from "./server/routes/auth.js";
import { registerPiAuthRoutes } from "./server/routes/pi-auth.js";
import { registerPtyRoutes } from "./server/routes/ptys.js";
import { registerRuntimeRoutes } from "./server/routes/runtime.js";

const config = loadConfig();
const projects = new ProjectStore(config);
await projects.initialize();
const terminals = new PtyManager({ filePath: config.remotesFile });
await terminals.load();
async function clearHostPiDefaults() {
  const changed = [];
  for (const project of await projects.list()) {
    if (project.kind !== "workspace" || project.defaultTemplateId !== "host-pi") continue;
    changed.push(await projects.update(project.id, { defaultTemplateId: null }));
  }
  return changed;
}
if (!config.installations.get("host-pi").available) await clearHostPiDefaults();
const pinnedInstallation = config.installations.get("conduit-pinned");
const registry = new ChatStore(config.sessionRegistryFile, {
  defaultRuntime: {
    kind: "conduit_profile",
    installationId: pinnedInstallation.id,
    binaryVersion: pinnedInstallation.version,
    profileId: config.piTemplate.id,
    profileVersion: config.piTemplate.version,
  },
});
await registry.initialize(await projects.list());
const attachments = new AttachmentStore(registry, { maxBytes: config.maxAttachmentBytes });
const runtimeSettings = new RuntimeSettingsStore(config.runtimeSettingsFile, defaultsFromEnv(process.env));
await runtimeSettings.load();
const knownTemplateIds = config.piTemplates
  .filter((template) => template.defaultable !== false)
  .map((template) => template.id);
const preferences = new PreferencesStore(
  config.preferencesFile,
  { defaultTemplateId: config.piTemplate.id },
  { knownTemplateIds },
);
await preferences.load();
const authStore = new AuthStore(config.authFile);
await authStore.load();
await authStore.pruneExpired();
const startupViolation = authStartupViolation(config, authStore);
if (startupViolation) {
  console.error(startupViolation.message);
  process.exit(1);
}
const manager = new PiManager({
  command: config.piCommand,
  agentDir: config.piAgentDir,
  template: config.piTemplate,
  maxLiveProcesses: runtimeSettings.get().maxLiveProcesses,
  maxGeneratingProcesses: runtimeSettings.get().maxGeneratingProcesses,
  idleProcessTtlMs: runtimeSettings.get().idleProcessTtlMs,
});
async function recycleIdleIsolatedPiProcesses() {
  const candidates = manager.liveRecords().filter((record) => record.runtime?.kind === "conduit_profile"
    && manager.isReclaimable(record));
  for (const record of candidates) {
    if (manager.isReclaimable(record)) await manager.stopAndWait(record.id);
  }
  return { restartedIdleProcesses: candidates.length };
}
const runtimeHub = new RuntimeHub({ listViews: () => manager.list() });
manager.on("process_changed", ({ record, reason }) => {
  runtimeHub.publishProcess(manager.view(record), reason || "update");
});
manager.on("process_removed", ({ id, chatId }) => {
  runtimeHub.publishProcessRemoved(id, chatId);
});
const modelCatalog = new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: config.piTemplate.models });
const piAuth = new PiAuthBroker({
  authStorage: modelCatalog.authStorage,
  modelRegistry: modelCatalog.modelRegistry,
  onCredentialsChanged: recycleIdleIsolatedPiProcesses,
});
const modelCatalogs = new Map();
const lifecycle = new ChatLifecycle();
const app = express();
const dist = process.env.CONDUIT_CLIENT_DIST
  ? path.resolve(process.env.CONDUIT_CLIENT_DIST)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

function defaultTemplate() {
  const selected = resolveTemplate(config, preferences.get().defaultTemplateId);
  return selected?.defaultable !== false ? selected : config.piTemplate;
}

function catalogFor(runtime, template) {
  const installation = config.installations.get(runtime.installationId);
  const key = runtime.kind === "native_pi"
    ? `host:${installation?.agentDir || "unavailable"}`
    : `isolated:${template?.id || config.piTemplate.id}`;
  if (!modelCatalogs.has(key)) {
    modelCatalogs.set(key, runtime.kind === "native_pi"
      ? new PiModelCatalog({ agentDir: installation.agentDir })
      : new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: template?.models || config.piTemplate.models }));
  }
  return modelCatalogs.get(key);
}

async function chatModelView(context) {
  const template = templateForChat(context.chat, context.project);
  const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
  const catalog = catalogFor(runtime, template);
  const catalogView = await catalog.list(context.project.path);
  let model = catalogView.defaultModel;
  let thinkingLevel = catalogView.defaultThinkingLevel;
  let source = "runtime_default";
  if (context.chat.piSessionFile) {
    try {
      const persisted = await readSessionMetadata(context.chat.piSessionFile, context.project);
      model = persisted.model || model;
      thinkingLevel = persisted.thinkingLevel || thinkingLevel;
      source = "jsonl";
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const resident = manager.getByChatId(context.chat.id);
  let models = catalogView.models;
  if (resident) {
    const [available, state] = await Promise.all([
      manager.getAvailableModels(resident.id),
      manager.getModelState(resident.id),
    ]);
    const enabled = new Set(catalogView.models.map((item) => item.spec));
    const liveModels = available.map((item) => catalog.modelView({ model: item }));
    models = enabled.size ? liveModels.filter((item) => enabled.has(item.spec)) : liveModels;
    model = state.model || model;
    thinkingLevel = state.thinkingLevel || thinkingLevel;
    const currentModel = liveModels.find((item) => item.spec === model);
    if (currentModel && !models.some((item) => item.spec === model)) models = [...models, currentModel];
    source = "live";
  }
  if (model && !models.some((item) => item.spec === model)) {
    const [provider, ...modelParts] = model.split("/");
    models = [...models, {
      provider,
      id: modelParts.join("/"),
      spec: model,
      label: modelParts.at(-1) || model,
      reasoning: thinkingLevel !== "off",
      thinkingLevels: thinkingLevel ? [...new Set(["off", thinkingLevel])] : ["off"],
      outsideScope: true,
    }];
  }
  return {
    installationId: runtime.installationId,
    runtimeKind: runtime.kind,
    models,
    model,
    thinkingLevel,
    modelThinkingLevels: context.chat.modelThinkingLevels || {},
    defaultModel: catalogView.defaultModel,
    defaultThinkingLevel: catalogView.defaultThinkingLevel,
    requiresAuthentication: catalogView.requiresAuthentication,
    warnings: catalogView.warnings,
    source,
  };
}

async function installationViews() {
  const project = await projects.get("chat");
  return Promise.all(config.installations.publicList().map(async (installation) => {
    if (!installation.available || !project) return { ...installation, models: null };
    const runtime = installation.id === "host-pi"
      ? { kind: "native_pi", installationId: installation.id }
      : { kind: "conduit_profile", installationId: installation.id };
    const catalog = catalogFor(runtime, config.piTemplate);
    try {
      const view = await catalog.list(project.path);
      return {
        ...installation,
        models: {
          access: installation.id === "host-pi" ? "read-only" : "managed",
          enabledModels: view.models.map((model) => model.spec),
          defaultModel: view.defaultModel,
          warnings: view.warnings,
        },
      };
    } catch (error) {
      return { ...installation, models: { access: "unavailable", enabledModels: [], defaultModel: null, warnings: [{ type: "warning", message: error.message }] } };
    }
  }));
}

function templateForId(templateId) {
  return resolveTemplate(config, templateId) || defaultTemplate();
}

function templateForChat(chat, project = null) {
  if (chat?.templateId) return templateForId(chat.templateId);
  if (project?.defaultTemplateId) return templateForId(project.defaultTemplateId);
  return defaultTemplate();
}

function runtimeFor({ runtimeKind = "conduit_profile", template }) {
  const installation = config.installations.get(runtimeKind === "native_pi" ? "host-pi" : "conduit-pinned");
  return runtimeKind === "native_pi"
    ? {
        kind: "native_pi",
        installationId: installation.id,
        binaryVersion: installation.version,
        profileId: null,
        profileVersion: null,
      }
    : {
        kind: "conduit_profile",
        installationId: installation.id,
        binaryVersion: installation.version,
        profileId: template.id,
        profileVersion: template.version,
      };
}

async function nativeResourceClasses(cwd) {
  const candidates = [
    [".pi/settings.json", "settings"],
    [".pi/extensions", "extensions"],
    [".pi/packages", "packages"],
    [".pi/skills", "skills"],
    [".pi/prompts", "prompts"],
    [".pi/themes", "themes"],
    [".pi/SYSTEM.md", "system prompt"],
    [".pi/APPEND_SYSTEM.md", "appended system prompt"],
    [".agents/skills", "agent skills"],
  ];
  const found = [];
  for (const [relative, label] of candidates) {
    try { await fs.access(path.join(cwd, relative)); found.push(label); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  let current = path.dirname(path.resolve(cwd));
  while (true) {
    const inherited = path.join(current, ".agents", "skills");
    if (inherited !== path.join(os.homedir(), ".agents", "skills")) {
      try { await fs.access(inherited); if (!found.includes("agent skills")) found.push("agent skills"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

async function nativePreflight(project) {
  const installation = config.installations.get("host-pi");
  if (!installation.available) {
    return { available: false, error: installation.error, version: installation.version, trustRequired: false, resources: [] };
  }
  const trustStore = new ProjectTrustStore(installation.agentDir);
  const decision = trustStore.get(project.path);
  const requiresResources = hasTrustRequiringProjectResources(project.path);
  const resources = requiresResources ? await nativeResourceClasses(project.path) : [];
  if (requiresResources) await validateNativeProjectResources(project.path);
  if (requiresResources && resources.length === 0) resources.push("inherited project resources");
  return {
    available: true,
    version: installation.version,
    savedTrust: decision,
    trustRequired: false,
    resources,
  };
}

async function ensureChatTemplate(chat, project = null) {
  if (!chat) return null;
  if (chat.templateId) return chat;
  const template = templateForChat(chat, project);
  return registry.ensureTemplate(chat.id, {
    templateId: template.id,
    templateVersion: template.version,
  });
}

app.use(compression());

const requireAuth = prepareAuthMiddleware(authStore);
app.use(requireAuth);

async function findRegisteredSession(id) {
  return registry.find(await projects.list(), id);
}

async function findChatContext(chatId) {
  if (!isChatId(chatId)) return null;
  let chat = registry.metadata(chatId);
  if (!chat) return null;
  const project = await projects.get(chat.projectId);
  if (!project) return null;
  await projects.validate(project);
  chat = await ensureChatTemplate(chat, project) || chat;
  return { chat, project };
}

registerAttachmentRoutes(app, { attachments, findChatContext });

app.use(express.json({ limit: "128kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

registerAuthRoutes(app, { authStore });

const pendingCheckpoints = new Set();
let shuttingDown = false;
manager.on("event", ({ record, event }) => {
  const chat = record.chatId ? registry.metadata(record.chatId) : null;
  const terminal = event.type === "agent_settled"
    || event.type === "generation_stopped"
    || (event.type === "agent_end" && !event.willRetry);
  const generation = record.activeGeneration;
  const checkpointId = generation ? `${record.id}:${generation.id}` : null;
  if (!terminal || !chat || !record.sessionFile || !checkpointId || pendingCheckpoints.has(checkpointId) || record.active) return;
  const checkpoint = { id: generation.id, seq: generation.lastSeq };
  pendingCheckpoints.add(checkpointId);
  setTimeout(() => {
    projects.get(record.projectId)
      .then((project) => project && registry.syncFile(record.chatId, record.sessionFile, project, { waitForFileMs: 2000 }))
      .then((session) => {
        if (!session) return null;
        record.lastCheckpoint = {
          type: "session_checkpoint",
          generationId: checkpoint.id,
          generationSeq: checkpoint.seq,
          chat: chatView(registry.metadata(record.chatId)),
        };
        manager.publish(record, record.lastCheckpoint);
        return session;
      })
      .catch((error) => console.error("Could not checkpoint the session registry", error))
      .finally(() => pendingCheckpoints.delete(checkpointId));
  }, 50).unref();
});
registerRuntimeRoutes(app, {
  attachments,
  config,
  currentMagicDnsOrigin,
  isPathInside,
  isShuttingDown: () => shuttingDown,
  listDirectorySuggestions,
  nativePreflight,
  preferences,
  resolveTemplate,
  runtimeHub,
  templatePublicView,
  projects,
});

registerPiAuthRoutes(app, {
  piAuth,
  installationViews,
  clearHostPiDefaults,
  detectHost: () => config.installations.detectHost(),
});

async function stopSessionProcesses(session) {
  const chatId = session.chatId || session.id;
  const sessionFile = session.piSessionFile || session.file;
  const matching = manager.list().filter((item) => item.chatId === chatId || (sessionFile && item.sessionFile === sessionFile));
  await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
}

async function stopSessionFamilyProcesses(chat, files) {
  const sessionFiles = new Set(files.map((file) => path.resolve(file)));
  const matching = manager.list().filter((item) => item.chatId === chat.id
    || (item.sessionFile && sessionFiles.has(path.resolve(item.sessionFile))));
  await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
}

function sessionDirectoryForChat(chat, project) {
  const installation = config.installations.get(chat.runtime?.installationId || "conduit-pinned");
  return installation ? sessionDirectoryFor(project.path, installation.agentDir) : project.sessionsDir;
}

async function findDeletableSession(projectList, chat) {
  try { return await registry.find(projectList, chat.id); }
  catch (error) {
    if (["ENOENT", "invalid_session_mapping", "session_cwd_mismatch"].includes(error.code)) return null;
    throw error;
  }
}

async function moveRegisteredChat({ chat, source, target, session }) {
  let duplicate = null;
  let folderMoved = false;
  try {
    if (session) duplicate = await duplicateSession(session, target);
    await registry.move(chat.id, source, target);
    folderMoved = true;
    if (duplicate) await registry.commitSession(chat.id, duplicate);
    if (session) await removeSession(session);
    return duplicate;
  } catch (error) {
    if (folderMoved) {
      await registry.move(chat.id, target, source).catch(() => {});
      if (session) await registry.commitSession(chat.id, session).catch(() => {});
    }
    if (duplicate) await removeSession(duplicate).catch(() => {});
    throw error;
  }
}

registerPtyRoutes(app, { projects, terminals });

app.get("/v0/projects", async (_request, response, next) => {
  try {
    const items = await projects.list();
    const live = manager.list();
    response.json({ projects: await Promise.all(items.map(async (project) => ({
      ...project,
      sessions: registry.listProject(project.id).map((chat) => {
        const process = live.find((item) => item.chatId === chat.id);
        return {
          ...chatView(chat),
          liveStatus: process?.status || null,
          liveId: process?.id || null,
          liveActivity: process?.activity || null,
          liveActive: process?.active || false,
        };
      }),
    }))), live });
  } catch (error) { next(error); }
});

app.get("/v0/projects/:id/dashboard", async (request, response, next) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", () => { if (!response.writableEnded) abort(); });
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await projects.validate(project);
    response.json(await buildProjectDashboard({
      project,
      registry,
      processes: manager.list(),
      terminals: terminals.list(),
      readPage: readSessionPage,
      inspectWorkspace: (root, options) => readWorkspaceDiff(root, { ...options, includePatch: false }),
      signal: controller.signal,
    }));
  } catch (error) {
    if (!request.aborted && !response.destroyed) next(error);
  } finally {
    request.removeListener("aborted", abort);
  }
});

function resolveProjectDefaultTemplateId(requested, fallback = null, { allowHostPi = false } = {}) {
  if (requested == null || requested === "") return fallback;
  if (requested === "host-pi" && allowHostPi) return requested;
  const template = resolveTemplate(config, requested);
  if (!template) {
    const error = new Error(`Unknown template: ${requested}`);
    error.code = "unknown_template";
    error.templateId = requested;
    throw error;
  }
  if (template.defaultable === false) {
    const error = new Error(`Template cannot be used as a project default: ${requested}`);
    error.code = "special_template";
    error.templateId = requested;
    throw error;
  }
  return requested;
}

app.post("/v0/workspaces/preview", async (request, response, next) => {
  try {
    const mode = String(request.body?.mode || "").trim().toLowerCase();
    if (!["link", "linked", "create", "created"].includes(mode)) {
      return response.status(400).json({ error: "workspace_preview_mode_invalid", message: "Preview supports linking or creating a folder" });
    }
    response.json(await projects.previewWorkspace({
      mode,
      path: request.body?.path,
      directoryName: request.body?.directoryName,
    }));
  } catch (error) { next(error); }
});

app.get("/v0/workspace-operations/:id", (request, response) => {
  const operation = projects.getCloneOperation(request.params.id);
  if (!operation) return response.status(404).json({ error: "workspace_operation_not_found" });
  response.json(operation);
});

app.delete("/v0/workspace-operations/:id", async (request, response, next) => {
  try {
    const operation = await projects.cancelCloneOperation(request.params.id);
    if (!operation) return response.status(404).json({ error: "workspace_operation_not_found" });
    response.json(operation);
  } catch (error) { next(error); }
});

app.post("/v0/projects", async (request, response, next) => {
  try {
    const mode = String(request.body?.mode || request.body?.origin || "managed").trim().toLowerCase();
    const name = String(request.body?.name || "").trim();
    if (mode === "link" || mode === "linked") {
      if (!request.body?.path) return response.status(400).json({ error: "workspace_path_required" });
      const created = await projects.create({
        mode: "linked",
        name: name || undefined,
        path: request.body.path,
        defaultTemplateId: resolveProjectDefaultTemplateId(request.body?.defaultTemplateId, null),
      });
      return response.status(201).json(created);
    }
    if (mode === "create" || mode === "created") {
      if (!request.body?.path || !request.body?.directoryName) return response.status(400).json({ error: "workspace_path_required" });
      const created = await projects.create({
        mode: "created",
        name: name || undefined,
        path: request.body.path,
        directoryName: request.body.directoryName,
        defaultTemplateId: resolveProjectDefaultTemplateId(request.body?.defaultTemplateId, null),
      });
      return response.status(201).json(created);
    }
    if (mode === "clone" || mode === "cloned") {
      if (!request.body?.cloneUrl) return response.status(400).json({ error: "clone_url_required" });
      if (!request.body?.path && !request.body?.cloneParentPath) return response.status(400).json({ error: "workspace_path_required" });
      const created = await projects.create({
        mode: "cloned",
        name: name || undefined,
        cloneUrl: request.body.cloneUrl,
        path: request.body.path,
        cloneParentPath: request.body.cloneParentPath,
        cloneDirectoryName: request.body.cloneDirectoryName,
        defaultTemplateId: resolveProjectDefaultTemplateId(request.body?.defaultTemplateId, null),
      });
      return response.status(202).json(created);
    }
    if (!name) return response.status(400).json({ error: "project_name_required" });
    response.status(201).json(await projects.create({
      mode: "managed",
      name,
      defaultTemplateId: resolveProjectDefaultTemplateId(request.body?.defaultTemplateId, null),
    }));
  } catch (error) {
    if (!request.aborted && !response.destroyed) next(error);
  } finally {
  }
});

app.patch("/v0/projects/:id", async (request, response, next) => {
  try {
    const current = await projects.get(request.params.id);
    if (!current) return response.status(404).json({ error: "project_not_found" });
    const hasName = Object.hasOwn(request.body || {}, "name");
    const hasDefault = Object.hasOwn(request.body || {}, "defaultTemplateId");
    if (!hasName && !hasDefault) return response.status(400).json({ error: "project_update_required" });
    const changes = {};
    if (hasName) {
      changes.name = String(request.body.name || "").trim();
      if (!changes.name) return response.status(400).json({ error: "project_name_required" });
    }
    if (hasDefault) changes.defaultTemplateId = resolveProjectDefaultTemplateId(request.body.defaultTemplateId, null, { allowHostPi: current.kind === "workspace" });
    const project = await projects.update(request.params.id, changes);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json(project);
  } catch (error) { next(error); }
});

app.get("/v0/projects/:id/tree", async (request, response, next) => {
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await projects.validate(project);
    const listing = await listWorkspaceDirectory(project.path, request.query.path);
    response.json({ path: String(request.query.path || ""), ...listing });
  } catch (error) { next(error); }
});

app.get("/v0/projects/:id/file", async (request, response, next) => {
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    if (!request.query.path) return response.status(400).json({ error: "workspace_path_required" });
    await projects.validate(project);
    response.json(await readWorkspaceFile(project.path, request.query.path));
  } catch (error) { next(error); }
});

app.get("/v0/projects/:id/diff", async (request, response, next) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  const close = () => { if (!response.writableEnded) abort(); };
  response.once("close", close);
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await projects.validate(project);
    response.json(await readWorkspaceDiff(project.path, { includePatch: request.query.patch === "1", reuse: request.query.reuse === "1", signal: controller.signal }));
  } catch (error) {
    if (!request.aborted && !response.destroyed) next(error);
  } finally {
    request.removeListener("aborted", abort);
    response.removeListener("close", close);
  }
});

app.post("/v0/projects/:id/move-sessions", async (request, response, next) => {
  try {
    const source = await projects.get(request.params.id);
    const target = await projects.get(request.body?.projectId || "");
    if (!source || !target) return response.status(404).json({ error: "project_not_found" });
    await lifecycle.withProjects([source.id, target.id], async () => {
      await projects.validate(source);
      await projects.validate(target);
      if (source.id === target.id) throw Object.assign(new Error("Project target is unchanged"), { code: "project_target_unchanged", status: 409 });
      const chats = registry.listProject(source.id, { includeHidden: true });
      if (chats.some((chat) => chat.runtime?.kind === "native_pi")) {
        throw Object.assign(new Error("Host Pi chats cannot move between working roots."), { code: "chat_move_not_supported", status: 409 });
      }
      const moved = [];
      for (const { id } of chats) {
        const item = await lifecycle.run(id, async () => {
          const chat = registry.metadata(id);
          if (!chat || chat.projectId !== source.id) return null;
          const projectList = await projects.list();
          const session = chat.piSessionFile ? await registry.find(projectList, chat.id) : null;
          await stopSessionProcesses(chat);
          lifecycle.assertAvailable(chat.id, source.id);
          lifecycle.assertAvailable(chat.id, target.id);
          await moveRegisteredChat({ chat, source, target, session });
          return { sourceId: chat.id, session: chatView(registry.metadata(chat.id)) };
        });
        if (item) moved.push(item);
      }
      response.json({ moved });
    });
  } catch (error) { next(error); }
});

app.delete("/v0/projects/:id", async (request, response, next) => {
  let finishDeletion = null;
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    const deleteWorkspaceFiles = request.body?.mode === "destroy_workspace";
    if (deleteWorkspaceFiles) {
      if (project.kind !== "workspace") return response.status(400).json({ error: "workspace_delete_not_supported" });
      if (String(request.body?.confirmation || "") !== project.name) {
        return response.status(400).json({ error: "workspace_delete_confirmation_required", message: "Type the Workspace name exactly to delete it" });
      }
    }
    finishDeletion = await lifecycle.beginProjectDeletion(project.id);
    let skipWorkingTree = false;
    try { await projects.validate(project); }
    catch (error) {
      if (deleteWorkspaceFiles) {
        try { await fs.lstat(project.path); }
        catch (statError) {
          if (statError.code !== "ENOENT") throw statError;
          skipWorkingTree = true;
        }
        if (!skipWorkingTree) throw error;
      } else if (project.kind === "workspace" && project.externalPath) skipWorkingTree = true;
      else throw error;
    }
    const projectList = await projects.list();
    const chats = registry.listProject(project.id, { includeHidden: true });
    for (const { id } of chats) {
      await lifecycle.run(id, async () => {
        const chat = registry.metadata(id);
        if (chat?.projectId === project.id) await stopSessionProcesses(chat);
      });
    }
    const matching = manager.list().filter((item) => item.projectId === project.id);
    await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
    // PTYs own a real process cwd. Tear them down before unregistering or
    // deleting the working root so no shell survives in a removed Workspace.
    await terminals.removeProject(project.id);
    const sessions = (await Promise.all(chats
      .map((chat) => findDeletableSession(projectList, chat)))).filter(Boolean);
    await Promise.all(sessions.map(removeSession));
    await removeProjectSessions(project);
    for (const chat of chats) {
      await registry.remove(chat.id, skipWorkingTree ? null : project);
    }
    await registry.removeProject(project.id);
    await projects.remove(project.id, { skipWorkingTree, deleteWorkspaceFiles });
    response.status(204).end();
  } catch (error) { next(error); }
  finally { finishDeletion?.(); }
});

app.get("/v0/models", async (request, response, next) => {
  try {
    const project = await projects.get(request.query.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.list(project.path) });
  } catch (error) {
    next(error);
  }
});

app.get("/v0/settings", async (request, response, next) => {
  try {
    const project = await projects.get(request.query.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.getSettings(project.path) });
  } catch (error) {
    next(error);
  }
});

app.patch("/v0/settings", async (request, response, next) => {
  try {
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await projects.validate(project);
    response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.updateSettings(project.path, request.body) });
  } catch (error) {
    next(error);
  }
});

app.post("/v0/chats", async (request, response, next) => {
  try {
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await lifecycle.withProjects([project.id], async () => {
      await projects.validate(project);
      const hostDefault = project.defaultTemplateId === "host-pi" && request.body?.templateId == null && request.body?.runtimeKind == null;
      const hostAvailable = config.installations.get("host-pi").available;
      if (hostDefault && !hostAvailable) {
        await projects.update(project.id, { defaultTemplateId: null });
        project.defaultTemplateId = null;
      }
      const requestedTemplateId = request.body?.templateId || (project.defaultTemplateId === "host-pi" ? null : project.defaultTemplateId) || null;
      const template = requestedTemplateId
        ? resolveTemplate(config, requestedTemplateId)
        : defaultTemplate();
      if (!template) return response.status(400).json({ error: "unknown_template", templateId: requestedTemplateId });
      if (template.defaultable === false) return response.status(400).json({ error: "special_template", templateId: template.id });
      const runtimeKind = request.body?.runtimeKind || (hostDefault && hostAvailable ? "native_pi" : "conduit_profile");
      if (!new Set(["conduit_profile", "native_pi"]).has(runtimeKind)) {
        return response.status(400).json({ error: "unknown_runtime_kind" });
      }
      if (runtimeKind === "native_pi" && project.kind !== "workspace") {
        return response.status(400).json({ error: "native_pi_requires_workspace" });
      }
      const runtime = runtimeFor({ runtimeKind, template });
      if (runtimeKind === "native_pi" && !config.installations.get("host-pi").available) {
        return response.status(409).json({ error: "native_pi_unavailable" });
      }
      const chat = await registry.create(project, {
        templateId: template.id,
        templateVersion: template.version,
        runtime,
      });
      response.status(201).json(chatView(chat));
    });
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    response.json(chatView(context.chat));
  } catch (error) { next(error); }
});

app.patch("/v0/chats/:chatId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    if (lifecycle.isBusy(context.chat.id) && (request.body?.templateId != null || request.body?.runtimeKind != null)) {
      return response.status(409).json({ error: "runtime_locked", message: "Pi is already starting for this chat." });
    }
    let selectedTemplate = templateForChat(context.chat, context.project);
    if (request.body?.templateId != null) {
      const currentTemplate = resolveTemplate(config, context.chat.templateId);
      if (currentTemplate?.special === true) {
        return response.status(409).json({ error: "special_chat_locked" });
      }
      if (context.chat.status !== "draft" || context.chat.piSessionFile) {
        return response.status(409).json({ error: "template_locked" });
      }
      const template = resolveTemplate(config, request.body.templateId);
      if (!template) {
        return response.status(400).json({ error: "unknown_template", templateId: request.body.templateId });
      }
      if (template.defaultable === false) {
        return response.status(400).json({ error: "special_template", templateId: template.id });
      }
      await registry.update(context.chat.id, {
        templateId: template.id,
        templateVersion: template.version,
      });
      selectedTemplate = template;
    }
    if (request.body?.runtimeKind != null) {
      if (context.project.kind !== "workspace") {
        return response.status(400).json({ error: "native_pi_requires_workspace" });
      }
      if (context.chat.status !== "draft" || context.chat.piSessionFile) {
        return response.status(409).json({ error: "runtime_locked" });
      }
      const runtimeKind = request.body.runtimeKind;
      if (!new Set(["conduit_profile", "native_pi"]).has(runtimeKind)) {
        return response.status(400).json({ error: "unknown_runtime_kind" });
      }
      const runtime = runtimeFor({ runtimeKind, template: selectedTemplate });
      if (runtimeKind === "native_pi" && !config.installations.get("host-pi").available) {
        return response.status(409).json({ error: "native_pi_unavailable" });
      }
      await registry.update(context.chat.id, { runtime });
    }
    response.json(chatView(registry.metadata(context.chat.id)));
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId/models", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    response.json(await chatModelView(context));
  } catch (error) { next(error); }
});

app.patch("/v0/chats/:chatId/models", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const spec = String(request.body?.model || "").trim();
    const thinkingLevel = String(request.body?.thinkingLevel || "").trim();
    const current = await chatModelView(context);
    if (spec && !current.models.some((item) => item.spec === spec)) {
      return response.status(400).json({ error: "invalid_model" });
    }
    const targetModel = spec || current.model;
    const target = current.models.find((item) => item.spec === targetModel);
    if (thinkingLevel && target && !target.thinkingLevels.includes(thinkingLevel)) {
      return response.status(400).json({ error: "invalid_thinking_level" });
    }
    const saveThinkingPreference = async () => {
      if (!targetModel || !thinkingLevel) return context.chat;
      return registry.update(context.chat.id, {
        modelThinkingLevels: { ...(context.chat.modelThinkingLevels || {}), [targetModel]: thinkingLevel },
      });
    };
    const resident = manager.getByChatId(context.chat.id);
    if (resident) {
      if (spec && spec !== current.model) await manager.setModel(resident.id, spec);
      if (thinkingLevel) await manager.setThinkingLevel(resident.id, thinkingLevel);
    } else {
      if (context.chat.status !== "draft" || context.chat.piSessionFile) {
        return response.status(409).json({ error: "live_session_required" });
      }
      const template = templateForChat(context.chat, context.project);
      const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
      if (runtime.kind === "native_pi") {
        const chat = await saveThinkingPreference();
        return response.json({
          ...current,
          model: spec || current.model,
          thinkingLevel: thinkingLevel || current.thinkingLevel,
          modelThinkingLevels: chat?.modelThinkingLevels || {},
        });
      }
      if (spec) await catalogFor(runtime, template).updateDefault(context.project.path, spec, thinkingLevel);
    }
    await saveThinkingPreference();
    response.json(await chatModelView(context));
  } catch (error) { next(error); }
});

app.post("/v0/runtime/chats", async (_request, response, next) => {
  try {
    const template = config.piTemplates.find((item) => item.special === true && item.id === "runtime");
    if (!template) return response.status(404).json({ error: "runtime_template_not_found" });
    const project = await projects.get("chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await lifecycle.withProjects([project.id], async () => {
      await projects.validate(project);
      const chat = await registry.create(project, {
        templateId: template.id,
        templateVersion: template.version,
        runtime: runtimeFor({ runtimeKind: "conduit_profile", template }),
      });
      response.status(201).json(chatView(chat));
    });
  } catch (error) { next(error); }
});

app.delete("/v0/chats/:chatId", async (request, response, next) => {
  try {
    if (request.query.ifEmpty !== "true") return response.status(409).json({ error: "use_chat_delete_route" });
    if (!isChatId(request.params.chatId)) return response.status(404).json({ error: "chat_not_found" });
    const removed = await lifecycle.deleteChat(request.params.chatId, async () => {
      const context = await findChatContext(request.params.chatId);
      if (!context) return null;
      return lifecycle.withProjects([context.project.id], async () => {
        await stopSessionProcesses(context.chat);
        return registry.removeEmptyDraft(context.chat.id, context.project);
      });
    });
    if (removed == null) return response.status(404).json({ error: "chat_not_found" });
    response.status(removed ? 204 : 409).end();
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId/attachments", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    let announced = new Set();
    if (context.chat.piSessionFile) {
      try { announced = await readAnnouncedAttachmentIds(context.chat.piSessionFile, context.project); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    response.json({ attachments: (await attachments.list(context.project, context.chat.id))
      .map((attachment) => ({ ...attachment, announced: announced.has(attachment.id) })) });
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const attachment = await attachments.open(context.project, context.chat.id, request.params.attachmentId);
    if (!attachment) return response.status(404).json({ error: "attachment_not_found" });
    const preview = request.query.preview === "1" && /^image\/(png|jpeg|gif|webp)$/.test(attachment.type);
    response.setHeader("Content-Type", preview ? attachment.type : "application/octet-stream");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-cache");
    const downloadName = encodeURIComponent(attachment.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename*=UTF-8''${downloadName}`);
    response.setHeader("Content-Length", attachment.size);
    const stream = attachment.stream();
    stream.once("error", next);
    stream.pipe(response);
  } catch (error) { next(error); }
});

app.delete("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const removed = await attachments.delete(context.project, context.chat.id, request.params.attachmentId);
    response.status(removed ? 204 : 404).end();
  } catch (error) { next(error); }
});

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
        await stopSessionProcesses(current.chat);
        lifecycle.assertAvailable(current.chat.id, current.project.id);
        lifecycle.assertAvailable(current.chat.id, target.id);
        await moveRegisteredChat({ chat: current.chat, source: current.project, target, session });
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
        const session = await findDeletableSession(await projects.list(), context.chat);
        const sessionOptions = { sessionsDir: sessionDirectoryForChat(context.chat, context.project) };
        const family = session ? await sessionFamilyFiles(session.file, context.project, sessionOptions) : [];
        await stopSessionFamilyProcesses(context.chat, family);
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

app.get("/v0/live-sessions", (_request, response) => response.json({ sessions: manager.list() }));
app.get("/v0/runtime/settings", (_request, response) => {
  response.json({ ...runtimeSettings.get(), ...manager.policy() });
});
app.patch("/v0/runtime/settings", async (request, response, next) => {
  try {
    const saved = await runtimeSettings.save({
      maxLiveProcesses: request.body?.maxLiveProcesses,
      maxGeneratingProcesses: request.body?.maxGeneratingProcesses,
      idleProcessTtlMs: request.body?.idleProcessTtlMs,
    });
    manager.configure(saved);
    await manager.enforceLimit();
    response.json({ ...saved, ...manager.policy() });
  } catch (error) { next(error); }
});
app.post("/v0/live-sessions", async (request, response, next) => {
  let launchedRecord = null;
  try {
    const chatId = request.body?.chatId || request.body?.resumeSessionId;
    if (!isChatId(chatId)) return response.status(404).json({ error: "chat_not_found" });
    await lifecycle.runLaunch(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      await lifecycle.withProjects([context.project.id], async () => {
        lifecycle.assertAvailable(context.chat.id, context.project.id);
        const requestedProject = request.body?.projectId;
        if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
          return response.status(409).json({ error: "session_project_mismatch" });
        }
        const resident = manager.getByChatId(context.chat.id);
        if (resident) {
          return response.status(201).json({ ...manager.view(resident), streamUrl: `/v0/live-sessions/${resident.id}/stream` });
        }
        const template = templateForChat(context.chat, context.project);
        const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
        const installation = config.installations.get(runtime.installationId);
        if (!installation) {
          return response.status(409).json({ error: "runtime_unavailable", installationId: runtime.installationId });
        }
    if (context.chat.piSessionFile) {
      try { await validateSessionHeader(context.chat.piSessionFile, context.project); }
      catch (error) {
        if (error.code === "ENOENT") context.chat.piSessionFile = null;
        else return response.status(409).json({ error: "session_file_unavailable", message: error.message });
      }
    }
    if (runtime.kind === "native_pi") {
      const preflight = await nativePreflight(context.project);
      if (!preflight.available) return response.status(409).json({ error: "native_pi_unavailable", message: preflight.error });
      new ProjectTrustStore(installation.agentDir).set(context.project.path, true);
    }
    const seedModel = context.chat.piSessionFile ? "" : request.body?.model || "";
    const seedThinkingLevel = context.chat.piSessionFile ? "" : request.body?.thinkingLevel || "";
    const runtimeCatalog = catalogFor(runtime, template);
    if (seedModel) {
      const allowed = await runtimeCatalog.list(context.project.path);
      if (!allowed.models.some((model) => model.spec === seedModel)) {
        return response.status(400).json({ error: "invalid_model" });
      }
    }
    const launchSpec = resolvePiLaunch({
      chat: context.chat,
      project: context.project,
      installation,
      template: runtime.kind === "conduit_profile" ? template : null,
      models: runtime.kind === "conduit_profile" ? runtimeCatalog.getLaunchModels(context.project.path) : null,
      model: seedModel,
      thinkingLevel: seedThinkingLevel,
      bridgeSystemPrompt: config.bridgeSystemPrompt,
      bridgeSkill: config.bridgeSkill,
    });
    console.info("Launching Pi", {
      chatId: context.chat.id,
      projectId: context.project.id,
      runtimeKind: runtime.kind,
      installationId: installation.id,
      binaryVersion: installation.version,
      profileId: runtime.profileId,
      profileVersion: runtime.profileVersion,
      cwd: launchSpec.cwd,
      sessionFile: launchSpec.sessionFile,
      trustPosture: launchSpec.trustPosture,
    });
    lifecycle.assertAvailable(context.chat.id, context.project.id);
    const live = await manager.createWithCapacity({
      project: context.project,
      chatId: context.chat.id,
      sessionFile: context.chat.piSessionFile,
      model: seedModel,
      thinkingLevel: seedThinkingLevel,
      template: runtime.kind === "conduit_profile" ? template : null,
      launchSpec,
    });
    launchedRecord = live;
    await manager.waitForSession(live.id);
    lifecycle.assertAvailable(context.chat.id, context.project.id);
    if (runtime.kind === "native_pi" && seedModel) {
      await manager.setModel(live.id, seedModel);
      if (seedThinkingLevel) await manager.setThinkingLevel(live.id, seedThinkingLevel);
    }
    if (!live.sessionFile) throw Object.assign(new Error("Pi did not report a session file"), { code: "invalid_session_mapping" });
    const mapping = {
      templateId: template.id,
      templateVersion: template.version,
      runtime: {
        ...runtime,
      },
    };
    if (context.chat.status === "draft") {
      mapping.piSessionId = live.sessionId || null;
      mapping.piSessionFile = live.sessionFile;
    }
    await registry.update(context.chat.id, mapping);
    response.status(201).json({ ...manager.view(live), streamUrl: `/v0/live-sessions/${live.id}/stream` });
      });
    });
  } catch (error) {
    if (launchedRecord && ["starting", "running"].includes(launchedRecord.status)) {
      await manager.stopAndWait(launchedRecord.id).catch(() => {});
    }
    next(error);
  }
});

app.get("/v0/live-sessions/:id/snapshot", async (request, response, next) => {
  try {
    const live = manager.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    const persisted = live.chatId ? await findRegisteredSession(live.chatId) : null;
    response.json({ live: manager.view(live), events: live.events, messages: persisted ? messagesFromEntries(persisted.entries) : [] });
  } catch (error) { next(error); }
});

app.delete("/v0/live-sessions/:id/process", (request, response) => {
  const stopped = manager.stop(request.params.id);
  response.status(stopped ? 202 : 404).json({ stopped });
});

app.use(express.static(dist, {
  setHeaders(response, file) {
    if (file.includes(`${path.sep}assets${path.sep}`)) response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else response.setHeader("Cache-Control", "no-cache");
  },
}));
app.get("*", (request, response, next) => {
  if (request.path.startsWith("/v0/") || request.path === "/healthz") return next();
  response.setHeader("Cache-Control", "no-cache");
  response.sendFile(path.join(dist, "index.html"));
});
app.use((error, _request, response, _next) => {
  console.error(error);
  let status = error.status || 500;
  if (["reserved_project", "workspace_already_linked", "clone_target_reserved", "clone_reservation_lost", "workspace_cloning"].includes(error.code)) status = 409;
  if (error.code === "workspace_identity_changed") status = 409;
  if (["chat_move_not_supported", "live_session_starting", "runtime_locked", "session_writer_conflict"].includes(error.code)) status = 409;
  if (error.code === "live_process_limit" || error.code === "generation_limit" || error.code === "pty_capacity_reached") status = 429;
  if (["attachment_not_found", "path_not_found", "pty_project_not_found"].includes(error.code)) status = 404;
  if (error.code === "attachment_too_large") status = 413;
  if (["pty_not_running", "pty_cwd_unavailable", "pty_home_unavailable"].includes(error.code)) status = 409;
  if (error.code === "command_failed") status = 502;
  if (error.code === "clone_timeout") status = 504;
  if (error.code === "invalid_attachment_id"
    || [
      "enabled_models_required",
      "invalid_enabled_model",
      "invalid_default_model",
      "path_not_allowed",
      "path_not_absolute",
      "path_not_directory",
      "workspace_path_exists",
      "workspace_directory_invalid",
      "workspace_preview_mode_invalid",
      "dangerous_workspace_root",
      "unsafe_conduit_path",
      "native_resource_limit",
      "native_resource_symlink",
      "clone_url_required",
      "clone_target_exists",
      "clone_url_not_allowed",
      "clone_url_credentials",
      "special_template",
      "special_chat_locked",
      "unknown_template",
      "unknown_runtime_kind",
      "native_pi_requires_workspace",
      "invalid_workspace_path",
      "hidden_workspace_path",
      "workspace_path_symlink",
      "workspace_path_required",
      "path_not_file",
      "file_too_large",
      "file_not_text",
      "pty_template_not_allowed",
      "pty_project_required",
      "pty_cwd_required",
      "pty_resize_invalid",
      "pty_input_invalid",
      "pty_control_invalid",
    ].includes(error.code)
    || error.message?.includes("Project names")) status = 400;
  response.status(status).json({
    error: error.code || "runtime_error",
    message: error.message,
    path: error.path,
    allowlist: error.allowlist,
    maxBytes: error.maxBytes,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const terminalStream = createTerminalStream({ terminals, wss });
const liveSessionStream = createLiveSessionStream({
  manager,
  wss,
  attachments,
  registry,
  config,
  findChatContext,
  findRegisteredSession,
  chatModelView,
});

server.on("upgrade", async (request, socket, head) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const match = pathname.match(/^\/v0\/live-sessions\/([a-f0-9]{24})\/stream$/);
  const ptyMatch = pathname.match(/^\/v0\/ptys\/([a-f0-9-]{36})\/attach$/);
  if ((!match || !manager.get(match[1])) && (!ptyMatch || !terminals.get(ptyMatch[1]))) return socket.destroy();
  try {
    if (authStore.hasPassword()) {
      const context = await validateSession(authStore, request);
      if (!context) return socket.destroy();
    }
  } catch (error) {
    console.error("WebSocket session validation failed", error);
    return socket.destroy();
  }
  if (ptyMatch) return terminalStream.handleUpgrade(ptyMatch[1], request, socket, head);
  return liveSessionStream.handleUpgrade(match[1], request, socket, head);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Conduit received ${signal}; stopping`);
  runtimeHub.close();
  for (const socket of wss.clients) socket.close(1012, "Conduit is restarting");
  const closed = new Promise((resolve) => server.close(resolve));
  const stoppedProcesses = await manager.shutdown();
  await terminals.stopAll();
  server.closeIdleConnections?.();
  await closed;
  console.log(`Conduit stopped ${stoppedProcesses} Pi process${stoppedProcesses === 1 ? "" : "es"}`);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    shutdown(signal).catch((error) => {
      console.error("Conduit shutdown failed", error);
      process.exitCode = 1;
      server.closeAllConnections?.();
    });
  });
}

server.listen(config.port, config.host, () => console.log(
  `Conduit ${config.release} listening on http://${config.host}:${config.port}`,
));
