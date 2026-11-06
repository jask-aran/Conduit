// A backend provides id, label, runtime metadata, models, manifest(model),
// prepare(model, { onProgress }), and createSession(model, { modelPath }).
// prepare installs runtime packages; the manager downloads manifest artifacts.
// createSession returns the existing loaded runtime contract: diagnostics,
// transcribe(Float32Array), stream(options), and dispose(). A stream provides
// feed(Float32Array), finalize(), reset(), and full/committed/tentative text.
// streamOptions(profile, options) maps port options to backend options.
// Models provide catalogue metadata, modelId, artifactId, format, and execution.
// Add a backend as one new file and one registration line below.
export const LOCAL_VOICE_BACKENDS = [
  (await import("./transcribe-cpp.js")).default,
];

export function localVoiceBackend(id) {
  const backend = LOCAL_VOICE_BACKENDS.find((candidate) => candidate.id === id);
  if (!backend) throw Object.assign(new Error(`Unknown local voice backend: ${id}`), { code: "voice_backend_invalid", status: 409 });
  return backend;
}
