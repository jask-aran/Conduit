import { LOCAL_VOICE_BACKENDS } from "./voice-backends/index.js";

const VOICE_EXECUTION_CATALOG_SCHEMA_VERSION = 1;
const VOICE_EXECUTION_CATALOG_VERSION = "1";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function catalogueError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, status: 500, details });
}

const LEGACY_MODEL_DEFINITIONS = LOCAL_VOICE_BACKENDS.flatMap((backend) => backend.models.map((model) => ({ ...model, runtimeId: backend.id })));
const RUNTIME_DEFINITIONS = LOCAL_VOICE_BACKENDS.map(({ id, label, runtime }) => ({ id, label, ...runtime }));
const ARTIFACT_ID_BY_LEGACY_ID = Object.fromEntries(LEGACY_MODEL_DEFINITIONS.map((model) => [model.id, model.artifactId]));
const MODEL_ID_BY_LEGACY_ID = Object.fromEntries(LEGACY_MODEL_DEFINITIONS.map((model) => [model.id, model.modelId]));
const ARTIFACT_DEFINITIONS = LEGACY_MODEL_DEFINITIONS.map((model) => ({
  ...model, id: model.artifactId, legacyModelId: model.id, manifestModelId: model.id,
}));

const MODEL_DEFINITIONS = [...new Map(LEGACY_MODEL_DEFINITIONS.map((legacy) => {
  const modelId = MODEL_ID_BY_LEGACY_ID[legacy.id];
  return [modelId, {
    id: modelId,
    label: legacy.label.replace(/ \((?:fp32|int8)\)$/i, "").replace(/ Q8$/, ""),
    languages: legacy.languages,
    description: legacy.description,
    artifactIds: [],
  }];
}))].map(([, model]) => model);
for (const artifact of ARTIFACT_DEFINITIONS) MODEL_DEFINITIONS.find((model) => model.id === artifact.modelId).artifactIds.push(artifact.id);

const backendPathIdFor = (artifact) => `${artifact.id}.${artifact.runtimeId}`;
const BACKEND_PATH_DEFINITIONS = ARTIFACT_DEFINITIONS.map((artifact) => ({
  id: backendPathIdFor(artifact),
  artifactId: artifact.id,
  runtimeId: artifact.runtimeId,
  ports: { batch: true, stream: artifact.execution === "live" },
}));

const profileIdFor = (artifact, execution) => `${artifact.id}.${execution}`;
const profileFor = (artifact, execution, segmentation = "none") => ({
  schemaVersion: VOICE_EXECUTION_CATALOG_SCHEMA_VERSION,
  id: profileIdFor(artifact, execution),
  modelId: artifact.modelId,
  artifactId: artifact.id,
  runtimeId: artifact.runtimeId,
  backendPathId: backendPathIdFor(artifact),
  execution,
  segmentation,
  output: {
    tentative: execution !== "stop",
    stableSegments: true,
    sampleTimestamps: true,
  },
  resourcePolicy: {
    preload: execution === "live" ? "required" : "supported",
    serialInference: true,
    maximumSessionMs: 5 * 60 * 1000,
    maximumQueuedAudioMs: execution === "live" ? 30_000 : null,
  },
  fallback: null,
});

const PROFILE_DEFINITIONS = [];
for (const artifact of ARTIFACT_DEFINITIONS) {
  const stop = profileFor(artifact, "stop");
  PROFILE_DEFINITIONS.push(stop);
  if (artifact.execution === "live") {
    const live = profileFor(artifact, "live");
    live.fallback = { profileId: stop.id, allowed: "after_stable_checkpoint", replay: "from_committed_sample" };
    PROFILE_DEFINITIONS.push(live);
  }
}

const defaultProfileForLegacyModel = (legacyModelId) => {
  const artifactId = ARTIFACT_ID_BY_LEGACY_ID[legacyModelId] || legacyModelId;
  const artifact = ARTIFACT_DEFINITIONS.find((candidate) => candidate.id === artifactId);
  const execution = artifact.execution || "stop";
  return PROFILE_DEFINITIONS.find((profile) => profile.artifactId === artifact.id && profile.execution === execution);
};

const MIGRATION_DEFINITIONS = LEGACY_MODEL_DEFINITIONS.map((legacy) => {
  const profile = defaultProfileForLegacyModel(legacy.id);
  return {
    legacyLocalModelId: legacy.id,
    profileId: profile.id,
    selection: {
      modelId: profile.modelId,
      artifactId: profile.artifactId,
      runtimeId: profile.runtimeId,
      execution: profile.execution,
      segmentation: profile.segmentation,
    },
  };
});

