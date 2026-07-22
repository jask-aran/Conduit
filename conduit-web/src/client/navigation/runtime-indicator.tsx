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
export function RuntimeIndicator(props: { process?: RuntimeProcess | null; stale?: boolean; class?: string }) {
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
  return <Show when={visible()}>
    <Tooltip>
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
    </Tooltip>
  </Show>;
}

/** Roll-up of a folder/workspace's child chat activity, matching main's precedence. */
export function ProjectActivityIndicator(props: {
  sessions: ChatSummary[];
  processFor: (chat: ChatSummary) => RuntimeProcess | null;
  stale?: boolean;
}) {
  const children = () => props.sessions
    .map((session) => props.processFor(session))
    .filter((process): process is RuntimeProcess => Boolean(process))
    .filter((process) => process.status !== "stopped" && activityOf(process) !== "idle");

  const waiting = () => children().filter((process) => ["waiting_for_user", "retrying"].includes(activityOf(process)!));
  const working = () => children().filter((process) => ["working", "compacting", "starting", "stopping"].includes(activityOf(process)!));
  const failed = () => children().filter((process) => activityOf(process) === "failed");

  return <Show when={children().length}>
    <Show when={failed().length && !working().length && !waiting().length}>
      <RuntimeIndicator process={{ chatId: "", status: "failed", activity: "failed" }} stale={props.stale} />
    </Show>
    <Show when={!failed().length || working().length || waiting().length}>
      <Show when={waiting().length}>
        <RuntimeIndicator process={{ chatId: "", status: "running", activity: "waiting_for_user" }} stale={props.stale} />
      </Show>
      <Show when={!waiting().length && working().length > 1}>
        <Tooltip>
          <TooltipTrigger as="span"
            class={cn("runtime-indicator runtime-indicator-active", props.stale && "runtime-indicator-stale")}
            role="status"
            aria-label={`${working().length} agents working`}
          >
            <span class="runtime-indicator-count">{working().length}</span>
          </TooltipTrigger>
          <TooltipContent>{working().length} agents working</TooltipContent>
        </Tooltip>
      </Show>
      <Show when={!waiting().length && working().length === 1}>
        <RuntimeIndicator process={working()[0]} stale={props.stale} />
      </Show>
    </Show>
  </Show>;
}
