import { textBlockClassifications } from "../active-generation.js";
import { mergeContinuation } from "../continuation.js";
import type { ContentBlock, Message, ToolItem } from "./api/contracts";

type LiveBlock = {
  type: "thinking" | "text" | "toolCall";
  identity: string;
  contentIndex: number;
  text?: string;
  toolCallId?: string;
  name?: string;
  arguments?: unknown;
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
    arguments?: unknown;
    status?: string;
    partialResult?: unknown;
    result?: unknown;
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
  | { kind: "thinking"; id: string; text: string; live?: boolean }
  | { kind: "narration"; id: string; text: string; live?: boolean }
  | { kind: "error"; id: string; message: Message }
  | { kind: "tool"; id: string; tool: ToolItem };

export interface TurnTraceData {
  active: boolean;
  status: "thinking" | "executing_tool" | "interrupted" | "complete" | "failed";
  segments: TraceSegment[];
}

export type TurnRow =
  // precedingUserId is carried on the row rather than looked up per render.
  // The projection already knows which user message opened the turn; making
  // each row rediscover it meant a backwards scan of the whole message list
  // per assistant row, which is quadratic in a long chat.
  | { key: string; type: "message"; value: Message; live?: boolean; streamVersion?: number; displayKey?: string; precedingUserId?: string }
  | { key: string; type: "trace"; value: TurnTraceData; precedingUserId?: string; answerless?: boolean };

interface PersistedTurn {
  userMessage: Message | null;
  assistants: Message[];
  leftoverTools: ToolItem[];
}

export interface PersistedTurnProjection {
  key: string;
  userMessage: Message | null;
  assistants: Message[];
  leftoverTools: ToolItem[];
  /** What the rows were built from, so an unchanged turn can keep them. */
  sourceTools: ToolItem[];
  rows: TurnRow[];
}

const thinkingOf = (message: Message): string => (message.blocks || [])
  .filter((block) => block.type === "thinking")
  .map((block) => block.thinking || "")
  .join("\n")
  .trim();

const toolCallIdsOf = (message: Message): string[] => (message.blocks || [])
  .filter((block) => block.type === "toolCall" && typeof block.id === "string")
  .map((block) => block.id as string);

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
  const stated = messages[answerIndex]!.answers;
  if (stated) {
    const owner = messages.findIndex((message) => message.id === stated);
    if (owner >= 0) return owner;
  }
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" && !message.pending) return index;
  }
  return -1;
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
      if (block.type === "thinking" || (block.type === "text" && classifications[block.identity] === "interim")) {
        blockLocations.set(block.identity, { kind: "trace", rowKey: traceRowKey, segmentIndex });
        segmentIndex += 1;
      } else if (block.type === "toolCall") {
        blockLocations.set(block.identity, { kind: "trace", rowKey: traceRowKey, segmentIndex });
        const toolCallId = block.toolCallId || block.identity;
        toolLocations.set(toolCallId, { rowKey: traceRowKey, segmentIndex });
        segmentIndex += 1;
      } else if (block.type === "text") {
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
    .filter((block) => block.type === "text" && answerIdentities.has(block.identity))
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
    tool: buildLiveToolItem(toolCallId, execution, { name: block.name, args: block.arguments }),
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
  fallback: { name?: string; args?: unknown } = {},
): ToolItem {
  return {
    id: toolCallId,
    name: execution.name || fallback.name || "tool",
    args: execution.arguments ?? fallback.args,
    partialResult: execution.partialResult,
    result: execution.result,
    done: execution.status === "complete" || execution.status === "error" || execution.status === "cancelled",
    error: Boolean(execution.isError || execution.status === "error"),
    cancelled: execution.status === "cancelled",
  };
}

/** Commit final live tool records without assigning them to transcript turns. */
export function settleGenerationTools(current: ToolItem[], generation: ActiveGenerationView): ToolItem[] {
  const blocks = generation.assistantMessages.flatMap((message) => message.blocks)
    .filter((block) => block.type === "toolCall");
  if (!blocks.length) return current;
  const settled = new Map(blocks.map((block) => {
    const id = block.toolCallId || block.identity;
    return [id, buildLiveToolItem(id, generation.toolExecutions[id], { name: block.name, args: block.arguments })];
  }));
  const next = current.map((tool) => settled.has(tool.id) ? { ...tool, ...settled.get(tool.id)! } : tool);
  const known = new Set(current.map((tool) => tool.id));
  for (const block of blocks) {
    const id = block.toolCallId || block.identity;
    if (!known.has(id)) next.push(settled.get(id)!);
  }
  return next;
}

