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
import { duplicateSession, messagesFromEntries, pageSessionEntries, removeProjectSessions, removeSession, renameSession, settingsFromEntries, toolsFromEntries, transcriptFromEntries, validateSessionFile } from "./session-store.js";
import { PiManager } from "./pi-manager.js";
import { ChatStore, chatView, isChatId } from "./chat-store.js";
import { AttachmentStore } from "./attachment-store.js";
import { announcedAttachmentIds, serializeAttachmentEnvelope } from "./attachment-envelope.js";
import { CONTINUE_PROMPT } from "./continuation.js";
import { RuntimeHub } from "./runtime-hub.js";
import { defaultsFromEnv, RuntimeSettingsStore } from "./runtime-settings.js";
import { PreferencesStore } from "./preferences-store.js";
import { templatePublicView } from "../../scripts/pi-runtime.mjs";
import { isPathInside, listDirectorySuggestions } from "./workspace-paths.js";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { resolvePiLaunch } from "./pi-launch.js";

const config = loadConfig();
const projects = new ProjectStore(config);
await projects.initialize();
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
const attachments = new AttachmentStore(registry);
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
const manager = new PiManager({
  command: config.piCommand,
  agentDir: config.piAgentDir,
  template: config.piTemplate,
  maxLiveProcesses: runtimeSettings.get().maxLiveProcesses,
  maxGeneratingProcesses: runtimeSettings.get().maxGeneratingProcesses,
  idleProcessTtlMs: runtimeSettings.get().idleProcessTtlMs,
});
const runtimeHub = new RuntimeHub({ listViews: () => manager.list() });
manager.on("process_changed", ({ record, reason }) => {
  runtimeHub.publishProcess(manager.view(record), reason || "update");
});
manager.on("process_removed", ({ id, chatId }) => {
  runtimeHub.publishProcessRemoved(id, chatId);
});
const modelCatalog = new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: config.piTemplate.models });
const modelCatalogs = new Map();
const launchingChats = new Set();
const app = express();
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

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
    const session = await findDeletableSession(await projects.list(), context.chat);
    if (session) {
      const persisted = settingsFromEntries(session.entries);
      model = persisted.model || model;
      thinkingLevel = persisted.thinkingLevel || thinkingLevel;
      source = "jsonl";
    }
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

async function nativeResourceFingerprint(cwd) {
  const roots = [path.join(cwd, ".pi")];
  let current = path.resolve(cwd);
  while (true) {
    const agentsSkills = path.join(current, ".agents", "skills");
    if (agentsSkills !== path.join(os.homedir(), ".agents", "skills")) roots.push(agentsSkills);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const entries = [];
  let totalBytes = 0;
  const assertRealDirectory = async (target) => {
    let stat;
    try { stat = await fs.lstat(target); }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
    if (stat.isSymbolicLink()) {
      throw Object.assign(new Error("Symlinked project resources cannot be trusted through Conduit"), {
        code: "native_resource_symlink",
        path: target,
      });
    }
    return stat.isDirectory();
  };
  for (const root of roots.filter((item) => item.endsWith(`${path.sep}.agents${path.sep}skills`))) {
    const agentsRoot = path.dirname(root);
    if (await assertRealDirectory(agentsRoot)) await assertRealDirectory(root);
  }
  const visit = async (target) => {
    if (entries.length >= 10_000) {
      throw Object.assign(new Error("Too many project resources to preflight safely"), { code: "native_resource_limit" });
    }
    let stat;
    try { stat = await fs.lstat(target); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink()) {
      throw Object.assign(new Error("Symlinked project resources cannot be trusted through Conduit"), { code: "native_resource_symlink" });
    }
    let content = null;
    if (stat.isFile()) {
      totalBytes += stat.size;
      if (totalBytes > 100 * 1024 * 1024) {
        throw Object.assign(new Error("Project resources are too large to preflight safely"), { code: "native_resource_limit" });
      }
      content = crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex");
    }
    entries.push([path.relative(cwd, target), stat.mode, stat.size, content]);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const child of (await fs.readdir(target)).sort()) await visit(path.join(target, child));
  };
  for (const root of roots) await visit(root);
  return crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
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
  if (requiresResources) await nativeResourceFingerprint(project.path);
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

app.put("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const attachment = await attachments.write(
      context.project,
      context.chat.id,
      request.params.attachmentId,
      request.query.name,
      request,
    );
    response.status(201).json(attachment);
  } catch (error) {
    if (error.code === "EEXIST") return response.status(409).json({ error: "attachment_exists" });
    next(error);
  }
});

