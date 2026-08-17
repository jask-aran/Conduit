import dns from "node:dns/promises";
import net from "node:net";
import { OPENAI_LIVE_ADAPTER, OPENAI_LIVE_MODEL, openaiAdapterFor } from "../voice-settings.js";
import { openOpenaiRealtimeStream } from "./dictation-stream.js";
import {
  VOICE_EXECUTION_CATALOG,
  artifactForProfile,
  migrateLocalSelection,
  resolveVoiceExecutionProfile,
  runtimeForProfile,
} from "./voice-execution-catalog.js";
import { createVoiceRuntimeAdapters } from "./voice-runtime-adapters.js";

function runtimeError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function privateIpv4(address) {
  const pieces = address.split(".").map(Number);
  if (pieces.length !== 4 || pieces.some((piece) => !Number.isInteger(piece) || piece < 0 || piece > 255)) return true;
  const [a, b] = pieces;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

export function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase().split("%")[0];
  if (net.isIPv4(normalized)) return privateIpv4(normalized);
  if (!net.isIPv6(normalized)) return true;
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateIpv4(mapped[1]) : false;
}

async function publicAddresses(hostname, lookup = dns.lookup) {
  const literal = net.isIP(hostname) ? [{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }] : await lookup(hostname, { all: true, verbatim: true });
  if (!literal.length || literal.some((item) => isPrivateAddress(item.address))) {
    throw runtimeError("voice_endpoint_private", "Remote voice endpoints may not resolve to private, loopback, or link-local addresses");
  }
  return literal;
}

function requestHeaders(config) {
  if (config.provider === "deepgram") return { Authorization: `Token ${config.auth.secret}` };
  if (config.auth.type === "bearer") return { Authorization: `Bearer ${config.auth.secret}` };
  if (config.auth.type === "header") return { [config.auth.headerName]: config.auth.secret };
  return {};
}

function modelPrecision(modelId) {
  const value = String(modelId || "");
  if (value.endsWith("-fp32")) return "fp32";
  if (value.endsWith("-int8")) return "int8";
  if (value.endsWith("-q8")) return "q8";
  return null;
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const family = typeof options === "number" ? options : options?.family;
    const selected = addresses.find((item) => !family || item.family === family) || addresses[0];
    if (options?.all) callback(null, addresses);
    else callback(null, selected.address, selected.family);
  };
}

export class VoiceRuntime {
  constructor({ settings, modelManager, catalog = VOICE_EXECUTION_CATALOG, fetchImpl = fetch, lookup = dns.lookup } = {}) {
    this.settings = settings;
    this.modelManager = modelManager;
    this.catalog = catalog;
    this.fetchImpl = fetchImpl;
    this.lookup = lookup;
  }

  pin() {
    this.modelManager?.pin?.();
  }

  unpin() {
    this.modelManager?.unpin?.();
  }

