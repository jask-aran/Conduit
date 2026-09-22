import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { WebSocketServer } from "ws";
import { loadConfig, resolveTemplate } from "./config.js";
import { TerminalPasteStore } from "./terminal-paste-store.js";
import { PiModelCatalog, resolveThinkingLevel } from "./pi-model-catalog.js";
import { ProjectStore } from "./project-store.js";
import { pageSessionEntries, projectSessionEntries, readSessionMetadata, readSessionPage } from "./session-store.js";
import { ChatLogs } from "./server/chat-log.js";
import { MessageIds, applyArtifactMessageIds, applyMessageIds, entryMessageRows } from "./message-ids.js";
import { PiManager } from "./pi-manager.js";
import { manifestForImplementation } from "./harnesses/index.js";
import { ChatStore, chatView, isChatId } from "./chat-store.js";
import { AttachmentStore } from "./attachment-store.js";
import { RuntimeHub } from "./runtime-hub.js";
import { defaultsFromEnv, RuntimeSettingsStore } from "./runtime-settings.js";
import { ServerIdentity } from "./server-identity.js";
import { LanAdvertisement } from "./lan-advertisement.js";
import { DraftStore } from "./draft-store.js";
import { PreferencesStore } from "./preferences-store.js";
import { SessionNameService } from "./session-name-service.js";
import { normalizeTemplateId, templatePublicView } from "../../scripts/pi-runtime.mjs";
import { formatWorkspacePath, isPathInside, listDirectorySuggestions } from "./workspace-paths.js";
import fs from "node:fs/promises";
import { resolvePiLaunch } from "./pi-launch.js";
import { AuthStore } from "./auth-store.js";
import { PiAuthBroker } from "./pi-auth-broker.js";
import { ChatLifecycle } from "./chat-lifecycle.js";
import {
  authStartupViolation,
  nativeCors,
  prepareAuthMiddleware,
  validateSession,
} from "./auth-middleware.js";
import { SocketTicketStore, installedClientOrigin } from "./native-auth.js";
import { listWorkspaceDirectory, readWorkspaceCommit, readWorkspaceDiff, readWorkspaceFile, readWorkspaceFileMetadata, readWorkspaceVersion, runWorkspaceGitAction } from "./workspace-inspector.js";
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
import { registerTerminalPasteRoutes } from "./server/routes/terminal-paste.js";
import { registerDraftRoutes } from "./server/routes/drafts.js";
import { registerRuntimeRoutes } from "./server/routes/runtime.js";
import { registerChatRoutes } from "./server/routes/chats.js";
import { registerHarnessRoutes } from "./server/routes/harnesses.js";
import { createHarnessModelCatalogue } from "./harnesses/model-catalogue.js";
import { rememberedModel } from "./profile-model-memory.js";
import { registerLiveSessionRoutes } from "./server/routes/live-sessions.js";
import { registerProjectRoutes } from "./server/routes/projects.js";
import { registerSessionRoutes } from "./server/routes/sessions.js";
import { registerSearchRoutes } from "./server/routes/search.js";
import { registerVoiceRoutes } from "./server/routes/voice.js";
import { SearchSettingsStore } from "./search-settings.js";
import { VoiceSettingsStore } from "./voice-settings.js";
import { VOICE_EXECUTION_CATALOG } from "./server/voice-execution-catalog.js";
import { PromptStore } from "./prompt-store.js";
import { ChatBackendRegistry, serializePiV0 } from "./pi-rpc-adapter.js";
import { MANIFESTS } from "./harnesses/index.js";
import { detect } from "./harnesses/probe.js";
import { TurnCheckpointStore } from "./turn-checkpoint-store.js";
import { conduitPiSessionFile } from "./backend-session.js";

