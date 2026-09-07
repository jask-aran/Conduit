import { Show } from "solid-js";
import { activityLabel } from "../../activity.js";
import { Spinner, Tooltip, TooltipContent, TooltipTrigger } from "@/components/primitives";
import { cn } from "@/lib/utils";
import type { ChatSummary, RuntimeProcess } from "../api/contracts";

type Activity = string;

const activityOf = (process: RuntimeProcess | null | undefined): Activity | null => {
  if (!process) return null;
  const raw = typeof process.activity === "string" ? process.activity : process.activity?.kind;
  return raw || (process.status === "starting" ? "starting" : process.active ? "working" : "idle");
};

const activityDetail = (process: RuntimeProcess | null | undefined): string | null => {
  const value = process?.activity;
  return value && typeof value === "object" ? value.label || null : null;
};

const TONES: Record<string, string> = {
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

/** Compact accessible process/activity indicator for sidebar rows, matching main. */
export function RuntimeIndicator(props: { process?: RuntimeProcess | null; stale?: boolean; unread?: boolean; class?: string }) {
  const visible = () => {
    const process = props.process;
    if (!process || process.status === "stopped" || process.status === "none") return false;
    const activity = activityOf(process);
    if (activity === "idle" && process.status !== "running" && !process.active) return false;
    return true;
  };
  const activity = () => activityOf(props.process) || "idle";
  const label = () => activityLabel(activity(), activityDetail(props.process));
  const tone = () => TONES[activity()] || "muted";
  return <Show when={props.unread} fallback={<Show when={visible()}><Tooltip>
      <TooltipTrigger as="span"
        class={cn("runtime-indicator", `runtime-indicator-${tone()}`, props.stale && "runtime-indicator-stale", props.class)}
        role="status"
        aria-label={props.stale ? `${label()} (may be stale)` : label()}
      >
        {SPINNING.has(activity())
          ? <Spinner class="size-3" />
          : <span class="runtime-indicator-dot" aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent>{props.stale ? `${label()} · reconnecting` : label()}</TooltipContent>
    </Tooltip></Show>}>
    <span class={cn("runtime-indicator runtime-indicator-unread", props.class)} role="status" aria-label="Unread response"><span class="runtime-indicator-dot" aria-hidden="true" /></span>
  </Show>;
}

/** A collapsed parent only signals child responses that need attention. */
export function ProjectActivityIndicator(props: { sessions: ChatSummary[] }) {
  return <Show when={props.sessions.some((session) => session.unread)}>
    <span class="runtime-indicator runtime-indicator-unread" role="status" aria-label="Contains unread responses"><span class="runtime-indicator-dot" aria-hidden="true" /></span>
  </Show>;
}
