import { textBlockClassifications } from "../active-generation.js";
import { mergeContinuation } from "../continuation.js";
import type { Message, ToolItem, ToolKind } from "./api/contracts";

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
  // `orb`: in a turn that speaks more than once (TurnLayout conversational) the one row that carries the turn's orb --
  // while it runs the row where it is working, settled its last answer -- and how the turn is.
  | { key: string; type: "message"; value: Message; live?: boolean; streamVersion?: number; displayKey?: string; precedingUserId?: string; traced?: boolean; orb?: TurnOrbState }
  // `timestamp` is the turn's last reply's, for a trace with no answer row to carry it.
  | { key: string; type: "trace"; value: TurnTraceData; precedingUserId?: string; answerless?: boolean; unstated?: boolean; timestamp?: string; orb?: TurnOrbState }
  // Where the answer will be, from the start of a live turn until its text does.
  | { key: string; type: "pending"; value: null; precedingUserId?: string; startedAt?: string };

export type TurnOrbState = "live" | "settled" | "failed";
/** Gives a conversational turn's orb to one row: the last row while it runs, else its last answer (its last trace
 *  when it has none). */
function placeTurnOrb(rows: TurnRow[], state: TurnOrbState) {
  const own = (row: TurnRow) => row.type === "trace" || (row.type === "message" && row.value.role !== "user");
  const index = state === "live" ? rows.findLastIndex(own)
    : rows.findLastIndex((row) => row.type === "message" && row.value.role !== "user") >= 0
      ? rows.findLastIndex((row) => row.type === "message" && row.value.role !== "user") : rows.findLastIndex(own);
  const row = rows[index];
  if (row && row.type !== "pending") rows[index] = { ...row, orb: state };
  return rows;
}

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

/**
 * How a turn is laid out. Every chat draws the work as one trace and the last message as the answer, folding what the
 * agent says between tool calls into the trace. A conversational chat (the persistent agent's threads) talks as it
 * works, so each message it writes is drawn as it comes, with the work before it as its own trace row: work, text,
 * work, text. Keys follow one rule in the live and settled paths so a turn settles in place: the turn's trace rows are
 * `trace:<owner>` then `trace:<owner>:<n>`, its answers `answer:<owner>:<n>`, n counting the messages that had text.
 */
export type TurnLayout = { conversational?: boolean };
const traceGroupKey = (base: string, group: number) => group === 0 ? `trace:${base}` : `trace:${base}:${group}`;

export type LiveBlockLocation =
  | { kind: "trace"; rowKey: string; segmentIndex: number }
  | { kind: "answer"; rowKey: string; assistantId: string };

