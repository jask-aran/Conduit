import { isChatId } from "../chat-store.js";
import { ServerConcurrency } from "./effect-concurrency.js";

function launchError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * The intents that may start a process.
 *
 * Opening a chat is a document read, so "open" and "select" may attach to a
 * process that already exists but never create one. Only an action that needs
 * an agent may start one. That split lets the reaper stop an idle process
 * without a reconnect, retry, background fetch, or ordinary navigation
 * immediately bringing it back. The policy lives here so every client gets the
 * same lifecycle even if it sends an obsolete intent.
 */
export const SPAWNING_INTENTS = new Set([
  "prompt",
  "continue",
  "compact",
  "regenerate",
  "steer",
]);

export const maySpawnProcess = (intent) => SPAWNING_INTENTS.has(String(intent || "open"));

/**
 * A process that is alive, answering, and doing nothing.
 *
 * Read from the same view every client reads, so it holds for any harness
 * rather than for the one whose internals we happen to know.
 */
const isIdleProcess = (view) => Boolean(view)
  && view.status === "running"
  && view.ready !== false
  && !view.active
  && !view.stopping
  && !view.waiting
  && ["idle", "failed"].includes(typeof view.activity === "string" ? view.activity : view.activity?.kind);

const liveProcessEntries = (backends, exceptChatId = null) => backends.rawRecords()
  .map((record) => ({ record, view: backends.view(record) }))
  .filter(({ view }) => view.status !== "stopped" && view.chatId !== exceptChatId);

const processAge = ({ view }) => new Date(view.updatedAt || view.createdAt || Date.now()).getTime();

/**
 * Reclaim idle live sessions until the machine has the requested headroom.
 * reserve=1 is launch admission; reserve=0 is enforcement after a settings
 * change. One policy serves every harness.
 */
async function reclaimLiveProcesses(backends, maxLiveProcesses, {
  exceptChatId = null,
  reserve = 0,
  failIfBlocked = false,
  starting = new Set(),
} = {}) {
  const max = Math.trunc(Number(maxLiveProcesses) || 0);
  if (max <= 0) return 0;
  const target = Math.max(0, max - reserve);

  const attempted = new Set();
  let stopped = 0;
  for (;;) {
    const current = liveProcessEntries(backends, exceptChatId);
    // A launch admitted but not yet resident holds its slot all the same.
    const resident = new Set(current.map(({ view }) => view.chatId));
    const pending = [...starting].filter((chatId) => chatId !== exceptChatId && !resident.has(chatId)).length;
    if (current.length + pending <= target) return stopped;
    const oldest = current
      .filter(({ view }) => isIdleProcess(view) && !attempted.has(view.id))
      .sort((left, right) => processAge(left) - processAge(right))[0];
    if (!oldest) {
      if (failIfBlocked) {
        throw launchError("live_process_limit",
          `Too many live agents (max ${max}). Wait for a chat to finish or stop an idle one.`, 429);
      }
      return stopped;
    }
    attempted.add(oldest.view.id);
    const closed = await backends.adapterForRecord(oldest.record).close(oldest.view.id);
    if (closed !== false) stopped += 1;
  }
}

export const enforceLiveProcessLimit = (backends, maxLiveProcesses) =>
  reclaimLiveProcesses(backends, maxLiveProcesses);

export function createLiveSessionLauncher({
  catalogFor,
  config,
  concurrency = new ServerConcurrency(),
  findChatContext,
  lifecycle,
  maxLiveProcesses = () => 0,
  registry,
  runtimeFor,
  templateForChat,
  backends,
}) {
  // Chats admitted and still starting: each holds a slot of the budget.
  const starting = new Set();
  async function launchFromContext(context, {
    requestedProject = "",
    model = "",
    thinkingLevel = "",
    forceModel = false,
    attachOnly = false,
    spare = false,
  } = {}) {
    lifecycle.assertAvailable(context.chat.id, context.project.id);
    const adapter = backends.forChat(context.chat);
    if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
      throw launchError("session_project_mismatch", "The requested project does not own this chat", 409);
    }
    const resident = backends.getByChatId(context.chat.id);
    if (resident) {
      // A warm draft was started on whatever model its first page had; one
      // taken by another page with another choice is moved to it.
      if (context.chat.status === "draft") {
        const view = backends.view(resident);
        if (model && view.model !== model) await adapter.setModel?.(resident.id, model);
        if (thinkingLevel && view.thinkingLevel !== thinkingLevel) await adapter.setThinkingLevel?.(resident.id, thinkingLevel);
      }
      return { live: resident, modelRecovery: null };
    }
    // Selecting a chat may not start anything; sending a message must. That is
    // the whole of what `warm` says, and `attachOnly` already carries it here:
    // an "open" does not spawn, a prompt does. Refusing every launch on a
    // `warm: "none"` harness read the flag as "this chat can never be live",
    // which left its adapter with no record to publish into and answered a sent
    // message with "chat switched before the agent was ready".
    if (attachOnly) throw launchError("no_live_process", "This chat has no live agent process", 409);

    // Only admission is machine-wide: reclaiming room and reserving a slot.
    // Starting the process holds its slot, not the lock, so one cold start does
    // not hold up every other chat's.
    // A spare agent, started ahead of being asked for, only takes free room:
    // it never stops somebody's idle chat to make some.
    await concurrency.runCapacity(() => reclaimLiveProcesses(backends, spare ? 0 : maxLiveProcesses(), {
      exceptChatId: context.chat.id,
      reserve: 1,
      failIfBlocked: true,
      starting,
    }).then(() => {
      if (!spare) return;
      const max = Math.trunc(Number(maxLiveProcesses()) || 0);
      const held = liveProcessEntries(backends, context.chat.id).length + starting.size;
      if (max > 0 && held >= max) throw launchError("live_process_limit", "No room for a spare agent", 429);
    }).then(() => { starting.add(context.chat.id); }));
    try {
      const result = await adapter.launch(context, { model, thinkingLevel, forceModel }, {
        catalogFor, config, lifecycle, runtimeFor, templateForChat,
      });
      await registry.update(context.chat.id, result.mapping);
      return { live: result.live, modelRecovery: result.modelRecovery };
    } finally {
      starting.delete(context.chat.id);
    }
  }

  return async function launchLiveSession({
    chatId,
    requestedProject = "",
    model = "",
    thinkingLevel = "",
    forceModel = false,
    attachOnly = false,
    alreadyLocked = false,
    spare = false,
  } = {}) {
    if (!isChatId(chatId)) throw launchError("chat_not_found", "Chat not found", 404);
    if (alreadyLocked) {
      const context = await findChatContext(chatId);
      if (!context) throw launchError("chat_not_found", "Chat not found", 404);
      return lifecycle.withProjects([context.project.id], async () => launchFromContext(context, {
        requestedProject, model, thinkingLevel, forceModel, attachOnly, spare,
      }));
    }
    const request = { requestedProject, model, thinkingLevel, forceModel, attachOnly, spare };
    return lifecycle.runLaunch(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) throw launchError("chat_not_found", "Chat not found", 404);
      return lifecycle.withProjects([context.project.id], async () => launchFromContext(context, {
        requestedProject,
        model,
        thinkingLevel,
        forceModel,
        attachOnly,
        spare,
      }));
    }, request);
  };
}
