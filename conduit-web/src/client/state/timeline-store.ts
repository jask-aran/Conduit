import type { Accessor } from "solid-js";
import { createEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Message, ToolItem } from "../api/contracts";
import type {
  ActiveGenerationView,
  LiveGenerationChange,
  LiveProjectionIndex,
  PersistedTurnProjection,
  TraceSegment,
  TurnRow,
} from "../turn-rows";
import {
  buildLiveAnswerRow,
  buildLiveProjectionIndex,
  buildLiveToolItem,
  buildLiveToolSegment,
  assertStatedOutcomes,
  projectLiveTurn,
  projectPersistedTurns,
} from "../turn-rows";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";

export type TimelineRow = TurnRow;

function sameTraceSegment(left: TraceSegment, right: TraceSegment): boolean {
  if (left.kind !== right.kind || left.id !== right.id) return false;
  if (left.kind === "tool" && right.kind === "tool") return left.tool === right.tool;
  if (left.kind === "error" && right.kind === "error") return left.message === right.message;
  if ((left.kind === "thinking" || left.kind === "narration")
    && (right.kind === "thinking" || right.kind === "narration")) {
    return left.text === right.text && left.live === right.live && left.discarded === right.discarded;
  }
  return false;
}

function stableProjection(previous: TurnRow[], projected: TurnRow[]): TurnRow[] {
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  return projected.map((row) => {
    const prior = previousByKey.get(row.key);
    if (!prior || prior.type !== row.type) return row;
    if (row.type === "message" && prior.type === "message") {
      return prior.value === row.value
        && prior.live === row.live
        && prior.streamVersion === row.streamVersion
        && prior.displayKey === row.displayKey
        && prior.precedingUserId === row.precedingUserId
        ? prior : row;
    }
    if (row.type === "trace" && prior.type === "trace") {
      const left = prior.value;
      const right = row.value;
      return left.active === right.active
        && left.status === right.status
        && left.segments.length === right.segments.length
        && left.segments.every((segment, index) => sameTraceSegment(segment, right.segments[index]!))
        ? prior : row;
    }
    return row;
  });
}

function settledPrefixChanged(previous: Message[] | null, current: Message[]): boolean {
  if (!previous) return true;
  let latestUserIndex = -1;
  for (let index = current.length - 1; index >= 0; index -= 1) {
    if (current[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0 || previous.length <= latestUserIndex) return true;
  for (let index = 0; index <= latestUserIndex; index += 1) {
    if (previous[index] !== current[index]) return true;
  }
  return false;
}

export function createTimelineStore(
  messages: Accessor<Message[]>,
  tools: Accessor<ToolItem[]>,
  activeGeneration: Accessor<ActiveGenerationView | null>,
  activeGenerationChange: Accessor<LiveGenerationChange | null> = () => null,
) {
  const [rows, setRows] = createStore<TimelineRow[]>([]);
  /*
   * The store writes into whatever it holds. Handed the chat's own messages and
   * tools, a row whose key passed to a different value -- a saved answer's key
   * taken over by the live answer of the next send -- had that value merged
   * over the saved message: its id became the live one and its `answers` was
   * deleted, and the next projection stopped on the transcript contract. So the
   * store is only ever given its own copies.
   */
  const owned = <T,>(value: T): T => {
    if (Array.isArray(value)) return value.map(owned) as T;
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(value)) copy[key] = owned((value as Record<string, unknown>)[key]);
      return copy as T;
    }
    return value;
  };
  let previousProjectedRows: TurnRow[] = [];
  let previousMessages: Message[] | null = null;
  let previousTools: ToolItem[] | null = null;
  let persistedMessages: Message[] | null = null;
  let persistedTools: ToolItem[] | null = null;
  let persistedRows: TurnRow[] = [];
  let persistedTurns: PersistedTurnProjection[] = [];
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
      return prior.live !== row.live || prior.streamVersion !== row.streamVersion;
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
      setRows(index, "value", owned(next.value));
      previousProjectedRows[index] = next;
      return location.rowKey;
    }

    if (current.type !== "trace") return null;
    const nextSegment = block.kind === "tool_call"
      ? buildLiveToolSegment(inputGeneration, block)
      : {
        kind: block.kind === "thinking" ? "thinking" : "narration",
        id: block.identity,
        text: block.text || "",
        live: block.status === "streaming",
      } as TraceSegment;
    const nextValue = updateTraceSegment(current, location.segmentIndex, nextSegment);
    if (!nextValue) return null;
    const nextRow = { ...current, value: nextValue };
    setRows(index, "value", owned(nextValue));
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
      tool: buildLiveToolItem(change.toolCallId, execution, { name: segment.tool.name, input: segment.tool.input }),
    };
    const nextValue = updateTraceSegment(current, location.segmentIndex, nextSegment);
    if (!nextValue) return null;
    const nextRow = { ...current, value: nextValue };
    setRows(index, "value", owned(nextValue));
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

    const persistedInputsChanged = persistedMessages !== inputMessages || persistedTools !== inputTools;
    const mustRefreshPersisted = persistedInputsChanged && (
      !inputGeneration
      || persistedTools !== inputTools
      || settledPrefixChanged(persistedMessages, inputMessages)
    );
    if (mustRefreshPersisted) {
      const projection = projectPersistedTurns(inputMessages, inputTools, persistedTurns);
      persistedRows = projection.rows;
      persistedTurns = projection.turns;
      persistedMessages = inputMessages;
      persistedTools = inputTools;
    }
    const projected = stableProjection(previousProjectedRows, assertStatedOutcomes(inputGeneration
      ? projectLiveTurn(persistedRows, inputMessages, inputGeneration)
      : persistedRows));
    // Diffing the row sets allocates a Map and a Set the size of the whole
    // transcript, and the result is only ever a metric field. Every other
    // measurement here is already gated on the recorder; this one was not.
    const changed = recorder ? rowChanges(previousProjectedRows, projected) : [];
    setRows(reconcile(owned(projected), { key: "key" }));
    previousProjectedRows = projected;
    previousMessages = inputMessages;
    previousTools = inputTools;
    rowIndexes = new Map(projected.map((row, index) => [row.key, index]));
    liveIndex = inputGeneration ? buildLiveProjectionIndex(inputGeneration, inputMessages) : null;
    recordProjection(recorder, inputMessages, inputTools, inputGeneration, startedAt, changed, "full");
  });
  return rows;
}
