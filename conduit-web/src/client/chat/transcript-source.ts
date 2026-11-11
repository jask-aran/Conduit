import type { Accessor } from "solid-js";
import type { TurnArtifactSummary } from "../api/live-events";
import type { AgentSummary, ChatCapabilities, Message, ToolItem } from "../api/contracts";
import type { ActiveGenerationView, LiveGenerationChange } from "../turn-rows";

/** So surfaces without a Conduit chat behind them render through the same transcript instead of a second one. */
export interface TranscriptSource {
  messages: Accessor<Message[]>;
  tools: Accessor<ToolItem[]>;
  activeGeneration: Accessor<ActiveGenerationView | null>;
  activeGenerationChange: Accessor<LiveGenerationChange | null>;
  turnArtifacts: Accessor<{ chatId: string; items: TurnArtifactSummary[] } | null>;
  activity: Accessor<{ kind: string; label: string | null } | null>;
  streaming: Accessor<boolean>;
  loadedId: Accessor<string | null>;
  pageBefore: Accessor<string | null>;
  loadingOlder: Accessor<boolean>;
  editingEntryId: Accessor<string | null>;
  capabilities: Accessor<ChatCapabilities | null>;
  /** Unavailable without a Conduit chat; a read-only source may no-op these. */
  edit: (message: Message) => void;
  cancelEdit: () => void;
  regenerate: (userMessageId: string) => Promise<unknown> | void;
  loadOlder: () => Promise<boolean | undefined>;
  agents?: Accessor<AgentSummary[]>;
  stopAgent?: (id: string) => Promise<unknown> | void;
  cancelOutbox?: (messageId: string) => void;
  turnArtifactTimeline?: (projectId: string, chatId: string) => Promise<TurnArtifactSummary[]>;
}

/** Starting the agent is not content: a chat with no messages keeps the empty-chat layout while the harness spins up,
 *  and the composer alone shows the wait. */
export const isChatContentActivity = (
  activity: { kind: string; label: string | null } | null | undefined,
): boolean => Boolean(activity?.label) && activity?.kind !== "starting";
