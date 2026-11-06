import { localVoiceBackend } from "./voice-backends/index.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { LEGACY_LOCAL_VOICE_MODELS, VOICE_EXECUTION_CATALOG, publicVoiceExecutionCatalog } from "./voice-execution-catalog.js";

const MIB = 1024 * 1024;
export const LOCAL_VOICE_MODELS = LEGACY_LOCAL_VOICE_MODELS;

const MODEL_BY_ID = new Map(LOCAL_VOICE_MODELS.map((model) => [model.id, model]));

function modelError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requiredModel(modelId) {
  const model = MODEL_BY_ID.get(modelId);
  if (!model) throw modelError("voice_model_invalid", "Choose a supported managed local voice model");
  return model;
}

function packageManifest(model) { return localVoiceBackend(model.runtimeId).manifest(model); }

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

function pcmFloat32(buffer) {
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(index * 2) / 32768;
  return samples;
}

export const DEFAULT_VOICE_MODEL_IDLE_TTL_MS = 5 * 60 * 1000;

export class VoiceModelManager {
  constructor({ root, catalog = VOICE_EXECUTION_CATALOG, fetchImpl = fetch, manifestResolver = packageManifest, runtimeLoader = null, downloadRetries = DOWNLOAD_RETRIES, downloadRetryBaseMs = DOWNLOAD_RETRY_BASE_MS, downloadConcurrency = 3, idleTtlMs = DEFAULT_VOICE_MODEL_IDLE_TTL_MS } = {}) {
    if (!root) throw new Error("VoiceModelManager requires a root directory");
    this.root = path.resolve(root);
    this.catalog = catalog;
    this.fetchImpl = fetchImpl;
    this.manifestResolver = manifestResolver;
    this.runtimeLoader = runtimeLoader;
    this.downloadRetries = downloadRetries;
    this.downloadRetryBaseMs = downloadRetryBaseMs;
    this.downloadConcurrency = downloadConcurrency;
    this.idleTtlMs = Number.isFinite(Number(idleTtlMs)) ? Math.max(0, Number(idleTtlMs)) : DEFAULT_VOICE_MODEL_IDLE_TTL_MS;
    this.idleTimer = null;
    this.pinCount = 0;
    this.installController = null;
    this.installPromise = null;
    this.installingModelId = null;
    this.transcriber = null;
    this.activeModelId = null;
    this.activeRuntimeId = null;
    this.startPromise = null;
    this.startingModelId = null;
    this.startingRuntimeId = null;
    this.transcriptionTail = Promise.resolve();
    this.lastErrors = new Map();
    this.lastErrorCodes = new Map();
    this.progress = { phase: "idle", current: "", completedBytes: 0, totalBytes: 0 };

  }

  clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  armIdleTimer() {
    this.clearIdleTimer();
    if (this.idleTtlMs <= 0 || this.pinCount > 0 || this.startPromise) return;
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
    const manifests = new Map();
    const manifestFor = (modelId) => {
      if (!manifests.has(modelId)) manifests.set(modelId, this.installedManifest(modelId));
      return manifests.get(modelId);
    };
    const [backendPaths, models] = await Promise.all([
      this.backendPathStatuses(manifestFor),
      Promise.all(LOCAL_VOICE_MODELS.map(async (model) => {
        const [manifest, staged] = await Promise.all([manifestFor(model.id), this.hasStaging(model.id)]);
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
    ]);
    return {
      catalogue: publicVoiceExecutionCatalog(this.catalog),
      backendPaths,
      installingModelId: this.installingModelId,
      progress: this.installPromise ? { ...this.progress } : null,
      activeModelId: this.activeModelId,
      models,
    };
  }

  startInstall({ modelId, licenseAccepted = false } = {}) {
    const model = this.assertInstall({ modelId, licenseAccepted });
    this.lastErrors.delete(model.id);
    this.lastErrorCodes.delete(model.id);
    this.installingModelId = model.id;
    this.installController = new AbortController();
    this.installPromise = this.install(model, this.installController.signal)
      .catch((error) => {
        if (error.name !== "AbortError") {
          this.lastErrors.set(model.id, error.message);
          this.lastErrorCodes.set(model.id, error.code || "voice_model_install_failed");
        }
        throw error;
      })
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
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const stats = await fs.statfs(this.root);
    if (Number(stats.bavail) * Number(stats.bsize) < model.minimumFreeBytes) throw modelError("voice_model_disk_space", `At least ${Math.ceil(model.minimumFreeBytes / MIB)} MiB of free space is required for ${model.label}`, 409);
    await localVoiceBackend(model.runtimeId).prepare(model, { onProgress: (phase) => { this.progress.phase = phase; } });
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
    const finalManifest = {
      schemaVersion: 2,
      modelId: model.id,
      engine: model.engine,
      version: manifest.version,
      modelRevision: manifest.modelRevision,
      sourceRevision: manifest.sourceRevision || null,
      runtime: manifest.runtime || null,
      installedAt: new Date().toISOString(),
      artifacts: verified,
    };
    await fs.writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(finalManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.progress.phase = "activating";
    // Only the running copy goes. stop() is the whole manager's shutdown, and it
    // waits for the install in progress, which is this one.
    if (this.activeModelId === model.id || this.startingModelId === model.id) {
      const startup = this.startPromise;
      if (startup) await startup.catch(() => {});
      await this.stopActive();
    }
    await fs.rm(this.modelRoot(model.id), { recursive: true, force: true });
    await fs.rename(staging, this.modelRoot(model.id));
    this.lastErrors.delete(model.id);
  }

  defaultRuntimeId(model) { return model.runtimeId; }

  activeRuntime(model, runtimeId = this.activeRuntimeId || this.defaultRuntimeId(model)) {
    if (!model || this.activeModelId !== model.id || this.activeRuntimeId !== runtimeId || !this.transcriber) return null;
    return this.runtimeDescriptor(this.transcriber, model);
  }

  async ensureRunning(modelId, { runtimeId = null } = {}) {
    const model = requiredModel(modelId);
    const selectedRuntimeId = runtimeId || this.defaultRuntimeId(model);
    let active = this.activeRuntime(model, selectedRuntimeId);
    if (active) {
      this.armIdleTimer();
      return active;
    }
    while (this.startPromise) {
      const pending = this.startPromise;
      const pendingModelId = this.startingModelId;
      const pendingRuntimeId = this.startingRuntimeId;
      try { await pending; }
      catch (error) { if (pendingModelId === model.id && pendingRuntimeId === selectedRuntimeId) throw error; }
      active = this.activeRuntime(model, selectedRuntimeId);
      if (active) {
        this.armIdleTimer();
        return active;
      }
    }
    const startPromise = this.startRuntime(model, selectedRuntimeId);
    this.startPromise = startPromise;
    this.startingModelId = model.id;
    this.startingRuntimeId = selectedRuntimeId;
    try {
      const runtime = await startPromise;
      this.armIdleTimer();
      return runtime;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
        this.startingModelId = null;
        this.startingRuntimeId = null;
      }
    }
  }

  async startRuntime(model, runtimeId = this.defaultRuntimeId(model)) {
    if (runtimeId !== model.runtimeId) throw modelError("voice_model_engine", "The model does not support this runtime", 409);
    if (!await this.installedManifest(model.id)) throw modelError("voice_model_not_installed", `Install ${model.label} from Voice settings first`, 409);
    await this.stopActive();
    const backend = localVoiceBackend(runtimeId);
    const modelPath = path.join(this.modelRoot(model.id), model.modelFile);
    const runtime = this.runtimeLoader
      ? await this.runtimeLoader(modelPath, model)
      : await backend.createSession(model, { modelPath });
    this.transcriber = runtime;
    this.activeModelId = model.id;
    this.activeRuntimeId = runtimeId;
    return this.runtimeDescriptor(runtime, model);
  }

  async transcribe(modelId, pcm, options = {}) {
    const model = requiredModel(modelId);
    await this.ensureRunning(model.id, { runtimeId: options.runtimeId || model.runtimeId });
    const transcriber = this.transcriber;
    const task = this.transcriptionTail.then(() => transcriber.transcribe(pcmFloat32(Buffer.from(pcm)), { signal: options.signal }));
    this.transcriptionTail = task.then(() => undefined, () => undefined);
    const output = await task;
    return String(output?.text || "").trim();
  }

  async stream(modelId, options = {}) {
    const model = requiredModel(modelId);
    await this.ensureRunning(model.id, { runtimeId: model.runtimeId });
    if (typeof this.transcriber?.stream !== "function") throw modelError("voice_model_streaming", `${model.label} does not support stateful streaming`, 409);
    return this.transcriber.stream(options);
  }

  async test(modelId, { runtimeId = null } = {}) {
    const model = requiredModel(modelId);
    await this.ensureRunning(model.id, { runtimeId: runtimeId || model.runtimeId });
    return { ok: true, mode: "local", modelId: model.id };
  }

  runtimeDescriptor(runtime, model) {
    return {
      kind: "transcriber",
      adapter: runtime.adapter,
      backend: runtime.backend,
      computeBackend: runtime.computeBackend || runtime.backend || null,
      capabilities: runtime.capabilities || {
        language: model.languages === "English" ? "en" : null,
        inferenceMode: "batch",
        partials: false,
        externalVad: false,
        precision: model.precision || null,
        memory: { modelBytes: model.approximateBytes || null },
      },
      native: runtime.native || null,
    };
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
  }

  async stopActive() {
    this.clearIdleTimer();
    const transcriber = this.transcriber;
    this.transcriber = null;
    this.activeModelId = null; this.activeRuntimeId = null;
    await this.transcriptionTail.catch(() => {});
    this.transcriptionTail = Promise.resolve();
    if (typeof transcriber?.dispose === "function") await Promise.resolve().then(() => transcriber.dispose()).catch(() => {});
  }

  async uninstall(modelId) {
    const model = requiredModel(modelId);
    if (this.installingModelId === model.id) throw modelError("voice_model_installing", "Cancel the model installation before uninstalling", 409);
    if (this.activeModelId === model.id || this.startingModelId === model.id) {
      const startup = this.startPromise;
      if (startup) await startup.catch(() => {});
      await this.stopActive();
    }
    const removed = Boolean(await this.installedManifest(model.id));
    await fs.rm(this.modelRoot(model.id), { recursive: true, force: true });
    await fs.rm(this.stagingRoot(model.id), { recursive: true, force: true });
    this.lastErrors.delete(model.id);
    this.lastErrorCodes.delete(model.id);
    return removed;
  }

  async backendPathStatuses(manifestFor = (modelId) => this.installedManifest(modelId)) {
    return Promise.all(this.catalog.backendPaths.map(async (backendPath) => {
      const artifact = this.catalog.artifacts.find((candidate) => candidate.id === backendPath.artifactId);
      const modelId = artifact?.legacyModelId;
      const manifest = modelId ? await manifestFor(modelId) : null;
      const active = Boolean(modelId && this.activeModelId === modelId && this.activeRuntimeId === backendPath.runtimeId);
      const runtime = modelId ? this.activeRuntime(LOCAL_VOICE_MODELS.find((model) => model.id === modelId), backendPath.runtimeId) : null;
      const runtimeDefinition = this.catalog.runtimes.find((candidate) => candidate.id === backendPath.runtimeId);
      const runtimeState = (this.startingModelId === modelId && this.startingRuntimeId === backendPath.runtimeId)
        || (this.startPromise && this.startingModelId === modelId && this.startingRuntimeId === backendPath.runtimeId)
        ? "loading"
        : this.lastErrors.has(modelId)
          ? "failed"
          : active
            ? "warm"
            : "cold";
      const requestedComputeBackend = runtimeDefinition?.requestedComputeBackend || null;
      return {
        backendPathId: backendPath.id,
        installable: Boolean(artifact),
        operational: Boolean(manifest && active && runtime),
        blockedReason: null,
        artifactState: this.installingModelId === modelId ? "installing" : manifest ? "installed" : this.lastErrors.has(modelId) ? "failed" : "absent",
        runtimeState,
        requestedComputeBackend,
        actualComputeBackend: runtime?.computeBackend || null,
        loadedRuntimeVersion: active ? runtime?.native?.version || runtime?.runtimeVersion || runtimeDefinition?.version || null : null,
        lastErrorCode: this.lastErrorCodes.get(modelId) || null,
      };
    }));
  }
}