export interface LiveProjectionIndex {
  generationId: string;
  traceRowKey: string | null;
  blockLocations: Map<string, LiveBlockLocation>;
  toolLocations: Map<string, { rowKey: string; segmentIndex: number }>;
  answerBlockIdentities: Map<string, Set<string>>;
  answerRowKeys: Map<string, string>;
  firstAnswerAssistantId: string | null;
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
/**
 * The part of a live turn still being written: the messages answering its
 * latest prompt.
 *
 * A message steered into a running turn makes one generation answer two
 * prompts. What answered the first is closed by then, so it is drawn from what
 * the server stated, exactly as a reload draws it; only what answers the
 * prompt now being answered is drawn from paint. Projecting the whole
 * generation under its first prompt drew the steered message's answer above
 * the message, then moved it at settle.
 */
export function currentSegment(generation: ActiveGenerationView, messages: Message[]): ActiveGenerationView {
  if (!generation.assistantMessages.length) return generation;
  const rows = new Map(messages.map((message) => [message.id, message]));
  const ownerOf = (id: string) => { const row = rows.get(id); return row ? statedAnswers(row) : undefined; };
  const latest = generation.assistantMessages.map((assistant) => ownerOf(assistant.id)).findLast((owner) => owner != null);
  if (latest == null) return generation;
  // A prompt taken after the latest answer, once that answer's turn has said
  // how it ended, is the one now being answered, though nothing answers it yet:
  // the turn before it is finished and drawn as stated, not as still writing.
  const ownerIndex = messages.findIndex((message) => message.id === latest);
  const moved = ownerIndex >= 0 && lastPromptIndex(messages) > ownerIndex && Boolean(messages[ownerIndex]!.outcome)
    // An answer still arriving is drawn from paint until it closes.
    && !generation.assistantMessages.some((assistant) => rows.get(assistant.id)?.streaming);
  const kept = generation.assistantMessages.filter((assistant) => {
    const owner = ownerOf(assistant.id);
    return owner == null || (!moved && owner === latest);
  });
  return kept.length === generation.assistantMessages.length ? generation : { ...generation, assistantMessages: kept };
}

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
  wholeGeneration: ActiveGenerationView,
  messages: Message[],
  layout: TurnLayout = {},
): LiveProjectionIndex {
  if (layout.conversational) return conversationalLiveIndex(currentSegment(wholeGeneration, messages), messages);
  const generation = currentSegment(wholeGeneration, messages);
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const ownerIndex = liveOwnerIndex(messages, generation);
  const owner = ownerIndex < 0 ? null : messages[ownerIndex]!;
  const traceRowKey = `trace:${owner ? owner.id : `live:${generation.id}`}`;
  const blockLocations = new Map<string, LiveBlockLocation>();
  const toolLocations = new Map<string, { rowKey: string; segmentIndex: number }>();
  const answerBlockIdentities = new Map<string, Set<string>>();
  const answerRowKeys = new Map<string, string>();
  let firstAnswerAssistantId: string | null = null;
  let answerIndex = 0;
  let segmentIndex = 0;

  for (const assistant of generation.assistantMessages) {
    const answerBlocks = new Set<string>();
    for (const block of assistant.blocks) {
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
    traceRowKey: segmentIndex ? traceRowKey : null,
    blockLocations,
    toolLocations,
    answerBlockIdentities,
    answerRowKeys,
    firstAnswerAssistantId,
  };
}

/** Where each block of a conversational live turn is drawn: `conversationalLiveRows`' walk, without building rows. */
function conversationalLiveIndex(generation: ActiveGenerationView, messages: Message[]): LiveProjectionIndex {
  const owner = liveOwner(messages, generation);
  const base = owner ? owner.id : `live:${generation.id}`;
  const blockLocations = new Map<string, LiveBlockLocation>();
  const toolLocations = new Map<string, { rowKey: string; segmentIndex: number }>();
  const answerBlockIdentities = new Map<string, Set<string>>();
  const answerRowKeys = new Map<string, string>();
  let firstAnswerAssistantId: string | null = null;
  let group = 0;
  let answers = 0;
  let segmentIndex = 0;
  for (const assistant of generation.assistantMessages) {
    const texts = assistant.blocks.filter((block) => block.kind === "text");
    let answered = false;
    for (const block of assistant.blocks) {
      if (block.kind === "text") {
        if (answered) continue;
        answered = true;
        const rowKey = answerDisplayKey(owner, answers, `live:${generation.id}`);
        answerRowKeys.set(assistant.id, rowKey);
        if (!firstAnswerAssistantId) firstAnswerAssistantId = assistant.id;
        answerBlockIdentities.set(assistant.id, new Set(texts.map((text) => text.identity)));
        for (const text of texts) blockLocations.set(text.identity, { kind: "answer", rowKey, assistantId: assistant.id });
        answers += 1; group += 1; segmentIndex = 0;
        continue;
      }
      const rowKey = traceGroupKey(base, group);
      blockLocations.set(block.identity, { kind: "trace", rowKey, segmentIndex });
      if (block.kind === "tool_call") toolLocations.set(block.toolCallId || block.identity, { rowKey, segmentIndex });
      segmentIndex += 1;
    }
    if (assistant.stopReason === "error" && generation.assistantMessages.at(-1) !== assistant) segmentIndex += 1;
  }
  return { generationId: generation.id, traceRowKey: segmentIndex ? traceGroupKey(base, group) : null, blockLocations, toolLocations,
    answerBlockIdentities, answerRowKeys, firstAnswerAssistantId };
}

/** A conversational live turn (`TurnLayout`): each message's text where it was written, the work between as traces. */
function conversationalLiveRows(generation: ActiveGenerationView, owner: Message | null, tools: ToolItem[]): TurnRow[] {
  const base = owner ? owner.id : `live:${generation.id}`;
  const running = active(generation);
  const rows: TurnRow[] = [];
  let segments: TraceSegment[] = [];
  let group = 0;
  let answers = 0;
  const trace = (last: boolean) => {
    const latestTool = segments.findLast((segment) => segment.kind === "tool");
    const executingTool = running && latestTool?.kind === "tool" && latestTool.tool.done === false;
    const status = !last ? "complete" : generation.status === "stopped" ? "interrupted" : generation.status === "failed" ? "failed"
      : generation.status === "complete" ? "complete" : executingTool ? "executing_tool" : "thinking";
    rows.push({ key: traceGroupKey(base, group), type: "trace", value: { active: last && running, status, segments,
      ...turnTime(owner?.timestamp, last && running ? undefined : owner?.timing?.endedAt || generation.assistantMessages.at(-1)?.timestamp) },
      precedingUserId: owner?.id, answerless: last, timestamp: generation.assistantMessages.at(-1)?.timestamp || undefined });
  };
  for (const assistant of generation.assistantMessages) {
    const text = assistant.blocks.filter((block) => block.kind === "text").map((block) => block.text || "").join("\n");
    const terminalError = generation.status === "failed" && assistant.stopReason === "error" && generation.assistantMessages.at(-1) === assistant;
    let answered = false;
    const answer = () => {
      if (answered || !(text || terminalError)) return;
      answered = true;
      // Every turn opens with its trace, the turn's header, even before any work: an answer under none is not drawn.
      if (segments.length || !rows.some((row) => row.type === "trace")) trace(false);
      const content = generation.continuation && answers === 0 ? mergeContinuation(generation.continuationBase || "", text) : text;
      const key = answerDisplayKey(owner, answers, `live:${generation.id}`);
      rows.push({ key, displayKey: key, type: "message", traced: rows.some((row) => row.type === "trace"), live: running,
        streamVersion: generation.lastSeq, precedingUserId: owner?.id, value: liveAnswerMessage(generation, assistant, content, terminalError) });
      answers += 1; group += 1; segments = [];
    };
    for (const block of assistant.blocks) {
      if (block.kind === "text") answer();
      else if (block.kind === "thinking") {
        segments.push({ kind: "thinking", id: block.identity, text: block.text || "", live: block.status === "streaming",
          ...(block.redacted && !block.text ? { hidden: true } : {}) });
      } else if (block.kind === "narration") segments.push({ kind: "narration", id: block.identity, text: block.text || "", live: block.status === "streaming" });
      else if (block.kind === "tool_call") segments.push(buildLiveToolSegment(generation, block, tools));
    }
    if (assistant.stopReason === "error" && generation.assistantMessages.at(-1) !== assistant) segments.push(buildLiveErrorSegment(assistant));
    answer();
  }
  const endedEarly = generation.status === "stopped" || generation.status === "failed";
  if (segments.length || (endedEarly && !rows.length)) trace(true);
  else {
    // Talking with nothing after: the turn's last trace still says what it is doing, and how it ended.
    const index = rows.findLastIndex((row) => row.type === "trace");
    const last = rows[index];
    if (last?.type === "trace" && (running || endedEarly)) {
      const status = generation.status === "stopped" ? "interrupted" : generation.status === "failed" ? "failed" : "thinking";
      rows[index] = { ...last, value: { ...last.value, active: running, status, ...(running ? { endedAt: undefined } : {}) } };
    }
  }
  if (!rows.length && running && generation.status !== "stopping") {
    rows.push({ key: `pending:${owner ? owner.id : generation.id}`, type: "pending", value: null, precedingUserId: owner?.id,
      ...(owner?.timestamp ? { startedAt: owner.timestamp } : {}) });
  }
  return placeTurnOrb(rows, running ? "live" : endedEarly ? "failed" : "settled");
}

export function buildLiveAnswerRow(
  generation: ActiveGenerationView,
  assistantId: string,
  index: LiveProjectionIndex,
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
    value: liveAnswerMessage(generation, assistant, content, terminalError),
  };
}