app.use(express.json({ limit: "128kb" }));

const pendingCheckpoints = new Set();
manager.on("event", ({ record, event }) => {
  const chat = record.chatId ? registry.metadata(record.chatId) : null;
  if (!["agent_end", "generation_stopped"].includes(event.type)
    || !chat || chat.status !== "active" || !record.sessionFile || pendingCheckpoints.has(record.id) || record.active) return;
  pendingCheckpoints.add(record.id);
  setTimeout(() => {
    projects.get(record.projectId)
      .then((project) => project && registry.syncFile(record.chatId, record.sessionFile, project, { waitForFileMs: 2000 }))
      .then((session) => session && manager.publish(record, { type: "session_checkpoint", chat: chatView(registry.metadata(record.chatId)) }))
      .catch((error) => console.error("Could not checkpoint the session registry", error))
      .finally(() => pendingCheckpoints.delete(record.id));
  }, 50).unref();
});
app.get("/healthz", (_request, response) => response.json({ ok: true, filesRoot: config.filesRoot }));
app.get("/v0/capabilities", (_request, response) => response.json({
  runtime: "pi-rpc", create: true, resume: true, projects: true,
  sessionManagement: true, chatIdentity: "conduit", attachments: "raw-http",
  partialContinue: config.enablePartialContinue,
  stream: "websocket", processOwner: "conduit-server", sessionAuthority: "pi-jsonl",
  globalRuntime: "sse",
  templates: true,
  workspaces: true,
  workspaceModes: ["managed", "linked", "cloned"],
  piRuntimes: ["conduit_profile", "native_pi"],
}));

app.get("/v0/pi-installations", async (_request, response, next) => {
  try { response.json({ installations: await installationViews() }); }
  catch (error) { next(error); }
});

app.post("/v0/pi-installations/host/detect", async (_request, response, next) => {
  try {
    const detected = await config.installations.detectHost();
    if (!detected.available) await clearHostPiDefaults();
    response.json((await installationViews()).find((item) => item.id === "host-pi"));
  } catch (error) { next(error); }
});

app.get("/v0/workspaces/:id/native-preflight", async (request, response, next) => {
  try {
    const project = await projects.get(request.params.id);
    if (!project || project.kind !== "workspace") return response.status(404).json({ error: "workspace_not_found" });
    await projects.validate(project);
    response.json(await nativePreflight(project));
  } catch (error) { next(error); }
});

app.get("/v0/workspaces/policy", (_request, response) => {
  response.json({
    allowlist: config.workspaceAllowlist,
    filesRoot: config.filesRoot,
    templatesRoot: config.templatesRoot,
    modes: ["managed", "linked", "cloned"],
  });
});

app.get("/v0/workspaces/suggestions", async (_request, response, next) => {
  try {
    const home = path.resolve(os.homedir());
    if (!config.workspaceAllowlist.some((root) => isPathInside(home, root))) {
      return response.json({ root: "~", folders: [] });
    }
    const folders = await listDirectorySuggestions(home);
    response.json({
      root: "~",
      folders: folders.map((folder) => ({
        name: folder.name,
        path: folder.path,
        displayPath: `~/${folder.name}`,
      })),
    });
  } catch (error) { next(error); }
});

app.get("/v0/templates", (_request, response) => {
  const prefs = preferences.get();
  response.json({
    defaultTemplateId: prefs.defaultTemplateId,
    templates: config.piTemplates.map((template) => templatePublicView(template)),
  });
});

app.get("/v0/preferences", (_request, response) => {
  response.json(preferences.get());
});

app.patch("/v0/preferences", async (request, response, next) => {
  try {
    const requested = request.body?.defaultTemplateId;
    const template = requested == null ? null : resolveTemplate(config, requested);
    if (requested != null && !template) {
      return response.status(400).json({ error: "unknown_template", templateId: requested });
    }
    if (template?.defaultable === false) {
      return response.status(400).json({ error: "special_template", templateId: requested });
    }
    const saved = await preferences.save({
      defaultTemplateId: requested ?? preferences.get().defaultTemplateId,
    });
    response.json(saved);
  } catch (error) { next(error); }
});

app.get("/v0/runtime", (_request, response) => {
  response.json(runtimeHub.snapshot());
});

