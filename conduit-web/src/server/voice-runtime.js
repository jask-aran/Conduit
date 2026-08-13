import dns from "node:dns/promises";
import net from "node:net";
import { WebSocket } from "ws";

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

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const family = typeof options === "number" ? options : options?.family;
    const selected = addresses.find((item) => !family || item.family === family) || addresses[0];
    if (options?.all) callback(null, addresses);
    else callback(null, selected.address, selected.family);
  };
}

export class VoiceRuntime {
  constructor({ settings, modelManager, fetchImpl = fetch, lookup = dns.lookup } = {}) {
    this.settings = settings;
    this.modelManager = modelManager;
    this.fetchImpl = fetchImpl;
    this.lookup = lookup;
  }

  async resolve() {
    const config = await this.settings.effective();
    if (config.mode === "off") throw runtimeError("dictation_not_configured", "Voice dictation is disabled", 409);
    if (config.mode === "local") {
      const local = await this.modelManager.ensureRunning(config.localModelId);
      if (local.kind === "transcriber") {
        return {
          mode: "local",
          adapter: "managed_transformers_v1",
          provider: "local",
          localModelId: config.localModelId,
          model: config.localModelId,
          transcribe: (pcm) => this.modelManager.transcribe(config.localModelId, pcm),
        };
      }
      return {
        mode: "local",
        adapter: "openai_audio_sse_v1",
        provider: "local",
        localModelId: config.localModelId,
        model: "",
        endpoint: `${local.origin}/v1/audio/transcriptions`,
        headers: {},
        allowPrivate: true,
      };
    }
    const endpoint = new URL(config.endpoint);
    const addresses = config.allowPrivate ? [] : await publicAddresses(endpoint.hostname, this.lookup);
    return {
      mode: "remote",
      provider: config.provider,
      adapter: config.adapter,
      model: config.model,
      endpoint: endpoint.toString(),
      headers: requestHeaders(config),
      stopMessage: config.stopMessage || "",
      lookup: addresses.length ? pinnedLookup(addresses) : undefined,
    };
  }

  async test() {
    const config = await this.resolve();
    if (config.mode === "local") return this.modelManager.test(config.localModelId);
    if (config.adapter === "parakeet_pcm_ws_v1") {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(config.endpoint, { headers: config.headers, lookup: config.lookup, handshakeTimeout: 5_000 });
        const timer = setTimeout(() => {
          socket.terminate();
          reject(runtimeError("voice_endpoint_timeout", "Voice endpoint connection timed out", 504));
        }, 5_000);
        socket.once("open", () => {
          clearTimeout(timer);
          socket.close(1000, "Connection test");
          resolve({ ok: true, mode: config.mode, adapter: config.adapter });
        });
        socket.once("error", (error) => {
          clearTimeout(timer);
          reject(runtimeError("voice_endpoint_unreachable", `Could not connect to the voice endpoint: ${error.message}`, 502));
        });
      });
    }
    const testEndpoint = config.provider === "openai"
      ? `https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`
      : config.provider === "groq"
        ? `https://api.groq.com/openai/v1/models/${encodeURIComponent(config.model)}`
        : config.provider === "deepgram"
          ? "https://api.deepgram.com/v1/projects"
          : config.endpoint;
    const response = await this.fetchImpl(testEndpoint, {
      method: config.provider === "custom" ? "OPTIONS" : "GET",
      headers: config.headers,
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
