// Reconcile a rendered message list with a freshly fetched (durable) list while
// preserving each row's render identity. Timeline keys are `message.key ??
// message.id`; when the server confirms an optimistic client entry we adopt its
// durable id but keep the original key so the DOM node survives (no remount, no
// scroll-anchor churn, no Markdown re-parse). See AGENTS.md "Rendering stability".

const OPTIMISTIC_PREFIXES = ["user_", "live_", "end_"];

const isOptimisticId = (id) => OPTIMISTIC_PREFIXES.some((prefix) => String(id || "").startsWith(prefix));

const keyOf = (message) => message.key ?? message.id;

function sameMessage(a, b) {
  return a.role === b.role
    && a.content === b.content
    && (a.timestamp || null) === (b.timestamp || null)
    && Boolean(a.stopped) === Boolean(b.stopped)
    && (a.status || null) === (b.status || null)
    && Boolean(a.continuing) === Boolean(b.continuing);
}

export function reconcileMessages(current, incoming) {
  const currentList = Array.isArray(current) ? current : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];

  const byId = new Map();
  currentList.forEach((message) => {
    if (message && message.id != null && !byId.has(message.id)) byId.set(message.id, message);
  });

  const matched = new Set();
  // First pass: reconcile incoming messages that already share a durable id.
  const resolved = incomingList.map((message) => {
    const existing = byId.get(message.id);
    if (!existing || matched.has(existing)) return null;
    matched.add(existing);
    const key = keyOf(existing);
    if (sameMessage(existing, message) && existing.key === key) return existing;
    return { ...message, key };
  });

  // Second pass: pair still-unmatched incoming messages, in order and by role,
  // against the remaining optimistic client entries so they inherit their keys.
  const pending = currentList.filter((message) => !matched.has(message) && isOptimisticId(message.id));
  const takeKeyForRole = (role) => {
    const index = pending.findIndex((message) => message.role === role);
    if (index === -1) return null;
    const [taken] = pending.splice(index, 1);
    return keyOf(taken);
  };

  return incomingList.map((message, index) => {
    if (resolved[index]) {
      const kept = resolved[index];
      if (kept.pending || kept.queueMode) {
        return { ...kept, pending: false, queueMode: undefined };
      }
      return kept;
    }
    const key = takeKeyForRole(message.role) ?? message.id;
    return { ...message, key, pending: false, queueMode: undefined };
  });
}
