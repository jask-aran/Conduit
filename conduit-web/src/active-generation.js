const TERMINAL_STATUSES = new Set(["stopped", "complete", "failed"]);

export function createActiveGeneration(id, { status = "submitting", continuation = false, continuationBase = "" } = {}) {
  return {
    id,
    status,
    continuation,
    continuationBase,
    assistantMessages: [],
    toolExecutions: {},
    retry: null,
    error: null,
    lastSeq: 0,
  };
}

/**
 * What names a block, for as long as it is being written.
 *
 * The message id carries the generation already -- a claimed one is unique
 * outright, and the fallback the normalizer invents is prefixed with the
 * generation that invented it -- so naming the generation again here only made
 * every identity say it twice.
 */
export function contentBlockIdentity(messageId, contentIndex) {
  return `${messageId}:${contentIndex}`;
}

function cloneGeneration(state) {
  return {
    ...state,
    assistantMessages: [...state.assistantMessages],
    toolExecutions: { ...state.toolExecutions },
  };
}

function cloneMessage(state, messageId) {
  const index = state.assistantMessages.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  const message = {
    ...state.assistantMessages[index],
    blocks: [...state.assistantMessages[index].blocks],
  };
  state.assistantMessages[index] = message;
  return message;
}

function upsertBlock(message, incoming) {
  const index = message.blocks.findIndex((block) => block.contentIndex === incoming.contentIndex);
  if (index < 0) {
    const block = { ...incoming };
    message.blocks.push(block);
    message.blocks.sort((left, right) => left.contentIndex - right.contentIndex);
    return block;
  }
  const block = { ...message.blocks[index], ...incoming };
  message.blocks[index] = block;
  return block;
}

function terminalStatus(state) {
  const lastMessage = state.assistantMessages.at(-1);
  if (lastMessage?.stopReason === "error") return "failed";
  if (lastMessage?.stopReason === "aborted") return "stopped";
  return "complete";
}

export function snapshotActiveGeneration(state) {
  return state ? structuredClone(state) : null;
}

export function generationResumeEvent(state) {
  return {
    type: "generation_resume",
    generationId: state.id,
    seq: state.lastSeq,
    generation: snapshotActiveGeneration(state),
  };
}

/**
 * The turn so far, from the events the browser is sent.
 *
 * This read Pi's own event names while the browser's store read the contract's
 * -- one turn, two reducers, two vocabularies, agreeing only because a test
 * said so. It now reduces exactly what crosses the socket, so the snapshot it
 * builds is what a browser that saw everything would have built, by
 * construction rather than by assertion. That snapshot is the whole point of
 * keeping one here: it is what a reconnecting or paused socket is restated
 * from, which is what makes paint droppable.
 *
 * Block starts and completions are gone with the rename, because the browser
 * is not sent them: a block opens on its first delta and completes when the
 * message closes, at both ends.
 */
