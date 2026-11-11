export function activityLabel(activity, detail = null) {
  const base = {
    idle: "Ready (idle)",
    starting: "Starting",
    working: "Working",
    waiting_for_user: "Waiting for you",
    retrying: "Retrying",
    compacting: "Compacting context",
    stopping: "Stopping",
    failed: "Failed",
  }[activity] || "Agent";
  if (detail && activity !== "idle") return `${base} — ${detail}`;
  return base;
}

export function deriveFineActivity({
  generation = "idle",
  processStatus = "none",
  coarse = "idle",
  thinking = false,
  responding = false,
  toolName = null,
  toolKind = null,
  retry = null,
} = {}) {
  if (coarse === "failed" || processStatus === "failed") return { kind: "runtime_failed", label: "Agent failed" };
  if (generation === "failed") return { kind: "request_failed", label: "Request failed · Ready to retry" };
  if (generation === "interrupted") return { kind: "interrupted", label: "Interrupted · Ready" };
  if (generation === "stopping" || coarse === "stopping") return { kind: "stopping", label: "Stopping" };
  if (coarse === "waiting_for_user") return { kind: "waiting_for_user", label: "Waiting for your confirmation" };
  if (coarse === "compacting") return { kind: "compacting", label: "Compacting context" };
  if (retry?.waitingFor) return { kind: "waiting_for_device", label: `Waiting for ${retry.waitingFor}` };
  if (coarse === "retrying" || retry) {
    const attempt = retry?.attempt;
    const delay = retry?.delayMs;
    const parts = ["Retrying"];
    if (delay != null) parts.push(`in ${Math.ceil(delay / 1000)}s`);
    if (attempt != null) parts.push(`· attempt ${attempt}${retry.maxAttempts != null ? `/${retry.maxAttempts}` : ""}`);
    return { kind: "retrying", label: parts.join(" ") };
  }
  if (processStatus === "starting" || generation === "submitting" || coarse === "starting") {
    return { kind: "starting", label: generation === "submitting" ? "Starting…" : "Starting agent…" };
  }
  // An idle lifecycle wins over a stale coarse flag, so the row clears when the turn ends.
  if (generation === "idle" && !toolName && !thinking && !responding && !retry) {
    return { kind: "idle", label: null };
  }
  if (toolName) return { kind: "using_tool", label: toolKind === "script" ? "Scripting tools" : `Running ${toolName}` };
  if (thinking) return { kind: "thinking", label: "Thinking" };
  if (responding) return { kind: "responding", label: "Responding" };
  if (generation === "active" || generation === "submitting" || coarse === "working") {
    return { kind: "waiting_for_model", label: "Waiting for model" };
  }
  return { kind: "idle", label: null };
}
