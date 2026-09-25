import { textBlockClassifications } from "../active-generation.js";
import { mergeContinuation } from "../continuation.js";
import type { ContentBlock, Message, ToolItem, ToolKind } from "./api/contracts";

/**
 * A block of a message still arriving.
 *
 * The same block a settled message states, called the same things, with what
 * streaming needs on top: `contentIndex` is how a delta finds the block it
 * belongs to, `identity` is what a row is keyed on while it is being written,
 * and `status` is whether it is still coming. Not a second vocabulary -- this
 * one, before the turn finished.
 */
type LiveBlock = {
  kind: "thinking" | "narration" | "text" | "tool_call";
  identity: string;
  contentIndex: number;
  text?: string;
  toolCallId?: string;
  name?: string;
  // Which kind of tool a call is, stated by the adapter while it is still
  // being written, before the tool runs and states it itself.
  toolKind?: ToolKind;
  // What a call acts on, read out of its arguments while they are written.
  subject?: string;
  redacted?: boolean;
  input?: unknown;
  status?: string;
};

export interface ActiveGenerationView {
  id: string;
  status: string;
  lastSeq: number;
  continuation?: boolean;
  continuationBase?: string;
  assistantMessages: Array<{
    id: string;
    stopReason?: string | null;
    errorMessage?: string | null;
    provider?: string | null;
    model?: string | null;
    timestamp?: string | null;
    blocks: LiveBlock[];
  }>;
  toolExecutions: Record<string, {
    toolCallId?: string;
    name?: string;
    kind?: ToolKind;
    subject?: string;
    timestamp?: string;
    completedAt?: string;
    input?: unknown;
    // What the tool has returned. `status` says whether that is all of it, the
    // same way a block in flight carries its own text and says it is streaming.
    output?: unknown;
    status?: string;
    isError?: boolean;
  }>;
}

export type LiveGenerationChangeScope = "block" | "tool" | "structural";

export interface LiveGenerationChange {
  generationId: string;
  eventType: string;
  scope: LiveGenerationChangeScope;
  messageId?: string;
  contentIndex?: number;
  toolCallId?: string;
}

export type TraceSegment =
  // `discarded` is the server saying the harness is not carrying this text into
  // the next request -- an interrupted turn on a backend that cannot keep a
  // partial. Inside the trace it is struck through rather than collapsed: it is
  // already behind the rollup, and hiding it twice would just lose it.
  // `hidden` is reasoning the provider kept to itself: it happened, and there
  // is no text of it to show.
  | { kind: "thinking"; id: string; text: string; live?: boolean; discarded?: boolean; hidden?: boolean }
  | { kind: "narration"; id: string; text: string; live?: boolean; discarded?: boolean }
  | { kind: "error"; id: string; message: Message }
  | { kind: "tool"; id: string; tool: ToolItem };

export interface TurnTraceData {
  active: boolean;
  status: "thinking" | "executing_tool" | "interrupted" | "complete" | "failed";
  segments: TraceSegment[];
  // The turn's time, prompt to last reply, off the timestamps the messages
  // already carry. A live turn has no end yet; its header counts from the start.
  startedAt?: string;
  endedAt?: string;
}

export type TurnRow =
  // precedingUserId is carried on the row rather than looked up per render.
  // The projection already knows which user message opened the turn; making
  // each row rediscover it meant a backwards scan of the whole message list
  // per assistant row, which is quadratic in a long chat.
  // `traced` is whether a trace above this answer already speaks for its turn,
  // so a stopped turn says "Interrupted" once, on whichever row comes first.
  | { key: string; type: "message"; value: Message; live?: boolean; streamVersion?: number; displayKey?: string; precedingUserId?: string; traced?: boolean }
  // `timestamp` is the turn's last reply's, for a trace with no answer row to carry it.
  | { key: string; type: "trace"; value: TurnTraceData; precedingUserId?: string; answerless?: boolean; unstated?: boolean; timestamp?: string }
  // Where the answer will be, from the start of a live turn until its text does.
  | { key: string; type: "pending"; value: null; precedingUserId?: string; startedAt?: string };

