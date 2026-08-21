import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  VOICE_EXECUTION_CATALOG,
  artifactForProfile,
  migrateLocalSelection,
  profileSelection,
  resolveVoiceExecutionProfile,
} from "./server/voice-execution-catalog.js";

const MAX_SECRET_LENGTH = 16 * 1024;
const MAX_ENDPOINT_LENGTH = 2 * 1024;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const DEFAULT_LOCAL_VOICE_MODEL = "whisper-tiny-en-q8";
export const VOICE_CONFIG_VERSION = 2;

export const OPENAI_LIVE_MODEL = "gpt-live-transcribe";
export const OPENAI_FILE_MODEL = "gpt-transcribe";
export const OPENAI_LIVE_ADAPTER = "openai_realtime_stream_v1";

export const VOICE_ADAPTERS = Object.freeze([
  { id: "openai_audio_sse_v1", label: "OpenAI-compatible audio upload", transport: "http", description: "Uploads one in-memory WAV after stop and accepts JSON or transcript SSE events." },
  { id: OPENAI_LIVE_ADAPTER, label: "OpenAI realtime transcription", transport: "ws", description: "Feeds live PCM into gpt-live-transcribe and maps deltas to Conduit partials." },
  { id: "deepgram_audio_v1", label: "Deepgram prerecorded audio", transport: "http", description: "Uploads one in-memory WAV after stop and reads Deepgram channel alternatives." },
]);

export const VOICE_PROVIDERS = Object.freeze([
  {
    id: "openai", label: "OpenAI", adapter: "openai_audio_sse_v1", endpoint: "https://api.openai.com/v1/audio/transcriptions", authLabel: "OpenAI API key",
    models: [
      { id: OPENAI_FILE_MODEL, label: "GPT Transcribe", description: "Stop-time file transcription. Text appears after you stop." },
      { id: OPENAI_LIVE_MODEL, label: "GPT Live Transcribe", description: "Live transcription while you speak." },
    ],
  },
  {
    id: "deepgram", label: "Deepgram", adapter: "deepgram_audio_v1", endpoint: "https://api.deepgram.com/v1/listen", authLabel: "Deepgram API key",
    models: [
      { id: "nova-3", label: "Nova-3", description: "Recommended multilingual model with smart formatting." },
      { id: "nova-2", label: "Nova-2", description: "Lower-cost prior-generation general model." },
    ],
  },
  {
    id: "groq", label: "Groq", adapter: "openai_audio_sse_v1", endpoint: "https://api.groq.com/openai/v1/audio/transcriptions", authLabel: "Groq API key",
    models: [
      { id: "whisper-large-v3-turbo", label: "Whisper Large V3 Turbo", description: "Recommended price/performance multilingual model." },
      { id: "whisper-large-v3", label: "Whisper Large V3", description: "Higher-accuracy multilingual model." },
    ],
  },
  { id: "custom", label: "Custom endpoint", adapter: "openai_audio_sse_v1", endpoint: "", authLabel: "Endpoint credential", models: [] },
]);

const ADAPTER_IDS = new Set(VOICE_ADAPTERS.map((adapter) => adapter.id));
const PROVIDER_BY_ID = new Map(VOICE_PROVIDERS.map((provider) => [provider.id, provider]));
const AUTH_TYPES = new Set(["none", "bearer", "header"]);
const MODES = new Set(["off", "local", "remote"]);

function voiceError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSecret(value) {
  if (typeof value !== "string") throw voiceError("voice_secret_invalid", "Voice endpoint credential must be text");
  const secret = value.trim();
  if (!secret) throw voiceError("voice_secret_invalid", "Voice endpoint credential is required");
  if (secret.length > MAX_SECRET_LENGTH || /[\0-\x1f\x7f]/.test(secret)) throw voiceError("voice_secret_invalid", "Voice endpoint credential is invalid");
  return secret;
}

function normalizeHeaderName(value) {
  const name = String(value || "X-API-Key").trim();
  if (!HEADER_NAME.test(name) || ["authorization", "cookie", "host", "origin"].includes(name.toLowerCase())) throw voiceError("voice_auth_header_invalid", "Choose a safe API-key header name");
  return name;
}