export const VOICE_EXECUTION_CATALOG = deepFreeze({
  version: VOICE_EXECUTION_CATALOG_VERSION,
  schemaVersion: VOICE_EXECUTION_CATALOG_SCHEMA_VERSION,
  models: MODEL_DEFINITIONS,
  artifacts: ARTIFACT_DEFINITIONS,
  runtimes: RUNTIME_DEFINITIONS,
  backendPaths: BACKEND_PATH_DEFINITIONS,
  profiles: PROFILE_DEFINITIONS,
  migrations: MIGRATION_DEFINITIONS,
  defaultProfileId: defaultProfileForLegacyModel(LEGACY_MODEL_DEFINITIONS[0].id).id,
});

export const LOCAL_VOICE_MODELS = deepFreeze(LEGACY_MODEL_DEFINITIONS);
export const LEGACY_LOCAL_VOICE_MODELS = LOCAL_VOICE_MODELS;

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

export function validateVoiceExecutionCatalog(catalog = VOICE_EXECUTION_CATALOG) {
  if (!catalog || typeof catalog !== "object") throw catalogueError("voice_catalog_invalid", "Voice execution catalogue must be an object");
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  const artifacts = Array.isArray(catalog.artifacts) ? catalog.artifacts : [];
  const runtimes = Array.isArray(catalog.runtimes) ? catalog.runtimes : [];
  const paths = Array.isArray(catalog.backendPaths) ? catalog.backendPaths : [];
  const profiles = Array.isArray(catalog.profiles) ? catalog.profiles : [];
  const assertUnique = (items, kind) => {
    const seen = new Set();
    for (const item of items) {
      if (!item?.id || seen.has(item.id)) throw catalogueError("voice_catalog_duplicate_id", `Duplicate ${kind} id: ${item?.id || "<missing>"}`, { kind, id: item?.id || null });
      seen.add(item.id);
    }
  };
  assertUnique(models, "model");
  assertUnique(artifacts, "artifact");
  assertUnique(runtimes, "runtime");
  assertUnique(paths, "backend path");
  assertUnique(profiles, "profile");
  const modelById = indexById(models);
  const artifactById = indexById(artifacts);
  const runtimeById = indexById(runtimes);
  const pathById = indexById(paths);
  const profileById = indexById(profiles);
  const requireRef = (map, id, kind, owner) => {
    if (!map.has(id)) throw catalogueError("voice_catalog_missing_reference", `${owner} references missing ${kind}: ${id}`, { owner, kind, id });
  };
  for (const artifact of artifacts) {
    requireRef(modelById, artifact.modelId, "model", `artifact ${artifact.id}`);
    requireRef(runtimeById, artifact.runtimeId, "runtime", `artifact ${artifact.id}`);
  }
  for (const path of paths) {
    const artifact = artifactById.get(path.artifactId);
    requireRef(artifactById, path.artifactId, "artifact", `backend path ${path.id}`);
    requireRef(runtimeById, path.runtimeId, "runtime", `backend path ${path.id}`);
    if (artifact && artifact.runtimeId !== path.runtimeId) throw catalogueError("voice_catalog_artifact_runtime_mismatch", `Backend path ${path.id} pairs artifact ${path.artifactId} with runtime ${path.runtimeId}, but the artifact requires ${artifact.runtimeId}`, { pathId: path.id });
    if (!path.ports || path.ports.batch !== true) throw catalogueError("voice_catalog_batch_port_required", `Backend path ${path.id} must expose BatchPort`, { pathId: path.id });
    if (typeof path.ports.stream !== "boolean") throw catalogueError("voice_catalog_enum_invalid", `Backend path ${path.id} has an invalid stream port flag`, { pathId: path.id });
  }
  const enumValues = {
    execution: new Set(["stop", "eager", "live"]),
    segmentation: new Set(["none", "heuristic"]),
    preload: new Set(["supported", "required", "unsupported"]),
    allowed: new Set(["before_output", "after_tentative", "after_stable_checkpoint"]),
    replay: new Set(["from_zero", "from_committed_sample"]),
  };
  for (const profile of profiles) {
    if (profile.schemaVersion !== VOICE_EXECUTION_CATALOG_SCHEMA_VERSION) throw catalogueError("voice_catalog_enum_invalid", `Profile ${profile.id} has unsupported schemaVersion`, { profileId: profile.id });
    requireRef(modelById, profile.modelId, "model", `profile ${profile.id}`);
    requireRef(artifactById, profile.artifactId, "artifact", `profile ${profile.id}`);
    requireRef(runtimeById, profile.runtimeId, "runtime", `profile ${profile.id}`);
    requireRef(pathById, profile.backendPathId, "backend path", `profile ${profile.id}`);
    const artifact = artifactById.get(profile.artifactId);
    const backendPath = pathById.get(profile.backendPathId);
    if (artifact && artifact.modelId !== profile.modelId) throw catalogueError("voice_catalog_model_artifact_mismatch", `Profile ${profile.id} pairs model ${profile.modelId} with artifact ${profile.artifactId} for ${artifact.modelId}`, { profileId: profile.id });
    if (artifact && artifact.runtimeId !== profile.runtimeId) throw catalogueError("voice_catalog_artifact_runtime_mismatch", `Profile ${profile.id} pairs artifact ${profile.artifactId} with runtime ${profile.runtimeId}`, { profileId: profile.id });
    if (backendPath && (backendPath.artifactId !== profile.artifactId || backendPath.runtimeId !== profile.runtimeId)) throw catalogueError("voice_catalog_artifact_runtime_mismatch", `Profile ${profile.id} does not use the artifact/runtime owned by backend path ${profile.backendPathId}`, { profileId: profile.id });
    for (const [field, values] of Object.entries(enumValues)) {
      const value = field === "preload" ? profile.resourcePolicy?.preload : profile.fallback?.[field];
      if (field === "execution" || field === "segmentation") {
        if (!values.has(profile[field])) throw catalogueError("voice_catalog_enum_invalid", `Profile ${profile.id} has unsupported ${field}: ${profile[field]}`, { profileId: profile.id, field });
      } else if (profile.fallback && !values.has(value)) {
        throw catalogueError("voice_catalog_enum_invalid", `Profile ${profile.id} has unsupported fallback ${field}: ${value}`, { profileId: profile.id, field });
      }
    }
    if (!profile.output || typeof profile.output.tentative !== "boolean" || typeof profile.output.stableSegments !== "boolean" || typeof profile.output.sampleTimestamps !== "boolean") throw catalogueError("voice_catalog_enum_invalid", `Profile ${profile.id} has invalid output capabilities`, { profileId: profile.id });
    const queueLimit = profile.resourcePolicy?.maximumQueuedAudioMs;
    if (!profile.resourcePolicy || typeof profile.resourcePolicy.serialInference !== "boolean" || !Number.isSafeInteger(profile.resourcePolicy.maximumSessionMs) || profile.resourcePolicy.maximumSessionMs <= 0 || !(queueLimit === null || (Number.isSafeInteger(queueLimit) && queueLimit >= 0))) throw catalogueError("voice_catalog_enum_invalid", `Profile ${profile.id} has invalid resourcePolicy`, { profileId: profile.id });
    if (profile.execution === "stop" || profile.execution === "eager") {
      if (!backendPath?.ports.batch) throw catalogueError("voice_catalog_batch_port_required", `Profile ${profile.id} requires BatchPort`, { profileId: profile.id });
    }
    if (profile.execution === "live") {
      if (!backendPath?.ports.stream) throw catalogueError("voice_catalog_stream_port_required", `Profile ${profile.id} requires StreamPort`, { profileId: profile.id });
      if (!(profile.resourcePolicy.maximumQueuedAudioMs > 0)) throw catalogueError("voice_catalog_live_queue_required", `Live profile ${profile.id} must bound queued audio`, { profileId: profile.id });
    }
    if (profile.execution === "eager" && profile.segmentation === "none") throw catalogueError("voice_catalog_eager_segmentation_required", `Eager profile ${profile.id} requires segmentation`, { profileId: profile.id });
    if ((profile.execution === "stop" || profile.execution === "live") && profile.segmentation !== "none") throw catalogueError("voice_catalog_segmentation_forbidden", `${profile.execution} profile ${profile.id} cannot use segmentation`, { profileId: profile.id });
    if (profile.fallback) requireRef(profileById, profile.fallback.profileId, "fallback profile", `profile ${profile.id}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (profileId) => {
    if (visiting.has(profileId)) throw catalogueError("voice_catalog_fallback_cycle", `Fallback graph contains a cycle at profile ${profileId}`, { profileId });
    if (visited.has(profileId)) return;
    visiting.add(profileId);
    const fallback = profileById.get(profileId)?.fallback;
    if (fallback) visit(fallback.profileId);
    visiting.delete(profileId);
    visited.add(profileId);
  };
  for (const profile of profiles) visit(profile.id);
  if (!profileById.has(catalog.defaultProfileId)) throw catalogueError("voice_catalog_missing_reference", `Catalogue default profile is missing: ${catalog.defaultProfileId}`, { id: catalog.defaultProfileId });
  return catalog;
}

validateVoiceExecutionCatalog(VOICE_EXECUTION_CATALOG);

function catalogModelForLegacyId(legacyModelId, catalog = VOICE_EXECUTION_CATALOG) {
  const migration = catalog.migrations.find((candidate) => candidate.legacyLocalModelId === legacyModelId);
  if (!migration) throw catalogueError("voice_profile_recovery_required", `No local voice profile migration exists for ${legacyModelId}`, { legacyLocalModelId: legacyModelId });
  return migration;
}

export function profileSelection(profile) {
  return {
    modelId: profile.modelId,
    artifactId: profile.artifactId,
    runtimeId: profile.runtimeId,
    execution: profile.execution,
    segmentation: profile.segmentation,
  };
}

export function resolveVoiceExecutionProfile(selection, catalog = VOICE_EXECUTION_CATALOG) {
  validateVoiceExecutionCatalog(catalog);
  if (!selection || typeof selection !== "object") throw catalogueError("voice_profile_invalid", "A local voice selection is required", { selection });
  if (selection.profileId || selection.resolvedProfileId) {
    const profile = catalog.profiles.find((candidate) => candidate.id === (selection.profileId || selection.resolvedProfileId));
    if (!profile) throw catalogueError("voice_profile_invalid", `Unknown local voice profile: ${selection.profileId || selection.resolvedProfileId}`, { selection });
    return profile;
  }
  const keys = ["modelId", "artifactId", "runtimeId", "execution", "segmentation"];
  const matches = catalog.profiles.filter((profile) => keys.every((key) => String(profile[key]) === String(selection[key] || "")));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw catalogueError("voice_profile_invalid", "The local voice selection does not resolve to an execution profile", { selection });
  throw catalogueError("voice_profile_ambiguous", "The local voice selection resolves to more than one execution profile", { selection });
}

export function migrateLocalSelection(localModelId, catalog = VOICE_EXECUTION_CATALOG) {
  const migration = catalogModelForLegacyId(String(localModelId || ""), catalog);
  return { ...migration, selection: { ...migration.selection } };
}

export function artifactForProfile(profile, catalog = VOICE_EXECUTION_CATALOG) {
  const resolved = typeof profile === "string" ? resolveVoiceExecutionProfile({ profileId: profile }, catalog) : profile;
  const artifact = catalog.artifacts.find((candidate) => candidate.id === resolved.artifactId);
  if (!artifact) throw catalogueError("voice_catalog_missing_reference", `Profile ${resolved.id} references missing artifact ${resolved.artifactId}`);
  return artifact;
}

export function backendPathForProfile(profile, catalog = VOICE_EXECUTION_CATALOG) {
  const resolved = typeof profile === "string" ? resolveVoiceExecutionProfile({ profileId: profile }, catalog) : profile;
  const backendPath = catalog.backendPaths.find((candidate) => candidate.id === resolved.backendPathId);
  if (!backendPath) throw catalogueError("voice_catalog_missing_reference", `Profile ${resolved.id} references missing backend path ${resolved.backendPathId}`);
  return backendPath;
}

export function runtimeForProfile(profile, catalog = VOICE_EXECUTION_CATALOG) {
  const resolved = typeof profile === "string" ? resolveVoiceExecutionProfile({ profileId: profile }, catalog) : profile;
  const runtime = catalog.runtimes.find((candidate) => candidate.id === resolved.runtimeId);
  if (!runtime) throw catalogueError("voice_catalog_missing_reference", `Profile ${resolved.id} references missing runtime ${resolved.runtimeId}`);
  return runtime;
}

export function publicVoiceExecutionCatalog(catalog = VOICE_EXECUTION_CATALOG) {
  validateVoiceExecutionCatalog(catalog);
  return {
    version: catalog.version,
    schemaVersion: catalog.schemaVersion,
    models: catalog.models.map((model) => ({ ...model })),
    artifacts: catalog.artifacts.map(({ repository: _repository, revision: _revision, sourceRevision: _sourceRevision, ...artifact }) => ({ ...artifact })),
    runtimes: catalog.runtimes.map((runtime) => ({ ...runtime, compiledComputeBackends: [...runtime.compiledComputeBackends] })),
    backendPaths: catalog.backendPaths.map((backendPath) => ({ ...backendPath, ports: { ...backendPath.ports } })),
    profiles: catalog.profiles.map((profile) => ({ ...profile, output: { ...profile.output }, resourcePolicy: { ...profile.resourcePolicy }, fallback: profile.fallback ? { ...profile.fallback } : null })),
    defaultProfileId: catalog.defaultProfileId,
  };
}
