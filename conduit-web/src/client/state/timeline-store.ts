import type { Accessor } from "solid-js";
import { createEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Message, ToolItem } from "../api/contracts";
import type { ActiveGenerationView, TurnRow } from "../turn-rows";
import { buildTurnRows } from "../turn-rows";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";

export type TimelineRow = TurnRow;

export function createTimelineStore(
  messages: Accessor<Message[]>,
  tools: Accessor<ToolItem[]>,
  activeGeneration: Accessor<ActiveGenerationView | null>,
) {
  const [rows, setRows] = createStore<TimelineRow[]>([]);
  let previousProjectedRows: TurnRow[] | null = null;
  createEffect(() => {
    const inputMessages = messages();
    const inputTools = tools();
    const inputGeneration = activeGeneration();
    const recorder = getHarnessRecorder();
    const startedAt = recorder ? performance.now() : 0;
    const projected = buildTurnRows(inputMessages, inputTools, {
      activeGeneration: inputGeneration,
    });
    if (recorder) {
      const projectedKeys = projected.map((row) => row.key);
      const nextKeys = new Set(projectedKeys);
      const previousRowsByKey = new Map((previousProjectedRows || []).map((row) => [row.key, row]));
      const changedRowKeys = projected.filter((row) => {
        const previous = previousRowsByKey.get(row.key);
        if (!previous || previous.type !== row.type || previous.value !== row.value) return true;
        if (row.type !== "message" || previous.type !== "message") return false;
        return previous.index !== row.index || previous.live !== row.live || previous.streamVersion !== row.streamVersion;
      }).map((row) => row.key)
        .concat((previousProjectedRows || []).filter((row) => !nextKeys.has(row.key)).map((row) => row.key));
      previousProjectedRows = projected;
      let activeBlockCount = 0;
      for (const message of inputGeneration?.assistantMessages || []) activeBlockCount += message.blocks.length;
      recordHarnessMetric(recorder, {
        stage: "timeline-projection",
        durationMs: performance.now() - startedAt,
        messageCount: inputMessages.length,
        toolCount: inputTools.length,
        activeGenerationId: inputGeneration?.id || null,
        activeBlockCount,
        projectedRowCount: projected.length,
        changedRowKeys,
      });
    }
    // No merge: rows keep identity by key, but values are replaced wholesale —
    // deep-merging trace segments positionally can breed hybrid objects when a
    // slot changes kind between projections.
    setRows(reconcile(projected, { key: "key" }));
  });
  return rows;
}
