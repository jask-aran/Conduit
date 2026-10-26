/**
 * How long each turn took, measured by Conduit as every harness's events pass
 * through the one place they all do (session-records.js `publish`), rather
 * than read from each harness's own reporting, which is partial and differs by
 * harness. A message's timestamp is when it began, so a turn's time used to be
 * its prompt to its answer's first word: an 18 s turn read 56 ms.
 *
 * Per turn: when it began (its prompt opened or the generation started,
 * whichever came first), its first output of any kind and its first answer
 * text, its last output, when it ended and how; what it streamed, in
 * characters and an estimate of tokens by one rule for every harness (four
 * characters each); and each tool call's span. Stated on the prompt when the
 * turn ends (`turn.time`, folded like `turn.settle`), and kept per chat on
 * disk so a transcript read later carries it (`decorate`).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { turnTime } from "../harnesses/transcript-ops.js";

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
    // Time to first output (thinking counts), to the first word of the answer, and the whole turn.
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
    // The turn under way in each chat.
    this.live = new Map();
    // Each chat's kept timings, by prompt id, as read or written last.
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
    } catch { /* none kept yet */ }
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
    const write = async () => {
      await fs.mkdir(this.root, { recursive: true });
      const file = this.fileFor(chatId);
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ version: 1, chatId, turns: Object.fromEntries(held) }));
      await fs.rename(temporary, file);
    };
    const previous = this.writes.get(chatId) || Promise.resolve();
    const next = previous.then(write, write).catch((error) => console.error("Could not keep turn timings", error));
    this.writes.set(chatId, next);
    return next;
  }

  /** A chat deleted takes its timings with it. */
  async forget(chatId) {
    this.live.delete(chatId);
    this.held.delete(chatId);
    await (this.writes.get(chatId) || Promise.resolve());
    this.writes.delete(chatId);
    await fs.rm(this.fileFor(chatId), { force: true });
  }

  /** The kept timing on each prompt that has one. */
  async decorate(chatId, messages = []) {
    if (!chatId || !messages.some((message) => message?.role === "user")) return messages;
    const held = await this.read(chatId);
    if (!held.size) return messages;
    return messages.map((message) => (message?.role === "user" && held.has(message.id) && !message.timing
      ? { ...message, timing: held.get(message.id) } : message));
  }

  /**
   * Note one event as it is published. Returns the statement to publish when
   * a turn ends (`turn.time`), else null.
   */
  observe(record, event) {
    const chatId = record?.chatId;
    if (!chatId || record.ephemeral || !event?.type) return null;
    const now = new Date().toISOString();
    let turn = this.live.get(chatId);
    const begin = () => {
      turn = { promptId: null, generationId: event.generationId || null, startedAt: now, firstOutputAt: null,
        firstAnswerAt: null, lastOutputAt: null, endedAt: null, thinkingChars: 0, answerChars: 0, tools: new Map() };
      this.live.set(chatId, turn);
    };
    const ended = !turn || turn.endedAt;
    if (event.type === "transcript_op" && event.op === "message.open" && event.message?.role === "user") {
      if (ended) begin();
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
      turn.firstOutputAt ??= now;
      turn.lastOutputAt = now;
      if (event.blockKind === "thinking") turn.thinkingChars += event.delta.length;
      else {
        turn.answerChars += event.delta.length;
        turn.firstAnswerAt ??= now;
      }
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