interface PersistedTurn {
  userMessage: Message | null;
  assistants: Message[];
}

export interface PersistedTurnProjection {
  key: string;
  userMessage: Message | null;
  assistants: Message[];
  /** What the rows were built from, so an unchanged turn can keep them. */
  sourceTools: ToolItem[];
  rows: TurnRow[];
}

const thinkingOf = (message: Message): string => (message.blocks || [])
  .filter((block) => block.kind === "thinking")
  .map((block) => block.text || "")
  .join("\n")
  .trim();

const toolCallIdsOf = (message: Message): string[] => (message.blocks || [])
  .filter((block) => block.kind === "tool_call" && typeof block.toolCallId === "string")
  .map((block) => block.toolCallId as string);

const answerDisplayKey = (owner: Message | null, answerIndex: number, fallback: string) =>
  `answer:${owner ? owner.id : fallback}:${answerIndex}`;
const active = (generation: ActiveGenerationView) => !["stopped", "complete", "failed"].includes(generation.status);

export type LiveBlockLocation =
  | { kind: "trace"; rowKey: string; segmentIndex: number }
  | { kind: "answer"; rowKey: string; assistantId: string };

export interface LiveProjectionIndex {
  generationId: string;
  messageIndex: number;
  traceRowKey: string | null;
  blockLocations: Map<string, LiveBlockLocation>;
  toolLocations: Map<string, { rowKey: string; segmentIndex: number }>;
  answerBlockIdentities: Map<string, Set<string>>;
  answerRowKeys: Map<string, string>;
  firstAnswerAssistantId: string | null;
  activeBlockCount: number;
}

// Returns the index as well as the message: the caller needs both, and asking
// for the index separately meant a second full pass over the list. Scanning
// backwards in place also avoids copying the whole list to read one element.
const lastPromptIndex = (messages: Message[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" && !message.pending) return index;
  }
  return -1;
};
/**
 * What the server said about a message, or a loud stop.
 *
 * Two questions used to be answered by reading the shape of a turn: whether a
 * message is the turn's answer or the turn talking as it works, and which
 * prompt an answer answers. Every backend now states both -- `answers` when it
 * opens a message, `interim` when it closes one -- so the readings are deleted
 * rather than kept underneath as a fallback.
 *
 * A fallback here would be silent. A new harness that stated neither would draw
 * a transcript that looked right until the first turn that answered and was
 * then steered, and that turn's answer would be folded into a collapsed trace
 * with nothing failing and nothing logged. A harness that does not state these
 * is not one Conduit can draw, and it finds that out on its first turn.
 */
const stateless = (message: Message, field: string): never => {
  throw new Error(`transcript contract: assistant message ${message.id} did not state \`${field}\`. A backend must state \`answers\` when it opens a message and \`interim\` when it closes one.`);
};
const statedInterim = (message: Message): boolean =>
  (typeof message.interim === "boolean" ? message.interim : stateless(message, "interim"));
const statedAnswers = (message: Message): string | null =>
  (message.answers !== undefined ? message.answers : stateless(message, "answers"));

/**
 * And how a turn ended, which is stated on its prompt by `turn.settle`.
 *
 * It was read off the turn's messages -- any of them stopped, the last one an
 * error -- and Pi's stop under a running tool files an empty entry that says
 * `error`, so the trace called that turn complete while the tool said error and
 * the composer said interrupted. A finished turn that did not say how it ended
 * is a harness that forgot to, and it stops here rather than being drawn as a
 * clean finish. A turn still running has not ended, so its rows are the live
 * overlay's and are checked once they are not.
 */
export function assertStatedOutcomes(rows: TurnRow[]): TurnRow[] {
  const unstated = rows.find((row) => row.type === "trace" && row.unstated);
  if (unstated) throw new Error(`transcript contract: the turn after prompt ${unstated.precedingUserId} ended without stating how. A backend must state \`turn.settle\` when a turn ends.`);
  return rows;
}