export function reduceActiveGeneration(current, event) {
  if (!event || !event.generationId) return current;
  if (event.type === "generation_replay") {
    if (!event.generation || event.generation.id !== event.generationId) return current;
    if (current?.id === event.generationId && current.lastSeq > event.seq) return current;
    return snapshotActiveGeneration(event.generation);
  }
  if (event.type === "status" && event.phase === "started") {
    if (current?.id === event.generationId) return current;
    const started = createActiveGeneration(event.generationId, {
      continuation: Boolean(event.continuation),
      continuationBase: String(event.continuationBase || ""),
    });
    started.lastSeq = event.seq;
    return started;
  }
  if (!current || current.id !== event.generationId) return current;
  // Only a stated position can be ordered. An event without one is not part of
  // the turn's sequence and must not move `lastSeq` off a number.
  if (typeof event.seq !== "number") return current;
  if (event.seq <= current.lastSeq || TERMINAL_STATUSES.has(current.status)) return current;

  const next = cloneGeneration(current);
  next.lastSeq = event.seq;

  switch (event.type === "status" ? `status:${event.phase}`
    : event.type === "assistant_content" ? `content:${event.phase}`
      : event.type === "tool_activity" ? `tool:${event.phase}` : event.type) {
    case "status:running":
      next.status = "running";
      break;
    case "status:stopping":
      next.status = "stopping";
      break;
    case "content:start":
      if (!next.assistantMessages.some((message) => message.id === event.messageId)) {
        next.assistantMessages.push({
          id: event.messageId,
          status: "streaming",
          stopReason: null,
          errorMessage: null,
          blocks: [],
        });
      }
      break;
    case "content:delta": {
      const message = cloneMessage(next, event.messageId);
      if (!message) break;
      const existing = message.blocks.find((block) => block.contentIndex === event.contentIndex);
      const block = upsertBlock(message, {
        kind: event.blockKind,
        contentIndex: event.contentIndex,
        status: "streaming",
        identity: contentBlockIdentity(event.messageId, event.contentIndex),
        // A call being written, named as soon as the harness knows which.
        ...(event.name ? { name: event.name, toolKind: event.toolKind } : {}),
        ...(event.subject ? { subject: event.subject } : {}),
        ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      });
      if (event.blockKind === "tool_call") block.inputText = `${existing?.inputText || ""}${event.delta}`;
      else block.text = `${existing?.text || ""}${event.delta}`;
      break;
    }
    case "content:final": {
      const message = cloneMessage(next, event.messageId);
      if (!message) break;
      const existingByIndex = new Map(message.blocks.map((block) => [block.contentIndex, block]));
      message.blocks = event.blocks.map((block) => ({
        ...existingByIndex.get(block.contentIndex),
        ...block,
        status: "complete",
        identity: contentBlockIdentity(event.messageId, block.contentIndex),
      }));
      message.status = event.stopReason === "error" || event.stopReason === "aborted" ? "error" : "complete";
      message.stopReason = event.stopReason;
      message.errorMessage = event.errorMessage || null;
      if (event.provider) message.provider = event.provider;
      if (event.model) message.model = event.model;
      if (event.timestamp) message.timestamp = event.timestamp;
      break;
    }
    case "tool:start":
      next.toolExecutions[event.toolCallId] = {
        toolCallId: event.toolCallId,
        name: event.name,
        kind: event.kind || "other",
        ...(event.subject ? { subject: event.subject } : {}),
        ...(event.at ? { timestamp: event.at } : {}),
        input: event.input,
        status: "running",
        // What the tool has returned so far. `status` says whether that is all
        // of it, so there is one field to read rather than two to choose
        // between.
        output: null,
        isError: false,
      };
      break;
    case "tool:update": {
      const existing = next.toolExecutions[event.toolCallId] || { toolCallId: event.toolCallId };
      next.toolExecutions[event.toolCallId] = {
        ...existing,
        name: event.name || existing.name,
        input: event.input ?? existing.input,
        status: "running",
        output: event.output ?? existing.output,
      };
      break;
    }
    case "tool:end": {
      const existing = next.toolExecutions[event.toolCallId] || { toolCallId: event.toolCallId };
      next.toolExecutions[event.toolCallId] = {
        ...existing,
        name: event.name || existing.name,
        status: event.isError ? "error" : "complete",
        output: event.output,
        isError: Boolean(event.isError),
        ...(event.at ? { completedAt: event.at } : {}),
      };
      break;
    }
    case "retry":
      if (event.active) {
        next.status = "running";
        next.retry = event.retry;
      } else {
        next.retry = null;
      }
      break;
    case "status:settled":
      next.status = terminalStatus(next);
      next.retry = null;
      break;
    case "status:stopped":
      next.status = "stopped";
      next.retry = null;
      for (const execution of Object.values(next.toolExecutions)) {
        if (execution.status === "running") {
          execution.status = "cancelled";
          execution.isError = false;
        }
      }
      break;
    case "error":
      next.status = "failed";
      next.error = event.error;
      next.retry = null;
      break;
  }
  return next;
}

