function conflict(code, message) {
  return Object.assign(new Error(message), { code, status: 409 });
}

// Serializes the transitions that change a chat's process, session mapping, or
// owning project. Project guards are shared locks: deletion marks a project as
// closing before waiting for active launch/move work to drain.
export class ChatLifecycle {
  constructor() {
    this.chatTails = new Map();
    this.deletingChats = new Set();
    this.projects = new Map();
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

  async runLaunch(chatId, work) {
    if (this.isBusy(chatId)) throw conflict("live_session_starting", "Pi is already starting or changing for this chat.");
    return this.run(chatId, work);
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
    if (state.active > 0) await new Promise((resolve) => state.waiters.push(resolve));
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
