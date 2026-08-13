import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const PARAKEET_VERSION = "v0.8.0";
const ONNXRUNTIME_VERSION = "1.25.1";
const MODEL_REVISION = "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce";
const MIN_FREE_BYTES = 900 * 1024 * 1024;
const MODEL_FILES = [
  "config.json",
  "vocab.txt",
  "nemo128.onnx",
  "encoder-model.int8.onnx",
  "decoder_joint-model.int8.onnx",
];
const PARAKEET_SHA256 = Object.freeze({
  x64: "1a0d435056272a49fbf41e1f6b62d1e1204c7fa62d1d9d90f6a645e079389d70",
  arm64: "3fae4c85adbbc6cb1ad7f89ab30a0570c3d4804f1b6540f0ac7ce6097a517861",
});
const SILERO_SHA256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";

function modelError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function shaFromDigest(value) {
  const match = String(value || "").match(/^sha256:([a-f0-9]{64})$/i);
  return match?.[1]?.toLowerCase() || null;
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
  if (process.platform !== "linux") throw modelError("voice_model_platform", "Managed Parakeet currently supports Linux servers only", 409);
  if (process.arch === "x64") return { release: "amd64", runtime: "x64", node: "x64" };
  if (process.arch === "arm64") return { release: "arm64", runtime: "aarch64", node: "arm64" };
  throw modelError("voice_model_platform", `Managed Parakeet does not support ${process.arch}`, 409);
}

async function jsonResponse(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw modelError("voice_model_download_failed", `Could not read package metadata (${response.status})`, 502);
  return response.json();
}

async function packageManifest(fetchImpl, signal) {
  const arch = architecture();
  const [runtimeRelease, modelMetadata] = await Promise.all([
    jsonResponse(fetchImpl, `https://api.github.com/repos/microsoft/onnxruntime/releases/tags/v${ONNXRUNTIME_VERSION}`, signal),
    jsonResponse(fetchImpl, `https://huggingface.co/api/models/istupakov/parakeet-tdt-0.6b-v3-onnx/revision/${MODEL_REVISION}?blobs=true`, signal),
  ]);
  const runtimeName = `onnxruntime-linux-${arch.runtime}-${ONNXRUNTIME_VERSION}.tgz`;
  const runtimeAsset = runtimeRelease.assets?.find((asset) => asset.name === runtimeName);
  const runtimeSha = shaFromDigest(runtimeAsset?.digest);
  if (!runtimeAsset?.browser_download_url || !runtimeSha) {
    throw modelError("voice_model_manifest_invalid", `ONNX Runtime ${ONNXRUNTIME_VERSION} does not publish a verifiable ${arch.runtime} package`, 502);
  }
  const siblingByName = new Map((modelMetadata.siblings || []).map((item) => [item.rfilename, item]));
  const models = MODEL_FILES.map((name) => {
    const metadata = siblingByName.get(name);
    const sha256 = metadata?.lfs?.sha256 || metadata?.lfs?.oid?.replace(/^sha256:/, "") || null;
    if (name.endsWith(".int8.onnx") && !sha256) {
      throw modelError("voice_model_manifest_invalid", `The pinned model revision does not publish a checksum for ${name}`, 502);
    }
    return {
      name,
      relative: `models/${name}`,
      url: `https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/${MODEL_REVISION}/${name}`,
      sha256,
      size: Number(metadata?.lfs?.size || metadata?.size || 0),
    };
  });
  return {
    version: PARAKEET_VERSION,
    modelRevision: MODEL_REVISION,
    artifacts: [
      {
        name: `parakeet-linux-${arch.release}`,
        relative: "bin/parakeet",
        url: `https://github.com/achetronic/parakeet/releases/download/${PARAKEET_VERSION}/parakeet-linux-${arch.release}`,
        sha256: PARAKEET_SHA256[arch.node],
        size: 3 * 1024 * 1024,
      },
      {
        name: runtimeName,
        relative: "runtime.tgz",
        url: runtimeAsset.browser_download_url,
        sha256: runtimeSha,
        size: Number(runtimeAsset.size || 0),
      },
      ...models,
      {
        name: "silero_vad.onnx",
        relative: "models/silero_vad.onnx",
        url: "https://github.com/snakers4/silero-vad/raw/v6.2.1/src/silero_vad/data/silero_vad.onnx",
        sha256: SILERO_SHA256,
        size: 2 * 1024 * 1024,
      },
    ],
  };
}

