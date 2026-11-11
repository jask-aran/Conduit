import { isChatId } from "../chat-store.js";
import { rememberedModel } from "../profile-model-memory.js";
import { ServerConcurrency } from "./effect-concurrency.js";

function launchError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * Opening a chat only attaches; only an action that needs an agent starts one, so a reconnect, retry or navigation
 * does not bring back a process the reaper stopped.
 */
const SPAWNING_INTENTS = new Set([
  "prompt",
  "compact",
  "regenerate",
  "steer",
]);

export const maySpawnProcess = (intent) => SPAWNING_INTENTS.has(String(intent || "open"));

/** Read from the client view so it holds for any harness. */
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

/** reserve=1 is launch admission; reserve=0 is enforcement after a settings change. */
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
  preferences = null,
  registry,
  runtimeFor,
  templateForChat,
  backends,
}) {
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
    // A harness the workspace's place cannot run would run on the hub, against a path that names a device's folder.
    const can = await backends.capabilities?.(context.project);
    if (can && !can.harnesses.includes(context.chat.backend?.implementation || "conduit-runtime")) {
      throw launchError("harness_not_here", `This chat's harness is not available on ${can.device.name}`, 409);
    }
    if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
      throw launchError("session_project_mismatch", "The requested project does not own this chat", 409);
    }
    const resident = backends.getByChatId(context.chat.id);
    if (resident) {
      // A draft's session from an earlier launch takes this request's model.
      if (context.chat.status === "draft") {
        const view = backends.view(resident);
        if (model && view.model !== model) await adapter.setModel?.(resident.id, model);
        if (thinkingLevel && view.thinkingLevel !== thinkingLevel) await adapter.setThinkingLevel?.(resident.id, thinkingLevel);
      }
      return { live: resident, modelRecovery: null };
    }
    // A subagent's chat is the exception: opening it starts only a read-only watcher (no process, outside the cap).
    if (attachOnly && context.chat.status !== "subagent") throw launchError("no_live_process", "This chat has no live agent process", 409);

    // Only admission holds the machine-wide lock, so one cold start does not hold up every other chat's. A spare
    // agent only takes free room: it never stops an idle chat to make some.
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
    // The model lookup below can fail too, and the slot must be given back however the start ends.
    try {
      // A chat with no model starts on its profile's last one, as its composer shows.
      if (!model && !context.chat.backend?.model && preferences
        && (context.chat.backend?.implementation || "conduit-runtime") === "conduit-runtime") {
        const remembered = rememberedModel(preferences, templateForChat(context.chat, context.project)?.id);
        const known = remembered?.model && (await adapter.listAvailableModels?.(context.project.workingRoot) || [])
          .some((item) => item.spec === remembered.model);
        if (known) { model = remembered.model; thinkingLevel = remembered.thinkingLevel || ""; forceModel = true; }
      }
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
