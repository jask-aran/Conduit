import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { getVoiceModelManifest, ONNXRUNTIME_VERSION } from "./voice-model-manifests.js";
import { SileroVad, VoiceVadObservationQueue } from "./voice-vad.js";

const MIB = 1024 * 1024;
export const LOCAL_VOICE_MODELS = Object.freeze([
  {
    id: "whisper-tiny-en-q8", label: "Whisper Tiny English", engine: "transformers-whisper", size: "tiny", languages: "English",
    description: "Smallest and fastest option for lightweight English dictation.", approximateBytes: 48 * MIB, minimumFreeBytes: 128 * MIB,
    repository: "onnx-community/whisper-tiny.en", revision: "2575352d61be1bf7225cf8f8b268a4678025fc58", precision: "q8",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-tiny-en-fp32", label: "Whisper Tiny English (fp32)", engine: "transformers-whisper", size: "tiny", languages: "English",
    description: "Full-precision Tiny tier for CPU-light accuracy comparisons.", approximateBytes: 155 * MIB, minimumFreeBytes: 256 * MIB,
    repository: "onnx-community/whisper-tiny.en", revision: "2575352d61be1bf7225cf8f8b268a4678025fc58", precision: "fp32",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-base-q8", label: "Whisper Base", engine: "transformers-whisper", size: "small", languages: "Multilingual",
    description: "Balanced multilingual model for modest CPU and memory budgets.", approximateBytes: 86 * MIB, minimumFreeBytes: 192 * MIB,
    repository: "onnx-community/whisper-base", revision: "1846881b6b3a3024392c1eea3ad983695bc23925", precision: "q8",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-base-fp32", label: "Whisper Base (fp32)", engine: "transformers-whisper", size: "small", languages: "Multilingual",
    description: "Full-precision Base tier for multilingual accuracy comparisons.", approximateBytes: 288 * MIB, minimumFreeBytes: 512 * MIB,
    repository: "onnx-community/whisper-base", revision: "1846881b6b3a3024392c1eea3ad983695bc23925", precision: "fp32",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-small-q8", label: "Whisper Small", engine: "transformers-whisper", size: "medium", languages: "Multilingual",
    description: "More accurate multilingual Whisper tier with a larger memory footprint.", approximateBytes: 260 * MIB, minimumFreeBytes: 480 * MIB,
    repository: "onnx-community/whisper-small", revision: "36050c46d777d46dc4b5f43f6d90574fc38f8732", precision: "q8",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-small-fp32", label: "Whisper Small (fp32)", engine: "transformers-whisper", size: "medium", languages: "Multilingual",
    description: "Full-precision Whisper Small tier for maximum embedded accuracy.", approximateBytes: 936 * MIB, minimumFreeBytes: 1536 * MIB,
    repository: "onnx-community/whisper-small", revision: "36050c46d777d46dc4b5f43f6d90574fc38f8732", precision: "fp32",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "whisper-large-v3-turbo-q8", label: "Whisper Large v3 Turbo", engine: "transformers-whisper", size: "large", languages: "Multilingual",
    description: "The most accurate embedded Whisper tier with fast turbo decoding for live dictation.", approximateBytes: 1040 * MIB, minimumFreeBytes: 1536 * MIB,
    repository: "onnx-community/whisper-large-v3-turbo", revision: "360ebcde2559d60bb474678be3c1de9ef347d01a", precision: "q8",
    license: { id: "MIT", attribution: "OpenAI Whisper and the ONNX Community conversion" },
  },
  {
    id: "parakeet-tdt-0.6b-v2-int8", label: "Parakeet TDT 0.6B v2", engine: "parakeet", size: "large", languages: "English",
    description: "English-only Parakeet; slightly more accurate than v3 on English, same CPU int8 runtime.", approximateBytes: 650 * MIB, minimumFreeBytes: 900 * MIB,
    repository: "istupakov/parakeet-tdt-0.6b-v2-onnx", revision: "0bbb45a3365852604aef28b538a8f066f4ccaa85", precision: "int8",
    license: { id: "CC-BY-4.0", attribution: "NVIDIA Parakeet TDT 0.6B v2 and the istupakov ONNX conversion" },
  },
  {
    id: "parakeet-tdt-0.6b-v2-fp32", label: "Parakeet TDT 0.6B v2 (fp32)", engine: "parakeet", size: "large", languages: "English",
    description: "English-only full-precision Parakeet for accuracy comparisons.", approximateBytes: 2440 * MIB, minimumFreeBytes: 3584 * MIB,
    repository: "istupakov/parakeet-tdt-0.6b-v2-onnx", revision: "0bbb45a3365852604aef28b538a8f066f4ccaa85", precision: "fp32",
    license: { id: "CC-BY-4.0", attribution: "NVIDIA Parakeet TDT 0.6B v2 and the istupakov ONNX conversion" },
  },
  {
    id: "parakeet-tdt-0.6b-v3-int8", label: "Parakeet TDT 0.6B v3", engine: "parakeet", size: "large", languages: "25 European",
    description: "Multilingual Parakeet covering English plus 24 other European languages; optimized ONNX int8 runtime.", approximateBytes: 900 * MIB, minimumFreeBytes: 900 * MIB,
    repository: "istupakov/parakeet-tdt-0.6b-v3-onnx", revision: "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce", precision: "int8",
    license: { id: "CC-BY-4.0", attribution: "NVIDIA Parakeet TDT 0.6B v3 and the istupakov ONNX conversion" },
  },
  {
    id: "parakeet-tdt-0.6b-v3-fp32", label: "Parakeet TDT 0.6B v3 (fp32)", engine: "parakeet", size: "large", languages: "25 European",
    description: "Full-precision multilingual Parakeet for accuracy comparisons.", approximateBytes: 2480 * MIB, minimumFreeBytes: 3584 * MIB,
    repository: "istupakov/parakeet-tdt-0.6b-v3-onnx", revision: "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce", precision: "fp32",
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

export async function extractRuntime(archive, destination) {
  await spawnAndWait("tar", ["--no-same-owner", "--no-same-permissions", "-xzf", archive, "-C", destination]);
}

function architecture() {
  if (process.platform !== "linux") throw modelError("voice_model_platform", "Managed local voice models currently support Linux servers only", 409);
  if (process.arch === "x64") return { release: "amd64", runtime: "x64", node: "x64" };
  if (process.arch === "arm64") return { release: "arm64", runtime: "aarch64", node: "arm64" };
  throw modelError("voice_model_platform", `Managed local voice models do not support ${process.arch}`, 409);
}

function packageManifest(model) { return getVoiceModelManifest(model, architecture()); }

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

const DOWNLOAD_RETRIES = 3;
const DOWNLOAD_RETRY_BASE_MS = 1_000;

async function hashFile(filePath, hash) {
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally { await handle.close(); }
}

async function downloadAttempt(fetchImpl, artifact, temporary, signal, onBytes) {
  let partialBytes = 0;
  try { partialBytes = (await fs.stat(temporary)).size; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (partialBytes > 0) {
    const sha256 = crypto.createHash("sha256");
    await hashFile(temporary, sha256);
    if (artifact.sha256 && sha256.digest("hex") === artifact.sha256) return { resumed: true };
    if (!artifact.sha256) {
      const gitBlob = crypto.createHash("sha1");
      gitBlob.update(`blob ${artifact.size}\0`);
      await hashFile(temporary, gitBlob);
      if (partialBytes === Number(artifact.size) && gitBlob.digest("hex") === artifact.gitBlob) return { resumed: true };
    }
  }
  if (partialBytes > 0 && partialBytes >= Number(artifact.size)) {
    await fs.rm(temporary, { force: true });
    partialBytes = 0;
  }
  const sha256 = artifact.sha256 ? crypto.createHash("sha256") : null;
  const gitBlob = artifact.sha256 ? null : crypto.createHash("sha1");
  if (gitBlob) gitBlob.update(`blob ${artifact.size}\0`);
  if (partialBytes > 0) {
    await hashFile(temporary, sha256);
    if (gitBlob) await hashFile(temporary, gitBlob);
  }
  const headers = partialBytes > 0 ? { Range: `bytes=${partialBytes}-` } : undefined;
  const response = await fetchImpl(artifact.url, { signal, redirect: "follow", headers });
  if (!response.ok || !response.body) {
    const error = modelError("voice_model_download_failed", `Could not download ${artifact.name} (${response.status})`, 502);
    error.status = response.status;
    throw error;
  }
  if (response.status !== 206 && partialBytes > 0) {
    partialBytes = 0;
    await fs.rm(temporary, { force: true });
  }
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      if (sha256) sha256.update(chunk);
      if (gitBlob) gitBlob.update(chunk);
      onBytes(chunk.length);
      callback(null, chunk);
    },
  });
  const file = await fs.open(temporary, partialBytes > 0 ? "a" : "w", 0o600);
  try { await streamPipeline(Readable.fromWeb(response.body), counter, file.createWriteStream()); }
  finally { await file.close().catch(() => {}); }
  const verified = artifact.sha256
    ? sha256.digest("hex") === artifact.sha256
    : gitBlob.digest("hex") === artifact.gitBlob;
  if (!verified) {
    await fs.rm(temporary, { force: true });
    throw modelError("voice_model_checksum", `Checksum verification failed for ${artifact.name}`, 502);
  }
  return { resumed: partialBytes > 0 };
}

async function download(fetchImpl, artifact, destination, signal, onBytes, { retries = DOWNLOAD_RETRIES, retryBaseMs = DOWNLOAD_RETRY_BASE_MS } = {}) {
  if (await verifiedExisting(artifact, destination)) return { resumed: true };
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.part`;
  let attempt = 0;
  while (true) {
    try {
      const result = await downloadAttempt(fetchImpl, artifact, temporary, signal, onBytes);
      await fs.rename(temporary, destination);
      return result;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.status === 403 || error?.status === 404) throw error;
      if (error?.code === "voice_model_checksum" || error?.status === 416) await fs.rm(temporary, { force: true }).catch(() => {});
      attempt += 1;
      if (attempt >= retries) throw error;
      if (signal?.aborted) throw new DOMException("Installation cancelled", "AbortError");
      await new Promise((resolve) => setTimeout(resolve, retryBaseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)));
    }
  }
}

async function defaultTransformersLoader(modelPath, precision = "q8") {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("automatic-speech-recognition", modelPath, { dtype: precision === "fp32" ? "fp32" : "q8", local_files_only: true });
}

function pcmFloat32(buffer) {
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(index * 2) / 32768;
  return samples;
}

export const DEFAULT_VOICE_MODEL_IDLE_TTL_MS = 5 * 60 * 1000;

export class VoiceModelManager {
  constructor({ root, fetchImpl = fetch, manifestResolver = packageManifest, runtimeExtractor = extractRuntime, transformersLoader = defaultTransformersLoader, downloadRetries = DOWNLOAD_RETRIES, downloadRetryBaseMs = DOWNLOAD_RETRY_BASE_MS, downloadConcurrency = 3, idleTtlMs = DEFAULT_VOICE_MODEL_IDLE_TTL_MS, vad = null, vadModelPath = null, vadSessionFactory = undefined } = {}) {
    if (!root) throw new Error("VoiceModelManager requires a root directory");
    this.root = path.resolve(root);
    this.fetchImpl = fetchImpl;
    this.manifestResolver = manifestResolver;
    this.runtimeExtractor = runtimeExtractor;
    this.transformersLoader = transformersLoader;
    this.downloadRetries = downloadRetries;
    this.downloadRetryBaseMs = downloadRetryBaseMs;
    this.downloadConcurrency = downloadConcurrency;
    this.idleTtlMs = Number.isFinite(Number(idleTtlMs)) ? Math.max(0, Number(idleTtlMs)) : DEFAULT_VOICE_MODEL_IDLE_TTL_MS;
    this.idleTimer = null;
    this.pinCount = 0;
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
    this.vad = vad || new SileroVad({ root: this.root, modelPath: vadModelPath, sessionFactory: vadSessionFactory });
    this.vadQueue = new VoiceVadObservationQueue({ observer: (pcm, options) => this.vad.observe(pcm, options) });
  }

  clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  armIdleTimer() {
    this.clearIdleTimer();
    if (this.idleTtlMs <= 0 || this.pinCount > 0 || this.startPromise) return;
    if (!this.activeModelId && !this.child && !this.transcriber) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pinCount > 0 || this.startPromise) return;
      void this.stopActive().catch(() => {});
    }, this.idleTtlMs);
    this.idleTimer.unref?.();
  }

  pin() {
    this.pinCount += 1;
    this.clearIdleTimer();
  }

  unpin() {
    this.pinCount = Math.max(0, this.pinCount - 1);
    if (this.pinCount === 0) this.armIdleTimer();
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

  async hasStaging(modelId) {
    try { return (await fs.stat(this.stagingRoot(modelId))).isDirectory(); }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }

  async publicView() {
    return {
      installingModelId: this.installingModelId,
      progress: this.installPromise ? { ...this.progress } : null,
      activeModelId: this.activeModelId,
      models: await Promise.all(LOCAL_VOICE_MODELS.map(async (model) => {
        const [manifest, staged] = await Promise.all([this.installedManifest(model.id), this.hasStaging(model.id)]);
        return {
          ...model,
          repository: undefined,
          revision: model.revision,
          installed: Boolean(manifest),
          staged,
          running: this.activeModelId === model.id,
          state: this.installingModelId === model.id ? "installing" : this.activeModelId === model.id ? "running" : manifest ? "ready" : this.lastErrors.has(model.id) ? "error" : staged ? "interrupted" : "not_installed",
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
    const verified = new Array(manifest.artifacts.length);
    let nextArtifact = 0;
    const workers = Array.from({ length: Math.min(this.downloadConcurrency, manifest.artifacts.length) }, async () => {
      while (true) {
        if (signal.aborted) throw new DOMException("Installation cancelled", "AbortError");
        const index = nextArtifact;
        nextArtifact += 1;
        if (index >= manifest.artifacts.length) return;
        const artifact = manifest.artifacts[index];
        this.progress.phase = "downloading";
        this.progress.current = artifact.name;
        const result = await download(this.fetchImpl, artifact, path.join(staging, artifact.relative), signal, (bytes) => { this.progress.completedBytes += bytes; }, { retries: this.downloadRetries, retryBaseMs: this.downloadRetryBaseMs });
        verified[index] = { ...artifact, url: undefined };
        if (result.resumed) this.progress.completedBytes += Number(artifact.size || 0);
      }
    });
    await Promise.all(workers);
    if (manifest.extractRuntime) {
      this.progress.phase = "extracting";
      const archive = path.join(staging, "runtime.tgz");
      const runtimeDirectory = path.join(staging, `onnxruntime-linux-${architecture().runtime}-${ONNXRUNTIME_VERSION}`);
      await fs.rm(runtimeDirectory, { recursive: true, force: true });
      await this.runtimeExtractor(archive, staging);
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
    if (active) {
      this.armIdleTimer();
      return active;
    }
    while (this.startPromise) {
      const pending = this.startPromise;
      const pendingModelId = this.startingModelId;
      try { await pending; }
      catch (error) { if (pendingModelId === model.id) throw error; }
      active = this.activeRuntime(model);
      if (active) {
        this.armIdleTimer();
        return active;
      }
    }
    const startPromise = this.startRuntime(model);
    this.startPromise = startPromise;
    this.startingModelId = model.id;
    try {
      const runtime = await startPromise;
      this.armIdleTimer();
      return runtime;
    } finally {
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
      this.transcriber = await this.transformersLoader(this.modelRoot(model.id), model.precision || "q8");
      this.activeModelId = model.id;
      return { kind: "transcriber" };
    }
    const port = await availablePort();
    const modelRoot = this.modelRoot(model.id);
    const binary = path.join(modelRoot, "bin/parakeet");
    const runtimeLibrary = path.join(modelRoot, "runtime/lib/libonnxruntime.so");
    const child = spawn(binary, ["-long-audio", "-port", String(port), "-models", path.join(modelRoot, "models"), "-workers", "1", "-ffmpeg=false"], {
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

  async observeVoiceActivity(pcm) {
    return this.vadQueue.enqueue(pcm);
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
    const installation = this.installPromise;
    if (installation) {
      this.cancelInstall();
      await installation.catch(() => {});
    }
    const startup = this.startPromise;
    if (startup) await startup.catch(() => {});
    await this.stopActive();
    this.vadQueue.stop();
    await this.vad?.stop?.();
  }

  async stopActive() {
    this.clearIdleTimer();
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
    await fs.rm(this.stagingRoot(model.id), { recursive: true, force: true });
    this.lastErrors.delete(model.id);
    return removed;
  }
}
