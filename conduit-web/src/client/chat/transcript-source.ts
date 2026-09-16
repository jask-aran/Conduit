import type { Accessor } from "solid-js";
import type { TurnArtifactSummary } from "../api/live-events";
import type { ChatCapabilities, Message, ToolItem } from "../api/contracts";
import type { ActiveGenerationView, LiveGenerationChange } from "../turn-rows";

/**
 * The slice of a chat store the transcript renders from.
 *
 * `ActiveChatStore` satisfies this structurally. It exists so surfaces without
 * a Conduit chat behind them - an ephemeral harness thread being driven from
 * the Computer, say - can render through the same transcript instead of
 * growing a second, poorer one.
 */
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
  regenerate: (userMessageId: string) => Promise<unknown> | void;
  continueResponse: () => Promise<unknown> | void;
  loadOlder: () => Promise<boolean | undefined>;
}

/**
 * Whether an activity means work is happening *in* the chat, rather than the
 * backend still coming up.
 *
 * Starting the agent is not content. A chat with no messages is still an empty
 * chat while the harness spins up, and that is exactly when the empty-chat
 * layout -- the welcome line and the centred composer -- belongs on screen.
 * Treating "Starting agent…" as content held that layout back until the
 * backend answered, so a new chat opened bottom-docked and bare and then
 * snapped to centred with a heading once it did. The composer still shows the
 * label and its spinner throughout; that is the only place the wait belongs.
 */
export const isChatContentActivity = (
  activity: { kind: string; label: string | null } | null | undefined,
): boolean => Boolean(activity?.label) && activity?.kind !== "starting";
