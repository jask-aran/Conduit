import type { Message, ToolItem } from "./api/contracts";

export type TraceSegment =
  | { kind: "thinking"; id: string; text: string; live?: boolean }
  | { kind: "narration"; id: string; text: string }
  | { kind: "tool"; id: string; tool: ToolItem };

export interface TurnTraceData {
  active: boolean;
  segments: TraceSegment[];
}

export type TurnRow =
  | { key: string; type: "message"; value: Message; index: number }
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

/**
 * Project the flat transcript into turn-scoped rows: each user message opens a
 * turn, and the turn's thinking segments, interim narration, and tool calls
 * collapse into a single trace row; only the turn's final assistant text stays
 * a top-level bubble. Thinking arrives as `blocks` on assistant messages (from
 * the transcript, or message_end events); the live segment streams through
 * `opts.reasoning`. Tools not referenced by any message's blocks (older
 * transcripts, live tool events before message_end) attach to the turn of the
 * nearest preceding user message by timestamp.
 */
export function buildTurnRows(
  messages: Message[],
  tools: ToolItem[],
  opts: { streaming?: boolean; reasoning?: { content: string; active: boolean } } = {},
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

  const rows: TurnRow[] = [];
  turns.forEach((turn, turnIndex) => {
    const live = turnIndex === turns.length - 1 && Boolean(opts.streaming);
    if (turn.userMessage) {
      rows.push({ key: `message:${messageKey(turn.userMessage)}`, type: "message", value: turn.userMessage, index: messages.indexOf(turn.userMessage) });
    }
    if (turn.assistants.length === 0) return;
    const segments: TraceSegment[] = [];
    const claimed = new Set<string>();
    const toolById = new Map(tools.map((tool) => [tool.id, tool]));
    // The bubble is the turn's final answer: the last assistant message that was
    // not a tool-use step. Interim (stopReason "toolUse") text joins the trace
    // as narration in chronological position as soon as message_end lands,
    // instead of lingering as a bubble until the next segment starts.
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
    if (live) {
      const thinking = (opts.reasoning?.content || "").trim();
      const currentAssistant = turn.assistants.at(-1);
      const persistedThinking = currentAssistant ? thinkingOf(currentAssistant) : "";
      if (thinking && thinking !== persistedThinking) segments.push({ kind: "thinking", id: `thinking:${currentAssistant?.id || "live"}`, text: thinking, live: true });
    }
    if (segments.length > 0) rows.push({ key: `trace:${turn.userMessage ? messageKey(turn.userMessage) : messageKey(turn.assistants[0]!)}`, type: "trace", value: { active: live, segments } });
    const text = String(bubble?.content || "").trim();
    if (bubble && (text || live)) rows.push({ key: `message:${messageKey(bubble)}`, type: "message", value: bubble, index: messages.indexOf(bubble) });
  });
  return rows;
}
