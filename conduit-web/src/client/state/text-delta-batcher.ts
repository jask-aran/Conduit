import type { StructuredGenerationEvent } from "../api/live-events";

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
