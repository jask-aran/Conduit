import { isChatId } from "../chat-store.js";
import { ChatBackendRegistry } from "../pi-rpc-adapter.js";

function launchError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

export function createLiveSessionLauncher({
  catalogFor,
  config,
  findChatContext,
  lifecycle,
  manager,
  modelProfileRuntime,
  registry,
  runtimeFor,
  templateForChat,
  backends = new ChatBackendRegistry(manager),
}) {
  async function launchFromContext(context, {
    requestedProject = "",
    model = "",
    thinkingLevel = "",
    forceModel = false,
  } = {}) {
    lifecycle.assertAvailable(context.chat.id, context.project.id);
    const adapter = backends.forChat(context.chat);
    if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
      throw launchError("session_project_mismatch", "The requested project does not own this chat", 409);
    }
    const resident = backends.getByChatId(context.chat.id);
    if (resident) return { live: resident, modelRecovery: null };

    const result = await adapter.launch(context, { model, thinkingLevel, forceModel }, {
      catalogFor, config, lifecycle, modelProfileRuntime, runtimeFor, templateForChat,
    });
    await registry.update(context.chat.id, result.mapping);
    return { live: result.live, modelRecovery: result.modelRecovery };
  }

  return async function launchLiveSession({
    chatId,
    requestedProject = "",
    model = "",
    thinkingLevel = "",
    forceModel = false,
    alreadyLocked = false,
  } = {}) {
    if (!isChatId(chatId)) throw launchError("chat_not_found", "Chat not found", 404);
    if (alreadyLocked) {
      const context = await findChatContext(chatId);
      if (!context) throw launchError("chat_not_found", "Chat not found", 404);
      return lifecycle.withProjects([context.project.id], async () => launchFromContext(context, {
        requestedProject, model, thinkingLevel, forceModel,
      }));
    }
    const request = { requestedProject, model, thinkingLevel, forceModel };
    return lifecycle.runLaunch(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) throw launchError("chat_not_found", "Chat not found", 404);
      return lifecycle.withProjects([context.project.id], async () => launchFromContext(context, {
        requestedProject,
        model,
        thinkingLevel,
        forceModel,
      }));
    }, request);
  };
}
