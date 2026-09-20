import type { Message, ToolItem } from "./api/contracts";
// The fold is shared with the server, which replays the same statements out of
// its own journal. One description of what a transcript is, applied at both
// ends -- see `src/transcript-fold.js`.
export {
  applyToolOp, applyTranscriptOp, applyTranscriptOps, displayUserText, isToolOp, openMessage, truncateAt,
} from "../transcript-fold.js";
export type { ProtocolMessage, TranscriptOp } from "../transcript-fold";

export interface ToolLifecycleEvent {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  done?: boolean;
  isError?: boolean;
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
  const id = event.toolCallId;
  if (!id) return { tools, created: false };
  const existing = tools.find((item) => item.toolCallId === id);
  if (existing) {
    return {
      tools: tools.map((item) => (item.toolCallId === id
        ? {
          ...item,
          name: event.name || item.name,
          input: event.input !== undefined ? event.input : item.input,
          // A tool that has finished keeps what it returned. Replay can deliver
          // an update behind an end, and with one output field rather than a
          // partial and a final there is nothing but this to stop the partial
          // landing on top of the answer.
          output: event.output !== undefined && !(item.done && event.type !== "tool_execution_end")
            ? event.output : item.output,
          done: event.done != null ? event.done : (event.type === "tool_execution_end" ? true : item.done),
          isError: event.isError != null ? Boolean(event.isError) : item.isError,
        }
        : item)),
      created: false,
    };
  }
  const seq = typeof options.nextSeq === "function" ? options.nextSeq() : (event.seq ?? tools.length);
  const tool: ToolItem = {
    toolCallId: id,
    name: event.name || "tool",
    input: event.input,
    done: Boolean(event.done) || event.type === "tool_execution_end",
    isError: Boolean(event.isError),
    timestamp: event.timestamp || new Date().toISOString(),
    seq,
    output: event.output,
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
