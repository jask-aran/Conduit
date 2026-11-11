import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

// Hex (github.com/anomalyco/hex, MIT) is the engine: its own program runs as a child in embedded mode and owns the
// model files, voice-activity filtering and inference. Embedded mode transcribes whole clips only (its live /streams
// route needs the desktop app's microphone listener), so a live stream here is a pause-bounded window that is
// transcribed again as it grows.
const HEX_MODEL = "parakeet_unified_en";
const SAMPLE_RATE = 16_000;
const FRAME = 320; // 20 ms
const SILENCE_RMS = 0.008; // -42 dBFS, as dictation's own silence split
const PAUSE_FRAMES = 35; // 0.7 s of quiet ends a window
const MAX_WINDOW_FRAMES = 550; // 11 s: on a CPU Hex takes about 0.6 s for every 12 s it is given
const LEAD_FRAMES = 15; // quiet kept ahead of speech
const PARTIAL_STEP_SAMPLES = 4_000;
const MIN_SPEECH_FRAMES = 15; // Hex reads nothing from less, and each reading costs its full time

const model = {
  id: "parakeet-unified-en-q8", modelId: "parakeet-unified-en", artifactId: "parakeet-unified-en-q8-gguf",
  label: "Parakeet Unified English", engine: "hex", size: "0.6b", languages: "English",
  description: "English model for local dictation, run by Hex on the hub.", approximateBytes: 731357568, minimumFreeBytes: 1024 * 1024 * 1024,
  precision: "q8", format: "gguf", execution: "live",
  license: { id: "CC-BY-4.0", attribution: "NVIDIA Parakeet, run by Hex (MIT)" },
};

const hexError = (code, message, status = 502) => Object.assign(new Error(message), { code, status });

export const hexBinary = () => process.env.CONDUIT_HEX_BIN || path.join(os.homedir(), ".local", "bin", "hex");

function floatWav(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
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
    transcribe(samples) {
      const task = tail.then(async () => {
        const wav = floatWav(samples);
        const send = () => request("POST", `/transcriptions?model=${HEX_MODEL}&language=en`, wav, { "Content-Type": "audio/wav" });
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

const join = (left, right) => [left, right].filter(Boolean).join(" ");

// The stream shape dictation drives: feed() takes samples and returns at once, text holds the committed windows and
// the open window's latest reading, finalize() commits what is left.
export function createHexStream(transcribe) {
  let samples = new Float32Array(0);
  let quiet = []; // one flag per whole frame of `samples`
  let framed = 0;
  let committed = "";
  let tentative = "";
  let committedSamples = 0;
  let generation = 0;
  let partialAt = 0;
  let reading = false;
  let revision = 0;
  let closed = false;
  let failure = null;
  let commits = Promise.resolve();

  const speechFrames = () => quiet.reduce((count, flag) => count + (flag ? 0 : 1), 0);
  const trailingQuiet = () => { let count = 0; while (count < quiet.length && quiet[quiet.length - 1 - count]) count += 1; return count; };
  const drop = (frames) => {
    samples = samples.slice(frames * FRAME);
    quiet = quiet.slice(frames);
    framed -= frames * FRAME;
    committedSamples += frames * FRAME;
    generation += 1;
    partialAt = 0;
  };
  const commit = (frames) => {
    const piece = samples.slice(0, frames * FRAME);
    drop(frames);
    commits = commits.then(async () => {
      if (closed) return;
      try { committed = join(committed, await transcribe(piece)); tentative = ""; revision += 1; }
      catch (error) { failure ||= error; }
    });
  };
  const frame = () => {
    while (framed + FRAME <= samples.length) {
      let sum = 0;
      for (let index = framed; index < framed + FRAME; index += 1) sum += samples[index] * samples[index];
      quiet.push(Math.sqrt(sum / FRAME) < SILENCE_RMS);
      framed += FRAME;
    }
  };
  const cut = () => {
    const speech = speechFrames();
    if (!speech) {
      if (quiet.length > LEAD_FRAMES) drop(quiet.length - LEAD_FRAMES);
      return;
    }
    if (trailingQuiet() >= PAUSE_FRAMES) commit(quiet.length - LEAD_FRAMES);
    else if (quiet.length >= MAX_WINDOW_FRAMES) {
      // No pause came: cut at the last quiet frame of the final five seconds, else at the end.
      const last = quiet.lastIndexOf(true);
      commit(last > quiet.length - 250 ? last + 1 : quiet.length);
    }
  };
  const read = () => {
    if (reading || closed || samples.length - partialAt < PARTIAL_STEP_SAMPLES || speechFrames() < MIN_SPEECH_FRAMES) return;
    reading = true;
    partialAt = samples.length;
    const at = generation;
    const piece = samples.slice();
    void commits.then(() => at === generation && !closed ? transcribe(piece) : null).then((text) => {
      if (text !== null && at === generation && !closed) { tentative = text; revision += 1; }
    }, () => {}).finally(() => { reading = false; });
  };
  const update = () => ({ revision, audioCommittedMs: committedSamples / (SAMPLE_RATE / 1_000), bufferedMs: samples.length / (SAMPLE_RATE / 1_000) });

  return {
    get text() { return { committed, tentative, full: join(committed, tentative) }; },
    async feed(chunk) {
      if (failure) throw failure;
      const next = new Float32Array(samples.length + chunk.length);
      next.set(samples);
      next.set(chunk, samples.length);
      samples = next;
      frame();
      cut();
      read();
      return update();
    },
    async finalize() {
      frame();
      if (speechFrames()) commit(Math.ceil(samples.length / FRAME));
      generation += 1;
      await commits;
      tentative = "";
      if (failure) throw failure;
      return update();
    },
    reset() { closed = true; },
  };
}

const backend = {
  id: "hex",
  label: "Hex",
  runtime: { adapterKind: "hex_embedded", version: null, requestedComputeBackend: "auto" },
  models: [model],
  // Hex filters silence and cuts long audio itself, so a recording goes to it whole.
  wholeClips: true,
  manifest() {
    return { version: "hex", modelRevision: HEX_MODEL, runtime: null, artifacts: [] };
  },
  streamOptions() { return {}; },
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
        kind: "transcriber", adapter: "transcribe_cpp_stream_v1", backend: "hex", computeBackend: "hex",
        capabilities: { language: "en", inferenceMode: "streaming", partials: true, externalVad: false, precision: model.precision,
          memory: { modelBytes: model.approximateBytes }, streaming: { family: "hex_window", commitPolicy: "pause" } },
        native: { package: "hex", version },
        async transcribe(samples) { return { text: await service.transcribe(samples) }; },
        stream: () => createHexStream((samples) => service.transcribe(samples)),
        dispose: () => service.stop(),
      };
    } catch (error) {
      await service.stop();
      throw error;
    }
  },
};

export default backend;
