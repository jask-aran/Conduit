import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import backend, { HEX_VERSION, hexHome } from "./voice-backends/hex.js";
import { LOCAL_VOICE_MODELS, VOICE_EXECUTION_CATALOG, publicVoiceExecutionCatalog } from "./voice-execution-catalog.js";

const MIB = 1024 * 1024;
export { LOCAL_VOICE_MODELS };

const MODEL_BY_ID = new Map(LOCAL_VOICE_MODELS.map((model) => [model.id, model]));

function modelError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requiredModel(modelId) {
  const model = MODEL_BY_ID.get(modelId);
  if (!model) throw modelError("voice_model_invalid", "Choose a supported managed local voice model");
  return model;
}

const DEFAULT_VOICE_MODEL_IDLE_TTL_MS = 5 * 60 * 1000;

export class VoiceModelManager {
  constructor({ root, catalog = VOICE_EXECUTION_CATALOG, runtimeLoader = null, idleTtlMs = DEFAULT_VOICE_MODEL_IDLE_TTL_MS } = {}) {
    if (!root) throw new Error("VoiceModelManager requires a root directory");
    this.root = path.resolve(root);
    // Hex's program and data folder sit beside the models folder.
    this.home = path.dirname(this.root);
    this.catalog = catalog;
    this.runtimeLoader = runtimeLoader;
    this.idleTtlMs = Number.isFinite(Number(idleTtlMs)) ? Math.max(0, Number(idleTtlMs)) : DEFAULT_VOICE_MODEL_IDLE_TTL_MS;
    this.idleTimer = null;
    this.pinCount = 0;
    this.installController = null;
    this.installPromise = null;
    this.installingModelId = null;
    this.transcriber = null;
    this.activeModelId = null;
    this.startPromise = null;
    this.startingModelId = null;
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
    const [artifactStatuses, models] = await Promise.all([
      this.artifactStatuses(manifestFor),
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
      artifactStatuses,
      engine: { label: backend.label, version: HEX_VERSION, installed: existsSync(hexHome(this.home).binary) },
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
    // Hex fetches and verifies the model into its own data folder; the manifest here only records that it did.
    await backend.install(model, this.home, { signal, onProgress: (progress) => { this.progress = { ...this.progress, current: model.label, ...progress }; } });
    const staging = this.stagingRoot(model.id);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    const finalManifest = { schemaVersion: 3, modelId: model.id, engine: model.engine, installedAt: new Date().toISOString() };
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

  activeRuntime(model) {
    if (!model || this.activeModelId !== model.id || !this.transcriber) return null;
    return this.runtimeDescriptor(this.transcriber, model);
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
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
        this.startingModelId = null;
        // Armed once the start is over: armed while it stands, the timer declines, and a model loaded by an unpinned
        // use (the settings test, a dictation that ended while it loaded) stays resident.
        this.armIdleTimer();
      }
    }
  }

  async startRuntime(model) {
    if (!await this.installedManifest(model.id)) throw modelError("voice_model_not_installed", `Install ${model.label} from Voice settings first`, 409);
    await this.stopActive();
    const runtime = this.runtimeLoader ? await this.runtimeLoader(model) : await backend.createSession(model, this.home);
    this.transcriber = runtime;
    this.activeModelId = model.id;
    return this.runtimeDescriptor(runtime, model);
  }

  async transcribe(modelId, pcm, options = {}) {
    const model = requiredModel(modelId);
    await this.ensureRunning(model.id);
    const transcriber = this.transcriber;
    const task = this.transcriptionTail.then(() => transcriber.transcribe(Buffer.from(pcm), { signal: options.signal }));
    this.transcriptionTail = task.then(() => undefined, () => undefined);
    const output = await task;
    return String(output?.text || "").trim();
  }

  async test(modelId) {
    const model = requiredModel(modelId);
    await this.ensureRunning(model.id);
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
    this.activeModelId = null;
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
    await backend.uninstall(model, this.home);
    await fs.rm(this.modelRoot(model.id), { recursive: true, force: true });
    await fs.rm(this.stagingRoot(model.id), { recursive: true, force: true });
    this.lastErrors.delete(model.id);
    this.lastErrorCodes.delete(model.id);
    return removed;
  }

  async artifactStatuses(manifestFor = (modelId) => this.installedManifest(modelId)) {
    return Promise.all(this.catalog.artifacts.map(async (artifact) => {
      const modelId = artifact.legacyModelId;
      const manifest = await manifestFor(modelId);
      const active = this.activeModelId === modelId;
      const runtime = this.activeRuntime(LOCAL_VOICE_MODELS.find((model) => model.id === modelId));
      const runtimeState = this.startPromise && this.startingModelId === modelId
        ? "loading"
        : this.lastErrors.has(modelId)
          ? "failed"
          : active
            ? "warm"
            : "cold";
      return {
        artifactId: artifact.id,
        installable: true,
        operational: Boolean(manifest && active && runtime),
        blockedReason: null,
        artifactState: this.installingModelId === modelId ? "installing" : manifest ? "installed" : this.lastErrors.has(modelId) ? "failed" : "absent",
        runtimeState,
        requestedComputeBackend: null,
        actualComputeBackend: runtime?.computeBackend || null,
        loadedRuntimeVersion: active ? runtime?.native?.version || runtime?.runtimeVersion || null : null,
        lastErrorCode: this.lastErrorCodes.get(modelId) || null,
      };
    }));
  }
}
