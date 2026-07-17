/**
 * Coarse process activity for global runtime indicators.
 * Precedence: failed > stopping > waiting_for_user > compacting > retrying > working > starting > idle
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
  return "idle";
}

/**
 * Apply a Pi/Conduit event to mutable activity-related flags on a process record.
 * Returns true when coarse activity may have changed.
 */
export function applyActivityEvent(record, event) {
  if (!record || !event?.type) return false;
  const before = deriveCoarseActivity(record);
  let detail = record.activityDetail || null;

  switch (event.type) {
    case "agent_start":
      record.active = true;
      if (record.generation) record.generation.settled = false;
      detail = null;
      break;
    case "agent_end":
      record.active = false;
      if (!event.willRetry) {
        record.retrying = false;
        record.retry = null;
        if (record.generation) record.generation.settled = true;
      }
      detail = null;
      break;
    case "agent_settled":
      record.active = false;
      if (record.generation) record.generation.settled = true;
      detail = null;
      break;
    case "tool_execution_start":
      record.active = true;
      detail = event.toolName ? `using ${event.toolName}` : "using tool";
      break;
    case "tool_execution_end":
      if (record.activityDetail?.startsWith("using ")) detail = null;
      break;
    case "compaction_start":
      record.compacting = true;
      detail = "compacting context";
      break;
    case "compaction_end":
      record.compacting = false;
      detail = null;
      break;
    case "auto_retry_start":
      record.retrying = true;
      record.retry = {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage || null,
      };
      detail = event.attempt != null ? `retry attempt ${event.attempt}` : "retrying";
      break;
    case "auto_retry_end":
      record.retrying = false;
      record.retry = null;
      detail = null;
      break;
    case "extension_ui_request": {
      if (isBlockingHostUi(event)) {
        const request = normalizeHostUiRequest(event);
        if (request && !record.hostUiRequests.some((item) => item.id === request.id)) {
          record.hostUiRequests.push(request);
        }
        detail = request?.title || "waiting for confirmation";
      }
      break;
    }
    case "extension_ui_resolved":
    case "extension_ui_response_sent": {
      const requestId = event.requestId || event.id;
      record.hostUiRequests = (record.hostUiRequests || []).filter((item) => item.id !== requestId);
      if (!record.hostUiRequests.length) detail = null;
      break;
    }
    case "queue_update":
      record.queue = {
        steering: listStrings(event.steering),
        followUp: listStrings(event.followUp),
      };
      break;
    case "runtime_error":
      if (record.status === "failed") detail = event.message || "failed";
      break;
    default:
      break;
  }

  const beforeDetail = record.activityDetail || null;
  record.activityDetail = detail;
  const after = deriveCoarseActivity(record);
  record.activity = after;
  return before !== after || beforeDetail !== detail;
}

export function isBlockingHostUi(event) {
  const method = event.method || event.request?.method || event.request?.kind;
  return ["confirm", "select", "input", "editor"].includes(method);
}

export function normalizeHostUiRequest(event) {
  const method = event.method || event.request?.method;
  if (!["confirm", "select", "input", "editor"].includes(method)) return null;
  const id = event.id || event.request?.id;
  if (!id) return null;
  return {
    id,
    kind: method,
    title: event.title || event.request?.title || "Request",
    message: event.message || event.request?.message || "",
    options: listStrings(event.options || event.request?.options),
    placeholder: event.placeholder || event.request?.placeholder || "",
    prefill: event.prefill || event.request?.prefill || "",
    timeoutMs: event.timeout ?? event.timeoutMs ?? event.request?.timeout ?? null,
  };
}

export function activityLabel(activity, detail = null) {
  const base = {
    idle: "Pi ready (idle)",
    starting: "Pi starting",
    working: "Pi working",
    waiting_for_user: "Waiting for you",
    retrying: "Retrying",
    compacting: "Compacting context",
    stopping: "Stopping",
    failed: "Pi failed",
  }[activity] || "Pi";
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
  if (generation === "failed" || coarse === "failed" || processStatus === "failed") return { kind: "failed", label: "Failed" };
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
    return { kind: "starting", label: generation === "submitting" ? "Starting…" : "Starting Pi…" };
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

function listStrings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}
