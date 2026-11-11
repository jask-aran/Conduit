import backend from "./voice-backends/transcribe-cpp.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function catalogueError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, status: 500, details });
}

// A managed model is one artifact of a catalogue model; each artifact has a stop profile, plus a live one that falls
// back to it.
export const LOCAL_VOICE_MODELS = deepFreeze(backend.models.map((model) => ({ ...model })));

const ARTIFACT_DEFINITIONS = LOCAL_VOICE_MODELS.map((model) => ({ ...model, id: model.artifactId, legacyModelId: model.id }));

const MODEL_DEFINITIONS = [];
for (const artifact of ARTIFACT_DEFINITIONS) {
  let model = MODEL_DEFINITIONS.find((candidate) => candidate.id === artifact.modelId);
  if (!model) {
    model = {
      id: artifact.modelId,
      label: artifact.label,
      languages: artifact.languages,
      description: artifact.description,
      artifactIds: [],
    };
    MODEL_DEFINITIONS.push(model);
  }
  model.artifactIds.push(artifact.id);
}

const profileFor = (artifact, execution) => ({
  id: `${artifact.id}.${execution}`,
  modelId: artifact.modelId,
  artifactId: artifact.id,
  execution,
  segmentation: "none",
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

function defaultProfileForModel(localModelId, catalog) {
  const artifact = catalog.artifacts.find((candidate) => candidate.legacyModelId === localModelId);
  if (!artifact) return null;
  const execution = artifact.execution || "stop";
  return catalog.profiles.find((profile) => profile.artifactId === artifact.id && profile.execution === execution) || null;
}

export const VOICE_EXECUTION_CATALOG = deepFreeze({
  models: MODEL_DEFINITIONS,
  artifacts: ARTIFACT_DEFINITIONS,
  profiles: PROFILE_DEFINITIONS,
  defaultProfileId: defaultProfileForModel(LOCAL_VOICE_MODELS[0].id, { artifacts: ARTIFACT_DEFINITIONS, profiles: PROFILE_DEFINITIONS }).id,
});

export function profileSelection(profile) {
  return {
    modelId: profile.modelId,
    artifactId: profile.artifactId,
    execution: profile.execution,
    segmentation: profile.segmentation,
  };
}

export function resolveVoiceExecutionProfile(selection, catalog = VOICE_EXECUTION_CATALOG) {
  if (!selection || typeof selection !== "object") throw catalogueError("voice_profile_invalid", "A local voice selection is required", { selection });
  if (selection.profileId || selection.resolvedProfileId) {
    const profile = catalog.profiles.find((candidate) => candidate.id === (selection.profileId || selection.resolvedProfileId));
    if (!profile) throw catalogueError("voice_profile_invalid", `Unknown local voice profile: ${selection.profileId || selection.resolvedProfileId}`, { selection });
    return profile;
  }
  const keys = ["modelId", "artifactId", "execution", "segmentation"];
  const matches = catalog.profiles.filter((profile) => keys.every((key) => String(profile[key]) === String(selection[key] || "")));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw catalogueError("voice_profile_invalid", "The local voice selection does not resolve to an execution profile", { selection });
  throw catalogueError("voice_profile_ambiguous", "The local voice selection resolves to more than one execution profile", { selection });
}

export function selectionForLocalModel(localModelId, catalog = VOICE_EXECUTION_CATALOG) {
  const profile = defaultProfileForModel(String(localModelId || ""), catalog);
  if (!profile) throw catalogueError("voice_profile_recovery_required", `No local voice profile exists for ${localModelId}`, { localModelId });
  return profileSelection(profile);
}

export function artifactForProfile(profile, catalog = VOICE_EXECUTION_CATALOG) {
  const resolved = typeof profile === "string" ? resolveVoiceExecutionProfile({ profileId: profile }, catalog) : profile;
  const artifact = catalog.artifacts.find((candidate) => candidate.id === resolved.artifactId);
  if (!artifact) throw catalogueError("voice_catalog_missing_reference", `Profile ${resolved.id} references missing artifact ${resolved.artifactId}`);
  return artifact;
}

export function publicVoiceExecutionCatalog(catalog = VOICE_EXECUTION_CATALOG) {
  return {
    models: catalog.models.map((model) => ({ ...model })),
    artifacts: catalog.artifacts.map(({ repository: _repository, revision: _revision, sourceRevision: _sourceRevision, ...artifact }) => ({ ...artifact })),
    profiles: catalog.profiles.map((profile) => ({ ...profile, output: { ...profile.output }, resourcePolicy: { ...profile.resourcePolicy }, fallback: profile.fallback ? { ...profile.fallback } : null })),
    defaultProfileId: catalog.defaultProfileId,
  };
}
