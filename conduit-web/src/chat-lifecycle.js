function conflict(code, message) {
  return Object.assign(new Error(message), { code, status: 409 });
}

// Serializes the transitions that change a chat's process, session mapping, or
// owning project. Project guards are shared locks: deletion marks a project as
// closing before waiting for active launch/move work to drain.
export class ChatLifecycle {
  constructor({ projectDrainTimeoutMs = 30_000 } = {}) {
    this.chatTails = new Map();
    this.launches = new Map();
    this.deletingChats = new Set();
    this.projects = new Map();
    this.projectDrainTimeoutMs = projectDrainTimeoutMs;
  }

  isBusy(chatId) {
    return this.chatTails.has(chatId);
  }

  assertAvailable(chatId, projectId) {
    if (this.deletingChats.has(chatId)) throw conflict("chat_deleting", "This chat is being deleted.");
    if (this.projectState(projectId).deleting) throw conflict("project_deleting", "This project is being deleted.");
  }

  async run(chatId, work) {
    const previous = this.chatTails.get(chatId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.chatTails.set(chatId, current);
    await previous.catch(() => {});
    try {
      return await work();
    } finally {
      release();
      if (this.chatTails.get(chatId) === current) this.chatTails.delete(chatId);
    }
  }

  async runLaunch(chatId, work, request = null) {
    if (this.deletingChats.has(chatId)) throw conflict("chat_deleting", "This chat is being deleted.");
    const existing = this.launches.get(chatId);
    if (existing) {
      // A passive browser attach may join a launch that already selected its
      // model. A later model-bearing request cannot join a passive launch,
      // because that would silently discard the requested model.
      const passiveJoin = request && !request.forceModel && !request.model && !request.thinkingLevel
        && (!request.requestedProject || request.requestedProject === existing.request?.requestedProject);
      const same = ["requestedProject", "model", "thinkingLevel", "forceModel"]
        .every((key) => existing.request?.[key] === request?.[key]);
      if (!passiveJoin && !same) {
        throw conflict("live_session_start_mismatch", "This chat is already starting with different launch settings.");
      }
      return existing.promise;
    }
    if (this.isBusy(chatId)) throw conflict("live_session_starting", "This chat is already starting or changing.");
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
    // This guard increments counters only; it never waits for a chat lock.
    // Callers may therefore take project guard -> chat lock without deadlock.
    const states = [...new Set(projectIds)].sort().map((projectId) => [projectId, this.projectState(projectId)]);
    for (const [, state] of states) {
      if (state.deleting) throw conflict("project_deleting", "This project is being deleted.");
    }
    for (const [, state] of states) state.active += 1;
    try {
      return await work();
    } finally {
      for (const [, state] of states) {
        state.active -= 1;
        if (state.active === 0) {
          for (const resolve of state.waiters.splice(0)) resolve();
        }
      }
    }
  }

  async beginProjectDeletion(projectId) {
    const state = this.projectState(projectId);
    if (state.deleting) throw conflict("project_deleting", "This project is already being deleted.");
    state.deleting = true;
    if (state.active > 0) {
      let timer;
      let drain;
      try {
        await Promise.race([
          new Promise((resolve) => { drain = resolve; state.waiters.push(resolve); }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(conflict("project_busy", "Project operations did not stop in time.")), this.projectDrainTimeoutMs); }),
        ]);
      } catch (error) {
        state.deleting = false;
        throw error;
      } finally {
        clearTimeout(timer);
        const index = state.waiters.indexOf(drain);
        if (index >= 0) state.waiters.splice(index, 1);
      }
    }
    return () => {
      state.deleting = false;
      if (state.active === 0 && state.waiters.length === 0) this.projects.delete(projectId);
    };
  }

  projectState(projectId) {
    let state = this.projects.get(projectId);
    if (!state) {
      state = { active: 0, deleting: false, waiters: [] };
      this.projects.set(projectId, state);
    }
    return state;
  }
}
