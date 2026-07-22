import type { Accessor } from "solid-js";
import { createEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Message, ToolItem } from "../api/contracts";
import type { TurnRow } from "../turn-rows";
import { buildTurnRows } from "../turn-rows";

export type TimelineRow = TurnRow;

export function createTimelineStore(
  messages: Accessor<Message[]>,
  tools: Accessor<ToolItem[]>,
  streaming: Accessor<boolean>,
  reasoning: Accessor<{ content: string; active: boolean; redacted: boolean }>,
) {
  const [rows, setRows] = createStore<TimelineRow[]>([]);
  createEffect(() => {
    const projected = buildTurnRows(messages(), tools(), { streaming: streaming(), reasoning: reasoning() });
    setRows(reconcile(projected, { key: "key", merge: true }));
  });
  return rows;
}