/**
 * Which prompt the live turn is drawn under.
 *
 * An answer holds a row in the transcript from the moment the harness names
 * it, so the prompt it answers is simply the one before that row. Reading the
 * last prompt in the whole list instead was only right while nothing else was
 * being sent: interrupting adds a prompt before the turn it cut off has
 * finished, and the answer being interrupted moved down to sit under the
 * message that stopped it. Until the first answer is named there is no row
 * yet, and the last prompt is the one being answered.
 */
const liveOwnerIndex = (messages: Message[], generation?: ActiveGenerationView | null) => {
  const live = new Set((generation?.assistantMessages || []).map((message) => message.id));
  const answerIndex = live.size
    ? messages.findIndex((message) => live.has(message.id))
    : -1;
  if (answerIndex < 0) return lastPromptIndex(messages);
  // The row the server placed for this answer says which prompt it answers.
  const stated = statedAnswers(messages[answerIndex]!);
  return stated ? messages.findIndex((message) => message.id === stated) : -1;
};
const liveOwner = (messages: Message[], generation: ActiveGenerationView) => {
  const index = liveOwnerIndex(messages, generation);
  return index < 0 ? null : messages[index]!;
};

export function buildLiveProjectionIndex(
  generation: ActiveGenerationView,
  messages: Message[],
): LiveProjectionIndex {
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const ownerIndex = liveOwnerIndex(messages, generation);
  const owner = ownerIndex < 0 ? null : messages[ownerIndex]!;
  const messageIndex = ownerIndex < 0 ? messages.length : ownerIndex;
  const traceRowKey = `trace:${owner ? owner.id : `live:${generation.id}`}`;
  const blockLocations = new Map<string, LiveBlockLocation>();
  const toolLocations = new Map<string, { rowKey: string; segmentIndex: number }>();
  const answerBlockIdentities = new Map<string, Set<string>>();
  const answerRowKeys = new Map<string, string>();
  let firstAnswerAssistantId: string | null = null;
  let answerIndex = 0;
  let segmentIndex = 0;
  let activeBlockCount = 0;

  for (const assistant of generation.assistantMessages) {
    const answerBlocks = new Set<string>();
    for (const block of assistant.blocks) {
      activeBlockCount += 1;
      if (block.kind === "thinking" || block.kind === "narration"
        || (block.kind === "text" && classifications[block.identity] === "interim")) {
        blockLocations.set(block.identity, { kind: "trace", rowKey: traceRowKey, segmentIndex });
        segmentIndex += 1;
      } else if (block.kind === "tool_call") {
        blockLocations.set(block.identity, { kind: "trace", rowKey: traceRowKey, segmentIndex });
        const toolCallId = block.toolCallId || block.identity;
        toolLocations.set(toolCallId, { rowKey: traceRowKey, segmentIndex });
        segmentIndex += 1;
      } else if (block.kind === "text") {
        answerBlocks.add(block.identity);
      }
    }
    if (assistant.stopReason === "error") segmentIndex += 1;
    if (answerBlocks.size) {
      const rowKey = answerDisplayKey(owner, answerIndex, `live:${generation.id}`);
      answerRowKeys.set(assistant.id, rowKey);
      if (!firstAnswerAssistantId) firstAnswerAssistantId = assistant.id;
      for (const identity of answerBlocks) blockLocations.set(identity, { kind: "answer", rowKey, assistantId: assistant.id });
      answerBlockIdentities.set(assistant.id, answerBlocks);
      answerIndex += 1;
    }
  }
  return {
    generationId: generation.id,
    messageIndex,
    traceRowKey: segmentIndex ? traceRowKey : null,
    blockLocations,
    toolLocations,
    answerBlockIdentities,
    answerRowKeys,
    firstAnswerAssistantId,
    activeBlockCount,
  };
}

