import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_KEY_LENGTH = 16 * 1024;

export const SEARCH_PROVIDERS = [
  {
    id: "brave",
    label: "Brave Search",
    configKey: "braveApiKey",
    environmentKey: "BRAVE_API_KEY",
    enabled: true,
    editable: true,
    description: "Model-agnostic web search fallback with fresh links and snippets.",
    docsUrl: "https://brave.com/search/api/",
  },
  {
    id: "exa",
    label: "Exa",
    configKey: "exaApiKey",
    environmentKey: "EXA_API_KEY",
    enabled: false,
    editable: false,
    description: "Neural search and page extraction.",
    docsUrl: "https://dashboard.exa.ai/",
  },
  {
    id: "parallel",
    label: "Parallel",
    configKey: "parallelApiKey",
    environmentKey: "PARALLEL_API_KEY",
    enabled: false,
    editable: false,
    description: "Search and hosted content extraction.",
    docsUrl: "https://platform.parallel.ai/",
  },
  {
    id: "tavily",
    label: "Tavily",
    configKey: "tavilyApiKey",
    environmentKey: "TAVILY_API_KEY",
    enabled: false,
    editable: false,
    description: "Search API for agent research workflows.",
    docsUrl: "https://app.tavily.com/",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    configKey: "perplexityApiKey",
    environmentKey: "PERPLEXITY_API_KEY",
    enabled: false,
    editable: false,
    description: "Answer-oriented search provider.",
    docsUrl: "https://www.perplexity.ai/settings/api",
  },
];

const SEARCH_DEFAULTS = {
  workflow: "none",
  searchRouting: {
    providers: ["openai", "brave", "exa", "parallel", "tavily", "perplexity"],
    fallbackOn: ["transient", "quota", "network"],
  },
  webSearch: { enabled: true },
};

function storeError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function providerFor(id) {
  const provider = SEARCH_PROVIDERS.find((item) => item.id === id);
  if (!provider) throw storeError("search_provider_unknown", `Unknown search provider: ${id}`);
  return provider;
}

function normalizeKey(value) {
  if (typeof value !== "string") throw storeError("search_key_invalid", "Search API key must be text");
  const key = value.trim();
  if (!key) throw storeError("search_key_invalid", "Search API key is required");
  if (key.length > MAX_KEY_LENGTH) throw storeError("search_key_invalid", "Search API key is too long");
  if (/[\0-\x1f\x7f]/.test(key)) throw storeError("search_key_invalid", "Search API key contains control characters");
  return key;
}

function literalCredential(value) {
  // pi-web-access treats leading `$` and `!` values as credential sources.
  // Escape those prefixes so a key entered in Conduit remains a literal key.
  return value.startsWith("$") || value.startsWith("!") ? `$${value}` : value;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) throw storeError("search_config_invalid", "Search configuration must be a JSON object");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw storeError("search_config_invalid", `Search configuration is not valid JSON: ${error.message}`);
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function configuredValue(config, provider) {
  const value = config[provider.configKey];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class SearchSettingsStore {
  constructor({ filePath, environment = process.env } = {}) {
    if (!filePath) throw new Error("SearchSettingsStore requires a file path");
    this.filePath = path.resolve(filePath);
    this.environment = environment;
  }

  async initialize() {
    const current = await readJson(this.filePath);
    const next = { ...current };
    let changed = false;
    if (next.workflow !== SEARCH_DEFAULTS.workflow) {
      next.workflow = SEARCH_DEFAULTS.workflow;
      changed = true;
    }
    if (!Object.hasOwn(next, "searchRouting") && !Object.hasOwn(next, "provider") && !Object.hasOwn(next, "searchProvider")) {
      next.searchRouting = structuredClone(SEARCH_DEFAULTS.searchRouting);
      changed = true;
    }
    if (!isObject(next.webSearch) || next.webSearch.enabled !== true) {
      next.webSearch = { ...(isObject(next.webSearch) ? next.webSearch : {}), enabled: true };
      changed = true;
    }
    if (changed) await writeJson(this.filePath, next);
    return next;
  }

  async read() {
    return readJson(this.filePath);
  }

  async publicView() {
    const config = await this.read();
    return {
      workflow: config.workflow === "none" ? "none" : "managed",
      providers: SEARCH_PROVIDERS.map((provider) => {
        const stored = Boolean(configuredValue(config, provider));
        const environment = typeof this.environment[provider.environmentKey] === "string"
          && this.environment[provider.environmentKey].trim().length > 0;
        return {
          id: provider.id,
          label: provider.label,
          description: provider.description,
          docsUrl: provider.docsUrl,
          enabled: provider.enabled,
          editable: provider.editable,
          configured: stored || environment,
          stored,
          source: environment ? "environment" : stored ? "stored" : null,
          removable: provider.editable && stored,
        };
      }),
    };
  }

  async setProvider(id, value) {
    const provider = providerFor(id);
    if (!provider.editable) throw storeError("search_provider_locked", `${provider.label} is not enabled in this build`);
    const key = normalizeKey(value);
    const config = await this.read();
    config[provider.configKey] = literalCredential(key);
    await writeJson(this.filePath, config);
    return this.publicView();
  }

  async removeProvider(id) {
    const provider = providerFor(id);
    if (!provider.editable) throw storeError("search_provider_locked", `${provider.label} is not enabled in this build`);
    const config = await this.read();
    const removed = Object.hasOwn(config, provider.configKey);
    delete config[provider.configKey];
    if (removed) await writeJson(this.filePath, config);
    return { removed, settings: await this.publicView() };
  }
}
