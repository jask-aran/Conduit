import type { Message, ToolItem } from "./api/contracts";
// The fold is shared with the server, which replays the same statements out of
// its own journal. One description of what a transcript is, applied at both
// ends -- see `src/transcript-fold.js`.
export {
  applyToolOp, applyTranscriptOp, displayUserText, isToolOp, openMessage, truncateAt,
} from "../transcript-fold.js";
export type { ProtocolMessage, TranscriptOp } from "../transcript-fold";

export interface ToolLifecycleEvent {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId?: string;
  id?: string;
  toolName?: string;
  name?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  done?: boolean;
  isError?: boolean;
  error?: boolean;
  timestamp?: string;
  seq?: number;
}

/**
 * Fold live tool activity into the record the server stated.
 *
 * Which tools ran, and what they returned, is stated as ops; this is only the
 * output arriving while one is still running. A tool nobody has stated yet is
 * still taken -- an ephemeral record has no transcript to state into, and the
 * activity is all there is.
 */
export function mergeToolEvent(tools: ToolItem[], event: ToolLifecycleEvent, options: { nextSeq?: () => number } = {}) {
  const id = event.toolCallId || event.id;
  if (!id) return { tools, created: false };
  const existing = tools.find((item) => item.id === id);
  if (existing) {
    return {
      tools: tools.map((item) => (item.id === id
        ? {
          ...item,
          name: event.toolName || item.name,
          args: event.args !== undefined ? event.args : item.args,
          partialResult: event.partialResult !== undefined ? event.partialResult : item.partialResult,
          result: event.result !== undefined ? event.result : item.result,
          done: event.done != null ? event.done : (event.type === "tool_execution_end" ? true : item.done),
          error: event.isError != null ? Boolean(event.isError) : (event.error != null ? Boolean(event.error) : item.error),
        }
        : item)),
      created: false,
    };
  }
  const seq = typeof options.nextSeq === "function" ? options.nextSeq() : (event.seq ?? tools.length);
  const tool: ToolItem = {
    id,
    name: event.toolName || event.name || "tool",
    args: event.args,
    done: Boolean(event.done) || event.type === "tool_execution_end",
    error: Boolean(event.isError || event.error),
    timestamp: event.timestamp || new Date().toISOString(),
    seq,
    result: event.result,
    partialResult: event.partialResult,
  };
  return { tools: [...tools, tool], created: true };
}

export function assignToolSeq(tools: ToolItem[] = []): ToolItem[] {
  return tools.map((tool, index) => ({ ...tool, seq: tool.seq == null ? index : tool.seq }));
}

/**
 * The whole transcript, as the server has it.
 *
 * A full load is the entire truth about a chat, so it replaces rather than
 * merges: a message it does not contain is a message the chat no longer has.
 * Merging one in made a load that landed after a fork put the abandoned
 * branch back. Only rows the server has never seen survive it: the composer's
 * own unsent messages, and an answer still arriving over the socket.
 */
export function replaceMessages(current: Message[], incoming: Message[]): Message[] {
  const kept = current.filter((message) => (message.pending || message.streaming)
    && !incoming.some((item) => item.id === message.id));
  return [...incoming, ...kept];
}
