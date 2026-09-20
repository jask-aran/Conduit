/**
 * Pi's own event stream, reduced onto a process record's activity flags.
 *
 * This lived in `activity.js`, the module every harness and the browser share,
 * so a switch statement over Pi's nineteen event names sat in the one place
 * that is supposed to be harness-agnostic. Nothing but Pi ever sent those
 * names -- Codex, ChatGPT Web and the test harness each reach the same flags
 * through their own adapters -- so the switch was unreachable for three of the
 * four and looked like shared ground for the fourth.
 *
 * What stays in `activity.js` is what reads the flags rather than the events:
 * `deriveCoarseActivity` and the labels. Those are Conduit's, and every
 * harness gets them. This file is Pi's, and only Pi imports it.
 */

import { deriveCoarseActivity } from "./activity.js";

/**
 * Apply a Pi event to mutable activity-related flags on a process record.
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

function listStrings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}