/**
 * The turn as transcript messages, so it survives the live view.
 *
 * A live generation is the only place a streaming turn exists, and the store
 * installs a fresh one the moment the next turn starts. Freezing the turn the
 * instant it stops puts it in the transcript, where nothing can take it away;
 * the sync that closes the same generation replaces it, matched by the
 * generationId each frozen message carries.
 */
export function freezeGeneration(generation: ActiveGenerationView): Message[] {
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const frozen: Message[] = [];
  for (const assistant of generation.assistantMessages) {
    const content = assistant.blocks
      .filter((block) => block.type === "text" && classifications[block.identity] === "answer")
      .map((block) => block.text || "")
      .join("\n");
    const blocks: ContentBlock[] = assistant.blocks.flatMap((block) => {
      if (block.type === "thinking") return [{ type: "thinking", thinking: block.text || "" } as ContentBlock];
      if (block.type === "toolCall") {
        return [{ type: "toolCall", id: block.toolCallId || block.identity, name: block.name, arguments: block.arguments } as ContentBlock];
      }
      return [] as ContentBlock[];
    });
    if (!content.trim() && !blocks.length) continue;
    frozen.push({
      // The harness named this message when it started streaming, so the row
      // frozen out of it keeps that name and the persisted copy replaces it by
      // id rather than by guesswork.
      id: assistant.id,
      generationId: generation.id,
      role: "assistant",
      content,
      blocks,
      stopped: generation.status === "stopped",
      stopReason: assistant.stopReason || (generation.status === "stopped" ? "aborted" : "stop"),
      provider: assistant.provider || null,
      model: assistant.model || null,
      timestamp: assistant.timestamp || new Date().toISOString(),
    });
  }
  return frozen;
}

