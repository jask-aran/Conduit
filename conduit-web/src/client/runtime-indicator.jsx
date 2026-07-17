import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { activityLabel } from "../activity.js";
import { cn } from "@/lib/utils";

/**
 * Compact accessible process/activity indicator for sidebar rows.
 * Visual: none | starting spinner | green idle | blue working | amber wait | red failed
 */
export function RuntimeIndicator({
  process = null,
  stale = false,
  className,
}) {
  if (!process || process.status === "stopped" || process.status === "none") return null;

  const activity = process.activity || (process.status === "starting" ? "starting" : process.active ? "working" : "idle");
  if (activity === "idle" && process.status === "running" && !process.active) {
    // green idle resident
  } else if (activity === "idle" && process.status !== "running") {
    return null;
  }

  const label = activityLabel(activity, process.activityDetail);
  const tone = {
    starting: "muted",
    idle: "success",
    working: "active",
    waiting_for_user: "warn",
    retrying: "warn",
    compacting: "active",
    stopping: "muted",
    failed: "danger",
  }[activity] || "muted";

  return <Tooltip>
    <TooltipTrigger asChild>
      <span
        className={cn(
          "runtime-indicator",
          `runtime-indicator-${tone}`,
          stale && "runtime-indicator-stale",
          className,
        )}
        role="status"
        aria-label={stale ? `${label} (may be stale)` : label}
      >
        {activity === "starting" || activity === "stopping" || activity === "working" || activity === "compacting"
          ? <Spinner className="size-3" />
          : <span className="runtime-indicator-dot" aria-hidden="true" />}
      </span>
    </TooltipTrigger>
    <TooltipContent side="right">{stale ? `${label} · reconnecting` : label}</TooltipContent>
  </Tooltip>;
}

export function ProjectActivityIndicator({ sessions = [], getProcess, stale = false, runtimeOnline = false }) {
  const children = sessions
    .map((session) => getProcess?.(session.id) || (!runtimeOnline && session.liveActivity ? {
      chatId: session.id,
      status: session.liveStatus,
      activity: session.liveActivity,
      active: session.liveActive,
    } : null))
    .filter(Boolean)
    .filter((process) => process.status !== "stopped" && process.activity && process.activity !== "idle");

  if (!children.length) return null;

  const waiting = children.filter((process) => process.activity === "waiting_for_user" || process.activity === "retrying");
  const working = children.filter((process) => ["working", "compacting", "starting", "stopping"].includes(process.activity));
  const failed = children.filter((process) => process.activity === "failed");

  if (failed.length && !working.length && !waiting.length) {
    return <RuntimeIndicator process={{ status: "failed", activity: "failed" }} stale={stale} />;
  }
  if (waiting.length) {
    return <RuntimeIndicator process={{ status: "running", activity: "waiting_for_user" }} stale={stale} />;
  }
  if (working.length > 1) {
    return <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("runtime-indicator runtime-indicator-active", stale && "runtime-indicator-stale")} role="status" aria-label={`${working.length} agents working`}>
          <span className="runtime-indicator-count">{working.length}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{working.length} agents working</TooltipContent>
    </Tooltip>;
  }
  if (working.length === 1) {
    return <RuntimeIndicator process={working[0]} stale={stale} />;
  }
  return null;
}
