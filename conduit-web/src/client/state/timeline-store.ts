import type { Accessor } from "solid-js";
import { createEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Message, ToolItem } from "../api/contracts";
import type {
  ActiveGenerationView,
  LiveGenerationChange,
  LiveProjectionIndex,
  TraceSegment,
  TurnRow,
} from "../turn-rows";
import {
  buildLiveAnswerRow,
  buildLiveProjectionIndex,
  buildLiveToolItem,
  buildLiveToolSegment,
  buildTurnRows,
} from "../turn-rows";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";

export type TimelineRow = TurnRow;

export function createTimelineStore(
  messages: Accessor<Message[]>,
  tools: Accessor<ToolItem[]>,
  activeGeneration: Accessor<ActiveGenerationView | null>,
  activeGenerationChange: Accessor<LiveGenerationChange | null> = () => null,
) {
  const [rows, setRows] = createStore<TimelineRow[]>([]);
  let previousProjectedRows: TurnRow[] = [];
  let previousMessages: Message[] | null = null;
  let previousTools: ToolItem[] | null = null;
  let rowIndexes = new Map<string, number>();
  let liveIndex: LiveProjectionIndex | null = null;

  const rowIndex = (key: string) => rowIndexes.get(key);
  const rowChanges = (previous: TurnRow[], projected: TurnRow[]) => {
    const nextKeys = new Set(projected.map((row) => row.key));
    const previousRowsByKey = new Map(previous.map((row) => [row.key, row]));
    return projected.filter((row) => {
      const prior = previousRowsByKey.get(row.key);
      if (!prior || prior.type !== row.type || prior.value !== row.value) return true;
      if (row.type !== "message" || prior.type !== "message") return false;
      return prior.index !== row.index || prior.live !== row.live || prior.streamVersion !== row.streamVersion;
    }).map((row) => row.key)
      .concat(previous.filter((row) => !nextKeys.has(row.key)).map((row) => row.key));
  };

  const recordProjection = (
    recorder: ReturnType<typeof getHarnessRecorder>,
    inputMessages: Message[],
    inputTools: ToolItem[],
    inputGeneration: ActiveGenerationView | null,
    startedAt: number,
    changedRowKeys: string[],
    mode: "full" | "narrow",
  ) => {
    if (!recorder) return;
    recordHarnessMetric(recorder, {
      stage: "timeline-projection",
      durationMs: performance.now() - startedAt,
      projectionMode: mode,
      messageCount: inputMessages.length,
      toolCount: inputTools.length,
      activeGenerationId: inputGeneration?.id || null,
      activeBlockCount: liveIndex?.activeBlockCount || 0,
      projectedRowCount: previousProjectedRows.length,
      changedRowKeys,
    });
  };

  const updateTraceSegment = (
    row: Extract<TurnRow, { type: "trace" }>,
    segmentIndex: number,
    nextSegment: TraceSegment,
  ): Extract<TurnRow, { type: "trace" }>["value"] | null => {
    if (segmentIndex < 0 || segmentIndex >= row.value.segments.length) return null;
    const current = row.value.segments[segmentIndex];
    if (!current || current.kind !== nextSegment.kind) return null;
    return {
      ...row.value,
      segments: row.value.segments.map((segment, index) => index === segmentIndex ? nextSegment : segment),
    };
  };

  const narrowBlockChange = (
    inputMessages: Message[],
    inputTools: ToolItem[],
    inputGeneration: ActiveGenerationView,
    change: LiveGenerationChange,
  ) => {
    if (!liveIndex || liveIndex.generationId !== inputGeneration.id
      || previousMessages !== inputMessages || previousTools !== inputTools) return null;
    if (!change.messageId || change.contentIndex == null) return null;
    const message = inputGeneration.assistantMessages.find((candidate) => candidate.id === change.messageId);
    const block = message?.blocks.find((candidate) => candidate.contentIndex === change.contentIndex);
    if (!block) return null;
    const location = liveIndex.blockLocations.get(block.identity);
    if (!location) return null;
    const index = rowIndex(location.rowKey);
    if (index == null) return null;
    const current = previousProjectedRows[index];
    if (!current) return null;

    if (location.kind === "answer") {
      if (current.type !== "message") return null;
      const next = buildLiveAnswerRow(inputGeneration, location.assistantId, liveIndex, liveIndex.messageIndex, current.precedingUserId);
      if (!next) return null;
      setRows(index, "value", next.value);
      previousProjectedRows[index] = next;
      return location.rowKey;
    }

    if (current.type !== "trace") return null;
    const nextSegment = block.type === "toolCall"
      ? buildLiveToolSegment(inputGeneration, block)
      : {
        kind: block.type === "thinking" ? "thinking" : "narration",
        id: block.identity,
        text: block.text || "",
        live: block.status === "streaming",
      } as TraceSegment;
    const nextValue = updateTraceSegment(current, location.segmentIndex, nextSegment);
    if (!nextValue) return null;
    const nextRow = { ...current, value: nextValue };
    setRows(index, "value", nextValue);
    previousProjectedRows[index] = nextRow;
    return location.rowKey;
  };

  const narrowToolChange = (
    inputGeneration: ActiveGenerationView,
    change: LiveGenerationChange,
  ) => {
    if (!liveIndex || liveIndex.generationId !== inputGeneration.id || !change.toolCallId) return null;
    const location = liveIndex.toolLocations.get(change.toolCallId);
    if (!location) return null;
    const index = rowIndex(location.rowKey);
    if (index == null) return null;
    const current = previousProjectedRows[index];
    if (!current || current.type !== "trace") return null;
    const segment = current.value.segments[location.segmentIndex];
    if (!segment || segment.kind !== "tool") return null;
    const execution = inputGeneration.toolExecutions[change.toolCallId] || {};
    const nextSegment: TraceSegment = {
      kind: "tool",
      id: segment.id,
      tool: buildLiveToolItem(change.toolCallId, execution, { name: segment.tool.name, args: segment.tool.args }),
    };
    const nextValue = updateTraceSegment(current, location.segmentIndex, nextSegment);
    if (!nextValue) return null;
    const nextRow = { ...current, value: nextValue };
    setRows(index, "value", nextValue);
    previousProjectedRows[index] = nextRow;
    return location.rowKey;
  };

  createEffect(() => {
    const inputMessages = messages();
    const inputTools = tools();
    const inputGeneration = activeGeneration();
    const change = activeGenerationChange();
    const recorder = getHarnessRecorder();
    const startedAt = recorder ? performance.now() : 0;
    const canNarrow = Boolean(inputGeneration && change && change.generationId === inputGeneration.id
      && previousMessages === inputMessages && previousTools === inputTools);
    const changedRowKeys = canNarrow && inputGeneration && change
      ? change.scope === "block"
        ? narrowBlockChange(inputMessages, inputTools, inputGeneration, change)
        : change.scope === "tool"
          ? narrowToolChange(inputGeneration, change)
          : null
      : null;
    if (changedRowKeys) {
      recordProjection(recorder, inputMessages, inputTools, inputGeneration, startedAt, [changedRowKeys], "narrow");
      return;
    }

    const projected = buildTurnRows(inputMessages, inputTools, {
      activeGeneration: inputGeneration,
    });
    const changed = rowChanges(previousProjectedRows, projected);
    setRows(reconcile(projected, { key: "key" }));
    previousProjectedRows = projected;
    previousMessages = inputMessages;
    previousTools = inputTools;
    rowIndexes = new Map(projected.map((row, index) => [row.key, index]));
    liveIndex = inputGeneration ? buildLiveProjectionIndex(inputGeneration, inputMessages) : null;
    recordProjection(recorder, inputMessages, inputTools, inputGeneration, startedAt, changed, "full");
  });
  return rows;
}
