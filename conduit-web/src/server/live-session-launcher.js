import { isChatId } from "../chat-store.js";
import { ChatBackendRegistry } from "../pi-rpc-adapter.js";

function launchError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * The intents that may start a process.
 *
 * "select" is a person opening a chat, and it warms an agent so the first
 * message they send does not pay a cold start. Everything else that is not real
 * use -- an "open", which is what a reconnect, a retry timer or a background
 * fetch sends -- may attach to a process that already exists but never creates
 * one. That split is the point: the reaper stops an idle process, and a socket
 * reconnecting a moment later must not be able to undo that just by asking
 * again, while a person who clicks into the chat plainly may. Leaving it to
 * clients to tell those apart meant one stale tab could resurrect everything
 * the reaper reclaimed, so the policy lives here, where every client meets it
 * whether or not it cooperates.
 */
export const SPAWNING_INTENTS = new Set([
  "select",
  "prompt",
  "continue",
  "compact",
  "regenerate",
  "steer",
]);

export const maySpawnProcess = (intent) => SPAWNING_INTENTS.has(String(intent || "open"));

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
    attachOnly = false,
  } = {}) {
    lifecycle.assertAvailable(context.chat.id, context.project.id);
    const adapter = backends.forChat(context.chat);
    if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
      throw launchError("session_project_mismatch", "The requested project does not own this chat", 409);
    }
    const resident = backends.getByChatId(context.chat.id);
    if (resident) return { live: resident, modelRecovery: null };
    if (attachOnly) throw launchError("no_live_process", "This chat has no live agent process", 409);

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
    attachOnly = false,
    alreadyLocked = false,
  } = {}) {
    if (!isChatId(chatId)) throw launchError("chat_not_found", "Chat not found", 404);
    if (alreadyLocked) {
      const context = await findChatContext(chatId);
      if (!context) throw launchError("chat_not_found", "Chat not found", 404);
      return lifecycle.withProjects([context.project.id], async () => launchFromContext(context, {
        requestedProject, model, thinkingLevel, forceModel, attachOnly,
      }));
    }
    const request = { requestedProject, model, thinkingLevel, forceModel, attachOnly };
    return lifecycle.runLaunch(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) throw launchError("chat_not_found", "Chat not found", 404);
      return lifecycle.withProjects([context.project.id], async () => launchFromContext(context, {
        requestedProject,
        model,
        thinkingLevel,
        forceModel,
        attachOnly,
      }));
    }, request);
  };
}
