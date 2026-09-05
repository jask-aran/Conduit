import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { WebSocketServer } from "ws";
import { loadConfig, resolveTemplate } from "./config.js";
import { PiModelCatalog, resolveThinkingLevel } from "./pi-model-catalog.js";
import { ProjectStore } from "./project-store.js";
import { readSessionMetadata, readSessionPage } from "./session-store.js";
import { PiManager } from "./pi-manager.js";
import { ChatStore, chatView, isChatId } from "./chat-store.js";
import { AttachmentStore } from "./attachment-store.js";
import { RuntimeHub } from "./runtime-hub.js";
import { defaultsFromEnv, RuntimeSettingsStore } from "./runtime-settings.js";
import { PreferencesStore } from "./preferences-store.js";
import { SessionNameService } from "./session-name-service.js";
import { templatePublicView } from "../../scripts/pi-runtime.mjs";
import { formatWorkspacePath, isPathInside, listDirectorySuggestions } from "./workspace-paths.js";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import { resolvePiLaunch } from "./pi-launch.js";
import { validateNativeProjectResources } from "./native-resource-validation.js";
import { AuthStore } from "./auth-store.js";
import { PiAuthBroker } from "./pi-auth-broker.js";
import { ChatLifecycle } from "./chat-lifecycle.js";
import {
  authStartupViolation,
  nativeCors,
  prepareAuthMiddleware,
  validateSession,
} from "./auth-middleware.js";
import { NATIVE_APP_ORIGIN, SocketTicketStore } from "./native-auth.js";
import { listWorkspaceDirectory, readWorkspaceCommit, readWorkspaceDiff, readWorkspaceFile, readWorkspaceVersion, runWorkspaceGitAction } from "./workspace-inspector.js";
import { currentMagicDnsOrigin } from "./tailscale-share.js";
import { buildProjectDashboard } from "./project-dashboard.js";
import { PtyManager } from "./pty-manager.js";
import { createLiveSessionStream } from "./server/live-session-stream.js";
import { createTerminalStream } from "./server/terminal-stream.js";
import { createDictationStream } from "./server/dictation-stream.js";
import { VoiceRuntime } from "./server/voice-runtime.js";
import { VoiceModelManager } from "./server/voice-model-manager.js";
import { VoiceRecordingStore, VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS } from "./server/voice-recording-store.js";
import { registerAttachmentRoutes } from "./server/routes/attachments.js";
import { registerAuthRoutes } from "./server/routes/auth.js";
import { registerPiAuthRoutes } from "./server/routes/pi-auth.js";
import { registerPtyRoutes } from "./server/routes/ptys.js";
import { registerRuntimeRoutes } from "./server/routes/runtime.js";
import { registerChatRoutes } from "./server/routes/chats.js";
import { registerLiveSessionRoutes } from "./server/routes/live-sessions.js";
import { registerProjectRoutes } from "./server/routes/projects.js";
import { registerSessionRoutes } from "./server/routes/sessions.js";
import { registerSearchRoutes } from "./server/routes/search.js";
import { registerVoiceRoutes } from "./server/routes/voice.js";
import { SearchSettingsStore } from "./search-settings.js";
import { VoiceSettingsStore } from "./voice-settings.js";
import { VOICE_EXECUTION_CATALOG } from "./server/voice-execution-catalog.js";
import { ModelProfileRuntime, usesWebSearchOverlay } from "./model-profile-runtime.js";
import { publicModelProfile, resolveModelProfile } from "./model-profiles.js";

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
const searchSettings = new SearchSettingsStore({ filePath: config.searchConfigFile, environment: process.env });
await searchSettings.initialize();
const voiceSettings = new VoiceSettingsStore({ filePath: config.voiceConfigFile, catalog: VOICE_EXECUTION_CATALOG });
await voiceSettings.initialize();
const voiceModel = new VoiceModelManager({ root: config.voiceModelRoot, catalog: VOICE_EXECUTION_CATALOG });
const voiceRecordingStore = new VoiceRecordingStore({ root: config.voiceRecordingsRoot });
const voiceRuntime = new VoiceRuntime({ settings: voiceSettings, modelManager: voiceModel, catalog: VOICE_EXECUTION_CATALOG });
const modelProfileRuntime = new ModelProfileRuntime({
  agentDir: config.piAgentDir,
  searchConfigFile: config.searchConfigFile,
});
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
const socketTickets = new SocketTicketStore();
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
terminals.on("created", (record) => runtimeHub.publishTerminal(record, "created"));
terminals.on("updated", (record) => runtimeHub.publishTerminal(record, "updated"));
terminals.on("exit", (record) => runtimeHub.publishTerminal(record, "exit"));
terminals.on("removed", ({ id, projectId }) => runtimeHub.publishTerminalRemoved(id, projectId));
const modelCatalog = new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: config.piTemplate.models });
await modelCatalog.ready();
const sessionNames = new SessionNameService({
  file: config.sessionNameLogFile,
  modelCatalog,
  preferences,
});
const sessionNameTasks = new Map();
const piAuth = new PiAuthBroker({
  modelRuntime: modelCatalog.modelRuntime,
  authFile: modelCatalog.authFile,
  onCredentialsChanged: recycleIdleIsolatedPiProcesses,
});
const modelCatalogs = new Map([[`isolated:${config.piTemplate.id}`, modelCatalog]]);
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
  const catalogView = await catalog.list(context.project.workingRoot);
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
  const selectedModel = models.find((item) => item.spec === model);
  if (selectedModel) thinkingLevel = resolveThinkingLevel(thinkingLevel, selectedModel.thinkingLevels, catalogView.defaultThinkingLevel);
  const modelProfile = runtime.kind === "conduit_profile" && usesWebSearchOverlay(template)
    ? publicModelProfile(resolveModelProfile(config.modelProfiles, model || "unknown/unresolved"))
    : null;
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
    modelProfile,
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
      await projects.validate(project);
      const view = await catalog.list(project.workingRoot);
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
  const decision = trustStore.get(project.workingRoot);
  const requiresResources = hasTrustRequiringProjectResources(project.workingRoot);
  const resources = requiresResources ? await nativeResourceClasses(project.workingRoot) : [];
  if (requiresResources) await validateNativeProjectResources(project.workingRoot);
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
app.use(nativeCors);

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

