import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_SECRET_LENGTH = 16 * 1024;
const MAX_ENDPOINT_LENGTH = 2 * 1024;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const VOICE_ADAPTERS = Object.freeze([
  {
    id: "parakeet_pcm_ws_v1",
    label: "Parakeet live PCM WebSocket",
    transport: "websocket",
    description: "Streams 16 kHz signed PCM and expects explicit partial/final JSON events.",
  },
  {
    id: "openai_audio_sse_v1",
    label: "OpenAI-compatible audio upload",
    transport: "http",
    description: "Buffers one utterance in memory, then reads transcript delta events from the audio API.",
  },
]);

const ADAPTER_IDS = new Set(VOICE_ADAPTERS.map((adapter) => adapter.id));
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
  if (secret.length > MAX_SECRET_LENGTH || /[\0-\x1f\x7f]/.test(secret)) {
    throw voiceError("voice_secret_invalid", "Voice endpoint credential is invalid");
  }
  return secret;
}

function normalizeHeaderName(value) {
  const name = String(value || "X-API-Key").trim();
  if (!HEADER_NAME.test(name) || ["authorization", "cookie", "host", "origin"].includes(name.toLowerCase())) {
    throw voiceError("voice_auth_header_invalid", "Choose a safe API-key header name");
  }
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
  if (!allowed.has(endpoint.protocol)) {
    throw voiceError("voice_endpoint_insecure", "Remote voice endpoints must use HTTPS or WSS");
  }
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
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function environmentConfig(environment) {
  const endpoint = String(environment.CONDUIT_PARAKEET_STREAM_URL || "").trim();
  if (!endpoint) return null;
  return {
    mode: "remote",
    adapter: String(environment.CONDUIT_VOICE_ADAPTER || "parakeet_pcm_ws_v1").trim(),
    endpoint,
    auth: {
      type: environment.CONDUIT_PARAKEET_API_KEY ? "bearer" : "none",
      headerName: "Authorization",
      secret: String(environment.CONDUIT_PARAKEET_API_KEY || ""),
    },
    stopMessage: String(environment.CONDUIT_PARAKEET_STOP_MESSAGE || ""),
    source: "environment",
    allowPrivate: true,
  };
}

function storedConfig(config) {
  const mode = MODES.has(config.mode) ? config.mode : "off";
  const adapter = ADAPTER_IDS.has(config.adapter) ? config.adapter : "parakeet_pcm_ws_v1";
  const authType = AUTH_TYPES.has(config.auth?.type) ? config.auth.type : "none";
  return {
    mode,
    adapter,
    endpoint: typeof config.endpoint === "string" ? config.endpoint : "",
    auth: {
      type: authType,
      headerName: authType === "bearer" ? "Authorization" : normalizeHeaderName(config.auth?.headerName),
      secret: typeof config.auth?.secret === "string" ? config.auth.secret : "",
    },
    source: "stored",
    allowPrivate: false,
  };
}

export class VoiceSettingsStore {
  constructor({ filePath, environment = process.env } = {}) {
    if (!filePath) throw new Error("VoiceSettingsStore requires a file path");
    this.filePath = path.resolve(filePath);
    this.environment = environment;
  }

  async initialize() {
    const current = await readJson(this.filePath);
    if (!Object.keys(current).length) await writeJson(this.filePath, { mode: "off", adapter: "parakeet_pcm_ws_v1", auth: { type: "none", headerName: "X-API-Key" } });
  }

  async effective() {
    const environment = environmentConfig(this.environment);
    if (environment) return environment;
    return storedConfig(await readJson(this.filePath));
  }

  async publicView({ local = null } = {}) {
    const effective = await this.effective();
    const configured = Boolean(effective.auth.secret);
    return {
      mode: effective.mode,
      adapter: effective.adapter,
      endpoint: effective.endpoint,
      source: effective.source,
      locked: effective.source === "environment",
      adapters: VOICE_ADAPTERS,
      auth: {
        type: effective.auth.type,
        headerName: effective.auth.headerName,
        configured,
        source: configured ? effective.source : null,
        removable: configured && effective.source === "stored",
      },
      local,
    };
  }

  async update(input) {
    if (environmentConfig(this.environment)) throw voiceError("voice_settings_locked", "Voice settings are managed by the server environment", 409);
    if (!isObject(input)) throw voiceError("voice_settings_invalid", "Voice settings must be an object");
    const mode = String(input.mode || "");
    const adapter = String(input.adapter || "");
    const requestedAuthType = String(input.auth?.type || "none");
    if (!MODES.has(mode)) throw voiceError("voice_mode_invalid", "Voice mode must be off, local, or remote");
    if (!ADAPTER_IDS.has(adapter)) throw voiceError("voice_adapter_invalid", "Unknown voice endpoint adapter");
    if (!AUTH_TYPES.has(requestedAuthType)) throw voiceError("voice_auth_invalid", "Unknown voice endpoint authentication type");
    if (mode === "local" && adapter !== "openai_audio_sse_v1") {
      throw voiceError("voice_adapter_invalid", "Managed local voice uses the OpenAI-compatible audio adapter");
    }
    const authType = mode === "local" || mode === "off" ? "none" : requestedAuthType;
    const current = await readJson(this.filePath);
    const previousSecret = typeof current.auth?.secret === "string" ? current.auth.secret : "";
    const secret = typeof input.auth?.secret === "string" && input.auth.secret.trim()
      ? normalizeSecret(input.auth.secret)
      : previousSecret;
    const endpoint = mode === "remote" ? normalizeRemoteVoiceEndpoint(input.endpoint) : "";
    if (mode === "remote") {
      const protocol = new URL(endpoint).protocol;
      if (adapter === "parakeet_pcm_ws_v1" && protocol !== "wss:") {
        throw voiceError("voice_endpoint_protocol", "The live PCM adapter requires a WSS endpoint");
      }
      if (adapter === "openai_audio_sse_v1" && protocol !== "https:") {
        throw voiceError("voice_endpoint_protocol", "The audio upload adapter requires an HTTPS endpoint");
      }
    }
    const next = {
      mode,
      adapter,
      endpoint,
      auth: {
        type: authType,
        headerName: authType === "bearer" ? "Authorization" : normalizeHeaderName(input.auth?.headerName),
        ...(authType !== "none" && secret ? { secret } : {}),
      },
    };
    if (mode === "remote" && authType !== "none" && !secret) {
      throw voiceError("voice_secret_invalid", "Enter a credential for the selected authentication method");
    }
    await writeJson(this.filePath, next);
    return this.publicView();
  }

  async removeCredential() {
    if (environmentConfig(this.environment)) throw voiceError("voice_settings_locked", "Voice settings are managed by the server environment", 409);
    const config = await readJson(this.filePath);
    const removed = Boolean(config.auth?.secret);
    if (isObject(config.auth)) delete config.auth.secret;
    if (removed) await writeJson(this.filePath, config);
    return removed;
  }
}
