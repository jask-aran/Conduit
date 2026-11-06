import { TRANSCRIBE_CPP_RUNTIME, TRANSCRIBE_CPP_VERSION } from "../voice-model-manifests.js";
import { ensureVoicePackages, importVoicePackage } from "../voice-packages.js";

const model = {
  id: "moonshine-streaming-tiny-q8", modelId: "moonshine-streaming-tiny", artifactId: "moonshine-streaming-tiny-q8-gguf",
  label: "Moonshine Streaming Tiny Q8_0", engine: "transcribe-cpp", size: "tiny", languages: "English",
  description: "Small English streaming model for local dictation.", approximateBytes: 50462816, minimumFreeBytes: 128 * 1024 * 1024,
  repository: "handy-computer/moonshine-streaming-tiny-gguf", revision: "4125c28c22a76494162094ab3566387cd92fb2f5",
  modelFile: "moonshine-streaming-tiny-Q8_0.gguf", runtimeVersion: TRANSCRIBE_CPP_VERSION, precision: "q8", format: "gguf", execution: "live",
  sha256: "930e4622ad3a24158b91406c30c977fa6a26b34cb32d6ac3e57cfb23383a869e",
  license: { id: "MIT", attribution: "Useful Sensors Moonshine and the Handy transcribe.cpp port" },
};

export const DEFAULT_TRANSCRIBE_CPP_STREAM = Object.freeze({ family: "moonshine", commitPolicy: "stable_prefix", stablePrefixAgreementN: 3 });

const backend = {
  id: "transcribe-cpp",
  label: "transcribe.cpp",
  runtime: { adapterKind: "transcribe_cpp", version: TRANSCRIBE_CPP_VERSION, compiledComputeBackends: ["cpu+vulkan"], requestedComputeBackend: "auto" },
  models: [model],
  manifest(definition) {
    const base = (process.env.CONDUIT_HF_ENDPOINT || "https://huggingface.co").replace(/\/+$/, "");
    return {
      version: `transcribe-cpp-${TRANSCRIBE_CPP_VERSION}`, modelRevision: definition.revision, runtime: TRANSCRIBE_CPP_RUNTIME,
      artifacts: [{ name: definition.modelFile, relative: definition.modelFile,
        url: `${base}/${definition.repository}/resolve/${definition.revision}/${definition.modelFile}`,
        size: definition.approximateBytes, sha256: definition.sha256 }],
    };
  },
  streamOptions(_profile, options = {}) {
    const streaming = options.streaming || _profile?.streaming || {};
    return {
      family: { kind: "moonshine", ...(Number.isFinite(streaming.minDecodeIntervalMs) ? { minDecodeIntervalMs: streaming.minDecodeIntervalMs } : {}) },
      commitPolicy: streaming.commitPolicy || DEFAULT_TRANSCRIBE_CPP_STREAM.commitPolicy,
      stablePrefixAgreementN: streaming.stablePrefixAgreementN ?? DEFAULT_TRANSCRIBE_CPP_STREAM.stablePrefixAgreementN,
    };
  },
  prepare(_definition, { onProgress } = {}) {
    return ensureVoicePackages({ onPhase: onProgress });
  },
  async createSession(definition, { modelPath } = {}) {
    const native = await importVoicePackage("transcribe-cpp");
    const version = native.version();
    const availableBackends = native.getAvailableBackends();
    const model = await native.TranscribeModel.load(modelPath, { backend: "auto" });
    if (!model.capabilities?.supportsStreaming || !model.accepts({ kind: "moonshine" })) {
      model.dispose();
      throw Object.assign(new Error("The installed runtime does not support Moonshine streaming"), { code: "voice_model_streaming", status: 409 });
    }
    const session = model.createSession();
    const device = model.device || {};
    return {
      kind: "transcriber", adapter: "transcribe_cpp_stream_v1", backend: "transcribe_cpp",
      computeBackend: String(device.kind || model.backend || "unknown"),
      capabilities: {
        language: "en", inferenceMode: "streaming", partials: true, externalVad: false, precision: definition.precision,
        memory: { modelBytes: definition.approximateBytes,
          totalBytes: Number.isFinite(Number(device.memoryTotal)) ? Number(device.memoryTotal) : null,
          freeBytes: Number.isFinite(Number(device.memoryFree)) ? Number(device.memoryFree) : null },
        streaming: DEFAULT_TRANSCRIBE_CPP_STREAM,
      },
      native: { package: "transcribe-cpp", version: version.version, commit: version.commit, headerHash: version.headerHash,
        availableBackends: availableBackends.map(({ kind, name, deviceType }) => ({ kind, name, deviceType })) },
      // Moonshine is stream-slot only. Stop-time and fallback calls must also
      // feed/finalize a stream, rather than call session.run().
      async transcribe(pcm) {
        const stream = await session.stream(backend.streamOptions());
        try {
          await stream.feed(pcm);
          await stream.finalize();
          return { text: stream.text.full };
        } finally { stream.reset(); }
      },
      stream: (options = {}) => session.stream({ ...backend.streamOptions(), ...options, family: { ...options.family, kind: "moonshine" } }),
      dispose() { session.dispose(); model.dispose(); },
    };
  },
};

export default backend;