app.get("/v0/runtime/stream", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();
  const client = { kind: "sse", response };
  const detach = runtimeHub.attach(client);
  const heartbeat = setInterval(() => {
    try { response.write(": ping\n\n"); }
    catch { clearInterval(heartbeat); detach(); }
  }, 25000);
  heartbeat.unref?.();
  request.on("close", () => {
    clearInterval(heartbeat);
    detach();
  });
});

async function stopSessionProcesses(session) {
  const chatId = session.chatId || session.id;
  const sessionFile = session.piSessionFile || session.file;
  const matching = manager.list().filter((item) => item.chatId === chatId || (sessionFile && item.sessionFile === sessionFile));
  await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
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
    if (mode === "clone" || mode === "cloned") {
      if (!request.body?.cloneUrl) return response.status(400).json({ error: "clone_url_required" });
      if (!request.body?.path) return response.status(400).json({ error: "workspace_path_required" });
      const created = await projects.create({
        mode: "cloned",
        name: name || undefined,
        cloneUrl: request.body.cloneUrl,
        path: request.body.path,
        defaultTemplateId: resolveProjectDefaultTemplateId(request.body?.defaultTemplateId, null),
      });
      return response.status(201).json(created);
    }
    if (!name) return response.status(400).json({ error: "project_name_required" });
    response.status(201).json(await projects.create({
      mode: "managed",
      name,
      defaultTemplateId: resolveProjectDefaultTemplateId(request.body?.defaultTemplateId, null),
    }));
  } catch (error) { next(error); }
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

app.post("/v0/projects/:id/move-sessions", async (request, response, next) => {
  try {
    const source = await projects.get(request.params.id);
    const target = await projects.get(request.body?.projectId || "");
    if (!source || !target) return response.status(404).json({ error: "project_not_found" });
    await projects.validate(source);
    await projects.validate(target);
    if (source.id === target.id) return response.status(409).json({ error: "project_target_unchanged" });
    const projectList = await projects.list();
    const chats = registry.listProject(source.id, { includeHidden: true });
    if (chats.some((chat) => chat.runtime?.kind === "native_pi")) {
      return response.status(409).json({ error: "chat_move_not_supported", message: "Host Pi chats cannot move between working roots." });
    }
    const moved = [];
    for (const chat of chats) {
      await stopSessionProcesses(chat);
      const session = chat.piSessionFile ? await registry.find(projectList, chat.id) : null;
      await moveRegisteredChat({ chat, source, target, session });
      moved.push({ sourceId: chat.id, session: chatView(registry.metadata(chat.id)) });
    }
    response.json({ moved });
  } catch (error) { next(error); }
});

app.delete("/v0/projects/:id", async (request, response, next) => {
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    let skipWorkingTree = false;
    try { await projects.validate(project); }
    catch (error) {
      if (project.origin !== "linked") throw error;
      skipWorkingTree = true;
    }
    const matching = manager.list().filter((item) => item.projectId === project.id);
    await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
    const projectList = await projects.list();
    const sessions = (await Promise.all(registry.listProject(project.id, { includeHidden: true })
      .map((chat) => findDeletableSession(projectList, chat)))).filter(Boolean);
    await Promise.all(sessions.map(removeSession));
    await removeProjectSessions(project);
    for (const chat of registry.listProject(project.id, { includeHidden: true })) {
      await registry.remove(chat.id, skipWorkingTree ? null : project);
    }
    await registry.removeProject(project.id);
    await projects.remove(project.id, { skipWorkingTree });
    response.status(204).end();
  } catch (error) { next(error); }
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
    if (launchingChats.has(context.chat.id) && (request.body?.templateId != null || request.body?.runtimeKind != null)) {
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
        return response.json({ ...current, model: spec || current.model, thinkingLevel: thinkingLevel || current.thinkingLevel });
      }
      if (spec) await catalogFor(runtime, template).updateDefault(context.project.path, spec, thinkingLevel);
    }
    response.json(await chatModelView(context));
  } catch (error) { next(error); }
});

app.post("/v0/runtime/chats", async (_request, response, next) => {
  try {
    const template = config.piTemplates.find((item) => item.special === true && item.id === "runtime");
    if (!template) return response.status(404).json({ error: "runtime_template_not_found" });
    const project = await projects.get("chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    const chat = await registry.create(project, {
      templateId: template.id,
      templateVersion: template.version,
      runtime: runtimeFor({ runtimeKind: "conduit_profile", template }),
    });
    response.status(201).json(chatView(chat));
  } catch (error) { next(error); }
});

