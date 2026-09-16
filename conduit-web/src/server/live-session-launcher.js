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
    // The harness says whether there is anything to start. A backend that warms
    // nothing is not "failing to launch" -- it has no process by design, and
    // saying so here keeps that knowledge in the manifest rather than in a
    // client that would have to learn each backend's habits.
    const manifest = backends.manifestFor?.(context.chat.backend?.implementation || "");
    if (manifest && manifest.warm === "none") {
      throw launchError("no_live_process", "This chat has no live agent process", 409);
    }
    if (attachOnly) throw launchError("no_live_process", "This chat has no live agent process", 409);

    await reclaimForNewProcess(context.chat.id);
    const result = await adapter.launch(context, { model, thinkingLevel, forceModel }, {
      catalogFor, config, lifecycle, modelProfileRuntime, runtimeFor, templateForChat,
    });
    await registry.update(context.chat.id, result.mapping);
    return { live: result.live, modelRecovery: result.modelRecovery };
  }

  /**
   * Make room for one more agent, across every harness.
   *
   * The cap is a budget for this machine, so it counts processes rather than
   * Pi processes: warming a chat on one harness has to be able to reclaim an
   * idle agent on another, or the budget means nothing the moment two backends
   * are in use. The oldest idle one goes first -- the one nobody has come back
   * to -- and if every process is busy the launch is refused rather than
   * quietly stopping work somebody is waiting on.
   */
  async function reclaimForNewProcess(exceptChatId) {
    const max = Number(manager?.policy?.().maxLiveProcesses) || 0;
    if (!max) return;
    // Raw records rather than views: the same pass needs both what the process
    // is doing and which adapter owns it.
    const others = () => backends.rawRecords()
      .map((record) => ({ record, view: backends.view(record) }))
      .filter(({ view }) => view.chatId !== exceptChatId && view.status !== "stopped");
    for (let attempt = 0; others().length >= max; attempt += 1) {
      // A record that does not report its age is not therefore the oldest:
      // treating a missing timestamp as the epoch would evict harnesses that
      // keep less bookkeeping first, every time. Undated processes go last.
      const age = ({ view }) => new Date(view.updatedAt || view.createdAt || Date.now()).getTime();
      const oldest = others().filter(({ view }) => isIdleProcess(view)).sort((left, right) => age(left) - age(right))[0];
      if (!oldest || attempt >= max) {
        throw launchError("live_process_limit",
          `Too many live agents (max ${max}). Wait for a chat to finish or stop an idle one.`, 429);
      }
      await backends.adapterForRecord(oldest.record).close(oldest.view.id);
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
