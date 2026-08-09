import fs from "node:fs/promises";
import { resolveTemplate } from "../../config.js";
import { chatView } from "../../chat-store.js";
import { removeProjectSessions, removeSession } from "../../session-store.js";
import {
  findDeletableSession,
  moveRegisteredChat,
  stopSessionProcesses,
} from "../../session-operations.js";

function resolveProjectDefaultTemplateId(config, requested, fallback = null, { allowHostPi = false } = {}) {
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

export function registerProjectRoutes(app, {
  buildProjectDashboard,
  config,
  listWorkspaceDirectory,
  manager,
  projects,
  readSessionPage,
  readWorkspaceDiff,
  readWorkspaceFile,
  registry,
  terminals,
  lifecycle,
}) {
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
          defaultTemplateId: resolveProjectDefaultTemplateId(config, request.body?.defaultTemplateId, null),
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
          defaultTemplateId: resolveProjectDefaultTemplateId(config, request.body?.defaultTemplateId, null),
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
          defaultTemplateId: resolveProjectDefaultTemplateId(config, request.body?.defaultTemplateId, null),
        });
        return response.status(202).json(created);
      }
      if (!name) return response.status(400).json({ error: "project_name_required" });
      response.status(201).json(await projects.create({
        mode: "managed",
        name,
        defaultTemplateId: resolveProjectDefaultTemplateId(config, request.body?.defaultTemplateId, null),
      }));
    } catch (error) {
      if (!request.aborted && !response.destroyed) next(error);
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
      if (hasDefault) changes.defaultTemplateId = resolveProjectDefaultTemplateId(config, request.body.defaultTemplateId, null, { allowHostPi: current.kind === "workspace" });
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
            await stopSessionProcesses(manager, chat);
            lifecycle.assertAvailable(chat.id, source.id);
            lifecycle.assertAvailable(chat.id, target.id);
            await moveRegisteredChat({ chat, source, target, session, registry });
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
          if (chat?.projectId === project.id) await stopSessionProcesses(manager, chat);
        });
      }
      const matching = manager.list().filter((item) => item.projectId === project.id);
      await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
      await terminals.removeProject(project.id);
      const sessions = (await Promise.all(chats
        .map((chat) => findDeletableSession(registry, projectList, chat)))).filter(Boolean);
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
}
