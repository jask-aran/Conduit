import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

// Hex (github.com/anomalyco/hex, MIT) is the engine: its own program runs as a child in embedded mode and owns the
// model files, voice-activity filtering and inference. Embedded mode transcribes a whole recording per call; Hex's
// live /streams route needs the desktop app's microphone listener, so dictation here gets its text at stop.
const SAMPLE_RATE = 16_000;

// The release Hex publishes, pinned by GitHub's own digest of each file.
export const HEX_VERSION = "3.3.0";
const RELEASES = {
  "linux-x64": { size: 72583368, sha256: "e8c7b3a2ebeb1d7da5d6276d5f25145891d52178e3636347cb3ac331f7662622" },
  "linux-arm64": { size: 63788856, sha256: "a8a28cb8bc922f8e11fd5996e090d88aa143a2c3a65b07f1962435d0b15a24d1" },
};
const TARGET = `${process.platform}-${process.arch}`;

const GIB = 1024 * 1024 * 1024;
const definition = (modelId, hexId, file, label, description, approximateBytes, languages, language, license) => ({
  id: `${modelId}-q8`, modelId, artifactId: `${modelId}-q8-gguf`, hexId, file, label, description, approximateBytes, languages, language, license,
  engine: "hex", minimumFreeBytes: approximateBytes + GIB / 4, precision: "q8", format: "gguf", execution: "stop",
});

// Hex's catalogue ids and the file each becomes in its models folder. The first is the default. Chosen by running
// Hex's models on a six-core CPU hub: the rest were slower without reading better,
// or are streaming models, whose live text embedded mode cannot give.
const MODELS = [
  definition("parakeet-tdt-v2", "parakeet_v2", "parakeet-tdt-0.6b-v2-Q8_0.gguf", "Parakeet v2", "English, punctuated, with false starts left out. About 1 s after you stop. Holds 1.2 GB of memory.", 729574912, "English", "en",
    { id: "CC-BY-4.0", attribution: "nvidia/parakeet-tdt-0.6b-v2" }),
  definition("sense-voice-small", "sense_voice_small", "SenseVoiceSmall-Q8_0.gguf", "SenseVoice Small", "The light one: a third of the download and memory (0.4 GB). Chinese, Cantonese, English, Japanese and Korean, detected. Misses more unusual words.", 252684608, "5 languages", "auto",
    { id: "FunASR model", attribution: "FunAudioLLM/SenseVoiceSmall, FunASR Model License" }),
  definition("whisper-large-v3-turbo", "whisper_large_v3_turbo", "whisper-large-v3-turbo-Q8_0.gguf", "Whisper large-v3-turbo", "Any language, detected. Slow without a GPU: about 8 s after you stop, on every core.", 886381824, "Any language", "auto",
    { id: "MIT", attribution: "openai/whisper-large-v3-turbo" }),
];

export const hexError = (code, message, status = 502) => Object.assign(new Error(message), { code, status });

/** Where the hub keeps Hex: its program and its data folder, both under the hub's voice folder. */
export function hexHome(home) {
  return {
    binary: process.env.CONDUIT_HEX_BIN || path.join(home, `hex-${HEX_VERSION}-${TARGET}`),
    data: path.join(home, "hex"),
  };
}

/** Downloads the pinned Hex program when the hub has none. `onBytes(done, total)` reports the download. */
export async function ensureHex(home, { signal, onBytes, fetchImpl = fetch } = {}) {
  const { binary } = hexHome(home);
  if (existsSync(binary)) return binary;
  const release = RELEASES[TARGET];
  if (!release) throw hexError("voice_hex_unsupported", `Hex has no build for this hub (${TARGET}). Local transcription needs Linux on x64 or arm64.`, 409);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const response = await fetchImpl(`https://github.com/anomalyco/hex/releases/download/v${HEX_VERSION}/hex-${HEX_VERSION}-${TARGET}`, { signal, redirect: "follow" });
  if (!response.ok || !response.body) throw hexError("voice_hex_download", `Could not download Hex ${HEX_VERSION} (${response.status})`);
  const partial = `${binary}.part`;
  const hash = crypto.createHash("sha256");
  let done = 0;
  const file = await fs.open(partial, "w", 0o700);
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      hash.update(chunk);
      await file.write(chunk);
      done += chunk.length;
      onBytes?.(done, release.size);
    }
  } finally { await file.close(); }
  if (hash.digest("hex") !== release.sha256) {
    await fs.rm(partial, { force: true });
    throw hexError("voice_hex_checksum", `Hex ${HEX_VERSION} did not match its published checksum`);
  }
  await fs.rename(partial, binary);
  return binary;
}

function wav(pcm16) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

