#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { WebSocket } from "ws";

const HELP = [
  "Usage: node scripts/run-live-harness.mjs [options]",
  "",
  "Run one explicitly requested live transport measurement through the ordinary",
  "authenticated HTTP and WebSocket interfaces.",
  "",
  "Required:",
  "  --origin <url>                    Local, VPS-origin, or VPS-edge URL",
  "  --chat-id <id>                    Dedicated performance chat id",
  "  CONDUIT_PERF_PASSWORD             Conduit password",
  "  CONDUIT_PERF_PROMPT               Prompt text",
  "",
  "Options:",
  "  --target <name>                   Target label (default: custom)",
  "  --timeout-ms <number>             Maximum generation duration (default: 60000)",
  "  --max-chars <number>              Maximum streamed characters (default: 200000)",
  "  --prompt-file <path>              Read prompt from an ignored local file",
  "  --dry-run                         Validate configuration without network or cost",
  "  --help                            Show this help",
  "",
].join("\n");

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CHARS = 200_000;

function valueAfter(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(flag + " requires a value");
  return value;
}

function numberAfter(args, flag, fallback, { min, max }) {
  const value = Number(valueAfter(args, flag, fallback));
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(flag + " must be a number between " + min + " and " + max);
  }
  return Math.trunc(value);
}

function cleanOrigin(value) {
  const origin = new URL(value);
  if (!["http:", "https:"].includes(origin.protocol)) throw new Error("--origin must use http or https");
  origin.hash = "";
  origin.search = "";
  origin.pathname = origin.pathname.replace(/\/$/, "");
  return origin;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
  };
}

function parseCookie(response) {
  const cookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  const cookie = cookies.find((value) => value.startsWith("conduit_session="));
  if (!cookie) throw new Error("Login succeeded without a conduit_session cookie");
  return cookie.split(";", 1)[0];
}

async function readPrompt(args) {
  const promptFile = valueAfter(args, "--prompt-file");
  if (promptFile) return (await fs.readFile(promptFile, "utf8")).trim();
  return String(process.env.CONDUIT_PERF_PROMPT || "").trim();
}

function parseConfiguration(args, dryRun) {
  const originValue = valueAfter(args, "--origin", process.env.CONDUIT_PERF_ORIGIN);
  if (!originValue) throw new Error("--origin or CONDUIT_PERF_ORIGIN is required");
  const origin = cleanOrigin(originValue);
  const chatId = valueAfter(args, "--chat-id", process.env.CONDUIT_PERF_CHAT_ID);
  if (!chatId && !dryRun) throw new Error("--chat-id or CONDUIT_PERF_CHAT_ID is required");
  if (!dryRun && !process.env.CONDUIT_PERF_PASSWORD) throw new Error("CONDUIT_PERF_PASSWORD is required");
  return {
    origin,
    target: valueAfter(args, "--target", "custom"),
    chatId,
    timeoutMs: numberAfter(args, "--timeout-ms", DEFAULT_TIMEOUT_MS, { min: 5_000, max: 120_000 }),
    maxChars: numberAfter(args, "--max-chars", DEFAULT_MAX_CHARS, { min: 1_000, max: 2_000_000 }),
  };
}

async function jsonRequest(origin, route, options = {}) {
  const response = await fetch(new URL(route, origin), {
    ...options,
    headers: { accept: "application/json", "content-type": "application/json", ...options.headers },
  });
  let body = null;
  try { body = await response.json(); } catch { /* status-only diagnostics */ }
  return { response, body };
}

