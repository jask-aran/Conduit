import fs from "node:fs/promises";
import path from "node:path";
import { startConduitHarness } from "./conduit-harness.js";

function chunks(text, size) {
  const values = [];
  for (let index = 0; index < text.length; index += size) values.push(text.slice(index, index + size));
  return values;
}

function seededRandom(seed) {
  let state = Math.trunc(Number(seed)) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function createCadence(profile, options = {}) {
  const text = String(options.text || "");
  const chunkSize = Math.max(1, Math.trunc(Number(options.chunkSize) || 1));
  const deltas = chunks(text, chunkSize);
  if (!deltas.length) throw new Error("Cadence text is required");
  if (profile === "steady") {
    const intervalMs = Math.max(0, Number(options.intervalMs) || 16);
    return { delaysMs: deltas.map((_, index) => index === 0 ? 0 : intervalMs), deltas };
  }
  if (profile === "burst") {
    const burstSize = Math.max(1, Math.trunc(Number(options.burstSize) || 8));
    const burstIntervalMs = Math.max(0, Number(options.burstIntervalMs) || 128);
    return {
      delaysMs: deltas.map((_, index) => index > 0 && index % burstSize === 0 ? burstIntervalMs : 0),
      deltas,
    };
  }
  if (profile === "stall") {
    const stallAfter = Math.min(
      Math.max(1, Math.trunc(Number(options.stallAfter) || 4)),
      deltas.length - 1,
    );
    const stallMs = Math.max(0, Number(options.stallMs) || 300);
    return {
      delaysMs: deltas.map((_, index) => index === 0 ? 0 : index === stallAfter ? stallMs : 0),
      deltas,
    };
  }
  if (profile === "jitter") {
    const minDelayMs = Math.max(0, Number(options.minDelayMs) || 5);
    const maxDelayMs = Math.max(minDelayMs, Number(options.maxDelayMs) || 80);
    const random = seededRandom(options.seed ?? 1);
    return {
      delaysMs: deltas.map((_, index) => index === 0
        ? 0
        : Math.round(minDelayMs + random() * (maxDelayMs - minDelayMs))),
      deltas,
    };
  }
  throw new Error(`Unknown cadence profile: ${profile}`);
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function gapSummary(frames) {
  const gaps = frames.slice(1).map((frame, index) => frame.receivedAt - frames[index].receivedAt);
  return numberSummary(gaps);
}

function numberSummary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
  };
}

function validateScenario({ name, cadence }) {
  if (!name || typeof name !== "string") throw new Error("Scenario name is required");
  if (!Array.isArray(cadence?.deltas) || !cadence.deltas.length) throw new Error("Scenario requires at least one delta");
  if (!Array.isArray(cadence.delaysMs) || cadence.delaysMs.length !== cadence.deltas.length) {
    throw new Error("Cadence delaysMs must contain one delay per delta");
  }
  for (const delay of cadence.delaysMs) {
    if (!Number.isFinite(delay) || delay < 0) throw new Error("Cadence delays must be non-negative numbers");
  }
}