export function normalizeRemoteVoiceEndpoint(value, { allowInsecure = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > MAX_ENDPOINT_LENGTH) throw voiceError("voice_endpoint_invalid", "A voice endpoint URL is required");
  let endpoint;
  try { endpoint = new URL(raw); }
  catch { throw voiceError("voice_endpoint_invalid", "Voice endpoint must be a valid URL"); }
  if (endpoint.username || endpoint.password) throw voiceError("voice_endpoint_credentials", "Do not put credentials in the voice endpoint URL");
  if (endpoint.search) throw voiceError("voice_endpoint_query", "Do not put query parameters or secrets in the voice endpoint URL");
  const allowed = allowInsecure ? new Set(["ws:", "wss:", "http:", "https:"]) : new Set(["wss:", "https:"]);
  if (!allowed.has(endpoint.protocol)) throw voiceError("voice_endpoint_insecure", "Remote voice endpoints must use HTTPS or WSS");
  endpoint.hash = "";
  return endpoint.toString();
}

async function readJson(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isObject(parsed)) throw voiceError("voice_config_invalid", "Voice configuration must be a JSON object");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw voiceError("voice_config_invalid", `Voice configuration is not valid JSON: ${error.message}`);
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
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

function credentialRecord(value) {
  if (!isObject(value)) return null;
  const type = AUTH_TYPES.has(value.type) ? value.type : "none";
  const headerName = type === "bearer"
    ? "Authorization"
    : type === "header"
      ? normalizeHeaderName(value.headerName)
      : "X-API-Key";
  const secret = typeof value.secret === "string" ? value.secret : "";
  return { type, headerName, secret };
}

function storedCredentials(config) {
  const credentials = {};
  if (isObject(config.credentials)) {
    for (const [provider, value] of Object.entries(config.credentials)) {
      if (!PROVIDER_BY_ID.has(provider)) continue;
      const record = credentialRecord(value);
      if (record) credentials[provider] = record;
    }
  }
  const provider = PROVIDER_BY_ID.has(config.provider) ? config.provider : "custom";
  const legacy = credentialRecord(config.auth);
  if (legacy && (legacy.secret || !credentials[provider])) credentials[provider] = { ...credentials[provider], ...legacy, secret: legacy.secret || credentials[provider]?.secret || "" };
  return credentials;
}

export function openaiAdapterFor(model) {
  return model === OPENAI_LIVE_MODEL ? OPENAI_LIVE_ADAPTER : "openai_audio_sse_v1";
}

function storedConfig(config) {
  const mode = MODES.has(config.mode) ? config.mode : "off";
  const provider = PROVIDER_BY_ID.has(config.provider) ? config.provider : "custom";
  const profile = PROVIDER_BY_ID.get(provider);
  const credentials = storedCredentials(config);
  const auth = credentials[provider] || { type: "none", headerName: "X-API-Key", secret: "" };
  let model = typeof config.model === "string" ? config.model : profile.models[0]?.id || "";
  if (provider === "openai" && !profile.models.some((candidate) => candidate.id === model)) model = OPENAI_FILE_MODEL;
  const adapter = provider === "custom" && ADAPTER_IDS.has(config.adapter)
    ? config.adapter
    : provider === "openai"
      ? openaiAdapterFor(model)
      : profile.adapter;
  return {
    voiceConfigVersion: Number(config.voiceConfigVersion) === VOICE_CONFIG_VERSION ? VOICE_CONFIG_VERSION : 1,
    mode,
    localModelId: String(config.localModelId || DEFAULT_LOCAL_VOICE_MODEL),
    localSelection: config.localSelection && typeof config.localSelection === "object" ? { ...config.localSelection } : null,
    localSelectionOrigin: ["default", "explicit", "migrated_explicit"].includes(config.localSelectionOrigin) ? config.localSelectionOrigin : null,
    resolvedProfileId: typeof config.resolvedProfileId === "string" ? config.resolvedProfileId : null,
    provider, adapter,
    model,
    endpoint: typeof config.endpoint === "string" ? config.endpoint : profile.endpoint,
    auth,
    credentials,
    source: "stored", allowPrivate: false,
  };
}

