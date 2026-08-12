import { batch } from "solid-js";
import { createStore } from "solid-js/store";
import {
  contentBlockIdentity,
  createActiveGeneration,
  snapshotActiveGeneration,
} from "../../active-generation.js";

const TERMINAL_STATUSES = new Set(["stopped", "complete", "failed"]);

/** @typedef {import("../turn-rows").ActiveGenerationView} ActiveGenerationView */
/** @typedef {import("../api/live-events").StructuredGenerationEvent} StructuredGenerationEvent */

function terminalStatus(state) {
  const lastMessage = state.assistantMessages.at(-1);
  if (lastMessage?.stopReason === "error") return "failed";
  if (lastMessage?.stopReason === "aborted") return "stopped";
  return "complete";
}

/**
 * Keep the client live-generation view reactive at the block field level.
 * The shared reducer remains the plain-data authority for the server.
 *
 * @param {{ collectMetrics?: boolean }} [options]
 */
export function createClientActiveGenerationStore({ collectMetrics = false } = {}) {
  /** @type {ActiveGenerationView | null} */
  let state = null;
  let setState = null;
  const messagePositions = new Map();
  const blockPositions = new Map();
  let changedAccessorCount = 0;
  let workCount = 0;

  const work = (amount = 1) => {
    if (collectMetrics) workCount += amount;
  };

  const setPath = (path, value) => {
    if (!setState) throw new Error("Cannot update an empty live generation");
    const key = path.at(-1);
    const parent = path.slice(0, -1).reduce((current, part) => current?.[part], state);
    if (parent && Object.prototype.hasOwnProperty.call(parent, key) && Object.is(parent[key], value)) return false;
    if (collectMetrics) changedAccessorCount += 1;
    setState(...path, value);
    return true;
  };

  const rebuildMessageIndex = (messageIndex) => {
    if (!state) return;
    const message = state.assistantMessages[messageIndex];
    if (!message) return;
    work();
    messagePositions.set(message.id, messageIndex);
    const positions = new Map();
    blockPositions.set(message.id, positions);
    message.blocks.forEach((block, blockIndex) => {
      work();
      positions.set(block.contentIndex, blockIndex);
    });
  };

  const rebuildIndexes = () => {
    messagePositions.clear();
    blockPositions.clear();
    if (!state) return;
    state.assistantMessages.forEach((message, messageIndex) => rebuildMessageIndex(messageIndex));
  };

  const install = (next) => {
    const [store, setter] = createStore(next);
    state = store;
    setState = setter;
    rebuildIndexes();
    return state;
  };

  const clear = () => {
    state = null;
    setState = null;
    messagePositions.clear();
    blockPositions.clear();
  };

  const currentMessageIndex = (messageId) => {
    work();
    return messagePositions.get(messageId);
  };

  const currentBlockIndex = (messageId, contentIndex) => {
    work();
    return blockPositions.get(messageId)?.get(contentIndex);
  };

  const blockPath = (messageIndex, blockIndex) => [
    "assistantMessages",
    messageIndex,
    "blocks",
    blockIndex,
  ];

  const addBlock = (messageIndex, incoming) => {
    if (!state) return null;
    const message = state.assistantMessages[messageIndex];
    if (!message) return null;
    const blocks = [...message.blocks, incoming].sort((left, right) => left.contentIndex - right.contentIndex);
    setPath(["assistantMessages", messageIndex, "blocks"], blocks);
    rebuildMessageIndex(messageIndex);
    const blockIndex = currentBlockIndex(message.id, incoming.contentIndex);
    return blockIndex == null ? null : { messageIndex, blockIndex };
  };

  const patchBlock = (messageIndex, blockIndex, patch) => {
    for (const [key, value] of Object.entries(patch)) setPath([...blockPath(messageIndex, blockIndex), key], value);
    return { messageIndex, blockIndex };
  };

  const upsertBlock = (messageId, contentIndex, incoming) => {
    const messageIndex = currentMessageIndex(messageId);
    if (messageIndex == null || !state) return null;
    const blockIndex = currentBlockIndex(messageId, contentIndex);
    if (blockIndex == null) return addBlock(messageIndex, incoming);
    return patchBlock(messageIndex, blockIndex, incoming);
  };

  const appendMessage = (message) => {
    if (!state) return;
    setPath(["assistantMessages"], [...state.assistantMessages, message]);
    rebuildMessageIndex(state.assistantMessages.length - 1);
  };

  const result = (previous, accepted, changed = state !== previous) => {
    const response = {
      state,
      rootChanged: state !== previous,
      changed,
      accepted,
    };
    if (collectMetrics) {
      response.metrics = { changedAccessorCount, workCount };
    }
    return response;
  };

  /**
   * @param {StructuredGenerationEvent} event
   */
  const apply = (event) => {
    const previous = state;
    if (collectMetrics) {
      changedAccessorCount = 0;
      workCount = 0;
    }
    if (!event || !event.generationId) return result(previous, Boolean(previous));

    if (event.type === "generation_resume") {
      if (!event.generation || event.generation.id !== event.generationId) return result(previous, Boolean(previous));
      if (state?.id === event.generationId && state.lastSeq > event.seq) return result(previous, true);
      install(snapshotActiveGeneration(event.generation));
      return result(previous, true);
    }

    if (event.type === "generation_started") {
      if (state?.id === event.generationId) return result(previous, true);
      const started = createActiveGeneration(event.generationId, {
        continuation: Boolean(event.continuation),
        continuationBase: String(event.continuationBase || ""),
      });
      started.lastSeq = event.seq;
      install(started);
      return result(previous, true);
    }

    if (!state || state.id !== event.generationId) return result(previous, false);
    if (event.seq <= state.lastSeq || TERMINAL_STATUSES.has(state.status)) return result(previous, true);

    batch(() => {
      setPath(["lastSeq"], event.seq);

      switch (event.type) {
        case "generation_running":
          setPath(["status"], "running");
          break;
        case "generation_stopping":
          setPath(["status"], "stopping");
          break;
        case "assistant_message_started":
          if (currentMessageIndex(event.messageId) == null) {
            appendMessage({
              id: event.messageId,
              status: "streaming",
              stopReason: null,
              errorMessage: null,
              blocks: [],
            });
          }
          break;
        case "content_block_started": {
          const block = event.block || {};
          upsertBlock(event.messageId, block.contentIndex, {
            ...block,
            status: "streaming",
            identity: contentBlockIdentity(state.id, event.messageId, block.contentIndex),
          });
          break;
        }
        case "content_block_delta": {
          const messageIndex = currentMessageIndex(event.messageId);
          const existingIndex = messageIndex == null ? null : currentBlockIndex(event.messageId, event.contentIndex);
          const existing = messageIndex != null && existingIndex != null
            ? state.assistantMessages[messageIndex]?.blocks[existingIndex]
            : null;
          const block = upsertBlock(event.messageId, event.contentIndex, {
            type: event.blockType,
            contentIndex: event.contentIndex,
            status: "streaming",
            identity: contentBlockIdentity(state.id, event.messageId, event.contentIndex),
          });
          if (!block) break;
          const field = event.blockType === "toolCall" ? "argumentsText" : "text";
          const value = `${existing?.[field] || ""}${event.delta}`;
          setPath([...blockPath(block.messageIndex, block.blockIndex), field], value);
          break;
        }
        case "content_block_completed": {
          const block = event.block || {};
          upsertBlock(event.messageId, block.contentIndex, {
            ...block,
            status: "complete",
            identity: contentBlockIdentity(state.id, event.messageId, block.contentIndex),
          });
          break;
        }
        case "assistant_message_completed": {
          const messageIndex = currentMessageIndex(event.messageId);
          if (messageIndex == null) break;
          const message = state.assistantMessages[messageIndex];
          if (!message) break;
          const existingByIndex = new Map(message.blocks.map((block) => [block.contentIndex, block]));
          const blocks = event.blocks.map((block) => ({
            ...existingByIndex.get(block.contentIndex),
            ...block,
            status: "complete",
            identity: contentBlockIdentity(state.id, event.messageId, block.contentIndex),
          }));
          setPath(["assistantMessages", messageIndex], {
            ...message,
            blocks,
            status: event.stopReason === "error" || event.stopReason === "aborted" ? "error" : "complete",
            stopReason: event.stopReason,
            errorMessage: event.errorMessage || null,
            ...(event.provider ? { provider: event.provider } : {}),
            ...(event.model ? { model: event.model } : {}),
            ...(event.timestamp ? { timestamp: event.timestamp } : {}),
          });
          rebuildMessageIndex(messageIndex);
          break;
        }
        case "tool_execution_started":
          setPath(["toolExecutions", event.toolCallId], {
            toolCallId: event.toolCallId,
            name: event.name,
            arguments: event.arguments,
            status: "running",
            partialResult: null,
            result: null,
            isError: false,
          });
          break;
        case "tool_execution_updated": {
          const existing = state.toolExecutions[event.toolCallId] || { toolCallId: event.toolCallId };
          setPath(["toolExecutions", event.toolCallId], {
            ...existing,
            name: event.name || existing.name,
            arguments: event.arguments ?? existing.arguments,
            status: "running",
            partialResult: event.partialResult,
          });
          break;
        }
        case "tool_execution_completed": {
          const existing = state.toolExecutions[event.toolCallId] || { toolCallId: event.toolCallId };
          setPath(["toolExecutions", event.toolCallId], {
            ...existing,
            name: event.name || existing.name,
            status: event.isError ? "error" : "complete",
            result: event.result,
            isError: Boolean(event.isError),
          });
          break;
        }
        case "generation_retry_started":
          setPath(["status"], "running");
          setPath(["retry"], event.retry);
          break;
        case "generation_retry_ended":
          setPath(["retry"], null);
          break;
        case "generation_turn_ended":
          if (!event.willRetry) setPath(["retry"], null);
          break;
        case "generation_settled":
          setPath(["status"], terminalStatus(state));
          setPath(["retry"], null);
          break;
        case "generation_stopped":
          setPath(["status"], "stopped");
          setPath(["retry"], null);
          break;
        case "generation_failed":
          setPath(["status"], "failed");
          setPath(["error"], event.error);
          setPath(["retry"], null);
          break;
      }
    });
    return result(previous, true, true);
  };

  return {
    current: () => state,
    clear,
    apply,
    snapshot: () => state ? snapshotActiveGeneration(state) : null,
  };
}