export function buildLiveAnswerRow(
  generation: ActiveGenerationView,
  assistantId: string,
  index: LiveProjectionIndex,
  _messageIndex: number,
  precedingUserId?: string,
): Extract<TurnRow, { type: "message" }> | null {
  const assistant = generation.assistantMessages.find((message) => message.id === assistantId);
  const answerIdentities = index.answerBlockIdentities.get(assistantId);
  if (!assistant || !answerIdentities) return null;
  const answer = assistant.blocks
    .filter((block) => block.kind === "text" && answerIdentities.has(block.identity))
    .map((block) => block.text || "")
    .join("\n");
  const terminalError = generation.status === "failed"
    && assistant.stopReason === "error"
    && generation.assistantMessages.at(-1) === assistant;
  if (!answer && !terminalError) return null;
  const content = generation.continuation && index.firstAnswerAssistantId === assistantId
    ? mergeContinuation(generation.continuationBase || "", answer)
    : answer;
  return {
    key: index.answerRowKeys.get(assistantId) || `message:live:${generation.id}:${assistantId}`,
    displayKey: index.answerRowKeys.get(assistantId),
    type: "message",
    live: active(generation),
    streamVersion: generation.lastSeq,
    precedingUserId,
    value: {
      id: `live:${generation.id}:${assistantId}`,
      role: "assistant",
      content,
      stopReason: assistant.stopReason || undefined,
      errorMessage: terminalError ? assistant.errorMessage || "The model request failed." : null,
      provider: assistant.provider || null,
      model: assistant.model || null,
      timestamp: assistant.timestamp || undefined,
      stopped: generation.status === "stopped",
      status: generation.status === "stopped" ? "stopped" : null,
    },
  };
}

export function buildLiveToolSegment(
  generation: ActiveGenerationView,
  block: LiveBlock,
): Extract<TraceSegment, { kind: "tool" }> {
  const execution = generation.toolExecutions[block.toolCallId || ""] || {};
  const toolCallId = block.toolCallId || block.identity;
  return {
    kind: "tool",
    id: `tool:${toolCallId}`,
    tool: buildLiveToolItem(toolCallId, execution, { name: block.name, kind: block.toolKind, subject: block.subject, input: block.input }),
  };
}

function buildLiveErrorSegment(
  assistant: ActiveGenerationView["assistantMessages"][number],
): Extract<TraceSegment, { kind: "error" }> {
  return {
    kind: "error",
    id: `error:${assistant.id}`,
    message: {
      id: assistant.id,
      role: "assistant",
      content: "",
      stopReason: "error",
      errorMessage: assistant.errorMessage || "The model request failed.",
      provider: assistant.provider || null,
      model: assistant.model || null,
      timestamp: assistant.timestamp || undefined,
    },
  };
}

export function buildLiveToolItem(
  toolCallId: string,
  execution: ActiveGenerationView["toolExecutions"][string] = {},
  fallback: { name?: string; kind?: ToolKind; subject?: string; input?: unknown } = {},
): ToolItem {
  return {
    toolCallId,
    name: execution.name || fallback.name || "tool",
    kind: execution.kind || fallback.kind || "other",
    ...(execution.subject || fallback.subject ? { subject: execution.subject || fallback.subject } : {}),
    ...(execution.timestamp ? { timestamp: execution.timestamp } : {}),
    ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
    input: execution.input ?? fallback.input,
    output: execution.output,
    done: execution.status === "complete" || execution.status === "error" || execution.status === "cancelled",
    isError: Boolean(execution.isError || execution.status === "error"),
    cancelled: execution.status === "cancelled",
  };
}

/*
 * `settleGenerationTools` and `freezeGeneration` were here.
 *
 * Both existed to turn a finished live generation into transcript rows: the
 * tools it ran, and the messages it wrote, assembled out of the deltas this
 * client had drawn. The server states all of that now -- every message opened
 * where it belongs and closed with what it says, every tool opened and closed
 * with what it returned -- so assembling a second version here could only ever
 * disagree with the first, which is what the reader saw as an answer changing
 * shape after it had settled.
 */

const turnTime = (startedAt?: string | null, endedAt?: string | null) => ({
  ...(startedAt ? { startedAt } : {}),
  ...(endedAt ? { endedAt } : {}),
});