registerAuthRoutes(app, { authStore, socketTickets });

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
      .then(async (session) => {
        if (!session) return null;
        await sessionNameTasks.get(record.chatId)?.catch(() => {});
        if (await registry.fallbackTitle(record.chatId, session.title)) {
          await sessionNames.recordFallback({ chatId: record.chatId, name: session.title });
        }
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
  formatWorkspacePath,
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

registerSearchRoutes(app, {
  searchSettings,
  onSettingsChanged: recycleIdleIsolatedPiProcesses,
});
registerVoiceRoutes(app, { voiceSettings, voiceRuntime, voiceModel });

registerPtyRoutes(app, { projects, terminals });

registerProjectRoutes(app, {
  buildProjectDashboard,
  config,
  listWorkspaceDirectory,
  manager,
  modelCatalog,
  preferences,
  projects,
  readSessionPage,
  readWorkspaceCommit,
  readWorkspaceDiff,
  readWorkspaceFile,
  readWorkspaceVersion,
  runWorkspaceGitAction,
  registry,
  terminals,
  lifecycle,
});
const launchLiveSession = registerLiveSessionRoutes(app, {
  catalogFor,
  config,
  findChatContext,
  findRegisteredSession,
  lifecycle,
  manager,
  modelProfileRuntime,
  nativePreflight,
  registry,
  runtimeFor,
  runtimeSettings,
  templateForChat,
});
registerChatRoutes(app, {
  catalogFor,
  chatModelView,
  config,
  defaultTemplate,
  findChatContext,
  launchLiveSession,
  lifecycle,
  manager,
  modelCatalog,
  projects,
  registry,
  runtimeFor,
  templateForChat,
});
registerSessionRoutes(app, {
  config,
  findChatContext,
  findRegisteredSession,
  lifecycle,
  manager,
  sessionNames,
  projects,
  readSessionPage,
  registry,
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
  if (["chat_move_not_supported", "live_session_starting", "runtime_locked", "session_writer_conflict", "session_name_model_required"].includes(error.code)) status = 409;
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
      "invalid_workspace_move",
      "path_not_file",
      "file_too_large",
      "file_not_text",
      "pty_template_not_allowed",
      "pty_project_required",
      "pty_cwd_required",
      "pty_resize_invalid",
      "pty_input_invalid",
      "pty_control_invalid",
      "search_config_invalid",
      "search_key_invalid",
      "search_provider_locked",
      "search_provider_unknown",
      "model_profile_required",
      "model_profile_unresolved",
      "model_profile_overlay_invalid",
      "model_profile_search_config_invalid",
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
const dictationStream = createDictationStream({
  wss,
  voiceRuntime,
  recordingStore: voiceRecordingStore,
  limits: {
    finalizationBaseMs: config.voiceFinalizationBaseMs,
    finalizationMaxMs: config.voiceFinalizationMaxMs,
    finalizationDefaultMultiplier: config.voiceFinalizationDefaultMultiplier,
  },
});
const liveSessionStream = createLiveSessionStream({
  manager,
  wss,
  attachments,
  registry,
  config,
  findChatContext,
  findRegisteredSession,
  chatModelView,
  async autoNameSession(record, context, message) {
    const task = sessionNames.run({
      chatId: context.chat.id,
      cwd: context.project.workingRoot,
      source: "first_prompt",
      message,
      apply: async (name) => {
        const currentTitle = registry.metadata(context.chat.id)?.title;
        if (currentTitle && currentTitle !== "New chat") return "not_applied_title_already_set";
        await registry.update(context.chat.id, { title: name });
        manager.publish(record, {
          type: "session_checkpoint",
          chat: chatView(registry.metadata(context.chat.id)),
          generationId: record.generation?.id || null,
          generationSeq: record.generation?.seq || null,
        });
        return "applied";
      },
    });
    sessionNameTasks.set(context.chat.id, task);
    try {
      await task;
    } finally {
      if (sessionNameTasks.get(context.chat.id) === task) sessionNameTasks.delete(context.chat.id);
    }
  },
});

server.on("upgrade", async (request, socket, head) => {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = requestUrl.pathname;
  const match = pathname.match(/^\/v0\/live-sessions\/([a-f0-9]{24})\/stream$/);
  const ptyMatch = pathname.match(/^\/v0\/ptys\/([a-f0-9-]{36})\/attach$/);
  const dictationMatch = pathname === "/v0/dictation/stream";
  if ((!match || !manager.get(match[1])) && (!ptyMatch || !terminals.get(ptyMatch[1])) && !dictationMatch) return socket.destroy();
  try {
    if (authStore.hasPassword()) {
      const ticket = requestUrl.searchParams.get("ticket");
      if (ticket) {
        if (request.headers.origin !== NATIVE_APP_ORIGIN) return socket.destroy();
        const sessionHash = socketTickets.consume(ticket);
        const session = await authStore.findSessionHash(sessionHash);
        if (!session || session.kind !== "native") return socket.destroy();
        await authStore.touchSession(session);
      } else {
        const context = await validateSession(authStore, request);
        if (!context) return socket.destroy();
      }
    }
  } catch (error) {
    console.error("WebSocket session validation failed", error);
    return socket.destroy();
  }
  if (dictationMatch) return dictationStream.handleUpgrade(request, socket, head);
  if (ptyMatch) return terminalStream.handleUpgrade(ptyMatch[1], request, socket, head);
  return liveSessionStream.handleUpgrade(match[1], request, socket, head);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Conduit received ${signal}; stopping`);
  runtimeHub.close();
  await dictationStream.shutdown?.({ timeoutMs: 1_000 });
  await terminalStream.shutdown?.({ timeoutMs: 1_000 });
  for (const socket of wss.clients) socket.close(1012, "Conduit is restarting");
  const archiveDrain = voiceRecordingStore.drain({ timeoutMs: VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS });
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  const stoppedProcesses = await manager.shutdown();
  const stoppedTerminals = await terminals.stopAll();
  await voiceModel.stop();
  await closed;
  const archiveResult = await archiveDrain;
  console.log(JSON.stringify({ type: "conduit.voice-archive-drain", ...archiveResult }));
  console.log(`Conduit stopped ${stoppedProcesses} Pi process${stoppedProcesses === 1 ? "" : "es"}`);
  console.log(`Conduit stopped ${stoppedTerminals} terminal session${stoppedTerminals === 1 ? "" : "s"}`);
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