// A live answer as the message its row shows: the same whether the turn has a trace or not.
function liveAnswerMessage(generation: ActiveGenerationView, assistant: ActiveGenerationView["assistantMessages"][number], content: string, terminalError: boolean) {
  return {
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
  } satisfies Message;
}

export function buildLiveToolSegment(
  generation: ActiveGenerationView,
  block: LiveBlock,
  tools: ToolItem[] = [],
): Extract<TraceSegment, { kind: "tool" }> {
  const execution = generation.toolExecutions[block.toolCallId || ""] || {};
  const toolCallId = block.toolCallId || block.identity;
  const held = tools.find((tool) => tool.toolCallId === toolCallId);
  return {
    kind: "tool",
    id: `tool:${toolCallId}`,
    tool: buildLiveToolItem(toolCallId, execution, { name: block.name, kind: block.toolKind, subject: held?.agent ? held.subject : block.subject, input: block.input,
      calls: held?.calls, agent: held?.agent }),
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
  fallback: { name?: string; kind?: ToolKind; subject?: string; input?: unknown; calls?: ToolItem["calls"]; agent?: ToolItem["agent"] } = {},
): ToolItem {
  return {
    // A script's calls and a subagent's reference are stated as transcript ops, not generation events.
    ...(fallback.calls ? { calls: fallback.calls } : {}),
    ...(fallback.agent ? { agent: fallback.agent } : {}),
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

function liveRows(generation: ActiveGenerationView, owner: Message | null, tools: ToolItem[]): TurnRow[] {
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
        segments.push(buildLiveToolSegment(generation, block, tools));
      }
    }
    const terminalError = generation.status === "failed"
      && assistant.stopReason === "error"
      && generation.assistantMessages.at(-1) === assistant;
    // Only an error the turn moved past belongs in the trace, which is what the
    // persisted path means by `assistant !== finalAssistant`. The last message
    // is either the turn's own failure, and renders as the answer row below, or
    // one backend is still retrying - and a retry in flight is not a failed request.
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
        traced: true,
        live: active(generation),
        streamVersion: generation.lastSeq,
        precedingUserId: owner?.id,
        value: liveAnswerMessage(generation, assistant, content, terminalError),
      });
      answerIndex += 1;
    }
  }
  const rows: TurnRow[] = [];
  // Every turn that has shown anything has its trace: one with no thinking
  // and no tools is its header alone -- the orb, what it is doing, the time.
  // One stopped or failed before it showed anything is that header too, as
  // the saved turn is (endedEarly): without a row the thread still ended at
  // the prompt, and its starting header stayed up, counting, until a reload.
  const endedEarly = generation.status === "stopped" || generation.status === "failed";
  if (segments.length || answers.length || endedEarly) {
    const running = active(generation);
    const latestTool = segments.findLast((segment) => segment.kind === "tool");
    const executingTool = running && latestTool?.kind === "tool" && latestTool.tool.done === false;
    const status = generation.status === "stopped" ? "interrupted"
      : generation.status === "failed" ? "failed"
      : generation.status === "complete" ? "complete"
      : executingTool ? "executing_tool" : "thinking";
    rows.push({ key: `trace:${owner ? owner.id : `live:${generation.id}`}`, type: "trace", value: { active: running, status, segments, ...turnTime(owner?.timestamp, running ? undefined : owner?.timing?.endedAt || generation.assistantMessages.at(-1)?.timestamp) }, precedingUserId: owner?.id, answerless: answers.length === 0, timestamp: generation.assistantMessages.at(-1)?.timestamp || undefined });
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
  wholeGeneration: ActiveGenerationView,
  tools: ToolItem[] = [],
  layout: TurnLayout = {},
): TurnRow[] {
  const generation = currentSegment(wholeGeneration, messages);
  const owner = liveOwner(messages, generation);
  const live = layout.conversational ? conversationalLiveRows : liveRows;
  if (!owner) return [...persistedRows, ...live(generation, null, tools)];
  const ownerRow = persistedRows.findIndex((row) => row.key === `message:${owner.id}`);
  if (ownerRow < 0) return [...persistedRows, ...live(generation, owner, tools)];
  let nextTurn = ownerRow + 1;
  while (nextTurn < persistedRows.length) {
    const row = persistedRows[nextTurn]!;
    if (row.type === "message" && row.value.role === "user") break;
    nextTurn += 1;
  }
  return [
    ...persistedRows.slice(0, ownerRow + 1),
    ...live(generation, owner, tools),
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

function persistedRowsForTurn(turn: PersistedTurn, toolById: Map<string, ToolItem>): TurnRow[] {
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
  // Every turn that answered has its trace: one with no thinking and no tools
  // is its header alone -- the orb, how it ended, the time -- and one stopped
  // before it wrote anything is that header with nothing under it, so the
  // header is what says so and what Regenerate hangs off. A turn that finished
  // having written nothing leaves no row.
  const hasAnswerRow = Boolean(answer && (answerText || (answer === finalAssistant && answer.stopReason === "error")));
  const outcome = turn.userMessage?.outcome;
  const endedEarly = outcome === "interrupted" || outcome === "failed" || Boolean(finalAssistant?.stopped);
  if (segments.length > 0 || hasAnswerRow || endedEarly) {
    rows.push({
      key: `trace:${turn.userMessage ? turn.userMessage.id : turn.assistants[0]!.id}`,
      type: "trace",
      value: { active: false, status: outcome || "complete", segments, ...turnTime(turn.userMessage?.timestamp, turn.userMessage?.timing?.endedAt || finalAssistant?.timestamp) },
      precedingUserId: turn.userMessage?.id,
      answerless: !hasAnswerRow,
      timestamp: finalAssistant?.timestamp || undefined,
      // Held to the contract where it always was: a turn with steps must say
      // how it ended.
      ...(turn.userMessage && !outcome && segments.length > 0 ? { unstated: true } : {}),
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
      traced: true,
    });
  }
  return rows;
}

/** A settled conversational turn (`TurnLayout`): each message with text as an answer row, the work before it a trace. */
function conversationalRowsForTurn(turn: PersistedTurn, toolById: Map<string, ToolItem>): TurnRow[] {
  const rows: TurnRow[] = [];
  const owner = turn.userMessage;
  if (owner) rows.push({ key: `message:${owner.id}`, type: "message", value: owner });
  if (!turn.assistants.length) return rows;
  const base = owner ? owner.id : turn.assistants[0]!.id;
  const finalAssistant = turn.assistants.at(-1) || null;
  const outcome = owner?.outcome;
  const claimed = new Set<string>();
  let segments: TraceSegment[] = [];
  let group = 0;
  let answers = 0;
  let traced = false;
  const trace = (last: boolean) => {
    traced = true;
    rows.push({ key: traceGroupKey(base, group), type: "trace", value: { active: false, status: last ? outcome || "complete" : "complete", segments,
      ...turnTime(owner?.timestamp, owner?.timing?.endedAt || finalAssistant?.timestamp) }, precedingUserId: owner?.id, answerless: last,
      timestamp: finalAssistant?.timestamp || undefined, ...(last && owner && !outcome && segments.length > 0 ? { unstated: true } : {}) });
  };
  for (const assistant of turn.assistants) {
    const discarded = assistant.discarded === true;
    const thinking = thinkingOf(assistant);
    if (thinking) segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: thinking, ...(discarded ? { discarded } : {}) });
    else if ((assistant.blocks || []).some((block) => block.kind === "thinking" && block.redacted)) {
      segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: "", hidden: true });
    }
    const text = String(assistant.content || "").trim();
    const failed = assistant.stopReason === "error";
    if (discarded && text) segments.push({ kind: "narration", id: `narration:${assistant.id}`, text: String(assistant.content), discarded });
    else if ((text && !(failed && assistant !== finalAssistant)) || (failed && assistant === finalAssistant)) {
      if (segments.length || !traced) trace(false);
      const key = answerDisplayKey(owner, answers, `message:${assistant.id}`);
      rows.push({ key, displayKey: key, type: "message", value: assistant, precedingUserId: owner?.id, traced });
      answers += 1; group += 1; segments = [];
    }
    for (const id of toolCallIdsOf(assistant)) {
      const tool = toolById.get(id);
      if (tool && !claimed.has(id)) { claimed.add(id); segments.push({ kind: "tool", id: `tool:${id}`, tool }); }
    }
    if (failed && assistant !== finalAssistant) segments.push({ kind: "error", id: `error:${assistant.id}`, message: assistant });
  }
  const endedEarly = outcome === "interrupted" || outcome === "failed" || Boolean(finalAssistant?.stopped);
  if (segments.length || (endedEarly && !answers)) trace(true);
  else if (outcome && outcome !== "complete") {
    const index = rows.findLastIndex((row) => row.type === "trace");
    const last = rows[index];
    if (last?.type === "trace") rows[index] = { ...last, value: { ...last.value, status: outcome } };
  }
  return placeTurnOrb(rows, endedEarly ? "failed" : "settled");
}

export function projectPersistedTurns(
  messages: Message[],
  tools: ToolItem[],
  previous: PersistedTurnProjection[] = [],
  layout: TurnLayout = {},
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
      rows: layout.conversational ? conversationalRowsForTurn(turn, toolById) : persistedRowsForTurn(turn, toolById),
    };
  });
  return { rows: projected.flatMap((turn) => turn.rows), turns: projected };
}

/**
 * Persisted history retains its transcript projection while a live Generation
 * projects directly from normalized backend blocks.
 */
export function buildTurnRows(
  messages: Message[],
  tools: ToolItem[],
  opts: {
    activeGeneration?: ActiveGenerationView | null;
  } & TurnLayout = {},
): TurnRow[] {
  const persisted = projectPersistedTurns(messages, tools, [], opts).rows;
  return opts.activeGeneration ? projectLiveTurn(persisted, messages, opts.activeGeneration, tools, opts) : persisted;
}