function liveRows(generation: ActiveGenerationView, owner: Message | null): TurnRow[] {
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const segments: TraceSegment[] = [];
  const answers: TurnRow[] = [];
  let answerIndex = 0;
  for (const assistant of generation.assistantMessages) {
    const answer = assistant.blocks
      .filter((block) => block.kind === "text" && classifications[block.identity] === "answer")
      .map((block) => block.text || "")
      .join("\n");
    for (const block of assistant.blocks) {
      if (block.kind === "thinking") {
        segments.push({ kind: "thinking", id: block.identity, text: block.text || "", live: block.status === "streaming",
          ...(block.redacted && !block.text ? { hidden: true } : {}) });
      } else if (block.kind === "narration") {
        segments.push({ kind: "narration", id: block.identity, text: block.text || "", live: block.status === "streaming" });
      } else if (block.kind === "text" && classifications[block.identity] === "interim") {
        segments.push({ kind: "narration", id: block.identity, text: block.text || "", live: block.status === "streaming" });
      } else if (block.kind === "tool_call") {
        segments.push(buildLiveToolSegment(generation, block));
      }
    }
    const terminalError = generation.status === "failed"
      && assistant.stopReason === "error"
      && generation.assistantMessages.at(-1) === assistant;
    // Only an error the turn moved past belongs in the trace, which is what the
    // persisted path means by `assistant !== finalAssistant`. The last message
    // is either the turn's own failure, and renders as the answer row below, or
    // one Pi is still retrying - and a retry in flight is not a failed request.
    if (assistant.stopReason === "error" && generation.assistantMessages.at(-1) !== assistant) {
      segments.push(buildLiveErrorSegment(assistant));
    }
    if (answer || terminalError) {
      const content = generation.continuation && answers.length === 0
        ? mergeContinuation(generation.continuationBase || "", answer)
        : answer;
      answers.push({
        key: answerDisplayKey(owner, answerIndex, `live:${generation.id}`),
        displayKey: answerDisplayKey(owner, answerIndex, `live:${generation.id}`),
        type: "message",
        live: active(generation),
        streamVersion: generation.lastSeq,
        precedingUserId: owner?.id,
        value: {
          id: `live:${generation.id}:${assistant.id}`,
          role: "assistant",
          content,
          stopReason: assistant.stopReason || undefined,
          errorMessage: terminalError ? assistant.errorMessage || "The model request failed." : null,
          provider: assistant.provider || null,
          model: assistant.model || null,
          timestamp: assistant.timestamp || undefined,
          stopped: generation.status === "stopped",
          status: generation.status === "stopped" ? "stopped" : null,
        },
      });
      answerIndex += 1;
    }
  }
  const rows: TurnRow[] = [];
  if (segments.length) {
    const running = active(generation);
    const latestTool = segments.findLast((segment) => segment.kind === "tool");
    const executingTool = running && latestTool?.kind === "tool" && latestTool.tool.done === false;
    const status = generation.status === "stopped" ? "interrupted"
      : generation.status === "failed" ? "failed"
      : generation.status === "complete" ? "complete"
      : executingTool ? "executing_tool" : "thinking";
    rows.push({ key: `trace:${owner ? owner.id : `live:${generation.id}`}`, type: "trace", value: { active: running, status, segments, ...turnTime(owner?.timestamp, running ? undefined : generation.assistantMessages.at(-1)?.timestamp) }, precedingUserId: owner?.id, answerless: answers.length === 0, timestamp: generation.assistantMessages.at(-1)?.timestamp || undefined });
  }
  rows.push(...answers);
  // Held only until something of the turn shows: its trace, once it has one,
  // is what says it is working.
  if (!answers.length && !segments.length && active(generation) && generation.status !== "stopping") {
    rows.push({ key: `pending:${owner ? owner.id : generation.id}`, type: "pending", value: null, precedingUserId: owner?.id,
      ...(owner?.timestamp ? { startedAt: owner.timestamp } : {}) });
  }
  return rows;
}

