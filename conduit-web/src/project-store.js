import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { sessionDirectoryFor } from "./session-store.js";
import { assertAllowedPath, resolveExistingDirectory } from "./workspace-paths.js";

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
  constructor({ filesRoot, catalogFile, piAgentDir, workspaceAllowlist = [] }) {
    this.filesRoot = path.resolve(filesRoot);
    this.catalogFile = catalogFile;
    this.piAgentDir = piAgentDir;
    this.workspaceAllowlist = workspaceAllowlist.map((item) => path.resolve(item));
  }

  async initialize() {
    await fs.mkdir(this.filesRoot, { recursive: true });
    await fs.mkdir(this.piAgentDir, { recursive: true });
    await this.ensure({ slug: "chat", name: "Chats", kind: "unstructured", origin: "managed" });
  }

  managedPath(slug) {
    if (!SLUG.test(slug)) throw new Error("Invalid project slug");
    return slug === "chat" ? this.filesRoot : path.join(this.filesRoot, slug);
  }

  async readCatalog() {
    const catalog = await readJson(this.catalogFile, { version: 1, projects: [] });
    return {
      version: 1,
      projects: Array.isArray(catalog.projects) ? catalog.projects : [],
    };
  }

  resolvePath(project) {
    if (project.origin === "linked" && project.externalPath) {
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
      deletesFilesOnRemove: (project.origin || "managed") !== "linked",
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
    await writeJson(this.catalogFile, catalog);
    await fs.mkdir(this.managedPath(slug), { recursive: true });
    return this.projectView(project);
  }

  async createLinked({ name, path: inputPath, defaultTemplateId = "workspace" }) {
    const externalPath = await resolveExistingDirectory(inputPath, this.workspaceAllowlist);
    const slugBase = name || path.basename(externalPath);
    const slug = await this.uniqueSlug(slugBase);
    const catalog = await this.readCatalog();
    if (catalog.projects.some((item) => item.externalPath && path.resolve(item.externalPath) === externalPath)) {
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
      defaultTemplateId: defaultTemplateId || "workspace",
      createdAt: new Date().toISOString(),
    };
    catalog.projects.push(project);
    await writeJson(this.catalogFile, catalog);
    await fs.mkdir(path.join(externalPath, ".conduit", "chats"), { recursive: true });
    return this.projectView(project);
  }

  async createCloned({ name, cloneUrl, defaultTemplateId = "workspace" }) {
    const url = String(cloneUrl || "").trim();
    if (!url) {
      const error = new Error("cloneUrl is required");
      error.code = "clone_url_required";
      throw error;
    }
    const slugBase = name || url.replace(/\.git$/i, "").split("/").filter(Boolean).pop() || "repo";
    const slug = await this.uniqueSlug(slugBase);
    const target = this.managedPath(slug);
    assertAllowedPath(target, [this.filesRoot, ...this.workspaceAllowlist], "clone target");
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.access(target);
      const exists = new Error("clone target already exists");
      exists.code = "clone_target_exists";
      throw exists;
    } catch (error) {
      if (error.code === "clone_target_exists") throw error;
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await runCommand("git", ["clone", "--", url, target]);
    } catch (error) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const catalog = await this.readCatalog();
    const project = {
      id: `project_${crypto.randomUUID()}`,
      slug,
      name: String(name || slug).trim(),
      kind: "workspace",
      origin: "cloned",
      externalPath: null,
      cloneUrl: url,
      defaultTemplateId: defaultTemplateId || "workspace",
      createdAt: new Date().toISOString(),
    };
    catalog.projects.push(project);
    await writeJson(this.catalogFile, catalog);
    return this.projectView(project);
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

  async remove(idOrSlug) {
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
    if ((project.origin || "managed") !== "linked") {
      await fs.rm(view.path, { recursive: true, force: true });
    } else {
      await fs.rm(path.join(view.path, ".conduit"), { recursive: true, force: true }).catch(() => {});
    }
    catalog.projects = catalog.projects.filter((item) => item.id !== project.id);
    await writeJson(this.catalogFile, catalog);
    return view;
  }
}

export { slugify };
