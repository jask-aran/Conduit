import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function AgentActivityRow({ activity, className }) {
  if (!activity?.label || activity.kind === "idle") return null;
  return <div
    className={cn("agent-activity-row text-muted-foreground flex items-center gap-2 px-2 py-1 text-sm", className)}
    role="status"
    aria-live={activity.kind === "waiting_for_user" || activity.kind === "failed" ? "polite" : "off"}
    aria-busy={!["failed", "idle"].includes(activity.kind)}
  >
    {activity.kind !== "failed" && <Spinner className="size-3.5" />}
    <span>{activity.label}</span>
  </div>;
}
