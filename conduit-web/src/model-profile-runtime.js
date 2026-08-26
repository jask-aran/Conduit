import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SHARED_PI_FILES = ["auth.json", "models.json", "models-store.json", "settings.json"];
const PROFILE_ID = /^[a-z][a-z0-9-]{0,63}$/;

function runtimeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function readJson(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isObject(parsed)) throw runtimeError("model_profile_search_config_invalid", "Search configuration must be a JSON object");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) {
      throw runtimeError("model_profile_search_config_invalid", `Search configuration is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    try {
      await fs.rename(temporary, filePath);
    } catch (error) {
      // Windows cannot replace an existing file with rename when concurrent
      // materialization has already published the same derived profile.
      if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(error.code)) throw error;
      await fs.rm(filePath, { force: true });
      await fs.rename(temporary, filePath);
    }
    await fs.chmod(filePath, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

async function ensureSharedLink(overlayDir, agentDir, fileName) {
  const linkPath = path.join(overlayDir, fileName);
  const targetPath = path.join(agentDir, fileName);
  const relativeTarget = path.relative(overlayDir, targetPath);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const current = await fs.lstat(linkPath);
      if (current.isDirectory() && !current.isSymbolicLink()) {
        throw runtimeError("model_profile_overlay_invalid", `Model profile overlay contains a directory at ${fileName}`);
      }
      if (current.isSymbolicLink() && await fs.readlink(linkPath) === relativeTarget) return;
      await fs.unlink(linkPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await fs.symlink(relativeTarget, linkPath);
      return;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 3) throw error;
    }
  }
}

function overlaySearchConfig(canonical, profile) {
  const config = { ...canonical };
  delete config.provider;
  delete config.searchProvider;
  config.searchRouting = {
    providers: [...profile.searchRouting.providers],
    fallbackOn: [...profile.searchRouting.fallbackOn],
  };
  return config;
}

export function usesWebSearchOverlay(template) {
  return Array.isArray(template?.runtimeOverlays) && template.runtimeOverlays.includes("web-search");
}

export class ModelProfileRuntime {
  constructor({ agentDir, searchConfigFile } = {}) {
    if (!agentDir) throw new Error("ModelProfileRuntime requires an agent directory");
    if (!searchConfigFile) throw new Error("ModelProfileRuntime requires a search configuration file");
    this.agentDir = path.resolve(agentDir);
    this.searchConfigFile = path.resolve(searchConfigFile);
    this.overlayRoot = path.join(this.agentDir, "model-profiles");
  }

  async materialize({ template, profile } = {}) {
    if (!usesWebSearchOverlay(template)) {
      return { agentDir: this.agentDir, overlayDir: null, modelProfile: null };
    }
    if (!profile?.id) throw runtimeError("model_profile_required", "A model profile is required for the web-search overlay");
    if (!PROFILE_ID.test(profile.id)) {
      throw runtimeError("model_profile_overlay_invalid", `Invalid model profile id: ${profile.id}`);
    }

    const overlayDir = path.join(this.overlayRoot, profile.id);
    await ensureDirectory(this.agentDir);
    await ensureDirectory(this.overlayRoot);
    await ensureDirectory(overlayDir);
    for (const fileName of SHARED_PI_FILES) await ensureSharedLink(overlayDir, this.agentDir, fileName);

    const canonical = await readJson(this.searchConfigFile);
    await writeJsonAtomic(path.join(overlayDir, "web-search.json"), overlaySearchConfig(canonical, profile));
    return { agentDir: overlayDir, overlayDir, modelProfile: profile };
  }
}

export { overlaySearchConfig };