function untouchedDefaultConfig(config) {
  return config.mode === "off"
    && (!config.localModelId || config.localModelId === DEFAULT_LOCAL_VOICE_MODEL)
    && (!config.provider || config.provider === "openai")
    && (!config.model || config.model === OPENAI_FILE_MODEL)
    && (!config.endpoint || config.endpoint === "https://api.openai.com/v1/audio/transcriptions")
    && !config.auth?.secret
    && !Object.values(config.credentials || {}).some((credential) => credential?.secret);
}

function normalizedLocalConfig(config, catalog) {
  let profile;
  let origin = config.localSelectionOrigin;
  if (Number(config.voiceConfigVersion) === VOICE_CONFIG_VERSION && config.localSelection) {
    if (!origin || !["default", "explicit", "migrated_explicit"].includes(origin)) throw voiceError("voice_profile_recovery_required", "The saved local voice profile has no valid selection origin", 409);
    profile = resolveVoiceExecutionProfile(config.localSelection, catalog);
  } else {
    const legacyModelId = String(config.localModelId || DEFAULT_LOCAL_VOICE_MODEL);
    const migration = migrateLocalSelection(legacyModelId, catalog);
    profile = resolveVoiceExecutionProfile(migration.selection, catalog);
    origin = untouchedDefaultConfig(config) ? "default" : "migrated_explicit";
  }
  const artifact = artifactForProfile(profile, catalog);
  return {
    voiceConfigVersion: VOICE_CONFIG_VERSION,
    localModelId: artifact.legacyModelId,
    localSelectionOrigin: origin,
    localSelection: profileSelection(profile),
    resolvedProfileId: profile.id,
  };
}

function normalizedStoredConfig(config, catalog) {
  const local = normalizedLocalConfig(config, catalog);
  return {
    ...config,
    ...local,
  };
}

export class VoiceSettingsStore {
  constructor({ filePath, catalog = VOICE_EXECUTION_CATALOG }) {
    if (!filePath) throw new Error("VoiceSettingsStore requires a file path");
    this.filePath = path.resolve(filePath);
    this.catalog = catalog;
  }

  async initialize() {
    const current = await readJson(this.filePath);
    const initial = Object.keys(current).length ? current : {
      mode: "off", localModelId: DEFAULT_LOCAL_VOICE_MODEL, provider: "openai", adapter: "openai_audio_sse_v1", model: "gpt-transcribe",
      endpoint: "https://api.openai.com/v1/audio/transcriptions", auth: { type: "bearer", headerName: "Authorization" },
    };
    const normalized = normalizedStoredConfig(initial, this.catalog);
    if (JSON.stringify(initial) !== JSON.stringify(normalized)) await writeJson(this.filePath, normalized);
  }

  async readNormalized() {
    const current = await readJson(this.filePath);
    const normalized = normalizedStoredConfig(current, this.catalog);
    if (JSON.stringify(current) !== JSON.stringify(normalized)) await writeJson(this.filePath, normalized);
    return normalized;
  }

  async effective() {
    return storedConfig(await this.readNormalized());
  }

  async publicView({ local = null } = {}) {
    const effective = await this.effective();
    const configured = Boolean(effective.auth.secret);
    return {
      voiceConfigVersion: effective.voiceConfigVersion, mode: effective.mode, localModelId: effective.localModelId,
      localSelection: effective.localSelection, localSelectionOrigin: effective.localSelectionOrigin, resolvedProfileId: effective.resolvedProfileId,
      provider: effective.provider, adapter: effective.adapter, model: effective.model,
      endpoint: effective.endpoint, source: effective.source, adapters: VOICE_ADAPTERS,
      providers: VOICE_PROVIDERS.map((provider) => ({
        ...provider,
        models: provider.models.map((model) => ({
          ...model,
          adapter: provider.id === "openai" ? openaiAdapterFor(model.id) : provider.adapter,
        })),
        configured: Boolean(effective.credentials[provider.id]?.secret),
      })),
      auth: { type: effective.auth.type, headerName: effective.auth.headerName, configured, source: configured ? effective.source : null, removable: configured && effective.source === "stored" },
      local,
    };
  }