app.delete("/v0/chats/:chatId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    if (request.query.ifEmpty !== "true") return response.status(409).json({ error: "use_chat_delete_route" });
    await stopSessionProcesses(context.chat);
    const removed = await registry.removeEmptyDraft(context.chat.id, context.project);
    response.status(removed ? 204 : 409).end();
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId/attachments", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const session = await registry.find(await projects.list(), context.chat.id);
    const announced = session ? announcedAttachmentIds(session.entries) : new Set();
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
    const session = await findDeletableSession(await projects.list(), context.chat);
    if (!session) return response.json({
      ...chatView(context.chat), messages: [], tools: [], attachments: [], page: { before: null },
    });
    const page = pageSessionEntries(session.entries, { before: request.query.before });
    const messages = messagesFromEntries(page.entries).filter((message) => ["user", "assistant"].includes(message.role));
    response.json({
      ...chatView(context.chat),
      ...settingsFromEntries(session.entries),
      messages,
      tools: toolsFromEntries(page.entries).map((tool) => ({ ...tool, result: tool.result?.length > 4000 ? null : tool.result, resultDeferred: tool.result?.length > 4000 })),
      page: { before: page.hasMore ? String(page.start) : null },
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
    // Never stop a warm process on rename — that drops the ready indicator and
    // thrash-kills idle agents. Live writers use Pi's set_session_name RPC;
    // cold sessions append session_info offline.
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
    const projectList = await projects.list();
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    if (context.chat.runtime?.kind === "native_pi") {
      return response.status(409).json({ error: "chat_move_not_supported", message: "Host Pi chats cannot move between working roots." });
    }
    const session = await registry.find(projectList, request.params.id);
    const target = projectList.find((item) => item.id === request.body?.projectId || item.slug === request.body?.projectId);
    if (!target) return response.status(404).json({ error: "project_not_found" });
    await projects.validate(target);
    if (context.chat.projectId === target.id) return response.status(409).json({ error: "session_project_unchanged" });
    await stopSessionProcesses(context.chat);
    await moveRegisteredChat({ chat: context.chat, source: context.project, target, session });
    response.json(chatView(registry.metadata(context.chat.id)));
  } catch (error) { next(error); }
});

