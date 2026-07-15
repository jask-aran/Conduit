import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { removeProjectSessions, sessionDirectoryFor } from "./session-store.js";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

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

export class ProjectStore {
  constructor({ filesRoot, catalogFile, piAgentDir }) {
    this.filesRoot = filesRoot;
    this.catalogFile = catalogFile;
    this.piAgentDir = piAgentDir;
  }

  async initialize() {
    await fs.mkdir(this.filesRoot, { recursive: true });
    await fs.mkdir(this.piAgentDir, { recursive: true });
    await this.ensure({ slug: "chat", name: "Chats", kind: "unstructured" });
  }

  projectPath(slug) {
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

  projectView(project) {
    const projectPath = this.projectPath(project.slug);
    return {
      ...project,
      path: projectPath,
      sessionsDir: sessionDirectoryFor(projectPath, this.piAgentDir),
    };
  }

  async ensure({ slug: rawSlug, name, kind = "project" }) {
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
        createdAt: new Date().toISOString(),
      };
      catalog.projects.push(project);
      await writeJson(this.catalogFile, catalog);
    }
    await fs.mkdir(this.projectPath(slug), { recursive: true });
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

  async create(input) {
    return this.ensure({ slug: input.slug || input.name, name: input.name, kind: "project" });
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
    await fs.rm(view.path, { recursive: true, force: true });
    await removeProjectSessions(view);
    catalog.projects = catalog.projects.filter((item) => item.id !== project.id);
    await writeJson(this.catalogFile, catalog);
    return view;
  }
}

export { slugify };