  async update(input) {
    if (!isObject(input)) throw voiceError("voice_settings_invalid", "Voice settings must be an object");
    const mode = String(input.mode || "");
    if (!MODES.has(mode)) throw voiceError("voice_mode_invalid", "Voice mode must be off, local, or remote");
    const current = await this.readNormalized();
    const credentials = storedCredentials(current);
    const selectionInput = input.localSelection
      || (Object.prototype.hasOwnProperty.call(input, "localModelId") ? migrateLocalSelection(input.localModelId, this.catalog).selection : current.localSelection);
    const selectedProfile = resolveVoiceExecutionProfile(selectionInput, this.catalog);
    const selectedArtifact = artifactForProfile(selectedProfile, this.catalog);
    const local = {
      voiceConfigVersion: VOICE_CONFIG_VERSION,
      localModelId: selectedArtifact.legacyModelId,
      localSelectionOrigin: "explicit",
      localSelection: profileSelection(selectedProfile),
      resolvedProfileId: selectedProfile.id,
    };
    if (mode !== "remote") {
      await writeJson(this.filePath, { ...current, ...local, mode, credentials });
      return this.publicView();
    }
    const provider = PROVIDER_BY_ID.has(input.provider) ? String(input.provider) : "custom";
    const profile = PROVIDER_BY_ID.get(provider);
    let model = provider === "custom" ? String(input.model || "").trim() : String(input.model || profile.models[0]?.id || "");
    if (provider !== "custom" && !profile.models.some((candidate) => candidate.id === model)) {
      if (provider === "openai") model = OPENAI_FILE_MODEL;
      else throw voiceError("voice_model_invalid", `Choose a supported ${profile.label} transcription model`);
    }
    const adapter = provider === "custom"
      ? String(input.adapter || "")
      : provider === "openai"
        ? openaiAdapterFor(model)
        : profile.adapter;
    if (!ADAPTER_IDS.has(adapter)) throw voiceError("voice_adapter_invalid", "Unknown voice endpoint adapter");
    const previous = credentials[provider] || {};
    const secret = typeof input.auth?.secret === "string" && input.auth.secret.trim() ? normalizeSecret(input.auth.secret) : previous.secret || "";
    const endpoint = provider === "custom" ? normalizeRemoteVoiceEndpoint(input.endpoint) : profile.endpoint;
    const authType = provider === "custom" ? String(input.auth?.type || "none") : "bearer";
    if (!AUTH_TYPES.has(authType)) throw voiceError("voice_auth_invalid", "Unknown voice endpoint authentication type");
    const headerName = authType === "bearer" ? "Authorization" : authType === "header" ? normalizeHeaderName(input.auth?.headerName) : "X-API-Key";
    const protocol = new URL(endpoint).protocol;
    if (adapter !== OPENAI_LIVE_ADAPTER && protocol !== "https:") throw voiceError("voice_endpoint_protocol", "Audio upload adapters require an HTTPS endpoint");
    if (authType !== "none" && !secret) throw voiceError("voice_secret_invalid", `Enter a credential for ${profile.label}`);
    const auth = { type: authType, headerName, ...(authType !== "none" && secret ? { secret } : {}) };
    credentials[provider] = { type: authType, headerName, secret };
    await writeJson(this.filePath, {
      ...current, ...local, mode, provider, adapter, model, endpoint, auth, credentials,
    });
    return this.publicView();
  }

  async removeCredential() {
    const config = await readJson(this.filePath);
    const provider = PROVIDER_BY_ID.has(config.provider) ? config.provider : "custom";
    const credentials = storedCredentials(config);
    const removed = Boolean(config.auth?.secret || credentials[provider]?.secret);
    if (isObject(config.auth)) delete config.auth.secret;
    if (credentials[provider]) delete credentials[provider].secret;
    if (removed) await writeJson(this.filePath, { ...config, credentials });
    return removed;
  }

  async selectLocalModel(localModelId) {
    const config = await this.readNormalized();
    const migration = migrateLocalSelection(String(localModelId), this.catalog);
    const profile = resolveVoiceExecutionProfile(migration.selection, this.catalog);
    const artifact = artifactForProfile(profile, this.catalog);
    await writeJson(this.filePath, {
      ...config,
      mode: "local",
      voiceConfigVersion: VOICE_CONFIG_VERSION,
      localModelId: artifact.legacyModelId,
      localSelectionOrigin: "explicit",
      localSelection: profileSelection(profile),
      resolvedProfileId: profile.id,
    });
    return this.publicView();
  }
}
