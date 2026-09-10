import type { Accessor } from "solid-js";
import type { Message, ToolItem } from "../api/contracts";
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
  activity: Accessor<{ kind: string; label: string | null } | null>;
  streaming: Accessor<boolean>;
  loadedId: Accessor<string | null>;
  pageBefore: Accessor<string | null>;
  loadingOlder: Accessor<boolean>;
  editingEntryId: Accessor<string | null>;
  /** Unavailable without a Conduit chat; a read-only source may no-op these. */
  edit: (message: Message) => void;
  regenerate: (userMessageId: string) => Promise<unknown> | void;
  continueResponse: () => Promise<unknown> | void;
  loadOlder: () => Promise<boolean | undefined>;
}