function latestAssistantText(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const assistant = [...messages].reverse().find((message) => message?.role === "assistant");
  if (!assistant) return "";
  if (typeof assistant.content === "string") return assistant.content;
  if (!Array.isArray(assistant.content)) return "";
  return assistant.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

async function runLiveMeasurement(configuration, prompt) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const health = await jsonRequest(configuration.origin, "/healthz");
  if (!health.response.ok || health.body?.status !== "ready") {
    throw new Error("Target health check failed with HTTP " + health.response.status);
  }
  const release = String(health.body.release || "");
  if (!/^[0-9a-f]{40}$/i.test(release)) {
    throw new Error("Target health response did not identify an immutable release");
  }

  const login = await jsonRequest(configuration.origin, "/v0/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: process.env.CONDUIT_PERF_PASSWORD }),
  });
  if (!login.response.ok) throw new Error("Target login failed with HTTP " + login.response.status);
  const cookie = parseCookie(login.response);
  const chatResult = await jsonRequest(configuration.origin, "/v0/chats/" + encodeURIComponent(configuration.chatId), {
    headers: { cookie },
  });
  if (!chatResult.response.ok) throw new Error("Performance chat lookup failed with HTTP " + chatResult.response.status);
  const chat = chatResult.body;
  const models = await jsonRequest(configuration.origin, "/v0/chats/" + encodeURIComponent(configuration.chatId) + "/models", {
    headers: { cookie },
  });
  if (!models.response.ok) throw new Error("Performance model lookup failed with HTTP " + models.response.status);
  const liveResult = await jsonRequest(configuration.origin, "/v0/live-sessions", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ chatId: configuration.chatId, projectId: chat.projectId }),
  });
  if (!liveResult.response.ok) throw new Error("Live session launch failed with HTTP " + liveResult.response.status);
  const live = liveResult.body;
  const streamUrl = new URL(live.streamUrl, configuration.origin);
  streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(streamUrl, { headers: { Cookie: cookie } });
  const frames = [];
  const deltas = [];
  let generationId = null;
  let firstDeltaAt = null;
  let completionAt = null;
  let streamedText = "";
  let settled = false;
  let resolveSettled;
  let rejectSettled;
  const settledPromise = new Promise((resolve, reject) => {
    resolveSettled = resolve;
    rejectSettled = reject;
  });
  const timeout = setTimeout(() => rejectSettled(new Error("Generation exceeded " + configuration.timeoutMs + " ms")), configuration.timeoutMs);
  socket.on("error", (error) => rejectSettled(new Error("WebSocket error: " + error.message)));
  socket.on("close", (code, reason) => {
    if (!settled) rejectSettled(new Error("WebSocket closed before settlement (" + code + " " + String(reason) + ")"));
  });
  socket.on("message", (data) => {
    let event;
    try { event = JSON.parse(String(data)); } catch { return; }
    const receivedAt = performance.now();
    frames.push({ event, receivedAt });
    if (event.type === "generation_started") generationId = event.generationId || generationId;
    if (event.type === "content_block_delta" && (!generationId || event.generationId === generationId)) {
      if (firstDeltaAt == null) firstDeltaAt = receivedAt;
      const delta = String(event.delta || "");
      streamedText += delta;
      if (streamedText.length > configuration.maxChars) {
        rejectSettled(new Error("Stream exceeded --max-chars " + configuration.maxChars));
        return;
      }
      deltas.push({ receivedAt, characters: delta.length });
    }
    if (event.type === "generation_settled" && (!generationId || event.generationId === generationId)) {
      completionAt = receivedAt;
      settled = true;
      resolveSettled();
    }
  });
  await new Promise((resolve, reject) => {
    if (socket.readyState === socket.OPEN) return resolve();
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const initialState = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Timed out waiting for live-session state")), 10_000);
    const onMessage = (data) => {
      let event;
      try { event = JSON.parse(String(data)); } catch { return; }
      if (!["runtime_state", "generation_resume"].includes(event.type)) return;
      clearTimeout(deadline);
      socket.off("message", onMessage);
      resolve(event);
    };
    socket.on("message", onMessage);
  });
  if (initialState.type === "generation_resume"
    || (initialState.type === "runtime_state" && initialState.session?.active)) {
    clearTimeout(timeout);
    socket.close();
    throw new Error("Performance chat already has an active generation");
  }
  const promptStarted = performance.now();
  socket.send(JSON.stringify({ type: "prompt", message: prompt }));
  try {
    await settledPromise;
  } finally {
    clearTimeout(timeout);
    socket.close();
  }
  let persistedText = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await jsonRequest(configuration.origin, "/v0/sessions/" + encodeURIComponent(configuration.chatId), {
      headers: { cookie },
    });
    persistedText = latestAssistantText(session.body);
    if (persistedText || attempt === 19) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const gaps = deltas.slice(1).map((frame, index) => frame.receivedAt - deltas[index].receivedAt);
  const completionMs = (completionAt ?? performance.now()) - promptStarted;
  return {
    schemaVersion: 1,
    scenario: "live-streaming-baseline",
    mode: "live-transport",
    target: configuration.target,
    origin: configuration.origin.origin,
    release,
    runtime: models.body?.runtimeKind || chat.runtime?.kind || null,
    model: models.body?.model || null,
    thinkingLevel: models.body?.thinkingLevel || null,
    startedAt,
    outcome: "passed",
    transport: {
      promptAcceptedMs: (frames.find((frame) => frame.event.type === "generation_started")?.receivedAt ?? promptStarted) - promptStarted,
      firstDeltaMs: firstDeltaAt == null ? null : firstDeltaAt - promptStarted,
      completionMs,
      deliveredDeltaCount: deltas.length,
      deliveredCharacters: streamedText.length,
      gapMs: summary(gaps),
      burstFramesUnder5Ms: gaps.filter((gap) => gap < 5).length,
      gapsOver100Ms: gaps.filter((gap) => gap > 100).length,
      finalTextCharacters: streamedText.length,
      finalTextSha256: hash(streamedText),
      persistedAssistantCharacters: persistedText.length,
      persistedAssistantSha256: hash(persistedText),
      finalContentMatches: streamedText === persistedText,
    },
    errors: [],
    artifacts: [],
    durationMs: performance.now() - started,
  };
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write(HELP);
  process.exit(0);
}

try {
  const dryRun = args.includes("--dry-run");
  const configuration = parseConfiguration(args, dryRun);
  const prompt = await readPrompt(args);
  if (!dryRun && !prompt) throw new Error("CONDUIT_PERF_PROMPT or --prompt-file is required");
  if (dryRun) {
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      mode: "live-transport",
      target: configuration.target,
      origin: configuration.origin.origin,
      chatId: configuration.chatId,
      bounded: { timeoutMs: configuration.timeoutMs, maxChars: configuration.maxChars },
      promptCharacters: prompt.length || null,
      outcome: "dry-run",
      errors: [],
      artifacts: [],
    }, null, 2) + "\n");
    process.exit(0);
  }
  const report = await runLiveMeasurement(configuration, prompt);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.outcome === "passed" ? 0 : 1;
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
