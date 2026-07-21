const BLOCKING_REQUEST_KINDS = new Set(["select", "confirm", "input", "editor"]);
const REQUEST_STATUSES = new Set(["pending", "submitting", "resolved", "error"]);

export function isInteractiveRequestKind(kind) {
  return BLOCKING_REQUEST_KINDS.has(kind);
}

function listStrings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeSeq(value) {
  if (value == null) return null;
  const seq = Number(value);
  return Number.isFinite(seq) ? seq : null;
}

function normalizeResponse(response) {
  if (!response || typeof response !== "object") return null;
  if (response.cancelled === true) return { cancelled: true };
  if (typeof response.confirmed === "boolean") return { confirmed: response.confirmed };
  if (response.value != null) return { value: String(response.value) };
  return null;
}

export function normalizeInteractiveRequest(event, { timestamp = null, seq = null } = {}) {
  if (!event || typeof event !== "object") return null;
  const source = event.request && typeof event.request === "object" ? event.request : event;
  const kind = source.method || source.kind || event.method || event.kind;
  if (!isInteractiveRequestKind(kind)) return null;

  const id = event.id || event.requestId || source.id || source.requestId;
  if (!id) return null;

  const eventTimestamp = event.timestamp ?? source.timestamp ?? timestamp;
  const eventSeq = event.seq ?? source.seq ?? seq;
  const status = REQUEST_STATUSES.has(source.status || event.status)
    ? (source.status || event.status)
    : "pending";
  const error = source.error ?? event.error;

  return {
    id: String(id),
    kind,
    title: String(source.title ?? event.title ?? "Request"),
    message: String(source.message ?? event.message ?? ""),
    options: listStrings(source.options ?? event.options),
    placeholder: String(source.placeholder ?? event.placeholder ?? ""),
    prefill: String(source.prefill ?? event.prefill ?? ""),
    timeoutMs: source.timeoutMs ?? source.timeout ?? event.timeoutMs ?? event.timeout ?? null,
    status,
    response: normalizeResponse(source.response ?? event.response),
    error: error == null || error === "" ? null : String(error),
    timestamp: eventTimestamp ?? null,
    seq: normalizeSeq(eventSeq),
  };
}

export function mergeInteractiveRequestSnapshot(current, incoming) {
  const currentList = Array.isArray(current) ? current : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const currentById = new Map(currentList.map((request) => [request.id, request]));
  const seen = new Set();
  const merged = [];

  for (const request of incomingList) {
    const normalized = normalizeInteractiveRequest(request, {
      timestamp: request?.timestamp ?? null,
      seq: request?.seq ?? null,
    });
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);

    const existing = currentById.get(normalized.id);
    if (!existing) {
      merged.push(normalized);
      continue;
    }

    const next = {
      ...existing,
      ...normalized,
      timestamp: existing.timestamp ?? normalized.timestamp,
      seq: existing.seq ?? normalized.seq,
    };
    if (existing.status === "resolved" && normalized.status !== "resolved") {
      next.status = "resolved";
      next.response = existing.response;
      next.error = null;
    }
    merged.push(next);
  }

  for (const request of currentList) {
    if (request?.status !== "resolved" || seen.has(request.id)) continue;
    seen.add(request.id);
    merged.push(request);
  }

  return merged;
}

function updateInteractiveRequest(current, requestId, update) {
  const list = Array.isArray(current) ? current : [];
  const index = list.findIndex((request) => request.id === requestId);
  if (index < 0) return current;
  const next = [...list];
  next[index] = update(list[index]);
  return next;
}

export function markInteractiveRequestSubmitting(current, requestId, response) {
  return updateInteractiveRequest(current, requestId, (request) => ({
    ...request,
    status: "submitting",
    response: normalizeResponse(response),
    error: null,
  }));
}

export function resolveInteractiveRequest(current, requestId, response = null) {
  return updateInteractiveRequest(current, requestId, (request) => ({
    ...request,
    status: "resolved",
    response: normalizeResponse(response) || request.response || null,
    error: null,
  }));
}

export function failInteractiveRequest(current, requestId, message) {
  return updateInteractiveRequest(current, requestId, (request) => ({
    ...request,
    status: "error",
    error: String(message || "Could not send response"),
  }));
}
