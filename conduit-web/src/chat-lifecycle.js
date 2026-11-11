import { ServerConcurrency } from "./server/effect-concurrency.js";

function conflict(code, message) {
  return Object.assign(new Error(message), { code, status: 409 });
}

// Project guards are shared locks: deletion marks a project as closing before waiting for active launch/move work to
// drain.
export class ChatLifecycle {
  constructor({ projectDrainTimeoutMs = 30_000, concurrency = new ServerConcurrency() } = {}) {
    this.concurrency = concurrency;
    this.launches = new Map();
    this.deletingChats = new Set();
    this.projects = new Map();
    this.projectDrainTimeoutMs = projectDrainTimeoutMs;
  }

  assertAvailable(chatId, projectId) {
    if (this.deletingChats.has(chatId)) throw conflict("chat_deleting", "This chat is being deleted.");
    if (this.projectState(projectId).deleting) throw conflict("project_deleting", "This project is being deleted.");
  }

  run(chatId, work) {
    return this.concurrency.runChat(chatId, work);
  }

  async runLaunch(chatId, work, request = null) {
    if (this.deletingChats.has(chatId)) throw conflict("chat_deleting", "This chat is being deleted.");
    const existing = this.launches.get(chatId);
    if (existing) {
      // A spare start is somebody's in advance: whatever is actually asked
      // for waits for it, then gets its own settings on the agent it made.
      if (existing.request?.spare && !request?.spare) {
        return existing.promise.catch(() => {}).then(() => this.runLaunch(chatId, work, request));
      }
      // A model-bearing request cannot join a passive launch: that would silently discard the requested model.
      const passiveJoin = request && !request.forceModel && !request.model && !request.thinkingLevel
        && (!request.requestedProject || request.requestedProject === existing.request?.requestedProject);
      const same = ["requestedProject", "model", "thinkingLevel", "forceModel"]
        .every((key) => existing.request?.[key] === request?.[key]);
      if (!passiveJoin && !same) {
        throw conflict("live_session_start_mismatch", "This chat is already starting with different launch settings.");
      }
      return existing.promise;
    }
    if (this.concurrency.isChatBusy(chatId)) throw conflict("live_session_starting", "This chat is already starting or changing.");
    const launch = this.run(chatId, work);
    const entry = { request, promise: launch };
    this.launches.set(chatId, entry);
    const cleanup = () => {
      if (this.launches.get(chatId) === entry) this.launches.delete(chatId);
    };
    launch.then(cleanup, cleanup);
    return launch;
  }

  async deleteChat(chatId, work) {
    if (this.deletingChats.has(chatId)) throw conflict("chat_deleting", "This chat is already being deleted.");
    this.deletingChats.add(chatId);
    try {
      return await this.run(chatId, work);
    } finally {
      this.deletingChats.delete(chatId);
    }
  }

  async withProjects(projectIds, work) {
    // Increments counters only and never waits for a chat lock, so callers may take project guard -> chat lock.
    const states = [...new Set(projectIds)].sort().map((projectId) => [projectId, this.projectState(projectId)]);
    for (const [, state] of states) {
      if (state.deleting) throw conflict("project_deleting", "This project is being deleted.");
    }
    for (const [, state] of states) {
      if (state.active === 0) state.drain = Promise.withResolvers();
      state.active += 1;
    }
    try {
      return await work();
    } finally {
      for (const [, state] of states) {
        state.active -= 1;
        if (state.active === 0) {
          state.drain?.resolve();
          state.drain = null;
        }
      }
    }
  }

  async beginProjectDeletion(projectId) {
    const state = this.projectState(projectId);
    if (state.deleting) throw conflict("project_deleting", "This project is already being deleted.");
    state.deleting = true;
    if (state.active > 0) {
      // Captured before yielding: the final project operation may resolve it and clear state.drain in the same turn.
      const drain = state.drain.promise;
      try {
        await this.concurrency.waitFor(
          () => drain,
          this.projectDrainTimeoutMs,
          () => conflict("project_busy", "Project operations did not stop in time."),
        );
      } catch (error) {
        state.deleting = false;
        throw error;
      }
    }
    return () => {
      state.deleting = false;
      if (state.active === 0) this.projects.delete(projectId);
    };
  }

  projectState(projectId) {
    let state = this.projects.get(projectId);
    if (!state) {
      state = { active: 0, deleting: false, drain: null };
      this.projects.set(projectId, state);
    }
    return state;
  }
}