export function reduceGenerationEvents(events, initial = null) {
  return events.reduce(reduceActiveGeneration, initial);
}

/**
 * Which of a turn's text is an answer, and which is it talking as it works.
 *
 * Decided per message, from that message alone: its text is narration when the
 * message is itself a step towards an answer -- it called a tool, or stopped to
 * call one -- and an answer otherwise.
 *
 * It used to be decided across the whole turn: any text with a tool call
 * anywhere after it was narration. That made a finished answer stop being one
 * retroactively. Steer a turn that has already answered, and the follow-on
 * message calls a tool -- so the answer already on screen was reclassified as
 * narration, folded into the collapsed trace, and to anyone watching it had
 * simply vanished. What a later message does cannot change what an earlier one
 * said.
 */
export function textBlockClassifications(state) {
  const result = {};
  for (const message of state.assistantMessages || []) {
    const interim = message.stopReason === "toolUse"
      || (message.blocks || []).some((block) => block.kind === "tool_call");
    for (const block of message.blocks || []) {
      if (block.kind === "text") result[block.identity] = interim ? "interim" : "answer";
    }
  }
  return result;
}

/** The same question, for a message the server is about to state as finished. */
export function messageIsInterim(message) {
  return Boolean(message && (message.stopReason === "toolUse"
    || (message.blocks || []).some((block) => block.kind === "tool_call")));
}

export function activeGenerationFromPersistedMessages(generationId, messages, { toolExecutions = {} } = {}) {
  const state = createActiveGeneration(generationId, { status: "complete" });
  // Named exactly as the normalizer names an answer it was given no id for:
  // the generation, then its position in the turn. The live view and the view
  // rebuilt from what was persisted are compared block by block, so a message
  // that is the same message has to be called the same thing on both sides.
  const fallbackId = (index) => `${generationId}:m${index + 1}`;
  state.assistantMessages = messages
    .filter((message) => message?.role === "assistant")
    .map((message, messageIndex) => ({
      id: fallbackId(messageIndex),
      status: message.stopReason === "error" || message.stopReason === "aborted" ? "error" : "complete",
      stopReason: message.stopReason || "stop",
      errorMessage: message.errorMessage || null,
      blocks: normalizePersistedBlocks(fallbackId(messageIndex), message.content),
    }));
  state.toolExecutions = structuredClone(toolExecutions);
  state.status = terminalStatus(state);
  return state;
}

/**
 * A message Pi has already written, rebuilt as a generation view of it.
 *
 * The reads are Pi's, because this is reading Pi's stored content. What it
 * builds is Conduit's, and it has to be identical to what the live reducer
 * builds from the same turn arriving as deltas -- that equivalence is asserted
 * directly, and it is what lets a reconnecting browser be given the view it
 * would have had if it had never dropped the socket.
 */
function normalizePersistedBlocks(messageId, content) {
  if (!Array.isArray(content)) {
    return content == null || content === "" ? [] : [{
      kind: "text",
      contentIndex: 0,
      text: String(content),
      status: "complete",
      identity: contentBlockIdentity(messageId, 0),
    }];
  }
  return content.flatMap((block, contentIndex) => {
    if (block?.type === "text") return [{
      kind: "text",
      contentIndex,
      text: String(block.text || ""),
      status: "complete",
      identity: contentBlockIdentity(messageId, contentIndex),
    }];
    if (block?.type === "thinking") return [{
      kind: "thinking",
      contentIndex,
      text: String(block.thinking || ""),
      redacted: Boolean(block.redacted),
      status: "complete",
      identity: contentBlockIdentity(messageId, contentIndex),
    }];
    if (block?.type === "toolCall") return [{
      kind: "tool_call",
      contentIndex,
      toolCallId: String(block.id || ""),
      name: String(block.name || ""),
      input: block.arguments,
      status: "complete",
      identity: contentBlockIdentity(messageId, contentIndex),
    }];
    return [];
  });
}
