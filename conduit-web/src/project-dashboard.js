import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { messagesFromEntries } from "./session-store.js";
import { conduitPiSessionFile } from "./backend-session.js";

const RECENT_CHAT_LIMIT = 10;
const PREVIEW_LENGTH = 180;
const CHANGE_LIMIT = 50;
const RECENT_FILE_LIMIT = 8;

// The folder's own files, newest first. Only the top level: a project folder
// is where an agent writes its results, and a walk of a large tree would cost
// the dashboard more than the list is worth.
async function listRecentFiles(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map(async (entry) => ({ name: entry.name, modifiedAt: (await stat(path.join(root, entry.name))).mtime.toISOString() })));
    return files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)).slice(0, RECENT_FILE_LIMIT);
  } catch {
    return [];
  }
}

function isWorkspace(project) {
  return project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin);
}

function previewText(entries) {
  const message = messagesFromEntries(entries)
    .filter((item) => ["user", "assistant"].includes(item.role) && item.content?.trim())
    .at(-1);
  if (!message) return "";
  const compact = message.content.replace(/\s+/g, " ").trim();
  return compact.length > PREVIEW_LENGTH ? `${compact.slice(0, PREVIEW_LENGTH - 1)}…` : compact;
}

function isInspectionAbort(error) {
  return error?.code === "workspace_inspection_aborted" || error?.name === "AbortError";
}

const opaqueThreadId = (chat) => typeof chat.backend?.opaqueSession === "string"
  ? chat.backend.opaqueSession
  : chat.backend?.opaqueSession?.threadId || null;

async function recentChatView(chat, project, process, readPage, backendSessions) {
  let lastMessagePreview = backendSessions.get(opaqueThreadId(chat))?.preview || "";
  let lastMessageAt = chat.updatedAt || chat.createdAt || null;
  const sessionFile = conduitPiSessionFile(chat);
  if (sessionFile) {
    try {
      const page = await readPage(sessionFile, project, { turnLimit: 1, characterLimit: 12_000 });
      const messages = messagesFromEntries(page.entries)
        .filter((item) => ["user", "assistant"].includes(item.role) && item.content?.trim());
      lastMessagePreview = previewText(page.entries);
      lastMessageAt = messages.at(-1)?.timestamp || lastMessageAt;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return {
    id: chat.id,
    projectId: chat.projectId,
    status: chat.status,
    title: chat.title,
    templateId: chat.templateId || null,
    runtime: chat.runtime || null,
    createdAt: chat.createdAt || null,
    updatedAt: chat.updatedAt || null,
    lastMessageAt,
    lastMessagePreview,
    liveStatus: process?.status || null,
    liveActivity: process?.activity || null,
    liveActive: Boolean(process?.active),
  };
}

export async function buildProjectDashboard({
  project,
  registry,
  processes,
  terminals = [],
  readPage,
  inspectWorkspace,
  listBackendSessions,
  signal,
}) {
  const chats = registry.listProject(project.id);
  const activeChats = chats.filter((chat) => chat.status === "active");
  const processByChat = new Map(processes
    .filter((process) => process.projectId === project.id && process.chatId)
    .map((process) => [process.chatId, process]));
  const recent = [...activeChats]
    .sort((left, right) => String(right.updatedAt || right.createdAt || "")
      .localeCompare(String(left.updatedAt || left.createdAt || "")))
    .slice(0, RECENT_CHAT_LIMIT);
  const backendSessions = new Map();
  const implementations = [...new Set(recent.map((chat) => chat.backend?.implementation)
    .filter((implementation) => implementation && implementation !== "conduit_pi"))];
  await Promise.all(implementations.map(async (implementation) => {
    const sessions = await listBackendSessions?.(implementation, project.workingRoot).catch(() => []) || [];
    for (const session of sessions) backendSessions.set(session.id, session);
  }));
  const recentChats = await Promise.all(recent
    .map((chat) => recentChatView(chat, project, processByChat.get(chat.id), readPage, backendSessions)));

  let git = null;
  let changes = [];
  if (isWorkspace(project)) {
    try {
      const overview = await inspectWorkspace(project.workingRoot, { signal });
      if (overview.repository) {
        git = {
          branch: overview.branch || "detached HEAD",
          upstream: overview.upstream || null,
          ahead: overview.ahead || 0,
          behind: overview.behind || 0,
          lastCommitAt: overview.commits?.[0]?.authoredAt || null,
          hasUnstaged: Boolean(overview.files?.length),
          changedFiles: overview.files?.length || 0,
        };
        changes = (overview.files || []).slice(0, CHANGE_LIMIT).map((file) => ({
          path: file.path,
          status: file.status,
          added: file.headCounts?.added ?? null,
          removed: file.headCounts?.removed ?? null,
        }));
      }
    } catch (error) {
      if (isInspectionAbort(error)) throw error;
      // Git availability is supplementary; it must not take down the project
      // operator surface.
    }
  }

  const lastActivityAt = activeChats
    .map((chat) => chat.updatedAt || chat.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const liveTerminals = terminals.filter((terminal) => terminal.projectId === project.id && terminal.status === "running");

  return {
    identity: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      kind: project.kind,
      origin: project.origin,
      path: project.workingRoot,
      workingRoot: project.workingRoot,
      externalPath: project.externalPath || null,
      createdAt: project.createdAt,
      defaultTemplateId: project.defaultTemplateId || null,
      workspaceAppearance: project.workspaceAppearance || null,
      deletesFilesOnRemove: project.deletesFilesOnRemove,
    },
    stats: {
      totalChats: chats.length,
      activeChats: activeChats.length,
      liveChats: processByChat.size,
      liveTerminals: liveTerminals.length,
      lastActivityAt,
    },
    git,
    changes,
    // A repository shows what changed through Git; a folder without one
    // shows what was written to it lately.
    recentFiles: git ? [] : await listRecentFiles(project.workingRoot),
    recentChats,
  };
}
