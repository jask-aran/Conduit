import { remoteNode } from "../../place.js";
import os from "node:os";
import { deviceHost, projectWorkspace } from "../../workspace-host.js";
import { readWorkspaceComparison } from "../../workspace-comparison.js";
import { computerContext, findComputerGitRoot, resolveComputerContext } from "../../computer-context.js";
import path from "node:path";
import fs from "node:fs/promises";
import express from "express";
import { resolveTemplate } from "../../config.js";
import { chatView } from "../../chat-store.js";
import { removeProjectSessions, removeSession } from "../../session-store.js";
import {
  createWorkspaceDirectory,
  deleteWorkspaceDirectory,
  deleteWorkspaceFile,
  moveWorkspaceEntry,
  readWorkspaceVersion,
  resolveInspectorPath,
  writeWorkspaceFile,
} from "../../workspace-inspector.js";
import {
  findDeletableSession,
  stopProjectProcesses,
  stopSessionProcesses,
  moveDurableChat,
} from "../../session-operations.js";

/**
 * Where a path on a device falls among the folders it makes available: the root whose path holds it, and the parts
 * under that root. Either separator is taken (a browser joins Windows paths with "/"); a Windows root matches
 * whatever the case. Null when no root holds it.
 */
function placeOnDevice(roots, devicePath) {
  const parts = (value) => String(value || "").split(/[\\/]+/).filter(Boolean);
  const wanted = parts(devicePath);
  for (const root of [...roots].sort((a, b) => parts(b.label).length - parts(a.label).length)) {
    const base = parts(root.label);
    const windows = /^[a-z]:/i.test(base[0] || "");
    const same = (a, b) => windows ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (base.length <= wanted.length && base.every((part, index) => same(part, wanted[index]))) {
      const sub = wanted.slice(base.length);
      if (sub.includes("..")) return null;
      const separator = root.label.includes("\\") && !root.label.includes("/") ? "\\" : "/";
      const absolute = (list) => `${root.label.startsWith("/") ? "/" : ""}${list.join(separator)}`;
      return { root, sub, separator, path: absolute([...base, ...sub]), parent: sub.length ? absolute([...base, ...sub.slice(0, -1)]) : null };
    }
  }
  return null;
}

