import { Show, type JSX } from "solid-js";
import { activityLabel } from "../../activity.js";
import { StatusDot, type StatusTone } from "@/components/ui";
import type { ChatSummary, RuntimeProcess } from "../api/contracts";

type Activity = string;

export const runtimeActivity = (process: RuntimeProcess | null | undefined): Activity | null => {
  if (!process) return null;
  const raw = typeof process.activity === "string" ? process.activity : process.activity?.kind;
  return raw || (process.status === "failed" ? "failed" : process.status === "starting" ? "starting" : process.stopping ? "stopping" : process.active ? "working" : "idle");
};

export const visibleRuntimeActivity = (process: RuntimeProcess | null | undefined): Activity | null => {
  if (!process || process.status === "stopped" || process.status === "none") return null;
  const activity = runtimeActivity(process);
  if (activity === "idle" && process.status !== "running" && !process.active) return null;
  return activity;
};

export const activityDetail = (process: RuntimeProcess | null | undefined): string | null => {
  const value = process?.activity;
  return value && typeof value === "object" ? value.label || null : null;
};

const TONES: Record<string, StatusTone> = {
  starting: "muted",
  idle: "success",
  working: "active",
  waiting_for_user: "warn",
  retrying: "warn",
  compacting: "active",
  stopping: "muted",
  failed: "danger",
};

const SPINNING = new Set(["starting", "stopping", "working", "compacting"]);

/** A chat's process and activity as a StatusDot, for its row. */
export function RuntimeIndicator(props: { process?: RuntimeProcess | null; stale?: boolean; unread?: boolean; fallback?: JSX.Element }) {
  const visible = () => Boolean(visibleRuntimeActivity(props.process));
  const activity = () => runtimeActivity(props.process) || "idle";
  const label = () => activityLabel(activity(), activityDetail(props.process));
  // Live and unread are independent facts, so the slot goes to whichever is
  // still happening. A process that is working, starting or waiting on the
  // user owns it; an idle one does not, because a warm process outlives every
  // turn and would hide the answer it just finished. Idle and read falls back
  // to the resident pill.
  const busy = () => visible() && activity() !== "idle";
  return <Show when={!busy() && props.unread} fallback={<Show when={visible()} fallback={props.fallback}>
      <StatusDot label={props.stale ? `${label()} (may be stale)` : label()} title={props.stale ? `${label()} · reconnecting` : label()}
        tone={TONES[activity()] || "muted"} spinning={SPINNING.has(activity())} stale={props.stale} />
    </Show>}>
    <StatusDot label="Unread response" tone="unread" />
  </Show>;
}

/** A collapsed parent only signals child responses that need attention. */
export function ProjectActivityIndicator(props: { sessions: ChatSummary[] }) {
  return <Show when={props.sessions.some((session) => session.unread)}><StatusDot label="Contains unread responses" tone="unread" /></Show>;
}
