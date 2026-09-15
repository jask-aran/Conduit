import path from "node:path";
import {
  duplicateSession,
  removeSession,
  sessionDirectoryFor,
} from "./session-store.js";

export async function stopSessionProcesses(backends, session) {
  const chatId = session.chatId || session.id;
  const matching = backends.rawRecords().filter((record) => record.chatId === chatId);
  await Promise.all(matching.map((record) => backends.adapterForRecord(record).close(record.id)));
}

export async function stopSessionFamilyProcesses(backends, chat, _files) {
  const matching = backends.rawRecords().filter((record) => record.chatId === chat.id);
  await Promise.all(matching.map((record) => backends.adapterForRecord(record).close(record.id)));
}

export async function stopProjectProcesses(backends, projectId) {
  await Promise.all(backends.rawRecords().filter((record) => record.projectId === projectId)
    .map((record) => backends.adapterForRecord(record).close(record.id)));
}

export function sessionDirectoryForChat(config, chat, project) {
  const installation = config.installations.get(chat.runtime?.installationId || "conduit-pinned");
  return installation ? sessionDirectoryFor(project.workingRoot, installation.agentDir) : project.sessionsDir;
}

export function sessionDirectoryRootForChat(config, chat) {
  const installation = config.installations.get(chat.runtime?.installationId || "conduit-pinned");
  return installation?.agentDir || null;
}

export async function findDeletableSession(registry, projectList, chat) {
  try { return await registry.find(projectList, chat.id); }
  catch (error) {
    if (["ENOENT", "invalid_session_mapping", "session_cwd_mismatch"].includes(error.code)) return null;
    throw error;
  }
}

export async function moveRegisteredChat({ chat, source, target, session, registry }) {
  let duplicate = null;
  let folderMoved = false;
  try {
    if (session) duplicate = await duplicateSession(session, target);
    await registry.move(chat.id, source, target);
    folderMoved = true;
    if (duplicate) await registry.commitSession(chat.id, duplicate);
    if (session) await removeSession(session);
    return duplicate;
  } catch (error) {
    if (folderMoved) {
      await registry.move(chat.id, target, source).catch(() => {});
      if (session) await registry.commitSession(chat.id, session).catch(() => {});
    }
    if (duplicate) await removeSession(duplicate).catch(() => {});
    throw error;
  }
}
