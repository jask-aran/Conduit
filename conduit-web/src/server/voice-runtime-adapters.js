import {
  artifactForProfile,
  backendPathForProfile,
  resolveVoiceExecutionProfile,
  runtimeForProfile,
} from "./voice-execution-catalog.js";

function runtimeAdapterError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason || runtimeAdapterError("voice_operation_cancelled", "Voice inference was cancelled", 499);
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const rejectAbort = () => reject(signal.reason || runtimeAdapterError("voice_operation_cancelled", "Voice inference was cancelled", 499));
      signal.addEventListener("abort", rejectAbort, { once: true });
      promise.finally(() => signal.removeEventListener("abort", rejectAbort)).catch(() => {});
    }),
  ]);
}

function pcmFloat32(pcm16) {
  const buffer = Buffer.isBuffer(pcm16) ? pcm16 : Buffer.from(pcm16 || []);
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(index * 2) / 32768;
  return samples;
}

function pcm16FromFloat32(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  const samples = value instanceof Float32Array ? value : Float32Array.from(value || []);
  const buffer = Buffer.allocUnsafe(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    buffer.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), index * 2);
  }
  return buffer;
}

function streamOptions(profile, options = {}) {
  const streaming = options.streaming || profile.streaming || {};
  const family = {
    kind: streaming.family || "parakeet_buffered",
    ...(Number.isFinite(Number(streaming.leftMs)) ? { leftMs: Number(streaming.leftMs) } : {}),
    ...(Number.isFinite(Number(streaming.chunkMs)) ? { chunkMs: Number(streaming.chunkMs) } : {}),
    ...(Number.isFinite(Number(streaming.rightMs)) ? { rightMs: Number(streaming.rightMs) } : {}),
  };
  return {
    family,
    commitPolicy: streaming.commitPolicy || "stable_prefix",
    ...(Number.isFinite(Number(streaming.stablePrefixAgreementN))
      ? { stablePrefixAgreementN: Number(streaming.stablePrefixAgreementN) }
      : {}),
  };
}

function resultText(value) {
  return String(value?.text || value?.transcript || value?.result?.text || "").trim();
}

async function readLoopbackText(response) {
  if (!response.ok) throw runtimeAdapterError("voice_model_unhealthy", `Managed local voice endpoint returned ${response.status}`, 502);
  const raw = await response.text();
  try { return resultText(JSON.parse(raw)); }
  catch {}
  let text = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try { text = resultText(JSON.parse(value)) || text; }
    catch {}
  }
  return text || raw.trim();
}

