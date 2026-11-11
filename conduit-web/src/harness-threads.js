import os from "node:os";
import path from "node:path";

// Conduit has no folder registry to consult here, so "projects" are derived from each thread's working directory.

export function displayPath(absolute, home = os.homedir()) {
  if (!absolute) return "";
  if (absolute === home) return "~";
  return absolute.startsWith(`${home}${path.sep}`) ? `~${absolute.slice(home.length)}` : absolute;
}

const recency = (thread) => thread.updatedAt || thread.createdAt || 0;

/**
 * `tracked` maps a native thread id to the Conduit chat that adopted it, so a thread appears once, badged, instead of
 * in separate tracked and adoptable lists.
 */
export function groupThreadsByFolder(threads, { tracked = new Map(), home = os.homedir() } = {}) {
  const groups = new Map();
  for (const thread of threads) {
    if (!thread?.id || !thread.cwd) continue;
    let group = groups.get(thread.cwd);
    if (!group) {
      group = { path: thread.cwd, display: displayPath(thread.cwd, home), repository: null, updatedAt: 0, threads: [] };
      groups.set(thread.cwd, group);
    }
    const chatId = tracked.get(thread.id) || null;
    group.threads.push(chatId ? { ...thread, tracked: true, chatId } : { ...thread, tracked: false, chatId: null });
    group.updatedAt = Math.max(group.updatedAt, recency(thread));
    group.repository ||= thread.branch || thread.originUrl ? { branch: thread.branch || null, originUrl: thread.originUrl || null } : null;
  }
  for (const group of groups.values()) group.threads.sort((left, right) => recency(right) - recency(left));
  return [...groups.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function trackedByThread(chats, implementation) {
  const tracked = new Map();
  for (const chat of chats) {
    if (chat.backend?.implementation !== implementation) continue;
    const opaque = chat.backend?.opaqueSession;
    const threadId = typeof opaque === "string" ? opaque : opaque?.threadId;
    if (threadId) tracked.set(threadId, chat.id);
  }
  return tracked;
}
