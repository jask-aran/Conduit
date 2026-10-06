/**
 * Empty Pi drafts kept with their agent already running, one per place and
 * profile.
 *
 * A page with a composer holds a draft chat, and a Pi agent takes about a
 * second to boot, which used to be spent after the first message was sent.
 * A draft is launched when it is made, and an untouched one given up by
 * its page is kept here instead of deleted, so coming back to that place, or
 * flicking through pages, costs no process start or teardown.
 */
export function createWarmDrafts({ backends, registry, projects, max = 3 }) {
  // key -> chatId, oldest first.
  const pool = new Map();
  const keyOf = (projectId, profileId) => `${projectId}\u0000${profileId}`;

  const discard = async (chatId) => {
    const chat = registry.metadata(chatId);
    const project = chat && await projects.get(chat.projectId);
    await Promise.all(backends.rawRecords().filter((record) => record.chatId === chatId)
      .map((record) => backends.adapterForRecord(record).close(record.id)));
    if (project) await registry.removeEmptyDraft(chatId, project);
  };

  const usable = (chatId) => {
    const chat = registry.metadata(chatId);
    const live = backends.getByChatId(chatId);
    return Boolean(chat && chat.status === "draft" && !chat.title && live
      && !live.terminating && live.status !== "stopped");
  };

  return {
    /** The warm draft for this place and Pi profile, given up by the pool. */
    async take(projectId, templateId) {
      const key = keyOf(projectId, templateId);
      const chatId = pool.get(key);
      if (!chatId) return null;
      pool.delete(key);
      if (usable(chatId)) return registry.metadata(chatId);
      await discard(chatId).catch(() => {});
      return null;
    },

    /**
     * Keep a draft its page has let go of. False when it is not one to keep,
     * and the caller deletes it as before.
     */
    async release(chat) {
      if (!chat.templateId || chat.backend?.implementation !== "conduit_pi" || !usable(chat.id)) return false;
      const key = keyOf(chat.projectId, chat.templateId);
      const held = pool.get(key);
      if (held === chat.id) return true;
      if (held) return false;
      pool.set(key, chat.id);
      while (pool.size > max) {
        const [oldestKey, oldest] = pool.entries().next().value;
        pool.delete(oldestKey);
        await discard(oldest).catch(() => {});
      }
      return true;
    },

    has: (chatId) => [...pool.values()].includes(chatId),
  };
}
