// Measured as every harness's events are published, not read from each harness's own reporting, which is partial and
// differs by harness.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { turnTime } from "../harnesses/transcript-ops.js";
import { writePrivateJson } from "../private-file.js";

const CHARS_PER_TOKEN = 4;
const TURNS_KEPT = 500;
const TOOLS_KEPT = 200;
// Shorter than this, a stream is one burst and a rate would be noise.
const RATE_MIN_MS = 250;

const span = (from, to) => (from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null);

function summary(turn) {
  const tokens = Math.round((turn.thinkingChars + turn.answerChars) / CHARS_PER_TOKEN);
  const streaming = span(turn.firstOutputAt, turn.lastOutputAt);
  return {
    startedAt: turn.startedAt, firstOutputAt: turn.firstOutputAt, firstAnswerAt: turn.firstAnswerAt,
    lastOutputAt: turn.lastOutputAt, endedAt: turn.endedAt,
    ttftMs: span(turn.startedAt, turn.firstOutputAt), ttfaMs: span(turn.startedAt, turn.firstAnswerAt),
    durationMs: span(turn.startedAt, turn.endedAt),
    thinkingChars: turn.thinkingChars, answerChars: turn.answerChars, tokens, tokensEstimated: true,
    tokensPerSecond: streaming >= RATE_MIN_MS && tokens ? Math.round((tokens / streaming) * 10_000) / 10 : null,
    tools: [...turn.tools.values()].slice(-TOOLS_KEPT).map((tool) => ({ ...tool, ms: span(tool.startedAt, tool.endedAt) })),
  };
}

export class TurnTimings {
  constructor(root) {
    this.root = root;
    this.live = new Map();
    this.held = new Map();
    this.writes = new Map();
  }

  fileFor(chatId) {
    return path.join(this.root, `${crypto.createHash("sha256").update(chatId).digest("hex").slice(0, 32)}.json`);
  }

  async read(chatId) {
    let held = this.held.get(chatId);
    if (held) return held;
    held = new Map();
    try {
      const stored = JSON.parse(await fs.readFile(this.fileFor(chatId), "utf8"));
      for (const [promptId, timing] of Object.entries(stored.turns || {})) held.set(promptId, timing);
    } catch {}
    // A read racing a write keeps what the write put in.
    const current = this.held.get(chatId);
    if (current) return current;
    this.held.set(chatId, held);
    return held;
  }

  async keep(chatId, promptId, timing) {
    const held = await this.read(chatId);
    held.delete(promptId);
    held.set(promptId, timing);
    while (held.size > TURNS_KEPT) held.delete(held.keys().next().value);
    const write = () => writePrivateJson(this.fileFor(chatId), { version: 1, chatId, turns: Object.fromEntries(held) }, { compact: true });
    const previous = this.writes.get(chatId) || Promise.resolve();
    const next = previous.then(write, write).catch((error) => console.error("Could not keep turn timings", error));
    this.writes.set(chatId, next);
    return next;
  }

  async forget(chatId) {
    this.live.delete(chatId);
    this.held.delete(chatId);
    await (this.writes.get(chatId) || Promise.resolve());
    this.writes.delete(chatId);
    await fs.rm(this.fileFor(chatId), { force: true });
  }

  async decorate(chatId, messages = []) {
    if (!chatId || !messages.some((message) => message?.role === "user")) return messages;
    const held = await this.read(chatId);
    if (!held.size) return messages;
    return messages.map((message) => (message?.role === "user" && held.has(message.id) && !message.timing
      ? { ...message, timing: held.get(message.id) } : message));
  }

  observe(record, event) {
    const chatId = record?.chatId;
    if (!chatId || record.ephemeral || !event?.type) return null;
    const now = new Date().toISOString();
    let turn = this.live.get(chatId);
    const begin = () => {
      turn = { promptId: null, generationId: event.generationId || null, startedAt: now, firstOutputAt: null,
        firstAnswerAt: null, lastOutputAt: null, endedAt: null, thinkingChars: 0, answerChars: 0, tools: new Map(),
        streamed: new Set() };
      this.live.set(chatId, turn);
    };
    const ended = !turn || turn.endedAt;
    if (event.type === "transcript_op" && event.op === "message.open" && event.message?.role === "user") {
      if (ended) begin();
      // A prompt taken mid-run (a steer, a follow-up, a subagent's report) is opened as it is taken, and the
      // answer after it is its own: the prompt before it is timed to here, and this one from here. Prompts
      // opened together before any output share one span, held by the last, which the answer follows.
      else if (turn.promptId && turn.promptId !== event.message.id) {
        if (!turn.firstOutputAt) { turn.promptId = event.message.id; return null; }
        const before = turn;
        before.endedAt = now;
        const timing = summary(before);
        void this.keep(chatId, before.promptId, timing);
        begin();
        turn.generationId = before.generationId;
        turn.promptId = event.message.id;
        return turnTime({ promptId: before.promptId, timing, generationId: before.generationId });
      }
      turn.promptId ??= event.message.id;
      return null;
    }
    if (event.type === "status" && event.phase === "started") {
      if (ended) begin();
      turn.generationId = event.generationId || turn.generationId;
      return null;
    }
    if (ended) return null;
    if (event.type === "assistant_content" && event.phase === "delta" && event.delta) {
      if (event.messageId) turn.streamed.add(event.messageId);
      turn.firstOutputAt ??= now;
      turn.lastOutputAt = now;
      if (event.blockKind === "thinking") turn.thinkingChars += event.delta.length;
      else {
        turn.answerChars += event.delta.length;
        turn.firstAnswerAt ??= now;
      }
    } else if (event.type === "transcript_op" && event.op === "message.close" && event.content && event.messageId !== turn.promptId && !turn.streamed.has(event.messageId)) {
      // An answer that arrived whole, with nothing painted before it: its output came now.
      turn.streamed.add(event.messageId);
      turn.firstOutputAt ??= now;
      turn.firstAnswerAt ??= now;
      turn.lastOutputAt = now;
      turn.answerChars += event.content.length;
    } else if (event.type === "transcript_op" && event.op === "tool.open" && event.toolCallId && !turn.tools.has(event.toolCallId)) {
      turn.tools.set(event.toolCallId, { name: event.name || "tool", kind: event.kind || "other", startedAt: now, endedAt: null });
    } else if (event.type === "transcript_op" && event.op === "tool.close" && turn.tools.has(event.toolCallId)) {
      const tool = turn.tools.get(event.toolCallId);
      if (!tool.endedAt) Object.assign(tool, { endedAt: now, ...(event.isError ? { failed: true } : {}), ...(event.cancelled ? { cancelled: true } : {}) });
    } else if (event.type === "transcript_op" && event.op === "turn.settle") {
      turn.promptId = event.promptId || turn.promptId;
    } else if (event.type === "status" && (event.phase === "settled" || event.phase === "stopped")) {
      turn.endedAt = now;
      if (!turn.promptId) return null;
      const timing = summary(turn);
      void this.keep(chatId, turn.promptId, timing);
      return turnTime({ promptId: turn.promptId, timing, generationId: turn.generationId });
    }
    return null;
  }
}
