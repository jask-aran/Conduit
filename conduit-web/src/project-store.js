import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { sessionDirectoryFor } from "./session-store.js";
import { assertAllowedPath, assertSafeWorkspaceRoot, resolveExistingDirectory } from "./workspace-paths.js";
import { ensureConduitRoot } from "./owned-paths.js";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ORIGINS = new Set(["managed", "linked", "cloned"]);

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

function runCommand(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(stderr.trim() || stdout.trim() || `${command} failed`);
        error.code = "command_failed";
        error.exitCode = code;
        reject(error);
      }
    });
  });
}

export class ProjectStore {
  constructor({ filesRoot, catalogFile, piAgentDir, workspaceAllowlist = [], dataRoot = null }) {
    this.filesRoot = path.resolve(filesRoot);
    this.catalogFile = catalogFile;
    this.piAgentDir = piAgentDir;
    this.workspaceAllowlist = workspaceAllowlist.map((item) => path.resolve(item));
    this.dataRoot = dataRoot ? path.resolve(dataRoot) : null;
    // Serialize catalog mutations (especially slow clones) so concurrent creates
    // cannot share a slug or rm each other's checkout.
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

  async createCloned({ name, cloneUrl, path: inputPath, defaultTemplateId = null }) {
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
    if (!inputPath) {
      const error = new Error("path is required");
      error.code = "workspace_path_required";
      throw error;
    }
    const target = assertAllowedPath(inputPath, this.workspaceAllowlist, "clone target");
    assertSafeWorkspaceRoot(target, { dataRoot: this.dataRoot });
    const parent = await resolveExistingDirectory(path.dirname(target), this.workspaceAllowlist, { dataRoot: this.dataRoot });
    if (path.dirname(target) !== parent) {
      const error = new Error("Clone target parent resolves to a different path");
      error.code = "path_not_allowed";
      throw error;
    }
    return this.runExclusive(async () => {
      const slugBase = name || url.replace(/\.git$/i, "").split("/").filter(Boolean).pop() || "repo";
      const slug = await this.uniqueSlug(slugBase);
      try {
        await fs.access(target);
        const exists = new Error("clone target already exists");
        exists.code = "clone_target_exists";
        throw exists;
      } catch (error) {
        if (error.code === "clone_target_exists") throw error;
        if (error.code !== "ENOENT") throw error;
      }

      const catalog = await this.readCatalog();
      if (catalog.projects.some((item) => path.resolve(this.resolvePath(item)) === target)) {
        const error = new Error("That directory is already registered");
        error.code = "workspace_already_linked";
        throw error;
      }
      const project = {
        id: `project_${crypto.randomUUID()}`,
        slug,
        name: String(name || slug).trim(),
        kind: "workspace",
        origin: "cloned",
        externalPath: target,
        cloneUrl: url,
        defaultTemplateId: defaultTemplateId || null,
        createdAt: new Date().toISOString(),
      };
      try {
        const githubSource = /^(?:https:\/\/github\.com\/|ssh:\/\/[^/]*github\.com\/|git@github\.com:)/i.test(url);
        let cloned = false;
        if (githubSource) {
          try {
            await runCommand("gh", ["repo", "clone", url, target, "--"]);
            cloned = true;
          } catch (error) {
            if (error.code !== "ENOENT") await fs.rm(target, { recursive: true, force: true }).catch(() => {});
          }
        }
        if (!cloned) await runCommand("git", ["clone", "--", url, target]);
        await ensureConduitRoot({ path: target, origin: "linked" });
        catalog.projects.push(project);
        await writeJson(this.catalogFile, catalog);
      } catch (error) {
        await fs.rm(target, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return this.projectView(project);
    });
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
    const used = new Set(catalog.projects.map((item) => item.slug));
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
