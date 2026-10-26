import path from "node:path";
import { sessionDirectoryFor } from "./session-store.js";

export async function stopSessionProcesses(backends, session) {
  const chatId = session.chatId || session.id;
  const matching = backends.rawRecords().filter((record) => record.chatId === chatId);
  const resident = backends.getByChatId?.(chatId);
  if (resident && !matching.includes(resident)) matching.push(resident);
  await Promise.all(matching.map((record) => backends.adapterForRecord(record).close(record.id)));
}

/** A chat being deleted: its processes stop, and so does work it left running in the background (a harness's own). */
export async function discardSession(backends, chat, registry = null) {
  // A harness that is not loaded has nothing running here to stop.
  const adapter = (() => { try { return backends.forChat(chat); } catch { return null; } })();
  await adapter?.discard?.(chat);
  await stopSessionProcesses(backends, chat);
  if (registry) {
    for (const child of registry.list({ includeHidden: true }).filter((child) => child.backend?.parentChatId === chat.id)) {
      await stopSessionProcesses(backends, child);
      await registry.remove(child.id);
    }
  }
}

export async function stopProjectProcesses(backends, projectId) {
  await Promise.all(backends.rawRecords().filter((record) => record.projectId === projectId)
    .map((record) => backends.adapterForRecord(record).close(record.id)));
}

export function sessionDirectoryForChat(config, chat, project) {
  return sessionDirectoryFor(project.workingRoot, config.piAgentDir);
}

export function sessionDirectoryRootForChat(config, chat) {
  return config.piAgentDir;
}

export async function findDeletableSession(registry, projectList, chat) {
  try { return await registry.find(projectList, chat.id); }
  catch (error) {
    if (["ENOENT", "invalid_session_mapping", "session_cwd_mismatch"].includes(error.code)) return null;
    throw error;
  }
}

/**
 * Move a Conduit durable agent chat to another project or workspace: a record
 * and metadata change, not a file move of its history. Its folder (logs,
 * attachments) follows it, its conversations work in the target from now on,
 * and its owner becomes the target's device. Chats of other harnesses keep
 * their history in the harness, tied to a folder, so they do not move.
 */
export async function moveDurableChat({ chat, source, target, backends, registry }) {
  if (chat.status === "subagent") throw Object.assign(new Error("subagent_read_only"), { code: "subagent_read_only", status: 409 });
  if (chat.backend?.implementation !== "conduit-runtime") {
    throw Object.assign(new Error("Only Conduit chats can move; this one's history lives in its harness, tied to its folder."),
      { code: "chat_move_not_supported", status: 409 });
  }
  if (chat.projectId === target.id) throw Object.assign(new Error("The chat is already there"), { code: "session_project_unchanged", status: 409 });
  // Roaming chats belong to no device; one moved onto a device's workspace is owned by it.
  if (chat.backend?.roaming && !target.local) {
    throw Object.assign(new Error("A chat that works on any device stays on this server's folders."), { code: "chat_move_not_supported", status: 409 });
  }
  for (const child of registry.list({ includeHidden: true }).filter((item) => item.backend?.parentChatId === chat.id)) {
    await stopSessionProcesses(backends, child);
  }
  await stopSessionProcesses(backends, chat);
  await registry.move(chat.id, source, target);
  try {
    await backends.adapters.get("conduit-runtime").relocate({ opaqueSession: chat.backend?.opaqueSession, project: target });
  } catch (error) {
    await registry.move(chat.id, target, source).catch(() => {});
    throw error;
  }
  return registry.metadata(chat.id);
}
