import type { Message, ToolItem } from "./client/api/contracts";

export interface ProtocolMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
  stopReason?: string;
  errorMessage?: string | null;
}

export interface TranscriptOp {
  op?: string;
  message?: ProtocolMessage;
  after?: string | null;
  answers?: string | null;
  messageId?: string | null;
  stopReason?: string | null;
  content?: string;
  blocks?: unknown[];
  interim?: boolean;
  discarded?: boolean;
  inclusive?: boolean;
  generationId?: string | null;
  toolCallId?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  timestamp?: string;
}

export function displayUserText(message?: ProtocolMessage | Message | null): string;
export function openMessage(messages: Message[], incoming: Message, after: string | null): Message[];
export function truncateAt(messages: Message[], messageId: string, options?: { inclusive?: boolean }): Message[];
export function applyTranscriptOp(messages: Message[], event: TranscriptOp): Message[];
export function applyToolOp(tools: ToolItem[], event: TranscriptOp): ToolItem[];
export function isToolOp(event: TranscriptOp | null | undefined): boolean;