async function digestFile(filePath) {
  const hash = crypto.createHash("sha256");
  const file = await fs.open(filePath, "r");
  try {
    for await (const chunk of file.createReadStream()) hash.update(chunk);
    return hash.digest("hex");
  } finally { await file.close().catch(() => {}); }
}

async function download(fetchImpl, artifact, destination, signal, onBytes) {
  try {
    if (artifact.sha256 && await digestFile(destination) === artifact.sha256) return { sha256: artifact.sha256, resumed: true };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.part`;
  await fs.rm(temporary, { force: true });
  const response = await fetchImpl(artifact.url, { signal, redirect: "follow" });
  if (!response.ok || !response.body) throw modelError("voice_model_download_failed", `Could not download ${artifact.name} (${response.status})`, 502);
  const hash = crypto.createHash("sha256");
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      onBytes(chunk.length);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), counter, (await fs.open(temporary, "w", 0o600)).createWriteStream());
  const sha256 = hash.digest("hex");
  if (artifact.sha256 && sha256 !== artifact.sha256) {
    await fs.rm(temporary, { force: true });
    throw modelError("voice_model_checksum", `Checksum verification failed for ${artifact.name}`, 502);
  }
  await fs.rename(temporary, destination);
  return { sha256, resumed: false };
}

export class VoiceModelManager {
  constructor({ root, fetchImpl = fetch, manifestResolver = packageManifest, runtimeExtractor = extractRuntime } = {}) {
    if (!root) throw new Error("VoiceModelManager requires a root directory");
    this.root = path.resolve(root);
    this.staging = path.join(path.dirname(this.root), ".voice-model-installing");
    this.fetchImpl = fetchImpl;
    this.manifestResolver = manifestResolver;
    this.runtimeExtractor = runtimeExtractor;
    this.installController = null;
    this.installPromise = null;
    this.child = null;
    this.port = null;
    this.lastError = "";
    this.progress = { phase: "idle", current: "", completedBytes: 0, totalBytes: 0 };
  }

  async installedManifest() {
    try { return JSON.parse(await fs.readFile(path.join(this.root, "manifest.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async publicView() {
    const manifest = await this.installedManifest();
    return {
      state: this.installPromise ? "installing" : this.child ? "running" : manifest ? "ready" : this.lastError ? "error" : "not_installed",
      installed: Boolean(manifest),
      running: Boolean(this.child),
      version: manifest?.version || PARAKEET_VERSION,
      modelRevision: manifest?.modelRevision || MODEL_REVISION,
      precision: "int8",
      approximateBytes: MIN_FREE_BYTES,
      license: { id: "CC-BY-4.0", attribution: "NVIDIA Parakeet TDT 0.6B v3 and the istupakov ONNX conversion" },
      progress: this.installPromise ? { ...this.progress } : null,
      error: this.lastError || null,
    };
  }

  startInstall({ licenseAccepted = false } = {}) {
    if (!licenseAccepted) throw modelError("voice_model_license", "Accept the model's CC BY 4.0 terms before installing");
    if (this.installPromise) throw modelError("voice_model_installing", "The local voice model is already installing", 409);
    this.lastError = "";
    this.installController = new AbortController();
    this.installPromise = this.install(this.installController.signal)
      .catch((error) => {
        if (error.name !== "AbortError") this.lastError = error.message;
        throw error;
      })
      .finally(() => { this.installController = null; this.installPromise = null; this.progress = { phase: "idle", current: "", completedBytes: 0, totalBytes: 0 }; });
    this.installPromise.catch(() => {});
    return this.installPromise;
  }

  cancelInstall() {
    if (!this.installController) return false;
    this.installController.abort();
    return true;
  }

  async install(signal) {
    await fs.mkdir(path.dirname(this.root), { recursive: true, mode: 0o700 });
    const stats = await fs.statfs(path.dirname(this.root));
    if (Number(stats.bavail) * Number(stats.bsize) < MIN_FREE_BYTES) {
      throw modelError("voice_model_disk_space", "At least 900 MiB of free space is required for managed Parakeet", 409);
    }
    this.progress.phase = "manifest";
    const manifest = await this.manifestResolver(this.fetchImpl, signal);
    this.progress.totalBytes = manifest.artifacts.reduce((sum, artifact) => sum + Number(artifact.size || 0), 0);
    await fs.mkdir(this.staging, { recursive: true, mode: 0o700 });
    const verified = [];
    for (const artifact of manifest.artifacts) {
      if (signal.aborted) throw new DOMException("Installation cancelled", "AbortError");
      this.progress.phase = "downloading";
      this.progress.current = artifact.name;
      const result = await download(this.fetchImpl, artifact, path.join(this.staging, artifact.relative), signal, (bytes) => { this.progress.completedBytes += bytes; });
      verified.push({ ...artifact, sha256: result.sha256, url: undefined });
      if (result.resumed) this.progress.completedBytes += Number(artifact.size || 0);
    }
    this.progress.phase = "extracting";
    const runtimeArchive = path.join(this.staging, "runtime.tgz");
    await this.runtimeExtractor(runtimeArchive, this.staging);
    const runtimeDirectory = path.join(this.staging, `onnxruntime-linux-${architecture().runtime}-${ONNXRUNTIME_VERSION}`);
    await fs.rm(path.join(this.staging, "runtime"), { recursive: true, force: true });
    await fs.rename(runtimeDirectory, path.join(this.staging, "runtime"));
    await fs.rm(runtimeArchive, { force: true });
    await fs.chmod(path.join(this.staging, "bin/parakeet"), 0o700);
    const finalManifest = {
      schemaVersion: 1,
      version: manifest.version,
      modelRevision: manifest.modelRevision,
      installedAt: new Date().toISOString(),
      artifacts: verified,
    };
    await fs.writeFile(path.join(this.staging, "manifest.json"), `${JSON.stringify(finalManifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.progress.phase = "activating";
    await this.stop();
    await fs.rm(this.root, { recursive: true, force: true });
    await fs.rename(this.staging, this.root);
    this.lastError = "";
  }

  async ensureRunning() {
    if (this.child && this.port) return `http://127.0.0.1:${this.port}`;
    if (!await this.installedManifest()) throw modelError("voice_model_not_installed", "Install the managed Parakeet model from Voice settings first", 409);
    const port = await availablePort();
    const binary = path.join(this.root, "bin/parakeet");
    const runtimeLibrary = path.join(this.root, "runtime/lib/libonnxruntime.so");
    const child = spawn(binary, ["-port", String(port), "-models", path.join(this.root, "models"), "-workers", "1", "-ffmpeg=false"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        ONNXRUNTIME_LIB: runtimeLibrary,
        LD_LIBRARY_PATH: path.dirname(runtimeLibrary),
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_192); });
    child.once("exit", () => {
      if (this.child === child) { this.child = null; this.port = null; }
    });
    this.child = child;
    this.port = port;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) {
        this.child = null;
        this.port = null;
        throw modelError("voice_model_start_failed", `Managed Parakeet exited during startup: ${stderr.trim()}`, 502);
      }
      try {
        const response = await this.fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return `http://127.0.0.1:${port}`;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await this.stop();
    throw modelError("voice_model_start_timeout", "Managed Parakeet did not become healthy in time", 504);
  }

  async test() {
    const origin = await this.ensureRunning();
    const response = await this.fetchImpl(`${origin}/health`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw modelError("voice_model_unhealthy", `Managed Parakeet health check failed (${response.status})`, 502);
    return { ok: true, mode: "local", endpoint: origin };
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || child.exitCode != null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }

  async uninstall() {
    if (this.installPromise) throw modelError("voice_model_installing", "Cancel the model installation before uninstalling", 409);
    await this.stop();
    const removed = Boolean(await this.installedManifest());
    await fs.rm(this.root, { recursive: true, force: true });
    this.lastError = "";
    return removed;
  }
}
