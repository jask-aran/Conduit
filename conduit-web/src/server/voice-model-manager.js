import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";

const PARAKEET_VERSION = "v0.8.0";
const ONNXRUNTIME_VERSION = "1.25.1";
const PARAKEET_MODEL_REVISION = "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce";
const MIB = 1024 * 1024;
const PARAKEET_FILES = ["config.json", "vocab.txt", "nemo128.onnx", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx"];
const WHISPER_FILES = [
  "added_tokens.json", "config.json", "generation_config.json", "merges.txt", "normalizer.json", "preprocessor_config.json",
  "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
];
const PARAKEET_SHA256 = Object.freeze({
  x64: "1a0d435056272a49fbf41e1f6b62d1e1204c7fa62d1d9d90f6a645e079389d70",
  arm64: "3fae4c85adbbc6cb1ad7f89ab30a0570c3d4804f1b6540f0ac7ce6097a517861",
});
const SILERO_SHA256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";

export const LOCAL_VOICE_MODELS = Object.freeze([
  {
    id: "whisper-tiny-en-q8", label: "Whisper Tiny English", engine: "transformers-whisper", size: "tiny", languages: "English",
    description: "Smallest and fastest option for lightweight English dictation.", approximateBytes: 48 * MIB, minimumFreeBytes: 128 * MIB,
    repository: "onnx-community/whisper-tiny.en", revision: "2575352d61be1bf7225cf8f8b268a4678025fc58", precision: "q8",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-base-q8", label: "Whisper Base", engine: "transformers-whisper", size: "small", languages: "Multilingual",
    description: "Balanced multilingual model for modest CPU and memory budgets.", approximateBytes: 86 * MIB, minimumFreeBytes: 192 * MIB,
    repository: "onnx-community/whisper-base", revision: "1846881b6b3a3024392c1eea3ad983695bc23925", precision: "q8",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-small-q8", label: "Whisper Small", engine: "transformers-whisper", size: "medium", languages: "Multilingual",
    description: "More accurate multilingual Whisper tier with a larger memory footprint.", approximateBytes: 260 * MIB, minimumFreeBytes: 480 * MIB,
    repository: "onnx-community/whisper-small", revision: "36050c46d777d46dc4b5f43f6d90574fc38f8732", precision: "q8",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "parakeet-tdt-0.6b-v3-int8", label: "Parakeet TDT 0.6B v3", engine: "parakeet", size: "large", languages: "English",
    description: "Highest-quality managed English option; optimized ONNX int8 runtime.", approximateBytes: 900 * MIB, minimumFreeBytes: 900 * MIB,
    revision: PARAKEET_MODEL_REVISION, precision: "int8",
    license: { id: "CC-BY-4.0", attribution: "NVIDIA Parakeet TDT 0.6B v3 and the istupakov ONNX conversion" },
  },
]);

const MODEL_BY_ID = new Map(LOCAL_VOICE_MODELS.map((model) => [model.id, model]));

function modelError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requiredModel(modelId) {
  const model = MODEL_BY_ID.get(modelId);
  if (!model) throw modelError("voice_model_invalid", "Choose a supported managed local voice model");
  return model;
}

function shaFromDigest(value) {
  return String(value || "").match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase() || null;
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_192); });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}: ${stderr.trim()}`)));
  });
}

async function extractRuntime(archive, destination) {
  await spawnAndWait("tar", ["-xzf", archive, "-C", destination]);
}

function architecture() {
  if (process.platform !== "linux") throw modelError("voice_model_platform", "Managed local voice models currently support Linux servers only", 409);
  if (process.arch === "x64") return { release: "amd64", runtime: "x64", node: "x64" };
  if (process.arch === "arm64") return { release: "arm64", runtime: "aarch64", node: "arm64" };
  throw modelError("voice_model_platform", `Managed local voice models do not support ${process.arch}`, 409);
}

async function jsonResponse(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw modelError("voice_model_download_failed", `Could not read package metadata (${response.status})`, 502);
  return response.json();
}

async function parakeetManifest(fetchImpl, signal) {
  const arch = architecture();
  const [runtimeRelease, modelMetadata] = await Promise.all([
    jsonResponse(fetchImpl, `https://api.github.com/repos/microsoft/onnxruntime/releases/tags/v${ONNXRUNTIME_VERSION}`, signal),
    jsonResponse(fetchImpl, `https://huggingface.co/api/models/istupakov/parakeet-tdt-0.6b-v3-onnx/revision/${PARAKEET_MODEL_REVISION}?blobs=true`, signal),
  ]);
  const runtimeName = `onnxruntime-linux-${arch.runtime}-${ONNXRUNTIME_VERSION}.tgz`;
  const runtimeAsset = runtimeRelease.assets?.find((asset) => asset.name === runtimeName);
  const runtimeSha = shaFromDigest(runtimeAsset?.digest);
  if (!runtimeAsset?.browser_download_url || !runtimeSha) throw modelError("voice_model_manifest_invalid", `ONNX Runtime ${ONNXRUNTIME_VERSION} does not publish a verifiable ${arch.runtime} package`, 502);
  const siblingByName = new Map((modelMetadata.siblings || []).map((item) => [item.rfilename, item]));
  const models = PARAKEET_FILES.map((name) => {
    const metadata = siblingByName.get(name);
    const sha256 = metadata?.lfs?.sha256 || metadata?.lfs?.oid?.replace(/^sha256:/, "") || null;
    if (name.endsWith(".int8.onnx") && !sha256) throw modelError("voice_model_manifest_invalid", `The pinned model revision does not publish a checksum for ${name}`, 502);
    return { name, relative: `models/${name}`, url: `https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/${PARAKEET_MODEL_REVISION}/${name}`, sha256, gitBlob: metadata?.blobId || null, size: Number(metadata?.lfs?.size || metadata?.size || 0) };
  });
  return {
    version: PARAKEET_VERSION, modelRevision: PARAKEET_MODEL_REVISION, extractRuntime: true,
    artifacts: [
      { name: `parakeet-linux-${arch.release}`, relative: "bin/parakeet", url: `https://github.com/achetronic/parakeet/releases/download/${PARAKEET_VERSION}/parakeet-linux-${arch.release}`, sha256: PARAKEET_SHA256[arch.node], size: 3 * MIB },
      { name: runtimeName, relative: "runtime.tgz", url: runtimeAsset.browser_download_url, sha256: runtimeSha, size: Number(runtimeAsset.size || 0) },
      ...models,
      { name: "silero_vad.onnx", relative: "models/silero_vad.onnx", url: "https://github.com/snakers4/silero-vad/raw/v6.2.1/src/silero_vad/data/silero_vad.onnx", sha256: SILERO_SHA256, size: 2 * MIB },
    ],
  };
}