function liveRows(generation: ActiveGenerationView, owner: Message | null): TurnRow[] {
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const segments: TraceSegment[] = [];
  const answers: TurnRow[] = [];
  let answerIndex = 0;
  for (const assistant of generation.assistantMessages) {
    const answer = assistant.blocks
      .filter((block) => block.type === "text" && classifications[block.identity] === "answer")
      .map((block) => block.text || "")
      .join("\n");
    for (const block of assistant.blocks) {
      if (block.type === "thinking") {
        segments.push({ kind: "thinking", id: block.identity, text: block.text || "", live: block.status === "streaming" });
      } else if (block.type === "text" && classifications[block.identity] === "interim") {
        segments.push({ kind: "narration", id: block.identity, text: block.text || "", live: block.status === "streaming" });
      } else if (block.type === "toolCall") {
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
    rows.push({ key: `trace:${owner ? owner.id : `live:${generation.id}`}`, type: "trace", value: { active: running, status, segments }, precedingUserId: owner?.id, answerless: answers.length === 0 });
  }
  rows.push(...answers);
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
    && left.leftoverTools.length === right.leftoverTools.length
    && left.leftoverTools.every((tool, index) => tool === right.leftoverTools[index])
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
  // A message that says what it is -- answer or the turn talking as it works --
  // is taken at its word. Only a message from a backend that states nothing
  // falls back to reading the turn's shape: anything before its last tool call
  // is narration, which is right for a turn that ran to completion and wrong
  // for one that was steered after it had already answered.
  const lastToolAssistantIndex = turn.assistants.findLastIndex((assistant) => toolCallIdsOf(assistant).length > 0);
  const answerAssistants = turn.assistants.filter((assistant, assistantIndex) => {
    if (assistant.stopReason === "error" && assistant !== finalAssistant) return false;
    if (assistant.interim !== undefined) return !assistant.interim;
    return assistant.stopReason !== "toolUse" && assistantIndex > lastToolAssistantIndex;
  });
  for (const assistant of turn.assistants) {
    const thinking = thinkingOf(assistant);
    if (thinking) segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: thinking });
    if (!answerAssistants.includes(assistant) && String(assistant.content || "").trim()) {
      segments.push({ kind: "narration", id: `narration:${assistant.id}`, text: String(assistant.content) });
    }
    for (const id of toolCallIdsOf(assistant)) {
      const tool = toolById.get(id);
      if (tool && !claimed.has(id)) { claimed.add(id); segments.push({ kind: "tool", id: `tool:${id}`, tool }); }
    }
    if (assistant.stopReason === "error" && assistant !== finalAssistant) {
      segments.push({ kind: "error", id: `error:${assistant.id}`, message: assistant });
    }
  }
  for (const tool of turn.leftoverTools) {
    if (!claimed.has(tool.id)) { claimed.add(tool.id); segments.push({ kind: "tool", id: `tool:${tool.id}`, tool }); }
  }
  const answer = answerAssistants.at(-1) || null;
  const answerText = answerAssistants.map((assistant) => String(assistant.content || "").trim()).filter(Boolean).join("\n\n");
  const hasAnswerRow = Boolean(answer && (answerText || (answer === finalAssistant && answer.stopReason === "error")));
  if (segments.length > 0) {
    const interrupted = turn.assistants.some((assistant) => assistant.stopped || assistant.stopReason === "aborted");
    const failed = finalAssistant?.stopReason === "error" && !interrupted;
    rows.push({
      key: `trace:${turn.userMessage ? turn.userMessage.id : turn.assistants[0]!.id}`,
      type: "trace",
      value: { active: false, status: interrupted ? "interrupted" : failed ? "failed" : "complete", segments },
      precedingUserId: turn.userMessage?.id,
      answerless: !hasAnswerRow,
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
  let current: PersistedTurn = { userMessage: null, assistants: [], leftoverTools: [] };
  turns.push(current);
  for (const message of messages) {
    if (message.role !== "user") { turnAt.set(message, current); continue; }
    current = { userMessage: message, assistants: [], leftoverTools: [] };
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
    const stated = message.answers ? byPrompt.get(message.answers) : null;
    (stated || turnAt.get(message) || current).assistants.push(message);
  }

  const referenced = new Set<string>();
  for (const turn of turns) for (const assistant of turn.assistants) for (const id of toolCallIdsOf(assistant)) referenced.add(id);
  // A message states the tools it called, so a tool has an owner or it has not
  // run yet -- in which case the live overlay is drawing it and the transcript
  // has nothing to say about it. Only a backend that states no ownership falls
  // back to matching tools to turns by timestamp.
  const statesOwnership = messages.some((message) => message.answers);
  const timedTurns = turns.filter((turn) => turn.userMessage);
  if (!statesOwnership) {
    for (const tool of tools) {
      if (referenced.has(tool.id)) continue;
      const timestamp = Date.parse(tool.timestamp || "") || 0;
      let owner: PersistedTurn | null = null;
      for (const turn of timedTurns) {
        const userTimestamp = Date.parse(turn.userMessage!.timestamp || "") || 0;
        if (userTimestamp <= timestamp) owner = turn;
      }
      const fallback = owner || turns[turns.length - 1];
      if (fallback) fallback.leftoverTools.push(tool);
    }
  }

  const previousByKey = new Map(previous.map((turn) => [turn.key, turn]));
  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  const projected = turns.map((turn) => {
    const key = turn.userMessage ? `user:${turn.userMessage.id}` : "preamble";
    const sourceTools = [
      ...turn.assistants.flatMap((assistant) => toolCallIdsOf(assistant).map((id) => toolById.get(id)).filter((tool): tool is ToolItem => Boolean(tool))),
      ...turn.leftoverTools,
    ];
    const cached = previousByKey.get(key);
    if (cached && sameSources(cached, turn, sourceTools)) return cached;
    return {
      key,
      userMessage: turn.userMessage,
      assistants: turn.assistants,
      leftoverTools: turn.leftoverTools,
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
  return opts.activeGeneration ? projectLiveTurn(persisted, messages, opts.activeGeneration) : persisted;
}
