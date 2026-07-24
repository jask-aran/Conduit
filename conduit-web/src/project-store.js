import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { sessionDirectoryFor } from "./session-store.js";
import { assertAllowedPath, assertSafeWorkspaceRoot, isPathInside, resolveExistingDirectory } from "./workspace-paths.js";
import { ensureConduitRoot } from "./owned-paths.js";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ORIGINS = new Set(["managed", "linked", "cloned"]);
export const CLONE_COMMAND_TIMEOUT_MS = 120_000;
export const CLONE_COMMAND_MAX_OUTPUT_BYTES = 64 * 1024;

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cloneError(code, message) {
  return Object.assign(new Error(message), { code });
}

function terminateProcess(child) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); }
    catch { child.kill("SIGTERM"); }
    setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch {}
    }, 500).unref();
    return;
  }
  child.kill("SIGTERM");
}

function appendTail(current, chunk, limit) {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next) <= limit) return next;
  return Buffer.from(next).subarray(-limit).toString("utf8");
}

async function resolveCloneParent(inputPath, allowlist, { dataRoot } = {}) {
  const textual = assertAllowedPath(inputPath, allowlist, "clone parent directory");
  let resolved;
  try { resolved = await fs.realpath(textual); }
  catch (error) {
    if (error.code === "ENOENT") throw cloneError("path_not_found", "Clone parent directory does not exist");
    throw error;
  }
  const parent = assertAllowedPath(resolved, allowlist, "clone parent directory");
  if (dataRoot && isPathInside(parent, dataRoot)) throw cloneError("dangerous_workspace_root", "That directory is too broad or owned by Conduit application data");
  const stat = await fs.stat(parent);
  if (!stat.isDirectory()) throw cloneError("path_not_directory", "Clone parent directory must be a directory");
  return parent;
}

function cloneDirectoryName(value, url) {
  const inferred = url.replace(/\.git$/i, "").split("/").filter(Boolean).pop() || "repo";
  const directory = String(value || inferred).trim();
  if (!directory || directory === "." || directory === ".." || /[\\/]/.test(directory)) {
    throw cloneError("clone_directory_invalid", "Folder name must be a single directory name");
  }
  return directory;
}