async function whisperManifest(model, fetchImpl, signal) {
  const metadata = await jsonResponse(fetchImpl, `https://huggingface.co/api/models/${model.repository}/revision/${model.revision}?blobs=true`, signal);
  if (metadata.sha !== model.revision) throw modelError("voice_model_manifest_invalid", `Pinned metadata for ${model.label} did not resolve to the expected revision`, 502);
  const siblingByName = new Map((metadata.siblings || []).map((item) => [item.rfilename, item]));
  const artifacts = WHISPER_FILES.map((name) => {
    const item = siblingByName.get(name);
    if (!item) throw modelError("voice_model_manifest_invalid", `The pinned ${model.label} package is missing ${name}`, 502);
    const sha256 = item.lfs?.sha256 || item.lfs?.oid?.replace(/^sha256:/, "") || null;
    const gitBlob = item.blobId || null;
    if (!sha256 && !gitBlob) throw modelError("voice_model_manifest_invalid", `The pinned ${model.label} package does not publish a checksum for ${name}`, 502);
    return {
      name, relative: name, size: Number(item.lfs?.size || item.size || 0), sha256, gitBlob,
      url: `https://huggingface.co/${model.repository}/resolve/${model.revision}/${name}`,
    };
  });
  return { version: "transformers.js-3.8.1", modelRevision: model.revision, artifacts };
}

async function packageManifest(model, fetchImpl, signal) {
  return model.engine === "parakeet" ? parakeetManifest(fetchImpl, signal) : whisperManifest(model, fetchImpl, signal);
}

