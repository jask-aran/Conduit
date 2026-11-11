import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

// Hex (github.com/anomalyco/hex, MIT) is the engine: its own program runs as a child in embedded mode and owns the
// model files, voice-activity filtering and inference. Embedded mode transcribes a whole recording per call; Hex's
// live /streams route needs the desktop app's microphone listener, so dictation here gets its text at stop.
const HEX_MODEL = "parakeet_unified_en";
const SAMPLE_RATE = 16_000;

const model = {
  id: "parakeet-unified-en-q8", modelId: "parakeet-unified-en", artifactId: "parakeet-unified-en-q8-gguf",
  label: "Parakeet Unified English", engine: "hex", size: "0.6b", languages: "English",
  description: "English model for local dictation, run by Hex on the hub. Text appears when you stop.", approximateBytes: 731357568, minimumFreeBytes: 1024 * 1024 * 1024,
  precision: "q8", format: "gguf", execution: "stop",
  license: { id: "CC-BY-4.0", attribution: "NVIDIA Parakeet, run by Hex (MIT)" },
};

const hexError = (code, message, status = 502) => Object.assign(new Error(message), { code, status });

export const hexBinary = () => process.env.CONDUIT_HEX_BIN || path.join(os.homedir(), ".local", "bin", "hex");

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
export function createHexService({ command = [hexBinary(), "service", "--embedded"], fetchImpl = fetch } = {}) {
  let child = null;
  let starting = null;
  let stopped = false;
  let tail = Promise.resolve();

  const start = () => new Promise((resolve, reject) => {
    if (!existsSync(command[0])) {
      reject(hexError("voice_hex_missing", `Hex is not installed on the hub: no program at ${command[0]}`, 409));
      return;
    }
    const spawned = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "ignore"] });
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

  const request = async (method, route, body, headers = {}) => {
    const hex = await running();
    let response;
    try { response = await fetchImpl(hex.url + route, { method, body, headers: { Authorization: `Bearer ${hex.token}`, ...headers } }); }
    catch (error) { throw hexError("voice_hex_unreachable", `Hex did not answer: ${error.message}`); }
    const text = await response.text();
    if (!response.ok) {
      let code = "";
      try { code = JSON.parse(text).code || ""; } catch {}
      throw hexError("voice_hex_refused", `Hex refused ${route.split("?")[0]} (${response.status}${code ? ` ${code}` : ""})`);
    }
    return text;
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

  const service = {
    get pid() { return child?.pid ?? null; },
    async health() { return JSON.parse(await withRestart(() => request("GET", "/health"))); },
    // Hex downloads, verifies and loads the model; the answer is server-sent progress that ends in ok or error.
    async prepare() {
      const events = await withRestart(() => request("POST", `/models/${HEX_MODEL}/prepare?language=en`));
      const last = events.trim().split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5))).at(-1);
      if (last?.type !== "ok") throw hexError("voice_hex_model", `Hex could not prepare ${HEX_MODEL}: ${last?.message || last?.code || "no answer"}`);
    },
    // Hex runs one inference at a time, so calls wait in line here instead of being refused there.
    transcribe(pcm16) {
      const task = tail.then(async () => {
        const body = wav(pcm16);
        const send = () => request("POST", `/transcriptions?model=${HEX_MODEL}&language=en`, body, { "Content-Type": "audio/wav" });
        return String(JSON.parse(await withRestart(send)).transcript || "").trim();
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
  return service;
}

const backend = {
  id: "hex",
  label: "Hex",
  models: [model],
  // Install is Hex's own prepare: it fetches and verifies the model into its data folder.
  async prepare(_definition, { onProgress } = {}) {
    onProgress?.("runtime");
    const service = createHexService();
    try { await service.prepare(); }
    finally { await service.stop(); }
  },
  async createSession() {
    const service = createHexService();
    try {
      const { version } = await service.health();
      await service.prepare();
      return {
        kind: "transcriber", adapter: "hex_batch_v1", backend: "hex", computeBackend: "hex",
        capabilities: { language: "en", inferenceMode: "batch", partials: false, externalVad: false, precision: model.precision,
          memory: { modelBytes: model.approximateBytes } },
        native: { package: "hex", version },
        async transcribe(pcm16) { return { text: await service.transcribe(pcm16) }; },
        dispose: () => service.stop(),
      };
    } catch (error) {
      await service.stop();
      throw error;
    }
  },
};

export default backend;