function resolveProjectDefaultTemplateId(config, requested, fallback = null) {
  if (requested == null || requested === "") return fallback;
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

const WORKSPACE_APPEARANCE_ICON_IDS = new Set([
  "activity", "aperture", "atom", "award", "badge-check", "bell",
  "book-open", "briefcase-business", "boxes", "braces", "building-2", "bug",
  "calendar-days", "camera", "chart-no-axes-combined", "code", "component",
  "cpu", "database", "folder-git-2", "flame", "gauge", "git-branch", "globe",
  "graduation-cap", "layers", "layers-2", "lightbulb", "map", "palette",
  "puzzle", "rocket", "route", "server-cog", "shield-check", "sparkles",
  "star", "terminal", "workflow", "zap",
]);
// Identity hues (components/ui/palettes.ts IDENTITY_HUES), and the Catppuccin names saved before hues.
const WORKSPACE_APPEARANCE_COLOR_IDS = new Set([
  "rose", "coral", "pink", "violet", "red", "orange", "yellow",
  "green", "teal", "cyan", "azure", "blue", "indigo",
  "rosewater", "flamingo", "mauve", "peach", "sky", "sapphire", "lavender",
]);
const WORKSPACE_APPEARANCE_HEX_COLOR = /^#[0-9a-f]{6}$/i;

function workspaceAppearanceError(message) {
  return Object.assign(new Error(message), { code: "workspace_appearance_invalid", status: 400 });
}

function normalizeWorkspaceAppearance(requested) {
  if (requested == null) return null;
  if (typeof requested !== "object" || Array.isArray(requested)) throw workspaceAppearanceError("Workspace identity must be an object");
  const mode = requested.mode;
  const value = String(requested.value || "").trim();
  const color = String(requested.color || "").trim().toLowerCase();
  if (mode !== "icon" && mode !== "monogram") throw workspaceAppearanceError("Workspace identity marker type is invalid");
  if (!WORKSPACE_APPEARANCE_COLOR_IDS.has(color) && !WORKSPACE_APPEARANCE_HEX_COLOR.test(color)) throw workspaceAppearanceError("Workspace identity color is invalid");
  if (mode === "icon") {
    if (!WORKSPACE_APPEARANCE_ICON_IDS.has(value)) throw workspaceAppearanceError("Workspace identity icon is invalid");
    return { mode, value, color: color.toLowerCase() };
  }
  if (!/^\p{L}{1,2}$/u.test(value)) throw workspaceAppearanceError("Workspace identity must use one or two letters");
  return { mode, value: value.toUpperCase(), color };
}

export function registerProjectRoutes(app, {
  nodeHub,
  backends,
  buildProjectDashboard,
  config,
  listWorkspaceDirectory,
  projects,
  readWorkspaceCommit,
  readWorkspaceDiff,
  readWorkspaceFile,
  readWorkspaceFileMetadata,
  runWorkspaceGitAction,
  registry,
  terminals,
  lifecycle,
  turnCheckpoints,
}) {
  const workspaceVersionPaths = (value) => {
    if (value == null) return [];
    if (typeof value !== "string") throw Object.assign(new Error("Workspace version paths are invalid"), { code: "invalid_workspace_path", status: 400 });
    try {
      const paths = JSON.parse(value);
      if (!Array.isArray(paths) || paths.length > 128 || paths.some((item) => typeof item !== "string" || item.length > 4_096)) throw new Error();
      return paths;
    } catch {
      throw Object.assign(new Error("Workspace version paths are invalid"), { code: "invalid_workspace_path", status: 400 });
    }
  };
  const inspectionContext = async (id, git = false) => {
    const computer = await resolveComputerContext(id);
    if (computer) {
      if (!git) return computer;
      const root = await findComputerGitRoot(computer.workingRoot);
      if (!root) throw Object.assign(new Error("No Git repository in this Computer context"), { status: 403, code: "source_control_disabled" });
      return computerContext(root);
    }
    const project = await projects.get(id);
    if (project) await projects.validate(project);
    return project;
  };
  // Where the inspector works for a project: this server's path, or the
  // device's folder through its environment (plan decision 22).
  const rootOf = (project) => projectWorkspace(project, nodeHub);
  const readComputerLocation = async (project) => {
    const [gitRoot, listing] = await Promise.all([
      findComputerGitRoot(project.workingRoot),
      listWorkspaceDirectory(project.workingRoot),
    ]);
    return { project, home: os.homedir(), parent: path.dirname(project.workingRoot), repository: Boolean(gitRoot), repositoryRoot: gitRoot, listing };
  };
  app.get("/v0/computer", async (request, response, next) => {
    try {
      const project = await computerContext(request.query.path === undefined ? os.homedir() : request.query.path);
      response.json(await readComputerLocation(project));
    } catch (error) { next(error); }
  });

  /*
   * A device's folders as Computer shows the server's, for choosing where a workspace goes: only inside the folders
   * it makes available (their grants are set on the device), so its first is home and nothing above a root is
   * listed. Same shape as /v0/computer, its project standing for the place.
   */
  app.get("/v0/nodes/:id/computer", async (request, response, next) => {
    try {
      const node = nodeHub && (await nodeHub.list()).find((item) => item.id === request.params.id);
      if (!node) return response.status(404).json({ error: "node_not_found" });
      if (!node.online) return response.status(503).json({ error: "device_offline", message: `${node.name} is offline` });
      if (node.browse) {
        // It lets this server browse it: any folder its user can list, by name and kind.
        const seen = await nodeHub.computer(node.id, "list", String(request.query.path || ""));
        const name = seen.path.split(/[\\/]/).filter(Boolean).at(-1) || seen.path;
        const project = { id: `device:${node.id}`, slug: `device-${node.id}`, name, workingRoot: seen.path, nodeId: node.id, kind: "workspace", sessions: [] };
        return response.json({ project, home: seen.home, parent: seen.parent ?? seen.path, repository: false, repositoryRoot: null,
          listing: { entries: seen.entries, cursor: null } });
      }
      if (!node.roots.length) return response.status(409).json({ error: "root_not_shared", message: `${node.name} makes no folders available yet` });
      const place = placeOnDevice(node.roots, request.query.path === undefined || request.query.path === "" ? node.roots[0].label : request.query.path);
      if (!place) return response.status(400).json({ error: "root_not_shared", message: `That folder is not one ${node.name} makes available` });
      const host = deviceHost({ hub: nodeHub, nodeId: node.id, place: { root: place.root.id, path: place.sub.join("/") }, label: place.path });
      const listing = await listWorkspaceDirectory(host);
      const project = { id: `device:${node.id}`, slug: `device-${node.id}`, name: place.sub.at(-1) || place.root.label, workingRoot: place.path,
        nodeId: node.id, place: { root: place.root.id, path: place.sub.join("/") }, kind: "workspace", sessions: [] };
      response.json({ project, home: node.roots[0].label, parent: place.parent ?? place.path, repository: false, repositoryRoot: null, listing });
    } catch (error) { next(error); }
  });

  app.post("/v0/computer/prefetch", async (request, response, next) => {
    try {
      const project = await resolveComputerContext(String(request.body?.id || ""));
      const paths = request.body?.paths;
      if (!project || !Array.isArray(paths) || paths.length > 8 || paths.some((item) => typeof item !== "string")) {
        return response.status(400).json({ error: "computer_prefetch_invalid" });
      }
      const locations = await Promise.all(paths.map(async (relativePath) => {
        try {
          const resolved = await resolveInspectorPath(project.workingRoot, relativePath, { kind: "directory" });
          return await readComputerLocation(await computerContext(resolved.path));
        } catch { return null; }
      }));
      response.json({ locations: locations.filter(Boolean) });
    } catch (error) { next(error); }
  });

  app.get("/v0/projects", async (_request, response, next) => {
    try {
      const items = await projects.list();
      const live = backends.list();
      response.json({ projects: await Promise.all(items.map(async (project) => ({
        ...project,
        // Whose it is and what can be done there, so the client asks that and never `nodeId`.
        capabilities: await backends.capabilities?.(project) || null,
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
        root: rootOf(project),
        registry,
        processes: backends.list(),
        terminals: terminals.list(),
        readTranscript: async (chat) => backends.forChat(chat).readTranscript({
          chatId: chat.id, opaqueSession: chat.backend?.opaqueSession, project,
        }),
        inspectWorkspace: (root, options) => readWorkspaceDiff(root, { ...options, includePatch: false }),
        // A harness with no threads of its own to enumerate (ChatGPT Web, the
        // test profile) has nothing to list, rather than failing the page.
        listBackendSessions: async (implementation, cwd) => (await backends.forImplementation(implementation).listSessions?.({ cwd })) || [],
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
      if (mode === "node") {
        // A folder a paired node shares: a root by id, and optionally a folder inside it.
        const nodeId = String(request.body?.nodeId || "");
        if (!nodeHub || !await nodeHub.get(nodeId)) return response.status(404).json({ error: "node_not_found" });
        // A root by id and a path inside it, or (from New workspace) the device's own path to the folder.
        const listed = (await nodeHub.list()).find((item) => item.id === nodeId);
        let located = request.body?.rootId ? null : placeOnDevice(listed?.roots || [], String(request.body?.path || ""));
        // Outside what it shares, on a device that lets this server browse it: it is asked to share the folder first.
        if (!request.body?.rootId && !located && listed?.browse && request.body?.path) {
          located = placeOnDevice(await nodeHub.computer(nodeId, "share", String(request.body.path)), String(request.body.path));
        }
        const root = located ? located.root : await nodeHub.root(nodeId, String(request.body?.rootId || ""));
        if (!root) return response.status(400).json({ error: "root_not_shared", message: "That folder is not shared by the device" });
        const subpath = located ? located.sub : String(request.body?.path || "").replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
        if (subpath.includes("..")) return response.status(400).json({ error: "invalid_workspace_path" });
        const separator = root.label.includes("\\") && !root.label.includes("/") ? "\\" : "/";
        const created = await projects.createOnNode({ name: name || undefined, nodeId, rootId: root.id, subpath: subpath.join("/"),
          label: [root.label.replace(/[\\/]+$/, ""), ...subpath].join(separator),
          defaultTemplateId: resolveProjectDefaultTemplateId(config, request.body?.defaultTemplateId, null) });
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
      const hasAppearance = Object.hasOwn(request.body || {}, "workspaceAppearance");
      if (!hasName && !hasDefault && !hasAppearance) return response.status(400).json({ error: "project_update_required" });
      const changes = {};
      if (hasName) {
        changes.name = String(request.body.name || "").trim();
        if (!changes.name) return response.status(400).json({ error: "project_name_required" });
      }
      if (hasDefault) changes.defaultTemplateId = resolveProjectDefaultTemplateId(config, request.body.defaultTemplateId, null);
      if (hasAppearance) {
        if (current.kind !== "workspace" && !["linked", "created", "cloned"].includes(current.origin)) return response.status(400).json({ error: "workspace_appearance_not_supported" });
        changes.workspaceAppearance = normalizeWorkspaceAppearance(request.body.workspaceAppearance);
      }
      const project = await projects.update(request.params.id, changes);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      response.json(project);
    } catch (error) { next(error); }
  });

  app.get("/v0/projects/:id/tree", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      const listing = await listWorkspaceDirectory(rootOf(project), request.query.path, { after: request.query.after });
      response.json({ path: String(request.query.path || ""), ...listing });
    } catch (error) { next(error); }
  });

  app.get("/v0/projects/:id/workspace/version", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      response.json(await readWorkspaceVersion(rootOf(project), { paths: workspaceVersionPaths(request.query.paths) }));
    } catch (error) { next(error); }
  });

  app.get("/v0/projects/:id/file", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (!request.query.path) return response.status(400).json({ error: "workspace_path_required" });
      const root = rootOf(project);
      if (request.query.download === "1" || request.query.inline === "1") {
        const resolved = await resolveInspectorPath(root, request.query.path, { kind: "file" });
        const metadata = await readWorkspaceFileMetadata(root, request.query.path);
        const inline = request.query.inline === "1";
        if (inline && !["image", "pdf", "audio", "video"].includes(metadata.kind)) {
          return response.status(415).json({ error: "unsupported_inline_type" });
        }
        if (inline && metadata.mime === "image/svg+xml") response.setHeader("Content-Security-Policy", "sandbox");
        const etag = `"${metadata.revision}"`;
        response.setHeader("ETag", etag);
        if (request.headers["if-none-match"] === etag) return response.status(304).end();
        const downloadName = encodeURIComponent(path.basename(resolved.relativePath)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        response.setHeader("Content-Type", metadata.mime);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "private, no-cache");
        response.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${downloadName}`);
        if (resolved.path) return response.sendFile(resolved.path);
        // A device's file comes through the device, whole.
        if (metadata.size > config.maxAttachmentBytes) return response.status(413).json({ error: "file_too_large" });
        return response.end(await resolved.host.read(resolved.relativePath));
      }
      if (request.query.metadata === "1") {
        return response.json(await readWorkspaceFileMetadata(root, request.query.path));
      }
      response.json(await readWorkspaceFile(root, request.query.path, {
        forceText: request.query.force === "text",
        preview: request.query.preview === "1",
      }));
    } catch (error) { next(error); }
  });

  app.put("/v0/projects/:id/file", express.raw({ type: "application/octet-stream", limit: config.maxAttachmentBytes }), async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (!request.query.path) return response.status(400).json({ error: "workspace_path_required" });
      const expectedRevision = typeof request.headers["if-match"] === "string" ? request.headers["if-match"] : null;
      const content = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const written = await writeWorkspaceFile(rootOf(project), request.query.path, content, { expectedRevision });
      response.status(expectedRevision == null ? 201 : 200).json(written);
    } catch (error) { next(error); }
  });

  app.delete("/v0/projects/:id/file", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (!request.query.path) return response.status(400).json({ error: "workspace_path_required" });
      await deleteWorkspaceFile(rootOf(project), request.query.path);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/v0/projects/:id/directory", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (!request.body?.path) return response.status(400).json({ error: "workspace_path_required" });
      response.status(201).json(await createWorkspaceDirectory(rootOf(project), request.body.path));
    } catch (error) { next(error); }
  });

  app.patch("/v0/projects/:id/entry", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (!request.body?.path || !request.body?.destination) {
        return response.status(400).json({ error: "workspace_path_required" });
      }
      response.json(await moveWorkspaceEntry(rootOf(project), request.body.path, request.body.destination));
    } catch (error) { next(error); }
  });

  app.delete("/v0/projects/:id/directory", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (!request.query.path) return response.status(400).json({ error: "workspace_path_required" });
      await deleteWorkspaceDirectory(rootOf(project), request.query.path);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/v0/projects/:id/diff", async (request, response, next) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    const close = () => { if (!response.writableEnded) abort(); };
    response.once("close", close);
    try {
      const project = await inspectionContext(request.params.id, true);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (project.kind !== "workspace") return response.status(403).json({ error: "source_control_disabled", message: "Source Control is available only for Workspaces." });
      if (request.query.compare === "1") {
        const scope = typeof request.query.scope === "string" ? request.query.scope : request.query.staged === "1" ? "staged" : "changes";
        response.json(await readWorkspaceComparison(rootOf(project), request.query.path, { scope, signal: controller.signal }));
      } else {
        response.json(await readWorkspaceDiff(rootOf(project), { filePath: typeof request.query.path === "string" ? request.query.path : null, staged: request.query.staged === "1", includePatch: request.query.patch === "1", includeHistory: request.query.history !== "0", reuse: request.query.reuse === "1", signal: controller.signal }));
      }
    } catch (error) {
      if (!request.aborted && !response.destroyed) next(error);
    } finally {
      request.removeListener("aborted", abort);
      response.removeListener("close", close);
    }
  });

  app.get("/v0/projects/:id/turn-artifact", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      const chatId = typeof request.query.chatId === "string" ? request.query.chatId : "";
      const chat = registry.metadata(chatId);
      if (!chat || chat.projectId !== project.id) return response.json(null);
      // Turn checkpoints snapshot the workspace where it is; a place that cannot (a device without Git there) has none.
      const can = await backends.capabilities?.(project);
      if (can && !can.checkpoints) return response.json(null);
      if (request.query.timeline === "1") {
        return response.json(await turnCheckpoints.timeline(chatId, rootOf(project)));
      }
      const baseline = request.query.baseline === "turn" ? "turn" : "chat";
      const checkpointId = typeof request.query.checkpointId === "string" ? request.query.checkpointId : null;
      const artifact = request.query.path
        ? await turnCheckpoints.compare(chatId, rootOf(project), request.query.path, checkpointId, baseline)
        : await turnCheckpoints.review(chatId, rootOf(project), baseline, checkpointId);
      response.json(artifact);
    } catch (error) { next(error); }
  });

  app.get("/v0/projects/:id/commits/:hash", async (request, response, next) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    const close = () => { if (!response.writableEnded) abort(); };
    response.once("close", close);
    try {
      const project = await inspectionContext(request.params.id, true);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (project.kind !== "workspace") return response.status(403).json({ error: "source_control_disabled", message: "Source Control is available only for Workspaces." });
      response.json(await readWorkspaceCommit(rootOf(project), request.params.hash, { signal: controller.signal }));
    } catch (error) {
      if (!request.aborted && !response.destroyed) next(error);
    } finally {
      request.removeListener("aborted", abort);
      response.removeListener("close", close);
    }
  });

  app.post("/v0/projects/:id/git", async (request, response, next) => {
    try {
      const project = await inspectionContext(request.params.id, true);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      if (project.kind !== "workspace") return response.status(403).json({ error: "source_control_disabled", message: "Source Control is available only for Workspaces." });
      response.json(await runWorkspaceGitAction(rootOf(project), {
        action: request.body?.action,
        relativePath: request.body?.path,
        message: request.body?.message,
      }));
    } catch (error) { next(error); }
  });

  // Every Conduit chat of one place moves to another; chats of other harnesses
  // stay (their history is the harness's, tied to the folder) and are listed.
  app.post("/v0/projects/:id/move-sessions", async (request, response, next) => {
    try {
      const source = await projects.get(request.params.id);
      const target = await projects.get(request.body?.projectId || "");
      if (!source || !target) return response.status(404).json({ error: "project_not_found" });
      await lifecycle.withProjects([source.id, target.id], async () => {
        await projects.validate(source);
        await projects.validate(target);
        if (source.id === target.id) throw Object.assign(new Error("Project target is unchanged"), { code: "project_target_unchanged", status: 409 });
        const moved = [];
        const kept = [];
        for (const { id } of registry.listProject(source.id, { includeHidden: true })) {
          const item = await lifecycle.run(id, async () => {
            const chat = registry.metadata(id);
            if (!chat || chat.projectId !== source.id) return null;
            lifecycle.assertAvailable(chat.id, source.id);
            lifecycle.assertAvailable(chat.id, target.id);
            try {
              return { sourceId: chat.id, session: chatView(await moveDurableChat({ chat, source, target, backends, registry })) };
            } catch (error) {
              if (error.code !== "chat_move_not_supported") throw error;
              kept.push({ id: chat.id, reason: error.message });
              return null;
            }
          });
          if (item) moved.push(item);
        }
        response.json({ moved, kept });
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
          try { await fs.lstat(project.workingRoot); }
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
          if (chat?.projectId === project.id) await stopSessionProcesses(backends, chat);
        });
      }
      await stopProjectProcesses(backends, project.id);
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