async function digestFile(filePath, algorithm = "sha256", size = 0) {
  const hash = crypto.createHash(algorithm);
  if (algorithm === "sha1") hash.update(`blob ${size}\0`);
  const file = await fs.open(filePath, "r");
  try { for await (const chunk of file.createReadStream()) hash.update(chunk); return hash.digest("hex"); }
  finally { await file.close().catch(() => {}); }
}

async function verifiedExisting(artifact, destination) {
  try {
    if (artifact.sha256) return await digestFile(destination) === artifact.sha256;
    if (artifact.gitBlob) return await digestFile(destination, "sha1", artifact.size) === artifact.gitBlob;
    return true;
  } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function download(fetchImpl, artifact, destination, signal, onBytes) {
  if (await verifiedExisting(artifact, destination)) return { resumed: true };
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.part`;
  await fs.rm(temporary, { force: true });
  const response = await fetchImpl(artifact.url, { signal, redirect: "follow" });
  if (!response.ok || !response.body) throw modelError("voice_model_download_failed", `Could not download ${artifact.name} (${response.status})`, 502);
  const sha256 = crypto.createHash("sha256");
  const gitBlob = crypto.createHash("sha1");
  gitBlob.update(`blob ${artifact.size}\0`);
  const counter = new Transform({ transform(chunk, _encoding, callback) { sha256.update(chunk); gitBlob.update(chunk); onBytes(chunk.length); callback(null, chunk); } });
  const file = await fs.open(temporary, "w", 0o600);
  try { await streamPipeline(Readable.fromWeb(response.body), counter, file.createWriteStream()); }
  finally { await file.close().catch(() => {}); }
  const verified = artifact.sha256
    ? sha256.digest("hex") === artifact.sha256
    : !artifact.gitBlob || gitBlob.digest("hex") === artifact.gitBlob;
  if (!verified) {
    await fs.rm(temporary, { force: true });
    throw modelError("voice_model_checksum", `Checksum verification failed for ${artifact.name}`, 502);
  }
  await fs.rename(temporary, destination);
  return { resumed: false };
}

async function defaultTransformersLoader(modelPath) {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("automatic-speech-recognition", modelPath, { dtype: "q8", local_files_only: true });
}

function pcmFloat32(buffer) {
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(index * 2) / 32768;
  return samples;
}

export class VoiceModelManager {
  constructor({ root, fetchImpl = fetch, manifestResolver = packageManifest, runtimeExtractor = extractRuntime, transformersLoader = defaultTransformersLoader } = {}) {
    if (!root) throw new Error("VoiceModelManager requires a root directory");
    this.root = path.resolve(root);
    this.fetchImpl = fetchImpl;
    this.manifestResolver = manifestResolver;
    this.runtimeExtractor = runtimeExtractor;
    this.transformersLoader = transformersLoader;
    this.installController = null;
    this.installPromise = null;
    this.installingModelId = null;
    this.child = null;
    this.port = null;
    this.transcriber = null;
    this.activeModelId = null;
    this.startPromise = null;
    this.startingModelId = null;
    this.transcriptionTail = Promise.resolve();
    this.lastErrors = new Map();
    this.progress = { phase: "idle", current: "", completedBytes: 0, totalBytes: 0 };
  }

  modelRoot(modelId) { return path.join(this.root, modelId); }
  stagingRoot(modelId) { return path.join(this.root, `.installing-${modelId}`); }
  assertModel(modelId) { return requiredModel(modelId); }
  assertInstall({ modelId, licenseAccepted = false } = {}) {
    const model = requiredModel(modelId);
    if (!licenseAccepted) throw modelError("voice_model_license", `Accept ${model.license.id} before installing ${model.label}`);
    if (this.installPromise) throw modelError("voice_model_installing", "A local voice model is already installing", 409);
    return model;
  }

  async installedManifest(modelId) {
    try { return JSON.parse(await fs.readFile(path.join(this.modelRoot(modelId), "manifest.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async publicView() {
    return {
      installingModelId: this.installingModelId,
      progress: this.installPromise ? { ...this.progress } : null,
      activeModelId: this.activeModelId,
      models: await Promise.all(LOCAL_VOICE_MODELS.map(async (model) => {
        const manifest = await this.installedManifest(model.id);
        return {
          ...model,
          repository: undefined,
          revision: model.revision,
          installed: Boolean(manifest),
          running: this.activeModelId === model.id,
          state: this.installingModelId === model.id ? "installing" : this.activeModelId === model.id ? "running" : manifest ? "ready" : this.lastErrors.has(model.id) ? "error" : "not_installed",
          error: this.lastErrors.get(model.id) || null,
        };
      })),
    };
  }

  startInstall({ modelId, licenseAccepted = false } = {}) {
    const model = this.assertInstall({ modelId, licenseAccepted });
    this.lastErrors.delete(model.id);
    this.installingModelId = model.id;
    this.installController = new AbortController();
    this.installPromise = this.install(model, this.installController.signal)
      .catch((error) => { if (error.name !== "AbortError") this.lastErrors.set(model.id, error.message); throw error; })
      .finally(() => {
        this.installController = null; this.installPromise = null; this.installingModelId = null;
        this.progress = { phase: "idle", current: "", completedBytes: 0, totalBytes: 0 };
      });
    this.installPromise.catch(() => {});
    return this.installPromise;
  }

  cancelInstall() {
    if (!this.installController) return false;
    this.installController.abort();
    return true;
  }

  async install(model, signal) {
    architecture();
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const stats = await fs.statfs(this.root);
    if (Number(stats.bavail) * Number(stats.bsize) < model.minimumFreeBytes) throw modelError("voice_model_disk_space", `At least ${Math.ceil(model.minimumFreeBytes / MIB)} MiB of free space is required for ${model.label}`, 409);
    this.progress.phase = "manifest";
    const manifest = await this.manifestResolver(model, this.fetchImpl, signal);
    this.progress.totalBytes = manifest.artifacts.reduce((sum, artifact) => sum + Number(artifact.size || 0), 0);
    const staging = this.stagingRoot(model.id);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    const verified = [];
    for (const artifact of manifest.artifacts) {
      if (signal.aborted) throw new DOMException("Installation cancelled", "AbortError");
      this.progress.phase = "downloading";
      this.progress.current = artifact.name;
      const result = await download(this.fetchImpl, artifact, path.join(staging, artifact.relative), signal, (bytes) => { this.progress.completedBytes += bytes; });
      verified.push({ ...artifact, url: undefined });
      if (result.resumed) this.progress.completedBytes += Number(artifact.size || 0);
    }
    if (manifest.extractRuntime) {
      this.progress.phase = "extracting";
      const archive = path.join(staging, "runtime.tgz");
      await this.runtimeExtractor(archive, staging);
      const runtimeDirectory = path.join(staging, `onnxruntime-linux-${architecture().runtime}-${ONNXRUNTIME_VERSION}`);
      await fs.rm(path.join(staging, "runtime"), { recursive: true, force: true });
      await fs.rename(runtimeDirectory, path.join(staging, "runtime"));
      await fs.rm(archive, { force: true });
      await fs.chmod(path.join(staging, "bin/parakeet"), 0o700);
    }
    const finalManifest = { schemaVersion: 2, modelId: model.id, engine: model.engine, version: manifest.version, modelRevision: manifest.modelRevision, installedAt: new Date().toISOString(), artifacts: verified };
    await fs.writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(finalManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.progress.phase = "activating";
    if (this.activeModelId === model.id) await this.stop();
    await fs.rm(this.modelRoot(model.id), { recursive: true, force: true });
    await fs.rename(staging, this.modelRoot(model.id));
    this.lastErrors.delete(model.id);
  }

  activeRuntime(model) {
    if (this.activeModelId === model.id) {
      if (model.engine === "parakeet" && this.child && this.port) return { kind: "http", origin: `http://127.0.0.1:${this.port}` };
      if (model.engine === "transformers-whisper" && this.transcriber) return { kind: "transcriber" };
    }
    return null;
  }

  async ensureRunning(modelId) {
    const model = requiredModel(modelId);
    let active = this.activeRuntime(model);
    if (active) return active;
    while (this.startPromise) {
      const pending = this.startPromise;
      const pendingModelId = this.startingModelId;
      try { await pending; }
      catch (error) { if (pendingModelId === model.id) throw error; }
      active = this.activeRuntime(model);
      if (active) return active;
    }
    const startPromise = this.startRuntime(model);
    this.startPromise = startPromise;
    this.startingModelId = model.id;
    try { return await startPromise; }
    finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
        this.startingModelId = null;
      }
    }
  }

  async startRuntime(model) {
    if (!await this.installedManifest(model.id)) throw modelError("voice_model_not_installed", `Install ${model.label} from Voice settings first`, 409);
    await this.stopActive();
    if (model.engine === "transformers-whisper") {
      this.transcriber = await this.transformersLoader(this.modelRoot(model.id));
      this.activeModelId = model.id;
      return { kind: "transcriber" };
    }
    const port = await availablePort();
    const modelRoot = this.modelRoot(model.id);
    const binary = path.join(modelRoot, "bin/parakeet");
    const runtimeLibrary = path.join(modelRoot, "runtime/lib/libonnxruntime.so");
    const child = spawn(binary, ["-port", String(port), "-models", path.join(modelRoot, "models"), "-workers", "1", "-ffmpeg=false"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, ONNXRUNTIME_LIB: runtimeLibrary, LD_LIBRARY_PATH: path.dirname(runtimeLibrary) },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_192); });
    child.once("exit", () => { if (this.child === child) { this.child = null; this.port = null; this.activeModelId = null; } });
    this.child = child; this.port = port; this.activeModelId = model.id;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) { this.child = null; this.port = null; this.activeModelId = null; throw modelError("voice_model_start_failed", `Managed Parakeet exited during startup: ${stderr.trim()}`, 502); }
      try {
        const response = await this.fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return { kind: "http", origin: `http://127.0.0.1:${port}` };
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await this.stopActive();
    throw modelError("voice_model_start_timeout", "Managed Parakeet did not become healthy in time", 504);
  }

  async transcribe(modelId, pcm) {
    const model = requiredModel(modelId);
    if (model.engine !== "transformers-whisper") throw modelError("voice_model_engine", `${model.label} does not use the embedded transcription engine`, 409);
    await this.ensureRunning(model.id);
    const transcriber = this.transcriber;
    const task = this.transcriptionTail.then(() => transcriber(pcmFloat32(Buffer.from(pcm)), { chunk_length_s: 30, stride_length_s: 2 }));
    this.transcriptionTail = task.then(() => undefined, () => undefined);
    const output = await task;
    return String(output?.text || "").trim();
  }

  async test(modelId) {
    const model = requiredModel(modelId);
    const resolved = await this.ensureRunning(model.id);
    if (resolved.kind === "http") {
      const response = await this.fetchImpl(`${resolved.origin}/health`, { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) throw modelError("voice_model_unhealthy", `Managed ${model.label} health check failed (${response.status})`, 502);
    }
    return { ok: true, mode: "local", modelId: model.id };
  }

  async stop() {
    const startup = this.startPromise;
    if (startup) await startup.catch(() => {});
    await this.stopActive();
  }

  async stopActive() {
    const child = this.child;
    const transcriber = this.transcriber;
    this.child = null; this.port = null; this.transcriber = null; this.activeModelId = null;
    await this.transcriptionTail.catch(() => {});
    this.transcriptionTail = Promise.resolve();
    if (transcriber?.dispose) await transcriber.dispose().catch(() => {});
    if (!child || child.exitCode != null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }

  async uninstall(modelId) {
    const model = requiredModel(modelId);
    if (this.installingModelId === model.id) throw modelError("voice_model_installing", "Cancel the model installation before uninstalling", 409);
    if (this.activeModelId === model.id || this.startingModelId === model.id) await this.stop();
    const removed = Boolean(await this.installedManifest(model.id));
    await fs.rm(this.modelRoot(model.id), { recursive: true, force: true });
    this.lastErrors.delete(model.id);
    return removed;
  }
}
