import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
  constructor({ filesRoot, piWebProjectsFile }) {
    this.filesRoot = filesRoot;
    this.piWebProjectsFile = piWebProjectsFile;
  }

  async initialize() {
    await fs.mkdir(this.filesRoot, { recursive: true });
    await this.ensure({ slug: "chat", name: "Chats", kind: "unstructured" });
    await this.syncPiWeb();
  }

  projectPath(slug) {
    if (!SLUG.test(slug)) throw new Error("Invalid project slug");
    return path.join(this.filesRoot, slug);
  }

  async ensure({ slug: rawSlug, name, kind = "project" }) {
    const slug = slugify(rawSlug || name);
    if (!SLUG.test(slug)) throw new Error("Project names must contain letters or numbers");
    const root = this.projectPath(slug);
    const metadataDir = path.join(root, ".conduit");
    const sessionsDir = path.join(metadataDir, "sessions");
    const manifestFile = path.join(metadataDir, "project.json");
    const existing = await readJson(manifestFile);
    const project = existing || {
      id: slug === "chat" ? "project_chat" : `project_${crypto.randomUUID()}`,
      slug,
      name: String(name || slug).trim(),
      kind,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(sessionsDir, { recursive: true });
    await writeJson(manifestFile, project);
    await this.writePiSettings(root, sessionsDir);
    return { ...project, path: root, sessionsDir };
  }

  async writePiSettings(projectRoot, sessionsDir) {
    const settingsFile = path.join(projectRoot, ".pi/settings.json");
    const settings = await readJson(settingsFile, {});
    settings.sessionDir = sessionsDir;
    await writeJson(settingsFile, settings);
  }

  async list() {
    await fs.mkdir(this.filesRoot, { recursive: true });
    const entries = await fs.readdir(this.filesRoot, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const root = path.join(this.filesRoot, entry.name);
      const manifest = await readJson(path.join(root, ".conduit/project.json"));
      if (!manifest?.id) continue;
      projects.push({ ...manifest, path: root, sessionsDir: path.join(root, ".conduit/sessions") });
    }
    return projects.sort((a, b) => a.slug === "chat" ? -1 : b.slug === "chat" ? 1 : a.name.localeCompare(b.name));
  }

  async get(idOrSlug) {
    return (await this.list()).find((project) => project.id === idOrSlug || project.slug === idOrSlug) || null;
  }

  async create(input) {
    const project = await this.ensure({ slug: input.slug || input.name, name: input.name, kind: "project" });
    await this.syncPiWeb();
    return project;
  }

  async syncPiWeb() {
    const current = await readJson(this.piWebProjectsFile, { projects: [] });
    const projects = await this.list();
    const byPath = new Map((current.projects || []).map((project) => [path.resolve(project.path), project]));
    for (const project of projects) {
      const key = path.resolve(project.path);
      if (!byPath.has(key)) {
        byPath.set(key, { id: crypto.randomUUID(), name: project.name, path: project.path, createdAt: project.createdAt });
      }
    }
    await writeJson(this.piWebProjectsFile, { projects: [...byPath.values()] });
  }
}

export { slugify };

