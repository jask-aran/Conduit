import { textBlockClassifications } from "../active-generation.js";
import { mergeContinuation } from "../continuation.js";
import type { Message, ToolItem } from "./api/contracts";

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
  segments: TraceSegment[];
}

export type TurnRow =
  // precedingUserId is carried on the row rather than looked up per render.
  // The projection already knows which user message opened the turn; making
  // each row rediscover it meant a backwards scan of the whole message list
  // per assistant row, which is quadratic in a long chat.
  | { key: string; type: "message"; value: Message; index: number; live?: boolean; streamVersion?: number; displayKey?: string; precedingUserId?: string }
  | { key: string; type: "trace"; value: TurnTraceData };

const thinkingOf = (message: Message): string => (message.blocks || [])
  .filter((block) => block.type === "thinking")
  .map((block) => block.thinking || "")
  .join("\n")
  .trim();

const toolCallIdsOf = (message: Message): string[] => (message.blocks || [])
  .filter((block) => block.type === "toolCall" && typeof block.id === "string")
  .map((block) => block.id as string);

const messageKey = (message: Message) => message.key || message.id;
const answerDisplayKey = (owner: Message | null, answerIndex: number, fallback: string) =>
  `answer:${owner ? messageKey(owner) : fallback}:${answerIndex}`;
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

const liveOwner = (messages: Message[], generation: ActiveGenerationView) =>
  [...messages].reverse().find((message) => message.role === "user" && !message.pending) || null;

export function buildLiveProjectionIndex(
  generation: ActiveGenerationView,
  messages: Message[],
): LiveProjectionIndex {
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const owner = liveOwner(messages, generation);
  const messageIndex = owner ? messages.indexOf(owner) : messages.length;
  const traceRowKey = `trace:${owner ? messageKey(owner) : `live:${generation.id}`}`;
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
  messageIndex: number,
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
    index: messageIndex,
    live: active(generation),
    streamVersion: generation.lastSeq,
    precedingUserId,
    value: {
      id: `live:${generation.id}:${assistantId}`,
      key: `live:${generation.id}:${assistantId}`,
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
    done: execution.status === "complete" || execution.status === "error",
    error: Boolean(execution.isError || execution.status === "error"),
  };
}

function liveRows(generation: ActiveGenerationView, owner: Message | null, index: number): TurnRow[] {
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
    if (answer || terminalError) {
      const content = generation.continuation && answers.length === 0
        ? mergeContinuation(generation.continuationBase || "", answer)
        : answer;
      answers.push({
        key: answerDisplayKey(owner, answerIndex, `live:${generation.id}`),
        displayKey: answerDisplayKey(owner, answerIndex, `live:${generation.id}`),
        type: "message",
        index,
        live: active(generation),
        streamVersion: generation.lastSeq,
        precedingUserId: owner?.id,
        value: {
          id: `live:${generation.id}:${assistant.id}`,
          key: `live:${generation.id}:${assistant.id}`,
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
  if (segments.length) rows.push({ key: `trace:${owner ? messageKey(owner) : `live:${generation.id}`}`, type: "trace", value: { active: active(generation), segments } });
  rows.push(...answers);
  return rows;
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
  interface Turn { userMessage: Message | null; assistants: Message[]; leftoverTools: ToolItem[] }
  const turns: Turn[] = [];
  let current: Turn = { userMessage: null, assistants: [], leftoverTools: [] };
  for (const message of messages) {
    if (message.role === "user") {
      turns.push(current);
      current = { userMessage: message, assistants: [], leftoverTools: [] };
    } else if (message.role === "assistant") {
      current.assistants.push(message);
    }
  }
  turns.push(current);

  const referenced = new Set<string>();
  for (const turn of turns) for (const assistant of turn.assistants) for (const id of toolCallIdsOf(assistant)) referenced.add(id);
  const timedTurns = turns.filter((turn) => turn.userMessage);
  for (const tool of tools) {
    if (referenced.has(tool.id)) continue;
    const timestamp = Date.parse(tool.timestamp || "") || 0;
    let owner: Turn | null = null;
    for (const turn of timedTurns) {
      const userTimestamp = Date.parse(turn.userMessage!.timestamp || "") || 0;
      if (userTimestamp <= timestamp) owner = turn;
    }
    const fallback = owner || turns[turns.length - 1];
    if (fallback) fallback.leftoverTools.push(tool);
  }

  const liveOwner = opts.activeGeneration
    ? [...messages].reverse().find((message) => message.role === "user" && !message.pending) || null
    : null;
  const rows: TurnRow[] = [];
  let renderedLive = false;
  turns.forEach((turn, turnIndex) => {
    const directLive = Boolean(opts.activeGeneration && turn.userMessage === liveOwner);
    if (turn.userMessage) {
      rows.push({ key: `message:${messageKey(turn.userMessage)}`, type: "message", value: turn.userMessage, index: messages.indexOf(turn.userMessage) });
    }
    if (turn.assistants.length && !directLive) {
      const segments: TraceSegment[] = [];
      const claimed = new Set<string>();
      const toolById = new Map(tools.map((tool) => [tool.id, tool]));
      const finalAssistant = turn.assistants.at(-1) || null;
      const lastToolAssistantIndex = turn.assistants.findLastIndex((assistant) => toolCallIdsOf(assistant).length > 0);
      const answerAssistants = turn.assistants.filter((assistant, assistantIndex) => assistant.stopReason !== "toolUse"
        && assistantIndex > lastToolAssistantIndex
        && !(assistant.stopReason === "error" && assistant !== finalAssistant));
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
      if (segments.length > 0) rows.push({ key: `trace:${turn.userMessage ? messageKey(turn.userMessage) : messageKey(turn.assistants[0]!)}`, type: "trace", value: { active: false, segments } });
      const answer = answerAssistants.at(-1) || null;
      const answerText = answerAssistants.map((assistant) => String(assistant.content || "").trim()).filter(Boolean).join("\n\n");
      if (answer && (answerText || (answer === finalAssistant && answer.stopReason === "error"))) {
        const displayKey = answerDisplayKey(turn.userMessage, 0, `message:${messageKey(answer)}`);
        rows.push({
          key: displayKey,
          displayKey,
          type: "message",
          value: answerAssistants.length === 1 ? answer : { ...answer, content: answerText },
          index: messages.indexOf(answer),
          precedingUserId: turn.userMessage?.id,
        });
      }
    }
    if (opts.activeGeneration && turn.userMessage === liveOwner) {
      rows.push(...liveRows(opts.activeGeneration, liveOwner, messages.indexOf(turn.userMessage!)));
      renderedLive = true;
    }
  });
  if (opts.activeGeneration && !renderedLive) rows.push(...liveRows(opts.activeGeneration, null, messages.length));
  return rows;
}
