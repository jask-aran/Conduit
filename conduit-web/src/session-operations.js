import path from "node:path";
import { sessionDirectoryFor } from "./session-store.js";

export async function stopSessionProcesses(backends, session) {
  const chatId = session.chatId || session.id;
  const matching = backends.rawRecords().filter((record) => record.chatId === chatId);
  await Promise.all(matching.map((record) => backends.adapterForRecord(record).close(record.id)));
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