const config = loadConfig();
const turnCheckpoints = new TurnCheckpointStore(path.join(config.dataRoot, "turn-checkpoints"));
const projects = new ProjectStore(config);
await projects.initialize();
for (const project of await projects.list()) {
  const normalized = normalizeTemplateId(project.defaultTemplateId);
  if (normalized && normalized !== project.defaultTemplateId) await projects.update(project.id, { defaultTemplateId: normalized });
}
const terminals = new PtyManager({ filePath: config.remotesFile });
await terminals.load();
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
await registry.migrateTemplateIds(normalizeTemplateId);
const attachments = new AttachmentStore(registry, { maxBytes: config.maxAttachmentBytes });
const terminalPastes = new TerminalPasteStore({ root: config.terminalPasteRoot });
const runtimeSettings = new RuntimeSettingsStore(config.runtimeSettingsFile, defaultsFromEnv(process.env));
await runtimeSettings.load();
const serverIdentity = await new ServerIdentity(config.identityFile, { port: config.port }).load();
const lanAdvertisement = new LanAdvertisement({
  identity: serverIdentity,
  enabled: config.advertiseOnLan,
  log: (event) => console.log(JSON.stringify(event)),
});
const searchSettings = new SearchSettingsStore({ filePath: config.searchConfigFile, environment: process.env });
await searchSettings.initialize();
const voiceSettings = new VoiceSettingsStore({ filePath: config.voiceConfigFile, catalog: VOICE_EXECUTION_CATALOG });
await voiceSettings.initialize();
const voiceModel = new VoiceModelManager({ root: config.voiceModelRoot, catalog: VOICE_EXECUTION_CATALOG });
const voiceRecordingStore = new VoiceRecordingStore({ root: config.voiceRecordingsRoot });
const voiceRuntime = new VoiceRuntime({ settings: voiceSettings, modelManager: voiceModel, catalog: VOICE_EXECUTION_CATALOG });
const promptStore = new PromptStore({
  root: config.promptOverridesRoot,
  prompts: [
    ...config.piTemplates.map((template) => ({ id: template.id, label: template.label, kind: "profile", defaultPath: template.systemPrompt })),
    { id: "chat-naming", label: "Chat naming", kind: "service", defaultPath: config.sessionNamePrompt },
  ],
});
config.promptStore = promptStore;
const knownTemplateIds = config.piTemplates
  .filter((template) => template.defaultable !== false)
  .map((template) => template.id);
const preferences = new PreferencesStore(
  config.preferencesFile,
  { defaultTemplateId: config.piTemplate.id },
  { knownTemplateIds },
);
await preferences.load();
const drafts = new DraftStore(config.draftsFile);
await drafts.load();
const authStore = new AuthStore(config.authFile);
await authStore.load();
await authStore.pruneExpired();
const socketTickets = new SocketTicketStore();
const startupViolation = authStartupViolation(config, authStore);
if (startupViolation) {
  console.error(startupViolation.message);
  process.exit(1);
}
// One order per chat, shared by everything that publishes into a chat: the
// harness process, and the command handlers above it.
const chatLogs = new ChatLogs();
const manager = new PiManager({
  serializeEvent: serializePiV0,
  logs: chatLogs,
  command: config.piCommand,
  agentDir: config.piAgentDir,
  template: config.piTemplate,
  maxLiveProcesses: runtimeSettings.get().maxLiveProcesses,
  maxGeneratingProcesses: runtimeSettings.get().maxGeneratingProcesses,
  idleProcessTtlMs: runtimeSettings.get().idleProcessTtlMs,
});
// Everything a harness manifest needs to probe and build itself. Backends are
// no longer named here: they come from MANIFESTS, and detection runs in
// parallel so four three-second timeouts cost three seconds, not twelve.
const harnessConfig = {
  manager,
  // The same per-chat order the Pi manager stamps into, so a harness that
  // states its transcript numbers its events in the chat's sequence rather
  // than one of its own.
  logs: chatLogs,
  codexCommand: process.env.CONDUIT_CODEX_COMMAND || "codex",
  chatgptWebPython: process.env.CONDUIT_CHATGPT_WEB_PYTHON
    || path.join(config.repositoryRoot, "working-files/.venv/bin/python"),
  chatgptWebScript: process.env.CONDUIT_CHATGPT_WEB_SIDECAR
    || path.join(config.repositoryRoot, "working-files/chatgpt_web_sidecar.py"),
  chatgptWebDataDir: path.join(config.dataRoot, "chatgpt-web"),
};
const backends = ChatBackendRegistry.fromManifests(MANIFESTS, await detect(MANIFESTS, harnessConfig), harnessConfig);
// Distinct adapter instances: Pi answers to two implementation keys.
const adapterInstances = () => new Set(backends.adapters.values());
const chatgptWeb = backends.adapters.get("chatgpt-web") || null;
const requireChatgptWeb = () => {
  if (!chatgptWeb) throw Object.assign(new Error("ChatGPT Web is not installed"), { code: "backend_unavailable", status: 409 });
  return chatgptWeb;
};
async function recycleIdleIsolatedPiProcesses() {
  const candidates = manager.liveRecords().filter((record) => record.runtime?.kind === "conduit_profile"
    && manager.isReclaimable(record));
  for (const record of candidates) {
    if (manager.isReclaimable(record)) await manager.stopAndWait(record.id);
  }
  return { restartedIdleProcesses: candidates.length };
}
// Conduit's message identity for Pi, which has none to give until it writes.
const messageIds = new MessageIds();
const runtimeHub = new RuntimeHub({ listViews: () => backends.list() });
// The snapshot hides records that are stopped or on their way out; so must
// every incremental update, or a teardown emit re-advertises a process the
// removal already retired and the pill comes back to life.
const processIsLive = (record) => Boolean(record) && !record.terminating && record.status !== "stopped";
const publishProcessChange = (view, record, reason) => {
  if (!view) return;
  if (processIsLive(record)) runtimeHub.publishProcess(view, reason || "update");
  else runtimeHub.publishProcessRemoved(view.id, view.chatId);
};
manager.on("process_changed", ({ record, reason }) => {
  publishProcessChange(backends.view(record), record, reason);
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
  promptStore,
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

// Shared with the launch composer so a chat and the dashboard ask the harness
// once between them rather than once each.
const harnessModels = createHarnessModelCatalogue();

function catalogFor(runtime, template) {
  const installation = config.installations.get(runtime.installationId);
  const key = `isolated:${template?.id || config.piTemplate.id}`;
  if (!modelCatalogs.has(key)) {
    modelCatalogs.set(key, new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: template?.models || config.piTemplate.models }));
  }
  return modelCatalogs.get(key);
}

