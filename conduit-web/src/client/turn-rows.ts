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
  assistantMessages: Array<{ id: string; stopReason?: string | null; blocks: LiveBlock[] }>;
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

export type TraceSegment =
  | { kind: "thinking"; id: string; text: string; live?: boolean }
  | { kind: "narration"; id: string; text: string; live?: boolean }
  | { kind: "tool"; id: string; tool: ToolItem };

export interface TurnTraceData {
  active: boolean;
  segments: TraceSegment[];
}

export type TurnRow =
  | { key: string; type: "message"; value: Message; index: number; live?: boolean; streamVersion?: number }
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
const active = (generation: ActiveGenerationView) => !["stopped", "complete", "failed"].includes(generation.status);

function liveRows(generation: ActiveGenerationView, owner: Message | null, index: number): TurnRow[] {
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const segments: TraceSegment[] = [];
  const answers: TurnRow[] = [];
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
        const execution = generation.toolExecutions[block.toolCallId || ""] || {};
        const toolCallId = block.toolCallId || block.identity;
        segments.push({
          kind: "tool",
          id: `tool:${toolCallId}`,
          tool: {
            id: toolCallId,
            name: execution.name || block.name || "tool",
            args: execution.arguments ?? block.arguments,
            partialResult: execution.partialResult,
            result: execution.result,
            done: execution.status === "complete" || execution.status === "error",
            error: Boolean(execution.isError || execution.status === "error"),
          },
        });
      }
    }
    if (answer) {
      const content = generation.continuation && answers.length === 0
        ? mergeContinuation(generation.continuationBase || "", answer)
        : answer;
      answers.push({
        key: `message:live:${generation.id}:${assistant.id}`,
        type: "message",
        index,
        live: active(generation),
        streamVersion: generation.lastSeq,
        value: {
          id: `live:${generation.id}:${assistant.id}`,
          key: `live:${generation.id}:${assistant.id}`,
          role: "assistant",
          content,
          stopped: generation.status === "stopped",
          status: generation.status === "stopped" ? "stopped" : null,
        },
      });
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
      const bubble = [...turn.assistants].reverse().find((assistant) => assistant.stopReason !== "toolUse");
      for (const assistant of turn.assistants) {
        const thinking = thinkingOf(assistant);
        if (thinking) segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: thinking });
        if (assistant !== bubble && String(assistant.content || "").trim()) {
          segments.push({ kind: "narration", id: `narration:${assistant.id}`, text: String(assistant.content) });
        }
        for (const id of toolCallIdsOf(assistant)) {
          const tool = toolById.get(id);
          if (tool && !claimed.has(id)) { claimed.add(id); segments.push({ kind: "tool", id: `tool:${id}`, tool }); }
        }
      }
      for (const tool of turn.leftoverTools) {
        if (!claimed.has(tool.id)) { claimed.add(tool.id); segments.push({ kind: "tool", id: `tool:${tool.id}`, tool }); }
      }
      if (segments.length > 0) rows.push({ key: `trace:${turn.userMessage ? messageKey(turn.userMessage) : messageKey(turn.assistants[0]!)}`, type: "trace", value: { active: false, segments } });
      const text = String(bubble?.content || "").trim();
      if (bubble && text) rows.push({ key: `message:${messageKey(bubble)}`, type: "message", value: bubble, index: messages.indexOf(bubble) });
    }
    if (opts.activeGeneration && turn.userMessage === liveOwner) {
      rows.push(...liveRows(opts.activeGeneration, liveOwner, messages.indexOf(turn.userMessage!)));
      renderedLive = true;
    }
  });
  if (opts.activeGeneration && !renderedLive) rows.push(...liveRows(opts.activeGeneration, null, messages.length));
  return rows;
}