/** Overlay one live turn onto an already projected persisted transcript. */
export function projectLiveTurn(
  persistedRows: TurnRow[],
  messages: Message[],
  generation: ActiveGenerationView,
): TurnRow[] {
  const owner = liveOwner(messages, generation);
  if (!owner) return [...persistedRows, ...liveRows(generation, null)];
  const ownerRow = persistedRows.findIndex((row) => row.key === `message:${owner.id}`);
  if (ownerRow < 0) return [...persistedRows, ...liveRows(generation, owner)];
  let nextTurn = ownerRow + 1;
  while (nextTurn < persistedRows.length) {
    const row = persistedRows[nextTurn]!;
    if (row.type === "message" && row.value.role === "user") break;
    nextTurn += 1;
  }
  return [
    ...persistedRows.slice(0, ownerRow + 1),
    ...liveRows(generation, owner),
    ...persistedRows.slice(nextTurn),
  ];
}

function sameSources(
  left: PersistedTurnProjection,
  right: PersistedTurn,
  sourceTools: ToolItem[],
): boolean {
  return left.userMessage === right.userMessage
    && left.assistants.length === right.assistants.length
    && left.assistants.every((message, index) => message === right.assistants[index])
    && left.sourceTools.length === sourceTools.length
    && left.sourceTools.every((tool, index) => tool === sourceTools[index]);
}

function persistedRowsForTurn(turn: PersistedTurn, messages: Message[], toolById: Map<string, ToolItem>): TurnRow[] {
  const rows: TurnRow[] = [];
  if (turn.userMessage) {
    rows.push({ key: `message:${turn.userMessage.id}`, type: "message", value: turn.userMessage });
  }
  if (!turn.assistants.length) return rows;
  const segments: TraceSegment[] = [];
  const claimed = new Set<string>();
  const finalAssistant = turn.assistants.at(-1) || null;
  // A message says what it is, and is taken at its word. One the harness is
  // not carrying forward (`discarded`) is not an answer: it is the trace's
  // last, struck-through step, so a stopped turn is one row.
  const answerAssistants = turn.assistants.filter((assistant) => {
    if (assistant.stopReason === "error" && assistant !== finalAssistant) return false;
    if (assistant.discarded === true) return false;
    return !statedInterim(assistant);
  });
  for (const assistant of turn.assistants) {
    const discarded = assistant.discarded === true;
    const thinking = thinkingOf(assistant);
    if (thinking) segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: thinking, ...(discarded ? { discarded } : {}) });
    else if ((assistant.blocks || []).some((block) => block.kind === "thinking" && block.redacted)) {
      segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: "", hidden: true });
    }
    if (!answerAssistants.includes(assistant) && String(assistant.content || "").trim()) {
      segments.push({ kind: "narration", id: `narration:${assistant.id}`, text: String(assistant.content), ...(discarded ? { discarded } : {}) });
    }
    for (const id of toolCallIdsOf(assistant)) {
      const tool = toolById.get(id);
      if (tool && !claimed.has(id)) { claimed.add(id); segments.push({ kind: "tool", id: `tool:${id}`, tool }); }
    }
    if (assistant.stopReason === "error" && assistant !== finalAssistant) {
      segments.push({ kind: "error", id: `error:${assistant.id}`, message: assistant });
    }
  }
  const answer = answerAssistants.at(-1) || null;
  const answerText = answerAssistants.map((assistant) => String(assistant.content || "").trim()).filter(Boolean).join("\n\n");
  // A turn stopped before it wrote anything, with no trace to say so, keeps its
  // empty answer as the row that does -- and that Regenerate hangs off.
  const stoppedBare = answer === finalAssistant && Boolean(answer?.stopped) && segments.length === 0;
  const hasAnswerRow = Boolean(answer && (answerText || (answer === finalAssistant && answer.stopReason === "error") || stoppedBare));
  if (segments.length > 0) {
    const outcome = turn.userMessage?.outcome;
    rows.push({
      key: `trace:${turn.userMessage ? turn.userMessage.id : turn.assistants[0]!.id}`,
      type: "trace",
      value: { active: false, status: outcome || "complete", segments, ...turnTime(turn.userMessage?.timestamp, finalAssistant?.timestamp) },
      precedingUserId: turn.userMessage?.id,
      answerless: !hasAnswerRow,
      timestamp: finalAssistant?.timestamp || undefined,
      ...(turn.userMessage && !outcome ? { unstated: true } : {}),
    });
  }
  if (hasAnswerRow && answer) {
    const displayKey = answerDisplayKey(turn.userMessage, 0, `message:${answer.id}`);
    rows.push({
      key: displayKey,
      displayKey,
      type: "message",
      value: answerAssistants.length === 1 ? answer : { ...answer, content: answerText },
      precedingUserId: turn.userMessage?.id,
      traced: segments.length > 0,
    });
  }
  return rows;
}

