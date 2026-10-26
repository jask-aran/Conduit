import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_KEY_LENGTH = 16 * 1024;

/**
 * The search providers Settings offers, in pi-web-access's own automatic
 * order (OpenAI first when the chat's model is on a ChatGPT subscription,
 * else Exa first). Each takes an API key under its own config field and
 * environment variable; OpenAI also searches on the hub's ChatGPT sign-in
 * and Exa without any key. pi-web-access knows ~40 more, set in
 * web-search.json directly.
 */
export const SEARCH_PROVIDERS = [
  { id: "openai", label: "OpenAI", configKey: "openaiApiKey", environmentKey: "OPENAI_API_KEY", signIn: ["openai", "openai-codex"],
    description: "Hosted web search on the hub's ChatGPT sign-in, or an API key.", docsUrl: "https://platform.openai.com/api-keys" },
  { id: "exa", label: "Exa", configKey: "exaApiKey", environmentKey: "EXA_API_KEY", keyless: true,
    description: "Neural search; works without a key through Exa's public MCP.", docsUrl: "https://dashboard.exa.ai/" },
  { id: "brave", label: "Brave Search", configKey: "braveApiKey", environmentKey: "BRAVE_API_KEY",
    description: "Independent index, fresh links and snippets.", docsUrl: "https://brave.com/search/api/" },
  { id: "parallel", label: "Parallel", configKey: "parallelApiKey", environmentKey: "PARALLEL_API_KEY",
    description: "Search and hosted page extraction.", docsUrl: "https://platform.parallel.ai/" },
  { id: "tavily", label: "Tavily", configKey: "tavilyApiKey", environmentKey: "TAVILY_API_KEY",
    description: "Search built for agent research.", docsUrl: "https://app.tavily.com/" },
  { id: "perplexity", label: "Perplexity", configKey: "perplexityApiKey", environmentKey: "PERPLEXITY_API_KEY",
    description: "Answer-oriented search.", docsUrl: "https://www.perplexity.ai/settings/api" },
  { id: "gemini", label: "Gemini", configKey: "geminiApiKey", environmentKey: "GEMINI_API_KEY",
    description: "Google Search grounding through the Gemini API; also reads YouTube and video.", docsUrl: "https://aistudio.google.com/apikey" },
  { id: "kagi", label: "Kagi", configKey: "kagiApiKey", environmentKey: "KAGI_API_KEY",
    description: "Kagi's search API.", docsUrl: "https://help.kagi.com/kagi/api/search.html" },
  { id: "jina", label: "Jina", configKey: "jinaApiKey", environmentKey: "JINA_API_KEY",
    description: "Search and page reading.", docsUrl: "https://jina.ai/api-dashboard/" },
  { id: "firecrawl", label: "Firecrawl", configKey: "firecrawlApiKey", environmentKey: "FIRECRAWL_API_KEY",
    description: "Search, and fetching pages that block plain requests.", docsUrl: "https://www.firecrawl.dev/app/api-keys" },
];

// The agent's web tools (pi-web-access `tools.<key>.enabled`), read when the
// runtime loads them.
export const SEARCH_TOOLS = ["webSearch", "fetchContent", "sourceCheck", "getSearchContent"];
// What fetching can do beyond a page, each its own config section's `enabled`.
const FETCHING = { github: ["githubClone"], video: ["youtube", "video"], pdf: ["pdf"] };
// A route that falls back takes every kind of failure, and an answer with no
// results or none from the domains asked for (pi-web-access 0.45: if every
// provider answers that way, the first answer is kept); one that does not keeps
// pi-web-access's own default kinds (the list must not be empty).
const FALLBACK_ALL = ["transient", "quota", "network", "invalid-response", "unsupported", "empty", "domain-miss"];
const FALLBACK_DEFAULT = ["transient", "quota", "network"];
// Answers judged off-topic go on down the route too, by this classifier on Pi's Cloudflare Workers AI sign-in.
const OFF_TOPIC_MODEL = "cloudflare-workers-ai/@cf/cloudflare/clef";
// A routed search's whole time, across every provider it tries (searchRouting.timeoutMs).
const MAX_ROUTE_TIMEOUT_MS = 600_000;
// fetch_content's modes when web-search.json names none; "extract" is added to them (it is never the default).
const FETCH_MODES = ["readable", "raw", "answer"];

