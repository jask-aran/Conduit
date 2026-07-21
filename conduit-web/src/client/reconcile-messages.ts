import type { Message } from "./api/contracts";

const OPTIMISTIC_PREFIXES = ["user_", "live_", "end_"];
const isOptimisticId = (id: string) => OPTIMISTIC_PREFIXES.some((prefix) => id.startsWith(prefix));
const keyOf = (message: Message) => message.key ?? message.id;

function sameMessage(left: Message, right: Message) {
  return left.role === right.role
    && left.content === right.content
    && (left.timestamp || null) === (right.timestamp || null)
    && Boolean(left.stopped) === Boolean(right.stopped)
    && (left.status || null) === (right.status || null)
    && Boolean(left.continuing) === Boolean(right.continuing);
}

export function reconcileMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  current.forEach((message) => {
    if (message.id && !byId.has(message.id)) byId.set(message.id, message);
  });

  const matched = new Set<Message>();
  const resolved = incoming.map((message) => {
    const existing = byId.get(message.id);
    if (!existing || matched.has(existing)) return null;
    matched.add(existing);
    const key = keyOf(existing);
    if (sameMessage(existing, message) && existing.key === key) return existing;
    return { ...message, key };
  });

  const pending = current.filter((message) => !matched.has(message) && isOptimisticId(message.id));
  const takeKeyForRole = (role: Message["role"]) => {
    const index = pending.findIndex((message) => message.role === role);
    if (index === -1) return null;
    const [taken] = pending.splice(index, 1);
    return keyOf(taken!);
  };

  return incoming.map((message, index) => {
    const kept = resolved[index];
    if (kept) return kept.pending || kept.queueMode ? { ...kept, pending: false, queueMode: undefined } : kept;
    return { ...message, key: takeKeyForRole(message.role) ?? message.id, pending: false, queueMode: undefined };
  });
}
