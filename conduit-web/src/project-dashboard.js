import { listWorkspaceDirectory } from "./workspace-inspector.js";

const RECENT_CHAT_LIMIT = 10;
const PREVIEW_LENGTH = 180;
const CHANGE_LIMIT = 50;
const RECENT_FILE_LIMIT = 8;

// The folder's own files, newest first. Only the top level: a project folder
// is where an agent writes its results, and a walk of a large tree would cost
// the dashboard more than the list is worth. Null when the folder could not be
// read (its device away, say), which is not the same as an empty one.
async function listRecentFiles(root) {
  try {
    const { entries } = await listWorkspaceDirectory(root);
    return entries
      .filter((entry) => entry.type === "file" && !entry.name.startsWith(".") && entry.modifiedAt != null)
      .map((entry) => ({ name: entry.name, modifiedAt: new Date(entry.modifiedAt).toISOString() }))
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)).slice(0, RECENT_FILE_LIMIT);
  } catch {
    return null;
  }
}

function isWorkspace(project) {
  return project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin);
}

function previewText(messages) {
  const message = messages
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

// A chat's preview, kept while its last message and update stay the same:
// reading ten transcripts on every open cost more than the rest of the page.
const previews = new Map();
const previewKey = (chat) => `${chat.lastMessageAt || ""}|${chat.updatedAt || chat.createdAt || ""}`;

async function chatPreview(chat, project, readTranscript, backendSessions) {
  const key = previewKey(chat);
  const kept = previews.get(chat.id);
  if (kept?.key === key) return kept;
  let lastMessagePreview = backendSessions.get(opaqueThreadId(chat))?.preview || "";
  let lastMessageAt = chat.updatedAt || chat.createdAt || null;
  let read = Boolean(lastMessagePreview);
  if (!lastMessagePreview && readTranscript) {
    try {
      const projection = await readTranscript(chat, project);
      const messages = (projection?.messages || []).filter((item) => ["user", "assistant"].includes(item.role) && item.content?.trim());
      lastMessagePreview = previewText(messages);
      lastMessageAt = messages.at(-1)?.timestamp || lastMessageAt;
      read = true;
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Could not read recent chat preview", chat.id, error);
    }
  }
  const preview = { key, lastMessagePreview, lastMessageAt };
  if (read) {
    previews.delete(chat.id);
    previews.set(chat.id, preview);
    if (previews.size > 1000) previews.delete(previews.keys().next().value);
  }
  return preview;
}

async function recentChatView(chat, project, process, readTranscript, backendSessions) {
  const { lastMessagePreview, lastMessageAt } = await chatPreview(chat, project, readTranscript, backendSessions);
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
  // Where its files are: this server's path, or a device's folder (workspace-host.js).
  root = project.workingRoot,
  registry,
  processes,
  terminals = [],
  readTranscript,
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
  const unknown = recent.filter((chat) => previews.get(chat.id)?.key !== previewKey(chat));
  const implementations = [...new Set(unknown.map((chat) => chat.backend?.implementation).filter(Boolean))];
  await Promise.all(implementations.map(async (implementation) => {
    const sessions = await listBackendSessions?.(implementation, project.workingRoot).catch(() => []) || [];
    for (const session of sessions) backendSessions.set(session.id, session);
  }));
  const recentChats = await Promise.all(recent
    .map((chat) => recentChatView(chat, project, processByChat.get(chat.id), readTranscript, backendSessions)));

  let git = null;
  let changes = [];
  if (isWorkspace(project)) {
    try {
      const overview = await inspectWorkspace(root, { signal });
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
    // Uncommitted changes when there are any; otherwise what was written to
    // the folder lately.
    recentFiles: changes.length ? [] : await listRecentFiles(root),
    recentChats,
  };
}
