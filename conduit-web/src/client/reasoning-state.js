export function createInitialReasoningState() {
  return null;
}

function reasoningEvent(event) {
  return event?.assistantMessageEvent && typeof event.assistantMessageEvent === "object"
    ? event.assistantMessageEvent
    : event || {};
}

function redactedFrom(event) {
  const detail = reasoningEvent(event);
  if (detail.redacted != null) return Boolean(detail.redacted);
  const block = detail.partial?.content?.[detail.contentIndex];
  return Boolean(block?.redacted);
}

function eventContent(event) {
  const detail = reasoningEvent(event);
  const value = detail.delta ?? detail.content;
  return typeof value === "string" ? value : "";
}

function initialState(generationId, now, observed = false) {
  return {
    generationId,
    status: "active",
    content: "",
    redacted: false,
    startedAt: now,
    completedAt: null,
    durationSeconds: null,
    observed,
  };
}

function complete(state, now, content = state.content) {
  if (state.status === "completed") return content === state.content ? state : { ...state, content };
  return {
    ...state,
    status: "completed",
    content,
    completedAt: now,
    durationSeconds: Math.max(0, Math.round((now - state.startedAt) / 1_000)),
  };
}

const COMPLETION_EVENTS = new Set([
  "agent_end",
  "agent_settled",
  "assistant_stream_final",
  "generation_completed",
  "generation_stopped",
  "message_end",
]);

export function reduceReasoningState(state, event, now = Date.now()) {
  if (!event || typeof event !== "object") return state;
  const detail = reasoningEvent(event);
  const type = detail.type || event.type;
  const generationId = event.generationId || detail.generationId || null;
  if (!generationId) return state;

  if (type === "generation_started") {
    if (state?.generationId === generationId) return state;
    return initialState(generationId, now);
  }

  let current = state;
  if (!current) current = initialState(generationId, now, type.startsWith("thinking_"));
  else if (current.generationId !== generationId) {
    if (current.status !== "completed" || !["agent_start", "message_start", "thinking_start", "thinking_delta"].includes(type)) {
      return current;
    }
    current = initialState(generationId, now, type.startsWith("thinking_"));
  }

  if (type === "thinking_start") {
    return {
      ...current,
      status: "active",
      redacted: current.redacted || redactedFrom(event),
      observed: true,
    };
  }

  if (type === "thinking_delta") {
    return {
      ...current,
      status: "active",
      content: `${current.content}${eventContent(event)}`,
      redacted: current.redacted || redactedFrom(event),
      observed: true,
    };
  }

  if (type === "thinking_end") {
    const content = eventContent(event) || current.content;
    return complete({
      ...current,
      redacted: current.redacted || redactedFrom(event),
      observed: true,
    }, now, content);
  }

  if (type === "text_start" || type === "text_delta") return complete(current, now);
  if (COMPLETION_EVENTS.has(type)) return complete(current, now);
  return current;
}