async function chatModelView(context) {
  if (manifestForImplementation(context.chat.backend?.implementation)?.profile) {
    const implementation = context.chat.backend.implementation;
    const manifest = manifestForImplementation(implementation);
    const adapter = backends.forChat(context.chat);
    const resident = backends.getByChatId(context.chat.id);
    if (!resident) {
      const remembered = rememberedModel(preferences, implementation);
      const models = await harnessModels.list(implementation, context.project.workingRoot, adapter, {
        require: context.chat.backend.model || remembered?.model || "",
      });
      const rememberedSpec = models.some((item) => item.spec === remembered?.model) ? remembered.model : "";
      const model = context.chat.backend.model || rememberedSpec || models[0]?.spec || "";
      // The remembered model is gone and something else is standing in. Say so,
      // rather than quietly running the chat on a model nobody chose.
      const modelFallback = !context.chat.backend.model && remembered?.model && !rememberedSpec && model
        ? { from: remembered.model, to: model }
        : null;
      const selected = models.find((item) => item.spec === model);
      const defaultThinkingLevel = selected?.defaultThinkingLevel || selected?.thinkingLevels[0] || "";
      const savedThinkingLevel = context.chat.modelThinkingLevels?.[model]
        || (rememberedSpec ? remembered.thinkingLevel : "") || "";
      const thinkingLevel = selected?.thinkingLevels.includes(savedThinkingLevel) ? savedThinkingLevel : defaultThinkingLevel;
      return {
        installationId: manifest?.installationId || context.chat.backend.installationId,
        runtimeKind: implementation, models, model,
        thinkingLevel, defaultModel: models[0]?.spec || "", defaultThinkingLevel, ...(modelFallback ? { modelFallback } : {}),
        modelThinkingLevels: context.chat.modelThinkingLevels || {}, requiresAuthentication: false, warnings: [], source: "catalog",
      };
    }
    const [models, state] = await Promise.all([adapter.listModels(resident.id), adapter.getModelState(resident.id)]);
    return {
      installationId: manifest?.installationId || context.chat.backend.installationId,
      runtimeKind: implementation, models, ...state,
      defaultModel: models[0]?.spec || "",
      defaultThinkingLevel: models.find((item) => item.spec === state.model)?.defaultThinkingLevel || "",
      modelThinkingLevels: context.chat.modelThinkingLevels || {},
      requiresAuthentication: false, warnings: [], source: "live",
    };
  }
  const template = templateForChat(context.chat, context.project);
  const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
  const catalog = catalogFor(runtime, template);
  const catalogView = await catalog.list(context.project.workingRoot);
  let model = context.chat.backend?.model || catalogView.defaultModel;
  let thinkingLevel = context.chat.modelThinkingLevels?.[model] || catalogView.defaultThinkingLevel;
  let source = context.chat.backend?.model ? "chat_preference" : "runtime_default";
  let chatOwnsModel = Boolean(context.chat.backend?.model);
  const sessionFile = conduitPiSessionFile(context.chat);
  if (sessionFile) {
    try {
      const persisted = await readSessionMetadata(sessionFile, context.project);
      if (!chatOwnsModel) {
        chatOwnsModel = Boolean(persisted.model);
        model = persisted.model || model;
        thinkingLevel = persisted.thinkingLevel || thinkingLevel;
        source = "jsonl";
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // A profile remembers the last model chosen on it, so picking one in the
  // Assistant does not have to be picked again in the next Assistant chat. A
  // chat that already ran on a model of its own keeps it: this only fills in
  // the blank a brand new chat starts with. When the remembered model is no
  // longer in the profile's catalogue the catalogue default stands in, and the
  // substitution is reported rather than made quietly.
  const remembered = rememberedModel(preferences, template?.id);
  let modelFallback = null;
  if (!chatOwnsModel && remembered?.model) {
    if (catalogView.models.some((item) => item.spec === remembered.model)) {
      model = remembered.model;
      thinkingLevel = remembered.thinkingLevel || thinkingLevel;
      source = "profile_default";
    } else if (model) {
      modelFallback = { from: remembered.model, to: model };
    }
  }
  const resident = backends.getByChatId(context.chat.id);
  let models = catalogView.models;
  if (resident) {
    const adapter = backends.forChat(context.chat);
    const [available, state] = await Promise.all([
      adapter.listModels(resident.id),
      adapter.getModelState(resident.id),
    ]);
    const enabled = new Set(catalogView.models.map((item) => item.spec));
    const liveModels = available.map((item) => catalog.modelView({ model: item }));
    models = enabled.size ? liveModels.filter((item) => enabled.has(item.spec)) : liveModels;
    model = state.model || model;
    thinkingLevel = state.thinkingLevel || thinkingLevel;
    const currentModel = liveModels.find((item) => item.spec === model);
    if (currentModel && !models.some((item) => item.spec === model)) models = [...models, currentModel];
    // A running process has a real model; nothing was substituted for it.
    modelFallback = null;
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
    ...(modelFallback ? { modelFallback } : {}),
    source,
  };
}

async function installationViews() {
  const project = await projects.get("chat");
  return Promise.all(config.installations.publicList().map(async (installation) => {
    if (!installation.available || !project) return { ...installation, models: null };
    const runtime = { kind: "conduit_profile", installationId: installation.id };
    const catalog = catalogFor(runtime, config.piTemplate);
    try {
      await projects.validate(project);
      const view = await catalog.list(project.workingRoot);
      return {
        ...installation,
        models: {
          access: "managed",
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
  if (runtimeKind !== "conduit_profile") throw Object.assign(new Error("Unknown Pi runtime"), { code: "unknown_runtime_kind", status: 400 });
  const installation = config.installations.get("conduit-pinned");
  return {
    kind: "conduit_profile",
    installationId: installation.id,
    binaryVersion: installation.version,
    profileId: template.id,
    profileVersion: template.version,
  };
}

async function ensureChatTemplate(chat, project = null) {
  if (!chat) return null;
  if (chat.backend?.protocol !== "pi_rpc") return chat;
  if (chat.templateId) return chat;
  const template = templateForChat(chat, project);
  return registry.ensureTemplate(chat.id, {
    templateId: template.id,
    templateVersion: template.version,
  });
}

app.use(compression());
app.use(nativeCors);

// A desktop client can only be offered an update over HTTP -- the updater
// speaks no file:// -- so during development the server that is already
// running serves the local build's artifacts. It sits ahead of authentication
// because the updater runs in the shell and carries no session: the artifacts
// are signed, and a signature is what makes an update safe to install, not the
// secrecy of the URL it came from. It exists only when the directory is named
// explicitly, and it serves that one directory.
const desktopUpdateDir = process.env.CONDUIT_DESKTOP_UPDATE_DIR;
if (desktopUpdateDir) {
  console.warn(`Serving desktop update artifacts from ${desktopUpdateDir} (development only).`);
  app.use("/desktop-updates", express.static(desktopUpdateDir, {
    index: false,
    dotfiles: "deny",
    fallthrough: false,
    setHeaders: (response) => response.setHeader("Cache-Control", "no-store"),
  }));
}

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

app.get("/v0/chatgpt-web/status", async (_request, response, next) => {
  try { response.json(await requireChatgptWeb().health()); } catch (error) { next(error); }
});
app.put("/v0/chatgpt-web/credential", async (request, response, next) => {
  try { response.json(await requireChatgptWeb().setCredential(String(request.body?.cookie || ""))); } catch (error) { next(error); }
});
app.delete("/v0/chatgpt-web/credential", async (_request, response, next) => {
  try { response.json(await requireChatgptWeb().removeCredential()); } catch (error) { next(error); }
});

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
    // The decoration below needs the project too, so it outlives the lookup.
    let project = null;
    projects.get(record.projectId)
      .then((found) => {
        project = found;
        return project && registry.syncFile(record.chatId, record.sessionFile, project, { waitForFileMs: 2000 });
      })
      .then(async (session) => {
        if (!session) return null;
        await sessionNameTasks.get(record.chatId)?.catch(() => {});
        if (await registry.fallbackTitle(record.chatId, session.title)) {
          await sessionNames.recordFallback({ chatId: record.chatId, name: session.title });
        }
        const artifacts = await turnCheckpoints.timeline(record.chatId, project.workingRoot, record.sessionFile)
          .catch((error) => { console.error("Could not compute turn artifacts", error); return null; });
        // The entries this turn wrote are now on disk, so the ids claimed for
        // its prompts can finally be tied to them.
        await messageIds.bind(project, registry.metadata(record.chatId), entryMessageRows(session.entries));
        const idFor = await messageIds.resolver(project, registry.metadata(record.chatId));
        record.lastCheckpoint = {
          type: "session_checkpoint",
          generationId: checkpoint.id,
          chat: chatView(registry.metadata(record.chatId)),
          artifacts: applyArtifactMessageIds(artifacts, idFor),
        };
        const latest = projectSessionEntries(pageSessionEntries(session.entries, { turnLimit: 1 }).entries);
        latest.messages = applyMessageIds(
          await attachments.decorateMessages(project, record.chatId, latest.messages, { fromStart: false }), idFor);
        manager.publish(record, { type: "transcript_sync", generationId: checkpoint.id, ...latest });
        manager.publish(record, record.lastCheckpoint);
        runtimeHub.publish({ type: "chat_changed", chat: record.lastCheckpoint.chat, at: new Date().toISOString() });
        return session;
      })
      .catch((error) => console.error("Could not checkpoint the session registry", error))
      .finally(() => pendingCheckpoints.delete(checkpointId));
  }, 50).unref();
});
function checkpointNativeAdapter(adapter, record, completed = true) {
  const completedAt = new Date().toISOString();
  // A cancelled or failed turn is activity, so it moves the sort key -- but it
  // completed nothing, so it leaves nothing to read.
  void registry.update(record.chatId, { backend: { ...registry.metadata(record.chatId)?.backend, opaqueSession: record.sessionId },
    ...(record.title ? { title: record.title } : {}),
    ...(completed ? { lastAssistantCompletedAt: completedAt } : {}),
    lastMessageAt: completedAt })
    .then((chat) => {
      record.lastCheckpoint = { type: "session_checkpoint", generationId: record.generation?.id || null,
        chatId: chat.id, title: chat.title || null };
      adapter.publish(record, record.lastCheckpoint);
      runtimeHub.publish({ type: "chat_changed", chat: chatView(chat), at: completedAt });
    })
    .catch((cause) => console.error("Could not checkpoint native chat", cause));
}
async function applyBackendName(adapter, record, name) {
  if (!await registry.fallbackTitle(record.chatId, name)) return;
  const chat = registry.metadata(record.chatId);
  adapter.publish(record, { type: "session_checkpoint", generationId: record.generation?.id || null,
    chatId: chat.id, title: chat.title });
  runtimeHub.publish({ type: "chat_changed", chat: chatView(chat), at: new Date().toISOString() });
}
// Every native adapter checkpoints the same way. PiRpcAdapter is not an event
// emitter and simply has no `on`, so this covers the backends that need it.
for (const adapter of adapterInstances()) {
  adapter.on?.("settled", ({ record, completed }) => checkpointNativeAdapter(adapter, record, completed !== false));
  adapter.on?.("changed", ({ record, reason, name }) => {
    publishProcessChange(adapter.view(record), record, reason);
    if (reason === "named" && name) void applyBackendName(adapter, record, name)
      .catch((cause) => console.error("Could not apply backend chat name", cause));
  });
  adapter.on?.("removed", ({ id, chatId }) => runtimeHub.publishProcessRemoved(id, chatId));
}
registerDraftRoutes(app, { drafts });
registerRuntimeRoutes(app, {
  attachments,
  config,
  currentMagicDnsOrigin,
  formatWorkspacePath,
  isPathInside,
  isShuttingDown: () => shuttingDown,
  listDirectorySuggestions,
  preferences,
  resolveTemplate,
  runtimeHub,
  templatePublicView,
  projects,
  promptStore,
  serverIdentity,
});

registerPiAuthRoutes(app, {
  piAuth,
  installationViews,
});

registerSearchRoutes(app, {
  searchSettings,
  onSettingsChanged: recycleIdleIsolatedPiProcesses,
});
registerVoiceRoutes(app, { voiceSettings, voiceRuntime, voiceModel });

registerPtyRoutes(app, { projects, terminals });
registerTerminalPasteRoutes(app, { terminalPastes });

registerProjectRoutes(app, {
  messageIds,
  backends,
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
  readWorkspaceFileMetadata,
  readWorkspaceVersion,
  runWorkspaceGitAction,
  registry,
  terminals,
  lifecycle,
  turnCheckpoints,
});
const launchLiveSession = registerLiveSessionRoutes(app, {
  messageIds,
  attachments,
  backends,
  catalogFor,
  config,
  findChatContext,
  lifecycle,
  manager,
  preferences,
  registry,
  runtimeFor,
  runtimeSettings,
  templateForChat,
});
registerChatRoutes(app, {
  backends,
  catalogFor,
  chatModelView,
  lifecycle,
  config,
  defaultTemplate,
  findChatContext,
  launchLiveSession,
  modelCatalog,
  preferences,
  projects,
  registry,
  runtimeFor,
  templateForChat,
});
registerHarnessRoutes(app, { backends, harnessModels, preferences, projects, registry });
registerSessionRoutes(app, {
  attachments,
  backends,
  chatLogs,
  config,
  findChatContext,
  findRegisteredSession,
  lifecycle,
  messageIds,
  sessionNames,
  projects,
  readSessionPage,
  registry,
});
// The service worker decides which build everything else comes from, so a
// cached copy of it pins the whole client to a build that is no longer there.
// `no-store` rather than `no-cache` because a CDN in front of this will happily
// rewrite a revalidating header into a browser TTL of its own -- and a browser
// that will not re-fetch this file cannot discover a new one.
const WORKER_SCRIPTS = /^(sw|service-worker|registerSW|workbox-[^/]+)\.js$/;

app.use(express.static(dist, {
  setHeaders(response, file) {
    if (WORKER_SCRIPTS.test(path.basename(file))) response.setHeader("Cache-Control", "no-store, must-revalidate");
    else if (file.includes(`${path.sep}assets${path.sep}`)) response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
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
    kind: error.kind,
    mime: error.mime,
    size: error.size,
    modifiedAt: error.modifiedAt,
    revision: error.revision,
    head: error.head,
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
  backends,
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
  lifecycle,
  async autoNameSession(record, context, message) {
    const task = sessionNames.run({
      chatId: context.chat.id,
      cwd: context.project.workingRoot,
      source: "first_prompt",
      message,
      apply: async (name) => {
        const currentTitle = registry.metadata(context.chat.id)?.title;
        if (currentTitle && currentTitle !== "New chat") return "not_applied_title_already_set";
        const updated = await registry.update(context.chat.id, { title: name });
        backends.adapterForRecord(record).publish(record, {
          type: "session_checkpoint",
          chat: chatView(updated),
          generationId: record.generation?.id || null,
        });
        runtimeHub.publish({ type: "chat_changed", chat: chatView(updated), at: new Date().toISOString() });
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
  const match = pathname.match(/^\/v0\/live-sessions\/([a-f0-9-]{24,36})\/stream$/);
  const ptyMatch = pathname.match(/^\/v0\/ptys\/([a-f0-9-]{36})\/attach$/);
  const dictationMatch = pathname === "/v0/dictation/stream";
  if ((!match || !backends.get(match[1])) && (!ptyMatch || !terminals.get(ptyMatch[1])) && !dictationMatch) return socket.destroy();
  try {
    if (authStore.hasPassword()) {
      const ticket = requestUrl.searchParams.get("ticket");
      if (ticket) {
        if (!installedClientOrigin(request.headers.origin)) return socket.destroy();
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
  if (!backends.get(match[1])) return socket.destroy();
  return liveSessionStream.handleUpgrade(match[1], request, socket, head);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Conduit received ${signal}; stopping`);
  runtimeHub.close();
  await lanAdvertisement.stop();
  await dictationStream.shutdown?.({ timeoutMs: 1_000 });
  await terminalStream.shutdown?.({ timeoutMs: 1_000 });
  for (const socket of wss.clients) socket.close(1012, "Conduit is restarting");
  const archiveDrain = voiceRecordingStore.drain({ timeoutMs: VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS });
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  const stoppedProcesses = await manager.shutdown();
  const codexAdapter = backends.adapters.get("codex");
  let stoppedCodexProcesses = 0;
  for (const adapter of adapterInstances()) {
    const stopped = await adapter.shutdown?.();
    if (adapter === codexAdapter) stoppedCodexProcesses = stopped || 0;
  }
  const stoppedTerminals = await terminals.stopAll();
  await voiceModel.stop();
  await closed;
  const archiveResult = await archiveDrain;
  console.log(JSON.stringify({ type: "conduit.voice-archive-drain", ...archiveResult }));
  console.log(`Conduit stopped ${stoppedProcesses} Pi process${stoppedProcesses === 1 ? "" : "es"}`);
  console.log(`Conduit stopped ${stoppedCodexProcesses} Codex process${stoppedCodexProcesses === 1 ? "" : "es"}`);
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

// When the server stalls, say so and by how much. Everything here shares one
// thread, so a slow open is usually not the work somebody asked for -- it is
// whatever else was holding the loop. Without this that shows up only as "it
// randomly slows to a crawl", and the phase timings blame whoever was waiting.
let loopCheckAt = Date.now();
const loopLag = setInterval(() => {
  const drift = Date.now() - loopCheckAt - 500;
  loopCheckAt = Date.now();
  if (drift > 250) console.warn("Event loop stalled", { ms: drift });
}, 500);
loopLag.unref?.();

// Pay the model catalogue's cold start at boot, not on somebody's first click.
// Building it costs seconds the first time, and starting an agent validates its
// model against it before spawning -- so that cost used to sit in front of the
// first chat anybody opened. One warm-up, in the background, for the catalogue
// nearly every chat shares; the rest warm when they are first used.
const warmModelCatalogue = () => catalogFor(runtimeFor({ runtimeKind: "conduit_profile", template: config.piTemplate }), config.piTemplate)
  .list(process.cwd())
  .catch((error) => console.warn("Model catalogue could not be warmed", error.message));

server.listen(config.port, config.host, () => {
  console.log(
    // The bound port, not the requested one: with CONDUIT_PORT=0 the kernel picks
    // it, and announcing the request would announce a zero.
    `Conduit ${config.release} listening on http://${config.host}:${server.address().port}`,
  );
  // Started here rather than at construction because the port is the one the
  // kernel handed over: with CONDUIT_PORT=0 the requested port is a zero, and
  // an address nothing listens on is worse than no advertisement at all.
  lanAdvertisement.start(server.address().port);
  void warmModelCatalogue();
});