app.delete("/v0/sessions/:id", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const session = await findDeletableSession(await projects.list(), context.chat);
    await stopSessionProcesses(context.chat);
    if (session) await removeSession(session);
    await registry.remove(context.chat.id, context.project);
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
  let lockedChatId = null;
  let launchedRecord = null;
  try {
    const chatId = request.body?.chatId || request.body?.resumeSessionId;
    const context = await findChatContext(chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    if (launchingChats.has(context.chat.id)) return response.status(409).json({ error: "live_session_starting" });
    launchingChats.add(context.chat.id);
    lockedChatId = context.chat.id;
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
      try { await validateSessionFile(context.chat.piSessionFile, context.project); }
      catch (error) {
        return response.status(409).json({ error: "session_file_unavailable", message: error.message });
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
  } catch (error) {
    if (launchedRecord && ["starting", "running"].includes(launchedRecord.status)) {
      await manager.stopAndWait(launchedRecord.id).catch(() => {});
    }
    next(error);
  } finally {
    if (lockedChatId) launchingChats.delete(lockedChatId);
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
  if (error.code === "reserved_project" || error.code === "workspace_already_linked") status = 409;
  if (error.code === "workspace_identity_changed") status = 409;
  if (["chat_move_not_supported", "live_session_starting", "runtime_locked", "session_writer_conflict"].includes(error.code)) status = 409;
  if (error.code === "live_process_limit" || error.code === "generation_limit") status = 429;
  if (error.code === "attachment_not_found" || error.code === "path_not_found") status = 404;
  if (error.code === "command_failed") status = 502;
  if (error.code === "invalid_attachment_id"
    || [
      "enabled_models_required",
      "invalid_enabled_model",
      "invalid_default_model",
      "path_not_allowed",
      "path_not_absolute",
      "path_not_directory",
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
    ].includes(error.code)
    || error.message?.includes("Project names")) status = 400;
  response.status(status).json({
    error: error.code || "runtime_error",
    message: error.message,
    path: error.path,
    allowlist: error.allowlist,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

async function promptForChat(record, command, message) {
  const context = await findChatContext(record.chatId);
  if (!context) throw new Error("Chat no longer exists");
  const selectedAttachments = await attachments.resolveMany(context.project, context.chat.id, command.attachmentIds);
  const prompt = serializeAttachmentEnvelope({ chatId: context.chat.id, attachments: selectedAttachments, message });
  return { context, prompt };
}

async function sendPrompt(record, prepared, options) {
  const generationId = await manager.promptAccepted(record.id, prepared.prompt, options);
  if (prepared.context.chat.status === "draft") {
    await registry.update(prepared.context.chat.id, {
      status: "active",
      piSessionId: record.sessionId || null,
      piSessionFile: record.sessionFile,
    });
  }
  return generationId;
}

async function syncForkedChat(record) {
  const context = await findChatContext(record.chatId);
  if (!context) throw new Error("Chat no longer exists");
  await registry.update(context.chat.id, {
    piSessionId: record.sessionId || context.chat.piSessionId,
    piSessionFile: record.sessionFile,
  });
  manager.publish(record, { type: "history_forked", chat: chatView(registry.metadata(context.chat.id)) });
  return registry.metadata(context.chat.id);
}

async function handleClientCommand(record, command) {
  if (command.type === "prompt") {
    const prepared = await promptForChat(record, command, String(command.message || ""));
    const streamingBehavior = command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
      ? command.streamingBehavior
      : null;
    return sendPrompt(record, prepared, { streamingBehavior });
  }
  if (command.type === "follow_up" || command.type === "steer") {
    const prepared = await promptForChat(record, command, String(command.message || ""));
    await manager.queueAccepted(record.id, command.type, prepared.prompt);
    return null;
  }
  if (command.type === "stop_generation" || command.type === "abort") {
    return manager.abortGeneration(record.id, command.generationId || null);
  }
  if (command.type === "fork_and_prompt") {
    await manager.fork(record.id, command.entryId);
    await syncForkedChat(record);
    const prepared = await promptForChat(record, command, String(command.message || ""));
    return sendPrompt(record, prepared);
  }
  if (command.type === "regenerate") {
    const forked = await manager.fork(record.id, command.entryId);
    await syncForkedChat(record);
    return manager.promptAccepted(record.id, forked.text);
  }
  if (command.type === "continue") {
    if (!config.enablePartialContinue) throw Object.assign(new Error("Partial continuation is disabled"), { code: "partial_continue_disabled" });
    const persisted = await findRegisteredSession(record.chatId);
    const previous = persisted ? messagesFromEntries(persisted.entries).findLast((message) => message.role === "assistant") : null;
    const partial = previous?.content || record.generation?.partial || "";
    if (!partial || (!previous?.stopped && !record.generation?.closed)) throw new Error("There is no stopped response to continue");
    // Experimental and intentionally removable: this is an ordinary hidden user prompt, not assistant prefill.
    return manager.promptAccepted(record.id, CONTINUE_PROMPT, { continuationBase: partial });
  }
  if (command.type === "extension_ui_response" || command.type === "host_ui_response") {
    manager.respondHostUi(record.id, command);
    return null;
  }
  if (command.type === "refresh_context") {
    return manager.refreshContextUsage(record.id);
  }
  manager.send(record.id, command);
  return null;
}

server.on("upgrade", (request, socket, head) => {
  const match = new URL(request.url, "http://localhost").pathname.match(/^\/v0\/live-sessions\/([a-f0-9]{24})\/stream$/);
  if (!match || !manager.get(match[1])) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => {
    const record = manager.get(match[1]);
    manager.attach(match[1], ws);
    const turnStart = record.events.findLastIndex((event) => event.type === "agent_start");
    const generationOpen = record.generation
      && !record.generation.closed
      && !record.generation.settled;
    const pendingEvents = generationOpen && turnStart >= 0
      ? record.events.slice(turnStart).filter((event) => event.type !== "assistant_stream_delta")
      : [];
    const stream = record.stream
      ? { generationId: record.stream.generationId, content: record.stream.chunks.join("") }
      : null;
    if (record.status === "running" && !record.contextUsage?.contextWindow) {
      manager.refreshContextUsage(record.id).catch(() => {});
    }
    ws.send(JSON.stringify({
      type: "runtime_snapshot",
      session: manager.view(record),
      stream,
      events: pendingEvents,
      hostUiRequests: record.hostUiRequests || [],
      queue: record.queue || { steering: [], followUp: [] },
      contextUsage: record.contextUsage || null,
    }));
    ws.on("message", (data) => {
      Promise.resolve()
        .then(() => handleClientCommand(record, JSON.parse(String(data))))
        .catch((error) => ws.send(JSON.stringify({ type: "client_error", code: error.code, message: error.message })));
    });
  });
});

server.listen(config.port, config.host, () => console.log(`Conduit listening on http://${config.host}:${config.port}`));