function createBatchPort({ profile, artifact, runtime, modelManager, fetchImpl }) {
  const callManager = async ({ pcm16, signal, operationId, sequence, startSample, endSample }) => {
    if (typeof modelManager?.transcribe !== "function") throw runtimeAdapterError("voice_batch_port_unavailable", "The selected local runtime has no BatchPort");
    const task = modelManager.transcribe(artifact.legacyModelId, Buffer.from(pcm16 || []), {
      signal,
      operationId,
      profileId: profile.id,
      runtimeId: profile.runtimeId,
      sequence,
      startSample,
      endSample,
    });
    const value = await withAbort(task, signal);
    if (value && typeof value === "object") return { ...value, text: String(value.text || "").trim() };
    return { text: String(value || "").trim() };
  };
  const callLoopback = async ({ pcm16, signal, operationId }) => {
    if (!runtime?.origin || typeof fetchImpl !== "function") throw runtimeAdapterError("voice_batch_port_unavailable", "The selected loopback runtime has no BatchPort");
    throwIfAborted(signal);
    const form = new FormData();
    const bytes = Buffer.from(pcm16 || []);
    const wav = Buffer.alloc(44 + bytes.length);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(36 + bytes.length, 4);
    wav.write("WAVE", 8, "ascii");
    wav.write("fmt ", 12, "ascii");
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24);
    wav.writeUInt32LE(32_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36, "ascii");
    wav.writeUInt32LE(bytes.length, 40);
    bytes.copy(wav, 44);
    form.append("file", new Blob([wav], { type: "audio/wav" }), "dictation.wav");
    form.append("response_format", "json");
    const response = await fetchImpl(`${runtime.origin}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { "User-Agent": "ConduitVoice/1.0" },
      body: form,
      signal,
      redirect: "error",
    });
    return { text: await readLoopbackText(response), operationId };
  };
  return {
    async transcribe(input) {
      const result = runtime.adapterKind === "parakeet_loopback" ? await callLoopback(input) : await callManager(input);
      return {
        ...result,
        operationId: input.operationId,
        sequence: input.sequence,
        startSample: input.startSample,
        endSample: input.endSample,
      };
    },
  };
}

function createStreamPort({ profile, modelManager, artifact, openNative }) {
  let stream = null;
  let opened = false;
  const open = async (input = {}) => {
    if (opened && stream) throw runtimeAdapterError("voice_stream_busy", "The selected StreamPort already has an active session");
    if (typeof openNative !== "function" && typeof modelManager?.stream !== "function") throw runtimeAdapterError("voice_stream_unsupported", "The selected local runtime does not expose StreamPort", 409);
    const options = streamOptions(profile, input);
    stream = await (openNative ? openNative(options) : modelManager.stream(artifact.legacyModelId, options));
    if (!stream || typeof stream.feed !== "function" || typeof stream.finalize !== "function") {
      stream = null;
      throw runtimeAdapterError("voice_stream_invalid", "The selected local runtime returned an invalid StreamPort session", 502);
    }
    opened = true;
  };
  const close = async () => {
    const active = stream;
    stream = null;
    opened = false;
    try { active?.reset?.(); }
    catch {}
  };
  const api = {
    open,
    async feed(input) {
      if (!stream) throw runtimeAdapterError("voice_stream_not_open", "StreamPort is not open");
      const update = await stream.feed(pcmFloat32(input.pcm16));
      return {
        update,
        text: { ...(stream.text || {}) },
        operationId: input.operationId,
        startSample: input.startSample,
        endSample: input.endSample,
      };
    },
    async finalize(input = {}) {
      if (!stream) throw runtimeAdapterError("voice_stream_not_open", "StreamPort is not open");
      const active = stream;
      const update = await active.finalize();
      const result = { update, text: { ...(active.text || {}) }, endSample: input.endSample ?? null };
      stream = null;
      opened = false;
      return result;
    },
    async cancel(reason = "cancelled") {
      await close();
      return { cancelled: true, reason };
    },
    // Legacy native opening remains available to callers that still expose the
    // native session shape. Dictation uses openSession below.
    openNative: async (options = {}) => {
      if (typeof openNative !== "function") {
        if (typeof modelManager?.stream !== "function") throw runtimeAdapterError("voice_stream_unsupported", "The selected local runtime does not expose StreamPort", 409);
        return modelManager.stream(artifact.legacyModelId, streamOptions(profile, options));
      }
      return openNative(streamOptions(profile, options));
    },
  };
  api.openSession = async (options = {}) => {
    await api.open(options);
    let cursor = 0;
    let lastText = { full: "", committed: "", tentative: "" };
    return {
      get text() { return lastText; },
      async feed(pcm) {
        const pcm16 = pcm16FromFloat32(pcm);
        const startSample = cursor;
        const endSample = startSample + Math.floor(pcm16.length / 2);
        const result = await api.feed({ pcm16, startSample, endSample });
        cursor = endSample;
        lastText = result.text;
        return result.update;
      },
      async finalize() {
        const result = await api.finalize({ endSample: cursor });
        lastText = result.text;
        return result.update;
      },
      reset() { void api.cancel("session_closed"); },
    };
  };
  return api;
}

export function createVoiceRuntimeAdapters({ profile, catalog, modelManager, runtime, fetchImpl = fetch, openStream } = {}) {
  const resolvedProfile = resolveVoiceExecutionProfile(profile, catalog);
  const artifact = artifactForProfile(resolvedProfile, catalog);
  const backendPath = backendPathForProfile(resolvedProfile, catalog);
  const runtimeDefinition = runtimeForProfile(resolvedProfile, catalog);
  if (backendPath.ports.batch !== true) throw runtimeAdapterError("voice_batch_port_unavailable", `Backend path ${backendPath.id} has no BatchPort`);
  const batch = createBatchPort({ profile: resolvedProfile, artifact, runtime: { ...runtime, ...runtimeDefinition }, modelManager, fetchImpl });
  const stream = backendPath.ports.stream
    ? createStreamPort({ profile: resolvedProfile, modelManager, artifact, openNative: openStream })
    : null;
  return {
    profile: resolvedProfile,
    artifact,
    backendPath,
    runtime: runtimeDefinition,
    batch,
    stream,
  };
}