  acquireLease() {
    this.pin();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.unpin();
    };
    release.release = release;
    return release;
  }

  async observeVoiceActivity(pcm) {
    if (typeof this.modelManager?.observeVoiceActivity !== "function") return null;
    return this.modelManager.observeVoiceActivity(pcm);
  }

  beginVoiceActivity() {
    if (typeof this.modelManager?.beginVoiceActivity !== "function") return null;
    return this.modelManager.beginVoiceActivity();
  }

  async resolve() {
    const config = await this.settings.effective();
    if (config.mode === "off") throw runtimeError("dictation_not_configured", "Voice dictation is disabled", 409);
    if (config.mode === "local") {
      const profile = config.localSelection
        ? resolveVoiceExecutionProfile(config.localSelection, this.catalog)
        : config.resolvedProfileId
          ? resolveVoiceExecutionProfile({ profileId: config.resolvedProfileId }, this.catalog)
          : resolveVoiceExecutionProfile(migrateLocalSelection(config.localModelId, this.catalog).selection, this.catalog);
      const artifact = artifactForProfile(profile, this.catalog);
      const runtimeDefinition = runtimeForProfile(profile, this.catalog);
      const local = await this.modelManager.ensureRunning(artifact.legacyModelId, { runtimeId: runtimeDefinition.id });
      const adapters = createVoiceRuntimeAdapters({
        profile,
        catalog: this.catalog,
        modelManager: this.modelManager,
        runtime: { ...local, adapterKind: runtimeDefinition.adapterKind },
        fetchImpl: this.fetchImpl,
        openStream: profile.execution === "live" && typeof this.modelManager.stream === "function"
          ? (options) => this.modelManager.stream(artifact.legacyModelId, options)
          : null,
      });
      const actualStreaming = profile.execution === "live" && Boolean(adapters.stream);
      const adapter = profile.execution === "live"
        ? "transcribe_cpp_stream_v1"
        : runtimeDefinition.adapterKind === "transformers_js"
          ? "managed_transformers_v1"
          : runtimeDefinition.adapterKind === "parakeet_loopback"
            ? "managed_parakeet_loopback_v1"
            : runtimeDefinition.adapterKind === "transcribe_rs"
              ? "transcribe_rs_batch_v1"
            : "transcribe_cpp_batch_v1";
      const transcribe = async (pcm, options = {}) => {
        const result = await adapters.batch.transcribe({
          pcm16: Buffer.from(pcm || []),
          operationId: options.operationId || `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sequence: options.sequence || 0,
          startSample: options.startSample || 0,
          endSample: options.endSample || Math.floor(Buffer.byteLength(pcm || []) / 2),
          signal: options.signal,
        });
        return result.text;
      };
      return {
        mode: "local",
        inferenceMode: profile.execution === "live" ? "streaming" : "batch",
        adapter,
        provider: "local",
        localModelId: artifact.legacyModelId,
        model: artifact.legacyModelId,
        modelId: profile.modelId,
        artifactId: profile.artifactId,
        runtimeId: profile.runtimeId,
        backendPathId: profile.backendPathId,
        resolvedProfileId: profile.id,
        profile,
        execution: profile.execution,
        segmentation: profile.segmentation,
        fallback: profile.fallback ? { ...profile.fallback } : null,
        precision: artifact.precision || modelPrecision(artifact.legacyModelId),
        backend: local.backend || (runtimeDefinition.adapterKind === "transformers_js" ? "embedded_transformers" : runtimeDefinition.adapterKind === "parakeet_loopback" ? "loopback_parakeet" : runtimeDefinition.adapterKind === "transcribe_rs" ? "transcribe_rs" : "transcribe_cpp"),
        computeBackend: local.computeBackend || (runtimeDefinition.adapterKind === "transformers_js" ? "wasm-cpu" : runtimeDefinition.adapterKind === "parakeet_loopback" || runtimeDefinition.adapterKind === "transcribe_rs" ? "cpu" : null),
        requestedComputeBackend: local.requestedComputeBackend || (profile.runtimeId === "transcribe-cpp" ? "auto" : runtimeDefinition.compiledComputeBackends[0] || null),
        actualComputeBackend: local.actualComputeBackend || local.computeBackend || (runtimeDefinition.adapterKind === "transformers_js" ? "wasm-cpu" : runtimeDefinition.adapterKind === "parakeet_loopback" || runtimeDefinition.adapterKind === "transcribe_rs" ? "cpu" : null),
        loadedRuntimeVersion: local.runtimeVersion || local.native?.version || runtimeDefinition.version,
        capabilities: local.capabilities || { inferenceMode: profile.execution === "live" ? "streaming" : "batch", partials: profile.execution === "live" },
        streaming: actualStreaming ? local.capabilities?.streaming || null : null,
        native: local.native || null,
        ports: adapters,
        transcribe,
        stream: profile.execution === "live" && adapters.stream ? (options) => adapters.stream.openSession(options) : null,
      };
    }
    const adapter = config.provider === "openai" ? openaiAdapterFor(config.model) : config.adapter;
    if (adapter === OPENAI_LIVE_ADAPTER) {
      return {
        mode: "remote",
        inferenceMode: "streaming",
        provider: config.provider,
        adapter,
        model: OPENAI_LIVE_MODEL,
        precision: null,
        backend: "openai_realtime",
        computeBackend: null,
        endpoint: "wss://api.openai.com/v1/realtime?intent=transcription",
        headers: requestHeaders(config),
        capabilities: { language: "en", inferenceMode: "streaming", partials: true, externalVad: false, streaming: { family: "openai_realtime", delay: "low" } },
        stream: (options = {}) => this.openOpenaiLive(config, options),
      };
    }
    const endpoint = new URL(config.endpoint);
    const addresses = config.allowPrivate ? [] : await publicAddresses(endpoint.hostname, this.lookup);
    return {
      mode: "remote",
      inferenceMode: "batch",
      provider: config.provider,
      adapter,
      model: config.model,
      precision: null,
      backend: "remote_provider",
      computeBackend: null,
      endpoint: endpoint.toString(),
      headers: requestHeaders(config),
      lookup: addresses.length ? pinnedLookup(addresses) : undefined,
    };
  }

  openOpenaiLive(config, options = {}) {
    const opener = options.openStream || openOpenaiRealtimeStream;
    return opener({
      url: options.url || "wss://api.openai.com/v1/realtime?intent=transcription",
      headers: requestHeaders(config),
      model: OPENAI_LIVE_MODEL,
    });
  }

  async test() {
    const config = await this.resolve();
    if (config.mode === "local") return this.modelManager.test(config.localModelId, { runtimeId: config.localSelection?.runtimeId || null });
    const testEndpoint = config.provider === "openai"
      ? `https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`
      : config.provider === "groq"
        ? `https://api.groq.com/openai/v1/models/${encodeURIComponent(config.model)}`
        : config.provider === "deepgram"
          ? "https://api.deepgram.com/v1/projects"
          : config.endpoint;
    const response = await this.fetchImpl(testEndpoint, {
      method: config.provider === "custom" ? "OPTIONS" : "GET",
      headers: { "User-Agent": "ConduitVoice/1.0", ...config.headers },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (response.status >= 500) throw runtimeError("voice_endpoint_unhealthy", `Voice endpoint returned ${response.status}`, 502);
    if (!response.ok) {
      const message = config.provider === "custom"
        ? `The custom voice endpoint rejected its connection test (${response.status})`
        : `${config.provider} rejected the configured credential (${response.status})`;
      throw runtimeError(config.provider === "custom" ? "voice_endpoint_rejected" : "voice_credentials_rejected", message, 502);
    }
    return { ok: true, mode: config.mode, adapter: config.adapter, status: response.status };
  }
}
