/**
 * Builders rather than a base class: publishing is each adapter's business, but the shape of what gets published lives
 * here, and nothing else may hand-write one.
 */

import { wasDiscarded } from "../abort-signature.js";

/**
 * A harness's own names may appear only where that harness's own bytes are read (its normalizer, its session file
 * reader, its thread reader); past that boundary they do not exist. Stop reasons are the adapter's to translate, since
 * the browser reads a stop as `aborted` and nothing else.
 */

const ROLES = new Set(["user", "assistant", "system"]);
const OUTCOMES = new Set(["complete", "interrupted", "failed"]);
const STOP_REASONS = new Set(["stop", "toolUse", "length", "error", "aborted"]);
const text = (value) => typeof value === "string" && value.length > 0;

/** Each adapter holds the table from its tool names to these, so the browser never guesses from a name. */
const TOOL_KINDS = new Set(["command", "read", "edit", "search", "fetch", "script", "agent", "message", "other"]);
export const toolKind = (table, name) => (Object.hasOwn(table, name) ? table[name] : "other");

const pageOf = (value) => {
  try {
    const url = new URL(value);
    return { host: url.hostname.replace(/^www\d*\./, ""), path: url.pathname === "/" ? "" : url.pathname };
  } catch { return null; }
};
export const DIFF_LINES = 160;
export function lineChanges(before = "", after = "") {
  const old = before ? before.split("\n") : [], next = after ? after.split("\n") : [];
  if (old.at(-1) === "" && next.at(-1) === "") { old.pop(); next.pop(); }
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) head += 1;
  let tail = 0;
  while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  const a = old.slice(head, old.length - tail), b = next.slice(head, next.length - tail);
  // The middle by its longest run in common, so a line kept between two changes is not counted twice; past a few
  // hundred lines a side, the whole middle (an edit that large is a rewrite).
  if (!a.length || !b.length || a.length * b.length > 160_000) return { removed: a, added: b, lines: [...a.map((text) => ({ sign: "-", text })), ...b.map((text) => ({ sign: "+", text }))] };
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1)
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const removed = [], added = [], lines = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i += 1; j += 1; continue; }
    if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) { removed.push(a[i]); lines.push({ sign: "-", text: a[i] }); i += 1; }
    else { added.push(b[j]); lines.push({ sign: "+", text: b[j] }); j += 1; }
  }
  return { removed, added, lines };
}
export const toolSubject = (value) => {
  const list = (Array.isArray(value) ? value : [value]).filter((item) => typeof item === "string" && item.trim());
  if (!list.length) return null;
  const pages = list.map((item) => (/^https?:\/\//i.test(item.trim()) ? pageOf(item.trim()) : null));
  if (pages.every(Boolean)) {
    if (list.length === 1) return `${pages[0].host}${pages[0].path}`;
    const hosts = new Set(pages.map((page) => page.host));
    return hosts.size === 1 ? `${list.length} pages on ${pages[0].host}` : `${list.length} pages`;
  }
  let line = list[0].trim().split("\n")[0];
  if (line.length > 160) line = `${line.slice(0, 159)}…`;
  return list.length > 1 ? `${line} and ${list.length - 1} more` : line;
};

/** Every op is checked before it leaves, because nothing downstream checks it: a throw names the adapter at fault. */
export function assertTranscriptOp(event) {
  const bad = (reason) => { throw new Error(`invalid ${event?.op || "transcript"} op: ${reason}`); };
  if (event?.type !== "transcript_op") bad("not a transcript_op");
  const agent = event.agent || event.message?.agent;
  if (agent && ((agent.id !== null && !text(agent.id))
    || (agent.conversationId !== null && !Number.isInteger(agent.conversationId) && !text(agent.conversationId)))) bad("invalid agent reference");
  if (event.op === "message.open") {
    if (!text(event.message?.id)) bad("no message id");
    if (!ROLES.has(event.message?.role)) bad(`role ${JSON.stringify(event.message?.role)}`);
    if (event.message.context !== undefined && (!event.message.context || typeof event.message.context !== "object" || Array.isArray(event.message.context))) bad("context must be an object");
    if (event.answers !== null && !text(event.answers)) bad("answers must be a message id or null");
  } else if (event.op === "message.close") {
    if (!text(event.messageId)) bad("no message id");
    if (typeof event.interim !== "boolean") bad("interim must be stated");
    if (typeof event.content !== "string") bad("content must be stated");
    if (!Array.isArray(event.blocks)) bad("blocks must be stated");
    if (event.stopReason != null && !STOP_REASONS.has(event.stopReason)) bad(`stopReason ${JSON.stringify(event.stopReason)}`);
  } else if (event.op === "message.drop") {
    if (!text(event.messageId)) bad("no message id");
    if (event.keep && event.inclusive) bad("a drop either keeps the message or takes it");
  } else if (event.op === "tool.open") {
    if (!text(event.toolCallId)) bad("no tool call id");
    if (!TOOL_KINDS.has(event.kind)) bad(`kind ${JSON.stringify(event.kind)}`);
    if (event.subject !== undefined && !text(event.subject)) bad("subject must be a line or left out");
  } else if (event.op === "tool.close") {
    if (!text(event.toolCallId)) bad("no tool call id");
    if (event.kind !== undefined && !TOOL_KINDS.has(event.kind)) bad(`kind ${JSON.stringify(event.kind)}`);
    if (event.subject !== undefined && !text(event.subject)) bad("subject must be a line or left out");
    if (event.isError && event.cancelled) bad("a tool is stopped or it failed");
  } else if (event.op === "tool.calls") {
    if (!text(event.toolCallId)) bad("no tool call id");
    if (!Array.isArray(event.calls)) bad("calls must be a list");
  } else if (event.op === "turn.settle") {
    if (!text(event.promptId)) bad("no prompt id");
    if (!OUTCOMES.has(event.outcome)) bad(`outcome ${JSON.stringify(event.outcome)}`);
  } else if (event.op === "turn.time") {
    if (!text(event.promptId)) bad("no prompt id");
    if (!event.timing || typeof event.timing !== "object") bad("timing must be stated");
  } else bad("unknown op");
  return event;
}

/** `after` is filled in by the chat's log, not here. */
export const messageOpen = ({ id, role, generationId = null, answers = null, ...fields }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "message.open",
    ...(generationId ? { generationId } : {}),
    answers,
    message: { id, role, ...fields },
  });

/**
 * The browser is told `interim` and `discarded` rather than deciding them from the shape of the turn. The text is
 * stated either way, since the trace renders interim text.
 */
export const messageClose = ({ messageId, stopReason = null, blocks = [], interim = false, generationId = null,
  keepsPartial = false, provider = null, model = null, timestamp = null, errorMessage = null }) => {
  const content = blocks.filter((block) => block.kind === "text").map((block) => block.text || "").join("\n");
  return assertTranscriptOp({
    type: "transcript_op", op: "message.close", messageId, stopReason, interim,
    // An interrupted answer on a backend that cannot keep a partial is text the model will never see again.
    ...(wasDiscarded({ role: "assistant", stopReason, content }, { keepsPartial }) ? { discarded: true } : {}),
    ...(generationId ? { generationId } : {}),
    content,
    // Stated here because the final paint frame may be merged away or dropped under backpressure.
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    blocks: blocks.filter((block) => block.kind !== "text"),
  });
};

/**
 * - `inclusive`: a fork or an edit; the history ends before this message, so it and everything after it go.
 * - `keep`: a regenerate; the history ends after this message, so the prompt stands and its answers go.
 * - neither: a turn giving up a row it named and never wrote into, that row alone.
 */
export const messageDrop = ({ messageId, inclusive = false, keep = false, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "message.drop", messageId,
    ...(keep ? { keep: true } : { inclusive }),
    ...(generationId ? { generationId } : {}),
  });

/** Stated here, tools travel in the same order as everything else, so a replay restores them with it. */
export const toolOpen = ({ toolCallId, name, kind = "other", subject = null, input, messageId = null, generationId = null,
  timestamp = new Date().toISOString(), agent = null, facts = null }) =>
  assertTranscriptOp({
    // When it started and, on the close, when it finished -- stamped as they
    // happen, so a replay says how long a step took rather than when the
    // replay ran.
    type: "transcript_op", op: "tool.open", toolCallId, name: name || "tool", kind, input, timestamp,
    ...(subject ? { subject } : {}),
    ...(facts ? { facts } : {}),
    ...(agent ? { agent } : {}),
    ...(messageId ? { messageId } : {}),
    ...(generationId ? { generationId } : {}),
  });

export const toolCalls = ({ toolCallId, calls, generationId = null }) =>
  assertTranscriptOp({ type: "transcript_op", op: "tool.calls", toolCallId, calls,
    ...(generationId ? { generationId } : {}) });

/**
 * A tool the user's stop cut short was `cancelled`, not failed: harnesses report the kill as an error, and the adapter,
 * which knows it asked for the stop, says which it was. `kind` and `subject` restated here replace what the open said.
 */
export const toolClose = ({ toolCallId, output, isError = false, cancelled = false, generationId = null,
  kind = undefined, subject = null, calls = null, completedAt = new Date().toISOString(), agent = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "tool.close", toolCallId, output, completedAt,
    isError: Boolean(isError) && !cancelled,
    ...(cancelled ? { cancelled: true } : {}),
    ...(kind ? { kind } : {}),
    ...(subject ? { subject } : {}),
    ...(agent ? { agent } : {}),
    ...(calls?.length ? { calls } : {}),
    ...(generationId ? { generationId } : {}),
  });

export const turnTime = ({ promptId, timing, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "turn.time", promptId, timing,
    ...(generationId ? { generationId } : {}),
  });

export const turnSettle = ({ promptId, outcome, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "turn.settle", promptId, outcome,
    ...(generationId ? { generationId } : {}),
  });
