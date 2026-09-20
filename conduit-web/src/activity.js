/**
 * Coarse process activity for global runtime indicators.
 * Precedence: failed > stopping > waiting_for_user > compacting > retrying > working > starting > idle
 *
 * Everything here reads a record's flags, never a harness's events. Pi's own
 * reduction onto those flags lives in `pi-activity.js`, where only Pi imports
 * it; the other three harnesses set the same flags through their adapters.
 */

export const COARSE_ACTIVITIES = [
  "idle",
  "starting",
  "working",
  "waiting_for_user",
  "retrying",
  "compacting",
  "stopping",
  "failed",
];

const RANK = Object.fromEntries(COARSE_ACTIVITIES.map((value, index) => [value, index]));

export function rankActivity(activity) {
  return RANK[activity] ?? 0;
}

export function pickHigherActivity(left, right) {
  return rankActivity(left) >= rankActivity(right) ? left : right;
}

/** True while a turn is in flight: agent streaming or prompt accepted but not yet settled. */
export function isTurnInFlight(record) {
  if (!record) return false;
  if (record.active) return true;
  const generation = record.generation;
  // A successful agent_end marks the generation settled; only aborts use closed.
  // Without this check, every completed turn looks "working" forever because the
  // generation handle stays open until the next prompt.
  if (generation && !generation.closed && !generation.settled) return true;
  return false;
}

/** Derive coarse activity from a process record's live flags. */
export function deriveCoarseActivity(record) {
  if (!record) return "idle";
  if (record.status === "failed") return "failed";
  if (record.status === "stopped") return "idle";
  if (record.status === "starting") return "starting";
  if (record.stopping) return "stopping";
  if (record.hostUiRequests?.length) return "waiting_for_user";
  if (record.compacting) return "compacting";
  if (record.retrying) return "retrying";
  if (isTurnInFlight(record)) return "working";
  // A harness that reports readiness separately is still starting while it is
  // alive but cannot answer -- Pi restoring a large session, for one. It ranks
  // below real work, which is proof enough that the harness is answering, and
  // harnesses that do not report readiness are unaffected.
  if (record.spoke === false || record.ready === false) return "starting";
  return "idle";
}

/**
 * What the indicator says a session is doing.
 *
 * These named Pi outright -- "Pi working", "Pi failed" -- on every chat,
 * including the three harnesses that are not Pi. The record the indicator is
 * given does not carry a harness name, so the labels say what is true of all
 * four instead of naming the wrong one.
 */
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

/** Fine-grained selected-chat activity for the transcript row. */
export function deriveFineActivity({
  generation = "idle",
  processStatus = "none",
  coarse = "idle",
  thinking = false,
  responding = false,
  toolName = null,
  retry = null,
} = {}) {
  if (coarse === "failed" || processStatus === "failed") return { kind: "runtime_failed", label: "Agent failed" };
  if (generation === "failed") return { kind: "request_failed", label: "Request failed · Ready to retry" };
  if (generation === "interrupted") return { kind: "interrupted", label: "Interrupted · Ready" };
  if (generation === "stopping" || coarse === "stopping") return { kind: "stopping", label: "Stopping" };
  if (coarse === "waiting_for_user") return { kind: "waiting_for_user", label: "Waiting for your confirmation" };
  if (coarse === "compacting") return { kind: "compacting", label: "Compacting context" };
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
  // Once the selected chat lifecycle is idle, do not keep showing activity from
  // a stale coarse flag — the transcript row must clear when the turn ends.
  if (generation === "idle" && !toolName && !thinking && !responding && !retry) {
    return { kind: "idle", label: null };
  }
  if (toolName) return { kind: "using_tool", label: `Running ${toolName}` };
  if (thinking) return { kind: "thinking", label: "Thinking" };
  if (responding) return { kind: "responding", label: "Responding" };
  if (generation === "active" || generation === "submitting" || coarse === "working") {
    return { kind: "waiting_for_model", label: "Waiting for model" };
  }
  return { kind: "idle", label: null };
}