function delay(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

export async function runDeterministicStreamingScenario(scenario) {
  validateScenario(scenario);
  const harness = await startConduitHarness();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const chat = await harness.createChat();
    const projects = await (await harness.request("/v0/projects")).json();
    const project = projects.projects.find((item) => item.id === chat.projectId);
    const sessionFile = path.join(harness.root, "pi", "sessions", `${chat.id}.jsonl`);
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, `${JSON.stringify({
      type: "session",
      id: `session-${chat.id}`,
      cwd: project.path,
    })}\n`);

    const commandOffset = (await harness.pi.commands()).length;
    const launchRequest = harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId }),
    });
    const stateCommand = await harness.pi.waitForCommand("get_state", { after: commandOffset });
    await harness.pi.reply(stateCommand, { sessionFile, sessionId: `session-${chat.id}` });
    const launchResponse = await launchRequest;
    if (!launchResponse.ok) throw new Error(`Could not launch deterministic scenario: ${launchResponse.status}`);
    const live = await launchResponse.json();
    const stream = harness.connectStream(live.id);
    await stream.opened;
    await stream.next((event) => event.type === "runtime_state");

    const promptStarted = performance.now();
    stream.socket.send(JSON.stringify({ type: "prompt", message: scenario.prompt || `Run ${scenario.name}` }));
    const promptCommand = await harness.pi.waitForCommand("prompt", { after: commandOffset + 1 });
    await harness.pi.reply(promptCommand, {});
    await stream.next((event) => event.type === "generation_started");

    await harness.pi.emit({ type: "agent_start" }, { pid: promptCommand.pid });
    await harness.pi.emit({
      type: "message_start",
      message: { role: "assistant", content: [] },
    }, { pid: promptCommand.pid });
    await harness.pi.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_start",
        contentIndex: 0,
        partial: { role: "assistant", content: [{ type: "text", text: "" }] },
      },
    }, { pid: promptCommand.pid });

    let finalText = "";
    for (let index = 0; index < scenario.cadence.deltas.length; index += 1) {
      await delay(scenario.cadence.delaysMs[index]);
      const delta = String(scenario.cadence.deltas[index]);
      finalText += delta;
      await harness.pi.emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta,
          partial: { role: "assistant", content: [{ type: "text", text: finalText }] },
        },
      }, { pid: promptCommand.pid });
    }

    await harness.pi.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_end",
        contentIndex: 0,
        content: finalText,
        partial: { role: "assistant", content: [{ type: "text", text: finalText }] },
      },
    }, { pid: promptCommand.pid });
    await harness.pi.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: finalText }],
        stopReason: "stop",
      },
    }, { pid: promptCommand.pid });
    await harness.pi.emit({ type: "agent_end", willRetry: false }, { pid: promptCommand.pid });
    await harness.pi.emit({ type: "agent_settled" }, { pid: promptCommand.pid });
    await stream.next((event) => event.type === "generation_settled", 5_000);

    const deltaFrames = stream.frames.filter(({ event }) => event.type === "content_block_delta");
    const firstDeltaAt = deltaFrames[0]?.receivedAt;
    const completionFrame = stream.frames.find(({ event }) => event.type === "generation_settled");
    const deliveredText = deltaFrames.map(({ event }) => event.delta).join("");
    const completionMs = (completionFrame?.receivedAt ?? performance.now()) - promptStarted;
    const sourceCharacters = finalText.length;

    return {
      schemaVersion: 1,
      scenario: scenario.name,
      mode: "deterministic-transport",
      target: "local-harness",
      startedAt,
      seed: scenario.seed ?? null,
      outcome: deliveredText === finalText ? "passed" : "failed",
      durationMs: performance.now() - started,
      transport: {
        promptAcceptedMs: stream.frames.find(({ event }) => event.type === "generation_started")?.receivedAt - promptStarted,
        firstDeltaMs: firstDeltaAt == null ? null : firstDeltaAt - promptStarted,
        completionMs,
        sourceDeltaCount: scenario.cadence.deltas.length,
        sourceCharacters,
        sourceGapMs: numberSummary(scenario.cadence.delaysMs.slice(1)),
        sourceStallCount: scenario.cadence.delaysMs.slice(1).filter((delay) => delay > 100).length,
        sourceStallMs: Math.max(0, ...scenario.cadence.delaysMs.slice(1).filter((delay) => delay > 100)),
        sourceGapsOver100Ms: scenario.cadence.delaysMs.slice(1).filter((delay) => delay > 100).length,
        deliveredDeltaCount: deltaFrames.length,
        deliveredCharacters: deliveredText.length,
        charactersPerSecond: completionMs > 0 ? sourceCharacters / (completionMs / 1_000) : null,
        gapMs: gapSummary(deltaFrames),
        burstFramesUnder5Ms: deltaFrames.slice(1).filter((frame, index) => frame.receivedAt - deltaFrames[index].receivedAt < 5).length,
        gapsOver100Ms: deltaFrames.slice(1).filter((frame, index) => frame.receivedAt - deltaFrames[index].receivedAt > 100).length,
        finalText: deliveredText,
      },
      errors: deliveredText === finalText ? [] : ["Delivered delta text did not match the scripted source"],
      artifacts: [],
    };
  } finally {
    await harness.stop();
  }
}
