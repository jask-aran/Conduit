import type { StructuredGenerationEvent } from "../api/live-events";
import type { LiveEvent } from "../api/live-events";

// Keep same-turn provider bursts bounded before they reach the parser and
// renderer. A single wire event remains atomic; this limit applies only when
// adjacent events are merged by the client.
export const MAX_TEXT_DELTA_BATCH_CHARS = 256;

function deltaText(event: StructuredGenerationEvent) {
  return String(event.delta || "");
}

export function sameTextDeltaBlock(left: StructuredGenerationEvent | null, right: StructuredGenerationEvent) {
  return Boolean(left
    && left.generationId === right.generationId
    && left.messageId === right.messageId
    && left.contentIndex === right.contentIndex
    && left.blockType === right.blockType);
}

export function canCoalesceTextDelta(
  left: StructuredGenerationEvent | null,
  right: StructuredGenerationEvent,
  limit = MAX_TEXT_DELTA_BATCH_CHARS,
) {
  return sameTextDeltaBlock(left, right)
    && deltaText(left!).length + deltaText(right).length <= Math.max(1, limit);
}

export function mergeTextDeltaEvents(left: StructuredGenerationEvent | null, right: StructuredGenerationEvent) {
  if (!sameTextDeltaBlock(left, right)) return null;
  return {
    ...left,
    seq: right.seq,
    delta: `${String(left!.delta || "")}${String(right.delta || "")}`,
  } as StructuredGenerationEvent;
}

const REPLACEABLE_LIVE_EVENT_TYPES = new Set(["runtime_state", "context_usage", "queue_update"]);

function isTextDeltaEvent(event: LiveEvent | null | undefined): event is StructuredGenerationEvent {
  return Boolean(event && event.type === "content_block_delta");
}

function isReplaceableLiveEvent(event: LiveEvent) {
  return REPLACEABLE_LIVE_EVENT_TYPES.has(event.type);
}

/**
 * Add an event to the overflow queue without allowing a same-block burst to
 * create one queued object per wire delta. Structural events remain ordered.
 * Runtime snapshots and other replaceable state keep only their latest value.
 */
export function enqueueOverflowLiveEvent(queue: LiveEvent[], event: LiveEvent) {
  const previous = queue.at(-1);
  if (isTextDeltaEvent(previous) && isTextDeltaEvent(event)) {
    const merged = mergeTextDeltaEvents(previous, event);
    if (merged) {
      queue[queue.length - 1] = merged;
      return;
    }
  }
  if (isReplaceableLiveEvent(event)) {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index]?.type === event.type) {
        queue[index] = event;
        return;
      }
    }
  }
  queue.push(event);
}