// One Hex child. A child that died is started again by the next call.
export function createHexService(home, { fetchImpl = fetch } = {}) {
  const { binary, data } = hexHome(home);
  let child = null;
  let starting = null;
  let stopped = false;
  let tail = Promise.resolve();

  const start = () => new Promise((resolve, reject) => {
    if (!existsSync(binary)) {
      reject(hexError("voice_hex_missing", "Hex is not installed on the hub. Install a model in Settings › Voice to download it.", 409));
      return;
    }
    // Its own data folder, so the hub's models and logs stay apart from a desktop Hex on the same account.
    const spawned = spawn(binary, ["service", "--embedded"], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, HEX_APPLICATION_SUPPORT_DIR: data } });
    const timer = setTimeout(() => { spawned.kill(); reject(hexError("voice_hex_start", "Hex did not start in time")); }, 15_000);
    const lines = createInterface({ input: spawned.stdout });
    spawned.once("error", (error) => { clearTimeout(timer); reject(hexError("voice_hex_start", `Hex could not start: ${error.message}`)); });
    spawned.once("exit", (code) => {
      clearTimeout(timer);
      if (child?.process === spawned) child = null;
      reject(hexError("voice_hex_start", `Hex exited before it was ready (${code})`));
    });
    lines.once("line", (line) => {
      clearTimeout(timer);
      lines.close();
      spawned.stdout.resume();
      try {
        const { url, token, pid } = JSON.parse(line);
        child = { process: spawned, url, token, pid };
        resolve(child);
      } catch { spawned.kill(); reject(hexError("voice_hex_start", "Hex did not report its address")); }
    });
  });

  const running = async () => {
    if (stopped) throw hexError("voice_hex_stopped", "Hex was stopped", 409);
    if (child) return child;
    starting ||= start().finally(() => { starting = null; });
    return starting;
  };

  const open = async (method, route, body, headers = {}) => {
    const hex = await running();
    let response;
    try { response = await fetchImpl(hex.url + route, { method, body, headers: { Authorization: `Bearer ${hex.token}`, ...headers } }); }
    catch (error) { throw hexError("voice_hex_unreachable", `Hex did not answer: ${error.message}`); }
    if (response.ok) return response;
    let code = "";
    try { code = JSON.parse(await response.text()).code || ""; } catch {}
    throw hexError("voice_hex_refused", `Hex refused ${route.split("?")[0]} (${response.status}${code ? ` ${code}` : ""})`);
  };

  // A request that found the child dead is sent once more, to the new child.
  const withRestart = async (call) => {
    try { return await call(); }
    catch (error) {
      if (error.code !== "voice_hex_unreachable" || stopped) throw error;
      child?.process.kill();
      child = null;
      return call();
    }
  };

  return {
    get pid() { return child?.pid ?? null; },
    async health() { return (await withRestart(() => open("GET", "/health"))).json(); },
    // Hex downloads, verifies and loads the model, reporting each step as a server-sent event that ends in ok or error.
    async prepare(hexId, onProgress) {
      const response = await withRestart(() => open("POST", `/models/${hexId}/prepare`));
      let last = null;
      for await (const line of createInterface({ input: Readable.fromWeb(response.body) })) {
        if (!line.startsWith("data:")) continue;
        last = JSON.parse(line.slice(5));
        onProgress?.(last);
      }
      if (last?.type !== "ok") throw hexError("voice_hex_model", `Hex could not prepare ${hexId}: ${last?.message || last?.code || "it stopped"}`);
    },
    // Hex runs one inference at a time, so calls wait in line here instead of being refused there.
    transcribe(hexId, language, pcm16) {
      const task = tail.then(async () => {
        const body = wav(pcm16);
        const send = () => open("POST", `/transcriptions?model=${hexId}&language=${language}`, body, { "Content-Type": "audio/wav" });
        return String((await (await withRestart(send)).json()).transcript || "").trim();
      });
      tail = task.then(() => undefined, () => undefined);
      return task;
    },
    async stop() {
      stopped = true;
      const hex = child || await starting?.catch(() => null);
      child = null;
      if (!hex) return;
      // Closing stdin is Hex's shutdown request; it exits by itself within five seconds.
      await new Promise((resolve) => {
        const timer = setTimeout(() => { hex.process.kill("SIGKILL"); resolve(); }, 6_000);
        hex.process.once("exit", () => { clearTimeout(timer); resolve(); });
        hex.process.stdin.end();
      });
    },
  };
}

const backend = {
  id: "hex",
  label: "Hex",
  models: MODELS,
  /**
   * Install: the Hex program if the hub has none, then Hex's own prepare, which fetches and verifies the model into
   * its data folder.
   */
  async install(model, home, { signal, onProgress } = {}) {
    await ensureHex(home, { signal, onBytes: (completedBytes, totalBytes) => onProgress?.({ phase: "runtime", completedBytes, totalBytes }) });
    const service = createHexService(home);
    const cancel = () => void service.stop();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await service.prepare(model.hexId, (event) => onProgress?.(event.type === "downloading"
        ? { phase: "downloading", completedBytes: event.downloadedBytes, totalBytes: event.totalBytes }
        : { phase: event.type }));
    } catch (error) {
      // Cancelling stops Hex, which ends its answer; the partial file stays and the next install resumes it.
      throw signal?.aborted ? new DOMException("Installation cancelled", "AbortError") : error;
    } finally {
      signal?.removeEventListener("abort", cancel);
      await service.stop();
    }
  },
  // The voice-activity model stays: every model uses it.
  async uninstall(model, home) {
    for (const file of [model.file, `${model.file}.verified.json`, `${model.file}.partial`]) await fs.rm(path.join(hexHome(home).data, "models", file), { force: true });
  },
  async createSession(model, home) {
    // After a change of HEX_VERSION the installed models are still there and only the program is missing.
    await ensureHex(home);
    const service = createHexService(home);
    try {
      const { version } = await service.health();
      await service.prepare(model.hexId);
      return {
        kind: "transcriber", adapter: "hex_batch_v1", backend: "hex", computeBackend: "hex",
        capabilities: { language: model.language, inferenceMode: "batch", partials: false, externalVad: false, precision: model.precision,
          memory: { modelBytes: model.approximateBytes } },
        native: { package: "hex", version },
        async transcribe(pcm16) { return { text: await service.transcribe(model.hexId, model.language, pcm16) }; },
        dispose: () => service.stop(),
      };
    } catch (error) {
      await service.stop();
      throw error;
    }
  },
};

export default backend;