/** Run an external clone command with cancellation, a hard deadline, and bounded diagnostics. */
export function runCommand(command, args, { cwd, signal, timeoutMs = CLONE_COMMAND_TIMEOUT_MS, maxOutputBytes = CLONE_COMMAND_MAX_OUTPUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cloneError("clone_aborted", "Clone was cancelled"));
    const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let terminalError = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const fail = (error) => {
      if (terminalError) return;
      terminalError = error;
      terminateProcess(child);
    };
    const onAbort = () => fail(cloneError("clone_aborted", "Clone was cancelled"));
    const timer = setTimeout(() => fail(cloneError("clone_timeout", "Clone timed out")), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = appendTail(stdout, chunk, maxOutputBytes); });
    child.stderr.on("data", (chunk) => { stderr = appendTail(stderr, chunk, maxOutputBytes); });
    child.on("error", (error) => finish(terminalError || error));
    child.on("exit", () => { if (terminalError) finish(terminalError); });
    child.on("close", (code) => {
      if (terminalError) return finish(terminalError);
      if (code === 0) finish(null, { stdout, stderr });
      else {
        const error = new Error(stderr.trim() || stdout.trim() || `${command} failed`);
        error.code = "command_failed";
        error.exitCode = code;
        finish(error);
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class ProjectStore {
  constructor({ filesRoot, catalogFile, piAgentDir, workspaceAllowlist = [], dataRoot = null, cloneTimeoutMs = CLONE_COMMAND_TIMEOUT_MS, runCommand: commandRunner = runCommand }) {
    this.filesRoot = path.resolve(filesRoot);
    this.catalogFile = catalogFile;
    this.piAgentDir = piAgentDir;
    this.workspaceAllowlist = workspaceAllowlist.map((item) => path.resolve(item));
    this.dataRoot = dataRoot ? path.resolve(dataRoot) : null;
    this.cloneTimeoutMs = cloneTimeoutMs;
    this.runCommand = commandRunner;
    this.cloneReservationRoot = path.join(path.dirname(this.catalogFile), "clone-reservations");
    this.cloneReservations = new Map();
    this.reservedSlugs = new Set();
    // Serialize only catalogue transitions; clone network work executes between
    // its reservation and commit transitions.
    this.mutationQueue = Promise.resolve();
  }

  runExclusive(work) {
    const run = this.mutationQueue.then(work, work);
    this.mutationQueue = run.then(() => {}, () => {});
    return run;
  }

  async initialize() {
    await fs.mkdir(this.filesRoot, { recursive: true });
    await fs.mkdir(this.piAgentDir, { recursive: true });
    const catalog = await readJson(this.catalogFile, { version: 2, projects: [] });
    if ((catalog.version || 1) < 2) {
      for (const project of Array.isArray(catalog.projects) ? catalog.projects : []) {
        if (["linked", "cloned"].includes(project.origin) && project.defaultTemplateId === "workspace") {
          project.defaultTemplateId = null;
        }
      }
      catalog.version = 2;
      await writeJson(this.catalogFile, catalog);
    }
    await this.recoverCloneReservations();
    await this.ensure({ slug: "chat", name: "Chats", kind: "unstructured", origin: "managed" });
  }

  managedPath(slug) {
    if (!SLUG.test(slug)) throw new Error("Invalid project slug");
    return slug === "chat" ? this.filesRoot : path.join(this.filesRoot, slug);
  }

  async readCatalog() {
    const catalog = await readJson(this.catalogFile, { version: 2, projects: [] });
    return {
      version: 2,
      projects: Array.isArray(catalog.projects) ? catalog.projects : [],
    };
  }

  resolvePath(project) {
    if (project.externalPath) {
      return path.resolve(project.externalPath);
    }
    return this.managedPath(project.slug);
  }

  projectView(project) {
    const projectPath = this.resolvePath(project);
    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      kind: project.kind || "project",
      origin: project.origin || (project.externalPath ? "linked" : "managed"),
      externalPath: project.externalPath || null,
      cloneUrl: project.cloneUrl || null,
      defaultTemplateId: project.defaultTemplateId || null,
      createdAt: project.createdAt,
      path: projectPath,
      sessionsDir: sessionDirectoryFor(projectPath, this.piAgentDir),
      deletesFilesOnRemove: (project.origin || "managed") === "managed",
    };
  }

  async ensure({ slug: rawSlug, name, kind = "project", origin = "managed", externalPath = null, cloneUrl = null, defaultTemplateId = null }) {
    const slug = slugify(rawSlug || name);
    if (!SLUG.test(slug)) throw new Error("Project names must contain letters or numbers");
    const catalog = await this.readCatalog();
    let project = catalog.projects.find((item) => item.slug === slug);
    if (!project) {
      project = {
        id: slug === "chat" ? "project_chat" : `project_${crypto.randomUUID()}`,
        slug,
        name: String(name || slug).trim(),
        kind,
        origin: ORIGINS.has(origin) ? origin : "managed",
        externalPath: externalPath ? path.resolve(externalPath) : null,
        cloneUrl: cloneUrl || null,
        defaultTemplateId: defaultTemplateId || null,
        createdAt: new Date().toISOString(),
      };
      catalog.projects.push(project);
      await writeJson(this.catalogFile, catalog);
    }
    if ((project.origin || "managed") !== "linked") {
      await fs.mkdir(this.managedPath(slug), { recursive: true });
    }
    return this.projectView(project);
  }

  async list() {
    const catalog = await this.readCatalog();
    const projects = catalog.projects
      .filter((project) => project?.id && SLUG.test(project.slug))
      .map((project) => this.projectView(project));
    return projects.sort((a, b) => a.slug === "chat" ? -1 : b.slug === "chat" ? 1 : a.name.localeCompare(b.name));
  }

  async get(idOrSlug) {
    return (await this.list()).find((project) => project.id === idOrSlug || project.slug === idOrSlug) || null;
  }

  async createManaged({ name, defaultTemplateId = null }) {
    return this.runExclusive(async () => {
      // Always mint a new catalog row with a free slug. Never reuse a linked/cloned
      // (or existing managed) entry via ensure()'s slug-idempotent path — that can
      // silently point a "new workspace" at an external tree.
      const slug = await this.uniqueSlug(name);
      const catalog = await this.readCatalog();
      const project = {
        id: `project_${crypto.randomUUID()}`,
        slug,
        name: String(name || slug).trim(),
        kind: "project",
        origin: "managed",
        externalPath: null,
        cloneUrl: null,
        defaultTemplateId: defaultTemplateId || null,
        createdAt: new Date().toISOString(),
      };
      catalog.projects.push(project);
      const target = this.managedPath(slug);
      await fs.mkdir(target, { recursive: false });
      try { await writeJson(this.catalogFile, catalog); }
      catch (error) {
        await fs.rmdir(target).catch(() => {});
        throw error;
      }
      return this.projectView(project);
    });
  }

  async createLinked({ name, path: inputPath, defaultTemplateId = null }) {
    const externalPath = await resolveExistingDirectory(inputPath, this.workspaceAllowlist, { dataRoot: this.dataRoot });
    return this.runExclusive(async () => {
      const slugBase = name || path.basename(externalPath);
      const slug = await this.uniqueSlug(slugBase);
      const catalog = await this.readCatalog();
      if (catalog.projects.some((item) => path.resolve(this.resolvePath(item)) === externalPath)) {
        const error = new Error("That directory is already registered");
        error.code = "workspace_already_linked";
        throw error;
      }
      const project = {
        id: `project_${crypto.randomUUID()}`,
        slug,
        name: String(name || path.basename(externalPath)).trim(),
        kind: "workspace",
        origin: "linked",
        externalPath,
        cloneUrl: null,
        defaultTemplateId: defaultTemplateId || null,
        createdAt: new Date().toISOString(),
      };
      catalog.projects.push(project);
      await ensureConduitRoot({ path: externalPath, origin: "linked" });
      await writeJson(this.catalogFile, catalog);
      return this.projectView(project);
    });
  }

  reservationFile(id) {
    return path.join(this.cloneReservationRoot, `${id}.json`);
  }

  async recoverCloneReservations() {
    const entries = await fs.readdir(this.cloneReservationRoot, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map(async (entry) => {
      const marker = path.join(this.cloneReservationRoot, entry.name);
      try {
        const reservation = await readJson(marker);
        const id = String(reservation?.id || "");
        const target = path.resolve(String(reservation?.target || ""));
        const staging = path.resolve(String(reservation?.staging || ""));
        const expectedName = `.conduit-clone-${id}.part`;
        const allowed = this.workspaceAllowlist.some((root) => isPathInside(target, root) && isPathInside(staging, root));
        if (id && path.basename(staging) === expectedName && path.dirname(staging) === path.dirname(target) && allowed) {
          await fs.rm(staging, { recursive: true, force: true });
        }
      } finally {
        await fs.rm(marker, { force: true });
      }
    }));
  }

  async reserveClone({ name, url, target, defaultTemplateId }) {
    return this.runExclusive(async () => {
      if (this.cloneReservations.has(target)) throw cloneError("clone_target_reserved", "Clone target is already being prepared");
      try {
        await fs.access(target);
        throw cloneError("clone_target_exists", "clone target already exists");
      } catch (error) {
        if (error.code === "clone_target_exists") throw error;
        if (error.code !== "ENOENT") throw error;
      }
      const catalog = await this.readCatalog();
      if (catalog.projects.some((item) => path.resolve(this.resolvePath(item)) === target)) {
        throw cloneError("workspace_already_linked", "That directory is already registered");
      }
      const slugBase = name || url.replace(/\.git$/i, "").split("/").filter(Boolean).pop() || "repo";
      const slug = await this.uniqueSlug(slugBase);
      const id = crypto.randomUUID();
      const reservation = {
        id,
        target,
        staging: path.join(path.dirname(target), `.conduit-clone-${id}.part`),
        project: {
          id: `project_${crypto.randomUUID()}`,
          slug,
          name: String(name || slug).trim(),
          kind: "workspace",
          origin: "cloned",
          externalPath: target,
          cloneUrl: url,
          defaultTemplateId: defaultTemplateId || null,
          createdAt: new Date().toISOString(),
        },
      };
      await fs.mkdir(this.cloneReservationRoot, { recursive: true });
      await writeJson(this.reservationFile(id), { id, target: reservation.target, staging: reservation.staging, createdAt: reservation.project.createdAt });
      this.cloneReservations.set(target, reservation);
      this.reservedSlugs.add(slug);
      return reservation;
    });
  }

  async releaseCloneReservation(reservation) {
    this.cloneReservations.delete(reservation.target);
    this.reservedSlugs.delete(reservation.project.slug);
    await fs.rm(this.reservationFile(reservation.id), { force: true });
  }

  async createCloned({ name, cloneUrl, path: inputPath, cloneParentPath, cloneDirectoryName: requestedDirectoryName, defaultTemplateId = null, signal }) {
    const url = String(cloneUrl || "").trim();
    if (!url) {
      const error = new Error("cloneUrl is required");
      error.code = "clone_url_required";
      throw error;
    }
    if (path.isAbsolute(url)) await resolveExistingDirectory(url, this.workspaceAllowlist, { dataRoot: this.dataRoot });
    else if (/^file:/i.test(url)) {
      const localPath = decodeURIComponent(new URL(url).pathname);
      await resolveExistingDirectory(localPath, this.workspaceAllowlist, { dataRoot: this.dataRoot });
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      const parsed = new URL(url);
      if (!new Set(["https:", "ssh:"]).has(parsed.protocol)) {
        const error = new Error("Clone URL scheme is not allowed");
        error.code = "clone_url_not_allowed";
        throw error;
      }
      if (parsed.password || (parsed.protocol === "https:" && parsed.username)) {
        const error = new Error("Clone URLs must not contain credentials");
        error.code = "clone_url_credentials";
        throw error;
      }
    } else if (!/^[\w.-]+@[\w.-]+:.+/.test(url)) {
      const error = new Error("Clone source must be an allow-listed local path or a supported Git URL");
      error.code = "clone_url_not_allowed";
      throw error;
    }
    if (!inputPath && !cloneParentPath) {
      const error = new Error("path is required");
      error.code = "workspace_path_required";
      throw error;
    }
    let target;
    if (cloneParentPath) {
      const parent = await resolveCloneParent(cloneParentPath, this.workspaceAllowlist, { dataRoot: this.dataRoot });
      target = path.join(parent, cloneDirectoryName(requestedDirectoryName, url));
      assertSafeWorkspaceRoot(target, { dataRoot: this.dataRoot });
    } else {
      target = assertAllowedPath(inputPath, this.workspaceAllowlist, "clone target");
      assertSafeWorkspaceRoot(target, { dataRoot: this.dataRoot });
      const parent = await resolveExistingDirectory(path.dirname(target), this.workspaceAllowlist, { dataRoot: this.dataRoot });
      if (path.dirname(target) !== parent) {
        const error = new Error("Clone target parent resolves to a different path");
        error.code = "path_not_allowed";
        throw error;
      }
    }
    const reservation = await this.reserveClone({ name, url, target, defaultTemplateId });
    try {
      const options = { signal, timeoutMs: this.cloneTimeoutMs };
      const githubSource = /^(?:https:\/\/github\.com\/|ssh:\/\/[^/]*github\.com\/|git@github\.com:)/i.test(url);
      let cloned = false;
      if (githubSource) {
        try {
          await this.runCommand("gh", ["repo", "clone", url, reservation.staging, "--"], options);
          cloned = true;
        } catch (error) {
          if (["clone_aborted", "clone_timeout"].includes(error.code)) throw error;
          await fs.rm(reservation.staging, { recursive: true, force: true }).catch(() => {});
        }
      }
      if (!cloned) await this.runCommand("git", ["clone", "--", url, reservation.staging], options);
      await ensureConduitRoot({ path: reservation.staging, origin: "linked" });
      return await this.runExclusive(async () => {
        if (this.cloneReservations.get(target)?.id !== reservation.id) throw cloneError("clone_reservation_lost", "Clone reservation was lost");
        try {
          await fs.access(target);
          throw cloneError("clone_target_exists", "clone target already exists");
        } catch (error) {
          if (error.code === "clone_target_exists") throw error;
          if (error.code !== "ENOENT") throw error;
        }
        const catalog = await this.readCatalog();
        if (catalog.projects.some((item) => item.slug === reservation.project.slug || path.resolve(this.resolvePath(item)) === target)) {
          throw cloneError("clone_reservation_lost", "Clone reservation conflicts with the current catalogue");
        }
        await fs.rename(reservation.staging, target);
        try {
          catalog.projects.push(reservation.project);
          await writeJson(this.catalogFile, catalog);
        } catch (error) {
          await fs.rename(target, reservation.staging).catch(() => {});
          throw error;
        }
        await this.releaseCloneReservation(reservation);
        return this.projectView(reservation.project);
      });
    } catch (error) {
      await fs.rm(reservation.staging, { recursive: true, force: true }).catch(() => {});
      await this.runExclusive(() => this.releaseCloneReservation(reservation));
      throw error;
    }
  }

  async create(input = {}) {
    const mode = String(input.mode || input.origin || "managed").trim().toLowerCase();
    if (mode === "link" || mode === "linked") {
      return this.createLinked(input);
    }
    if (mode === "clone" || mode === "cloned") {
      return this.createCloned(input);
    }
    return this.createManaged(input);
  }

  async uniqueSlug(raw) {
    let base = slugify(raw) || "workspace";
    if (!SLUG.test(base)) base = "workspace";
    const catalog = await this.readCatalog();
    const used = new Set([...catalog.projects.map((item) => item.slug), ...this.reservedSlugs]);
    if (!used.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base.slice(0, 44)}-${index}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base.slice(0, 30)}-${crypto.randomUUID().slice(0, 8)}`;
  }

  async rename(idOrSlug, name) {
    return this.runExclusive(() => this.renameUnlocked(idOrSlug, name));
  }

  async update(idOrSlug, changes = {}) {
    return this.runExclusive(async () => {
      const catalog = await this.readCatalog();
      const project = catalog.projects.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
      if (!project) return null;
      if (Object.hasOwn(changes, "name")) {
        const name = String(changes.name || "").trim();
        if (!name) throw new Error("Project names must contain letters or numbers");
        if (project.slug === "chat") throw Object.assign(new Error("The unstructured Chats project cannot be renamed"), { code: "reserved_project" });
        project.name = name;
      }
      if (Object.hasOwn(changes, "defaultTemplateId")) project.defaultTemplateId = changes.defaultTemplateId || null;
      await writeJson(this.catalogFile, catalog);
      return this.projectView(project);
    });
  }

  async renameUnlocked(idOrSlug, name) {
    const nextName = String(name || "").trim();
    if (!nextName) throw new Error("Project names must contain letters or numbers");
    const catalog = await this.readCatalog();
    const project = catalog.projects.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
    if (!project) return null;
    if (project.slug === "chat") {
      const error = new Error("The unstructured Chats project cannot be renamed");
      error.code = "reserved_project";
      throw error;
    }
    project.name = nextName;
    await writeJson(this.catalogFile, catalog);
    return this.projectView(project);
  }

  async remove(idOrSlug, options = {}) {
    return this.runExclusive(() => this.removeUnlocked(idOrSlug, options));
  }

  async removeUnlocked(idOrSlug, { skipWorkingTree = false } = {}) {
    const catalog = await this.readCatalog();
    const project = catalog.projects.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
    if (!project) return null;
    if (project.slug === "chat") {
      const error = new Error("The unstructured Chats project cannot be deleted");
      error.code = "reserved_project";
      throw error;
    }
    const view = this.projectView(project);
    // Linked workspaces are unregistered only — never delete the external tree.
    if (!skipWorkingTree && (project.origin || "managed") === "managed") {
      await fs.rm(view.path, { recursive: true, force: true });
    } else if (!skipWorkingTree) {
      // Chat deletion removes Conduit's owned trees. Unregister only prunes empty
      // parents so unrelated .conduit metadata is never removed.
      await fs.rmdir(path.join(view.path, ".conduit", "chats")).catch((error) => {
        if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
      });
      await fs.rmdir(path.join(view.path, ".conduit")).catch((error) => {
        if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
      });
    }
    catalog.projects = catalog.projects.filter((item) => item.id !== project.id);
    await writeJson(this.catalogFile, catalog);
    return view;
  }

  async validate(project) {
    if (!project || project.origin !== "linked") return project;
    const current = await resolveExistingDirectory(project.path, this.workspaceAllowlist, { dataRoot: this.dataRoot });
    if (current !== path.resolve(project.externalPath)) {
      const error = new Error("Workspace path identity changed");
      error.code = "workspace_identity_changed";
      throw error;
    }
    return project;
  }
}

export { slugify };
