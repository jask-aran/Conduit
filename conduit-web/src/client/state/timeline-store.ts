import type { Accessor } from "solid-js";
import { createEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Message, ToolItem } from "../api/contracts";
import { buildTimeline } from "../timeline-order";

export type TimelineRow =
  | { key: string; type: "message"; value: Message; index: number }
  | { key: string; type: "tool"; value: ToolItem; index: number };

export function createTimelineStore(messages: Accessor<Message[]>, tools: Accessor<ToolItem[]>, streaming: Accessor<boolean>) {
  const [rows, setRows] = createStore<TimelineRow[]>([]);
  createEffect(() => {
    const projected = buildTimeline(messages(), tools(), { streaming: streaming() }).map((item): TimelineRow => {
      const renderKey = item.type === "message" ? item.value.key || item.value.id : item.value.id;
      return { key: `${item.type}:${renderKey || item.index}`, type: item.type, value: item.value, index: item.index } as TimelineRow;
    });
    setRows(reconcile(projected, { key: "key", merge: true }));
  });
  return rows;
}