export function projectPersistedTurns(
  messages: Message[],
  tools: ToolItem[],
  previous: PersistedTurnProjection[] = [],
): { rows: TurnRow[]; turns: PersistedTurnProjection[] } {
  // Prompts first, so an answer can be given to the prompt it names whether or
  // not that prompt has been reached yet. Assigning as we go made grouping
  // depend on the order the rows happen to be in, which is the thing being
  // replaced.
  const turns: PersistedTurn[] = [];
  const byPrompt = new Map<string, PersistedTurn>();
  const turnAt = new Map<Message, PersistedTurn>();
  let current: PersistedTurn = { userMessage: null, assistants: [] };
  turns.push(current);
  for (const message of messages) {
    if (message.role !== "user") { turnAt.set(message, current); continue; }
    current = { userMessage: message, assistants: [] };
    turns.push(current);
    if (message.id) byPrompt.set(message.id, current);
  }
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    // An answer still arriving is drawn by the live overlay, not from here. Its
    // row is in the list all the same, holding the place the overlay is drawn
    // in, and settles into an ordinary answer when the turn ends.
    if (message.streaming) continue;
    // An answer belongs to the prompt it says it answers. Reading that off the
    // transcript instead -- whichever prompt the row happens to sit under --
    // is the guess that put one turn's work beneath another turn's prompt.
    const answers = statedAnswers(message);
    const stated = answers ? byPrompt.get(answers) : null;
    (stated || turnAt.get(message) || current).assistants.push(message);
  }

  // A message states the tools it called, so a tool has an owner or it has not
  // run yet -- in which case the live overlay is drawing it and the transcript
  // has nothing to say about it yet. Matching the leftovers to turns by
  // timestamp is what used to put one turn's work under another turn's prompt.

  const previousByKey = new Map(previous.map((turn) => [turn.key, turn]));
  const toolById = new Map(tools.map((tool) => [tool.toolCallId, tool]));
  const projected = turns.map((turn) => {
    const key = turn.userMessage ? `user:${turn.userMessage.id}` : "preamble";
    const sourceTools = [
      ...turn.assistants.flatMap((assistant) => toolCallIdsOf(assistant).map((id) => toolById.get(id)).filter((tool): tool is ToolItem => Boolean(tool))),
    ];
    const cached = previousByKey.get(key);
    if (cached && sameSources(cached, turn, sourceTools)) return cached;
    return {
      key,
      userMessage: turn.userMessage,
      assistants: turn.assistants,
      sourceTools,
      rows: persistedRowsForTurn(turn, messages, toolById),
    };
  });
  return { rows: projected.flatMap((turn) => turn.rows), turns: projected };
}

/**
 * Persisted history retains its transcript projection while a live Generation
 * projects directly from normalized Pi blocks.
 */
export function buildTurnRows(
  messages: Message[],
  tools: ToolItem[],
  opts: {
    activeGeneration?: ActiveGenerationView | null;
  } = {},
): TurnRow[] {
  const persisted = projectPersistedTurns(messages, tools).rows;
  return assertStatedOutcomes(opts.activeGeneration ? projectLiveTurn(persisted, messages, opts.activeGeneration) : persisted);
}
