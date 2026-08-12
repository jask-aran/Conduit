import fs from "node:fs";

const PROFILE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MODEL_SPEC = /^[^/\s]+\/.+$/;
const SUPPORTED_SEARCH_PROVIDERS = new Set([
  "openai",
  "brave",
  "parallel",
  "tinyfish",
  "tavily",
  "searxng",
  "exa",
  "perplexity",
  "gemini",
  "serpdive",
  "anysearch",
]);
const FALLBACK_KINDS = new Set(["transient", "quota", "network"]);

function profileError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw profileError("model_profiles_invalid", `${name} must be a non-empty string`);
  }
  return value.trim();
}

function modelPattern(value) {
  const pattern = nonEmptyString(value, "model profile match").toLowerCase();
  if (pattern === "*") return { pattern, kind: "catch_all", specificity: 1 };
  if (pattern.endsWith("/*") && pattern.indexOf("*") === pattern.length - 1) {
    const provider = pattern.slice(0, -2);
    if (!provider || provider.includes("/")) {
      throw profileError("model_profiles_invalid", `Invalid provider model match: ${pattern}`);
    }
    return { pattern, kind: "provider", provider, specificity: 2 };
  }
  if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
    throw profileError("model_profiles_invalid", `Model profile match supports only provider/* or *: ${pattern}`);
  }
  if (!MODEL_SPEC.test(pattern)) {
    throw profileError("model_profiles_invalid", `Model profile exact match must use provider/model: ${pattern}`);
  }
  return { pattern, kind: "exact", model: pattern, specificity: 3 };
}

function validateRouting(raw, profileId) {
  if (!object(raw)) throw profileError("model_profiles_invalid", `searchRouting for ${profileId} must be an object`);
  if (!Array.isArray(raw.providers) || raw.providers.length === 0) {
    throw profileError("model_profiles_invalid", `searchRouting.providers for ${profileId} must be a non-empty array`);
  }
  const providers = raw.providers.map((value) => nonEmptyString(value, `searchRouting provider for ${profileId}`).toLowerCase());
  if (providers.some((provider) => !SUPPORTED_SEARCH_PROVIDERS.has(provider))) {
    const invalid = providers.find((provider) => !SUPPORTED_SEARCH_PROVIDERS.has(provider));
    throw profileError("model_profiles_invalid", `Unsupported search provider for ${profileId}: ${invalid}`);
  }
  if (new Set(providers).size !== providers.length) {
    throw profileError("model_profiles_invalid", `searchRouting.providers for ${profileId} must not contain duplicates`);
  }
  if (!Array.isArray(raw.fallbackOn) || raw.fallbackOn.length === 0) {
    throw profileError("model_profiles_invalid", `searchRouting.fallbackOn for ${profileId} must be a non-empty array`);
  }
  const fallbackOn = raw.fallbackOn.map((value) => nonEmptyString(value, `searchRouting fallback kind for ${profileId}`).toLowerCase());
  if (fallbackOn.some((kind) => !FALLBACK_KINDS.has(kind))) {
    const invalid = fallbackOn.find((kind) => !FALLBACK_KINDS.has(kind));
    throw profileError("model_profiles_invalid", `Unsupported search fallback kind for ${profileId}: ${invalid}`);
  }
  if (new Set(fallbackOn).size !== fallbackOn.length) {
    throw profileError("model_profiles_invalid", `searchRouting.fallbackOn for ${profileId} must not contain duplicates`);
  }
  return { providers, fallbackOn };
}

export function validateModelProfiles(raw, source = "model profiles") {
  if (!object(raw)) throw profileError("model_profiles_invalid", `${source} must be a JSON object`);
  if (String(raw.version || "") !== "1") {
    throw profileError("model_profiles_invalid", `${source} must use version 1`);
  }
  if (!Array.isArray(raw.profiles) || raw.profiles.length === 0) {
    throw profileError("model_profiles_invalid", `${source}.profiles must be a non-empty array`);
  }

  const ids = new Set();
  const patterns = new Map();
  const profiles = raw.profiles.map((rawProfile) => {
    if (!object(rawProfile)) throw profileError("model_profiles_invalid", "Each model profile must be an object");
    const id = nonEmptyString(rawProfile.id, "model profile id").toLowerCase();
    if (!PROFILE_ID.test(id)) throw profileError("model_profiles_invalid", `Invalid model profile id: ${id}`);
    if (ids.has(id)) throw profileError("model_profiles_invalid", `Duplicate model profile id: ${id}`);
    ids.add(id);
    const label = nonEmptyString(rawProfile.label, `model profile label for ${id}`);
    if (!Array.isArray(rawProfile.matches) || rawProfile.matches.length === 0) {
      throw profileError("model_profiles_invalid", `Model profile ${id} must define at least one match`);
    }
    const matches = rawProfile.matches.map(modelPattern);
    for (const match of matches) {
      const previous = patterns.get(match.pattern);
      if (previous) {
        throw profileError("model_profiles_invalid", `Model profile match is duplicated: ${match.pattern}`, {
          profileId: id,
          previousProfileId: previous,
        });
      }
      patterns.set(match.pattern, id);
    }
    return {
      id,
      label,
      matches,
      searchRouting: validateRouting(rawProfile.searchRouting, id),
    };
  });

  if (!profiles.some((profile) => profile.matches.some((match) => match.kind === "catch_all"))) {
    throw profileError("model_profiles_invalid", "Model profiles must define a catch-all match (*)");
  }
  return { version: "1", profiles };
}

export function loadModelProfiles(filePath) {
  const source = String(filePath || "").trim();
  if (!source) throw profileError("model_profiles_missing", "Model profile configuration path is required");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw profileError("model_profiles_missing", `Model profile configuration not found: ${source}`);
    if (error instanceof SyntaxError) throw profileError("model_profiles_invalid", `Model profile configuration is not valid JSON: ${error.message}`);
    throw error;
  }
  return validateModelProfiles(raw, source);
}

function matchModel(pattern, spec) {
  if (pattern.kind === "catch_all") return true;
  if (pattern.kind === "provider") return spec.provider === pattern.provider;
  return spec.value === pattern.model;
}

export function resolveModelProfile(modelProfiles, modelSpec) {
  const value = nonEmptyString(modelSpec, "model specification").toLowerCase();
  if (!MODEL_SPEC.test(value)) {
    throw profileError("model_profile_unresolved", `Cannot resolve a model profile for invalid model: ${modelSpec}`);
  }
  const [provider, ...modelParts] = value.split("/");
  const spec = { value, provider, model: modelParts.join("/") };
  const candidates = [];
  for (const profile of modelProfiles?.profiles || []) {
    for (const pattern of profile.matches) {
      if (matchModel(pattern, spec)) candidates.push({ profile, specificity: pattern.specificity });
    }
  }
  const highest = Math.max(...candidates.map((candidate) => candidate.specificity), 0);
  const selected = [...new Map(candidates
    .filter((candidate) => candidate.specificity === highest)
    .map((candidate) => [candidate.profile.id, candidate.profile])).values()];
  if (selected.length !== 1) {
    throw profileError("model_profile_unresolved", `No unambiguous model profile matches ${modelSpec}`);
  }
  return selected[0];
}

export function publicModelProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    label: profile.label,
    searchRouting: {
      providers: [...profile.searchRouting.providers],
      fallbackOn: [...profile.searchRouting.fallbackOn],
    },
  };
}
