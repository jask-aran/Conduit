import { messagesFromEntries } from "./session-store.js";

const RECENT_CHAT_LIMIT = 10;
const PREVIEW_LENGTH = 180;

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

async function recentChatView(chat, project, process, readPage) {
  let lastMessagePreview = "";
  let lastMessageAt = chat.updatedAt || chat.createdAt || null;
  if (chat.piSessionFile) {
    try {
      const page = await readPage(chat.piSessionFile, project, { turnLimit: 1, characterLimit: 12_000 });
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
  const recentChats = await Promise.all(recent
    .map((chat) => recentChatView(chat, project, processByChat.get(chat.id), readPage)));

  let git = null;
  if (isWorkspace(project)) {
    try {
      const overview = await inspectWorkspace(project.path, { signal });
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
      path: project.path,
      externalPath: project.externalPath || null,
      createdAt: project.createdAt,
      defaultTemplateId: project.defaultTemplateId || null,
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
    recentChats,
  };
}
