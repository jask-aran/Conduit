import { agentProfiles, harnessIdForImplementation, profileSelection, templateBackend } from "../chat-backend.js";
import { isGeneratingRecord } from "../chat-backend-registry.js";
import { applyTranscriptOps } from "../transcript-fold.js";

const positive = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Limits must be positive integers");
  return value;
};
const line = (value) => String(value || "").replace(/\s+/g, " ").trim();
const required = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
};

/** Keep transcript text separate from instructions, and tool payloads short. */
function transcriptText(projection, limit, maxChars) {
  const tools = new Map((projection.tools || []).map((tool) => [tool.toolCallId, tool]));
  return (projection.messages || []).slice(-limit).map((message) => {
    const role = message.role || "unknown";
    if (role === "tool" || role === "toolResult") return `${role}: ${line(message.content).slice(0, 200)}`;
    const steps = (message.blocks || []).filter((block) => block.kind === "tool_call").map((block) => {
      const tool = tools.get(block.toolCallId);
      return `Tool: ${line(block.name || tool?.name || "tool")} — ${line(tool?.output || tool?.status || "called").slice(0, 200)}`;
    });
    return [`${role}: ${message.content || ""}`, ...steps].join("\n");
  }).join("\n\n").slice(-maxChars);
}

/** Use the same registry, transcript readers and prompt paths as the HTTP routes. */
export function createChatHost({ registry, projects, backends, chatLogs, findChatContext, launchLiveSession, submitPrompt }) {
  const visible = () => registry.list().filter((chat) => !chat.backend?.agentThread
    && chat.status !== "subagent" && !chat.untracked && !chat.run)
    .sort((a, b) => String(b.lastMessageAt || b.updatedAt || b.createdAt || "")
      .localeCompare(String(a.lastMessageAt || a.updatedAt || a.createdAt || "")));
  const personChat = (chatId) => {
    if (typeof chatId !== "string" || !visible().some((chat) => chat.id === chatId)) throw new Error("Chat not found in the person's chats");
  };
  const contextFor = async (chatId) => {
    personChat(chatId);
    const context = await findChatContext(chatId);
    if (!context) throw new Error("Chat not found");
    personChat(chatId);
    return context;
  };
  const view = (chat, workspaces) => ({
    chatId: chat.id,
    title: chat.title || "",
    workspace: workspaces.find((project) => project.id === chat.projectId)?.name || chat.projectId,
    profile: chat.backend?.profileId || chat.templateId || null,
    harness: harnessIdForImplementation(chat.backend?.implementation),
    status: chat.status,
    updatedAt: chat.updatedAt || chat.createdAt,
    generating: isGeneratingRecord(backends.getByChatId(chat.id)),
  });

  return {
    async listChats({ query = "", limit = 20 } = {}) {
      const workspaces = await projects.list();
      const needle = String(query).toLowerCase();
      return visible().map((chat) => view(chat, workspaces))
        .filter((chat) => `${chat.title}\n${chat.workspace}`.toLowerCase().includes(needle))
        .slice(0, positive(limit, 20));
    },

    async readChat(chatId, { limit = 30, maxChars = 20000 } = {}) {
      const context = await contextFor(chatId);
      limit = positive(limit, 30);
      maxChars = positive(maxChars, 20000);
      const adapter = backends.forChat(context.chat);
      const read = (before) => adapter.readTranscript({ chatId,
        liveSessionId: backends.getByChatId(chatId)?.id,
        opaqueSession: context.chat.backend?.opaqueSession, project: context.project, before });
      let projection = await read();
      const cursors = new Set();
      // A harness page can hold fewer messages than requested, even at the tail.
      while (projection.page?.before && (projection.messages || []).length < limit) {
        const before = projection.page.before;
        if (cursors.has(before)) break;
        cursors.add(before);
        personChat(chatId);
        const older = await read(before);
        projection = { ...older, messages: [...(older.messages || []), ...(projection.messages || [])],
          tools: [...(older.tools || []), ...(projection.tools || [])] };
      }
      personChat(chatId);
      const log = chatLogs?.peek(chatId);
      // This read always includes the newest page, so the live log belongs over it.
      const current = applyTranscriptOps(projection, log?.entries || []);
      return transcriptText(current, limit, maxChars);
    },

    async searchChats(query, { limit = 10 } = {}) {
      const needle = required(query, "query").toLowerCase();
      limit = Math.min(positive(limit, 10), 200);
      const workspaces = await projects.list();
      const matches = [];
      for (const chat of visible().slice(0, 200)) {
        // Search loaded text only: a history reader can contact a remote harness.
        const loaded = chatLogs?.peek(chat.id)?.stated || {};
        const text = [chat.title || "", transcriptText(loaded, 30, 20000)].join("\n");
        const match = text.split("\n").find((item) => item.toLowerCase().includes(needle));
        if (match !== undefined) {
          const at = match.toLowerCase().indexOf(needle);
          matches.push({ ...view(chat, workspaces), line: match.slice(Math.max(0, at - 100), at + needle.length + 200) });
        }
        if (matches.length >= limit) break;
      }
      return matches;
    },

    async startChat({ workspace, profile, prompt, title }) {
      required(prompt, "prompt");
      if (title !== undefined) title = required(title, "title");
      const workspaces = await projects.list();
      const name = workspace === undefined ? "chat" : required(workspace, "workspace");
      const project = workspaces.find((item) => item.id === name) || workspaces.find((item) => item.slug === name)
        || workspaces.find((item) => item.name === name);
      if (!project) throw new Error("Workspace not found");
      await projects.validate(project);
      const templates = backends.config?.piTemplates || backends.adapters.get("conduit-runtime")?.runtime?.templates || [];
      const selection = profileSelection({ profileId: profile === undefined ? project.defaultTemplateId || "assistant" : required(profile, "profile") });
      const profiles = agentProfiles(templates, { available: backends.local || new Set(backends.adapters.keys()) });
      const selected = profiles.find((item) => item.id === selection.profileId);
      const template = templates.find((item) => item.id === selection.templateId);
      if (!selected || selected.id === "agent" || template?.internal || template?.defaultable === false || template?.special) {
        throw new Error("Profile is unknown or internal");
      }
      const implementation = selected.agent.implementation;
      const can = await backends.capabilities?.(project);
      if (can && !can.harnesses.includes(implementation)) throw new Error("Harness is not available in this workspace");
      if ((!can && selected.disabled) || !backends.adapters.has(implementation)) throw new Error("Profile is unavailable");
      const chat = await registry.create(project, selected.management === "agent" ? {
        backend: { profileId: selected.id, profileRevision: null, management: selected.management, ...selected.agent, opaqueSession: null },
      } : { templateId: template.id, templateVersion: template.version, backend: templateBackend(template) });
      try {
        // Set the title before prompting so automatic naming cannot replace it.
        if (title !== undefined) await registry.update(chat.id, { title });
        await launchLiveSession({ chatId: chat.id, requestedProject: project.id });
        await submitPrompt(chat.id, prompt);
      } catch (error) {
        throw new Error(`Chat ${chat.id} was created, but could not start: ${error?.message || error}`, { cause: error });
      }
      return { chatId: chat.id, title: registry.metadata(chat.id)?.title || "", workspace: project.name };
    },

    async steerChat(chatId, message, { from } = {}) {
      required(message, "message");
      const context = await contextFor(chatId);
      if (!backends.getByChatId(chatId)) await launchLiveSession({ chatId, requestedProject: context.project.id });
      personChat(chatId);
      const record = backends.getByChatId(chatId);
      if (!record) throw new Error("This chat has no live agent process");
      const text = `[${line(from || "Agent")}] ${message}`;
      if (isGeneratingRecord(record)) {
        const adapter = backends.forChat(context.chat);
        if (!adapter.getCapabilities().steer) throw new Error("This harness cannot steer a busy chat");
        await adapter.queue(record.id, "steer", text);
      } else {
        await submitPrompt(chatId, text);
      }
      return { chatId, sent: true };
    },
  };
}