const SEARCH_DEFAULTS = {
  workflow: "none",
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

  /** Whether Pi can call Cloudflare Workers AI (extract mode, the off-topic check): its sign-in, or the server's key and account. */
  async cloudflareReady() {
    const set = (name) => typeof this.environment[name] === "string" && this.environment[name].trim().length > 0;
    const stored = (await this.auth())["cloudflare-workers-ai"];
    return Boolean(stored?.key || set("CLOUDFLARE_API_KEY")) && Boolean(stored?.env?.CLOUDFLARE_ACCOUNT_ID || set("CLOUDFLARE_ACCOUNT_ID"));
  }

  /** Pi's sign-ins on the hub (its auth.json, beside this file). */
  async auth() {
    try { return JSON.parse(await fs.readFile(path.join(path.dirname(this.filePath), "auth.json"), "utf8")) || {}; }
    catch { return {}; }
  }

  /** Which providers have a sign-in on the hub. */
  async signedIn() {
    return new Set(Object.keys(await this.auth()));
  }

  async publicView() {
    const config = await this.read();
    const auth = await this.auth();
    const providers = SEARCH_PROVIDERS.map((provider) => {
      const stored = Boolean(configuredValue(config, provider));
      const environment = typeof this.environment[provider.environmentKey] === "string"
        && this.environment[provider.environmentKey].trim().length > 0;
      // A sign-in, not a key, under one of the providers it searches through (pi-web-access's openaiSearchProviders).
      const signIn = (provider.signIn || []).some((id) => auth[id]?.type === "oauth");
      return {
        id: provider.id,
        label: provider.label,
        description: provider.description,
        docsUrl: provider.docsUrl,
        // How it can search now: its own key (stored or from the server's
        // environment), the hub's sign-in, or no key at all.
        source: environment ? "environment" : stored ? "stored" : signIn ? "sign-in" : provider.keyless ? "keyless" : null,
        ready: stored || environment || signIn || Boolean(provider.keyless),
        stored,
        removable: stored,
      };
    });
    const routing = isObject(config.searchRouting) ? config.searchRouting : null;
    const order = Array.isArray(routing?.providers) ? routing.providers.filter((id) => typeof id === "string") : [];
    const enabled = (key) => (isObject(config.tools?.[key]) && typeof config.tools[key].enabled === "boolean"
      ? config.tools[key].enabled
      : (key !== "webSearch" && key !== "sourceCheck") || config.webSearch?.enabled !== false);
    return {
      workflow: config.workflow === "none" ? "none" : "managed",
      // Automatic is pi-web-access's own chain; otherwise the first provider
      // and whether the rest of the route catches its failures.
      route: {
        first: typeof config.provider === "string" ? config.provider : order[0] || "auto",
        // Falling back is the route's failure kinds, not its length: one provider can search now, more may come.
        fallback: !config.provider && Array.isArray(routing?.fallbackOn) && routing.fallbackOn.includes("unsupported"),
        useCurrentModel: routing?.useCurrentModel === true,
        timeoutMs: Number.isInteger(routing?.timeoutMs) ? routing.timeoutMs : null,
        // The choice is kept (its classifier named) while fallback is off; it only runs while fallback is on.
        offTopic: typeof routing?.offTopicModel === "string",
      },
      tools: Object.fromEntries(SEARCH_TOOLS.map((key) => [key, enabled(key)])),
      fetching: {
        ...Object.fromEntries(Object.entries(FETCHING).map(([key, sections]) => [key, sections.every((section) => config[section]?.enabled !== false)])),
        extract: Array.isArray(config.fetch?.allowedModes) && config.fetch.allowedModes.includes("extract"),
      },
      cloudflare: await this.cloudflareReady(),
      providers,
    };
  }

  /**
   * Change how searches are made, which tools the agent has and what
   * fetching does, leaving the rest of web-search.json as it is.
   */
  async update(input = {}) {
    const config = await this.read();
    const view = await this.publicView();
    if (isObject(input.route)) {
      const first = String(input.route.first ?? view.route.first);
      const fallback = typeof input.route.fallback === "boolean" ? input.route.fallback : view.route.fallback;
      const useCurrentModel = typeof input.route.useCurrentModel === "boolean" ? input.route.useCurrentModel : view.route.useCurrentModel;
      const timeoutMs = input.route.timeoutMs === undefined ? view.route.timeoutMs : input.route.timeoutMs;
      if (timeoutMs !== null && !(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= MAX_ROUTE_TIMEOUT_MS)) {
        throw storeError("search_setting_invalid", `A search time limit is 1 to ${MAX_ROUTE_TIMEOUT_MS} milliseconds`);
      }
      const offTopic = typeof input.route.offTopic === "boolean" ? input.route.offTopic : view.route.offTopic;
      delete config.provider;
      delete config.searchProvider;
      if (first === "auto") delete config.searchRouting;
      else {
        if (!SEARCH_PROVIDERS.some((provider) => provider.id === first)) throw storeError("search_provider_unknown", `Unknown search provider: ${first}`);
        const rest = view.providers.filter((provider) => provider.ready && provider.id !== first).map((provider) => provider.id);
        // pi-web-access needs the route named to judge answers or time it; Conduit names every provider that can
        // search now, in its automatic order, and names them again whenever a key comes or goes (reroute).
        config.searchRouting = {
          providers: fallback ? [first, ...rest] : [first],
          fallbackOn: fallback ? [...FALLBACK_ALL, ...(offTopic ? ["off-topic"] : [])] : FALLBACK_DEFAULT,
          ...(offTopic ? { offTopicModel: OFF_TOPIC_MODEL } : {}),
          ...(useCurrentModel ? { useCurrentModel: true } : {}),
          ...(timeoutMs !== null ? { timeoutMs } : {}),
        };
      }
    }
    if (isObject(input.tools)) {
      for (const [key, on] of Object.entries(input.tools)) {
        if (!SEARCH_TOOLS.includes(key) || typeof on !== "boolean") throw storeError("search_setting_invalid", `Unknown search tool setting: ${key}`);
        config.tools = { ...(isObject(config.tools) ? config.tools : {}), [key]: { ...(isObject(config.tools?.[key]) ? config.tools[key] : {}), enabled: on } };
      }
    }
    if (isObject(input.fetching)) {
      for (const [key, on] of Object.entries(input.fetching)) {
        if (key === "extract" && typeof on === "boolean") {
          // Typed values read off a page (fetch_content mode "extract"): one of the modes the tool takes, never its default.
          const fetch = isObject(config.fetch) ? config.fetch : {};
          const modes = (Array.isArray(fetch.allowedModes) ? fetch.allowedModes : FETCH_MODES).filter((mode) => mode !== "extract");
          config.fetch = { ...fetch, allowedModes: on ? [...modes, "extract"] : modes };
          continue;
        }
        if (!FETCHING[key] || typeof on !== "boolean") throw storeError("search_setting_invalid", `Unknown fetching setting: ${key}`);
        for (const section of FETCHING[key]) config[section] = { ...(isObject(config[section]) ? config[section] : {}), enabled: on };
      }
    }
    await writeJson(this.filePath, config);
    return this.publicView();
  }

  async setProvider(id, value) {
    const provider = providerFor(id);
    const key = normalizeKey(value);
    const config = await this.read();
    config[provider.configKey] = literalCredential(key);
    await writeJson(this.filePath, config);
    return this.reroute();
  }

  /** A provider that can search now joins a falling-back route (one that cannot, leaves it), its choices kept. */
  async reroute() {
    const config = await this.read();
    return isObject(config.searchRouting) && !config.provider ? this.update({ route: {} }) : this.publicView();
  }

  async removeProvider(id) {
    const provider = providerFor(id);
    const config = await this.read();
    const removed = Object.hasOwn(config, provider.configKey);
    delete config[provider.configKey];
    if (removed) await writeJson(this.filePath, config);
    return { removed, settings: await this.reroute() };
  }
}
