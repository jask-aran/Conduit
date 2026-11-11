// Refusals are derived from the capability flags, so they cannot drift out of step with what an adapter advertises.

const refuse = (message) => () => {
  throw Object.assign(new Error(message), { code: "unsupported_interaction", status: 400 });
};

export function unsupported(capabilities, { label, overrides = {} } = {}) {
  const stubs = {};
  if (!capabilities.approvals) {
    stubs.respondHostUi = refuse(`${label} does not expose host UI requests`);
  }
  if (!capabilities.steer && !capabilities.followUpQueue) {
    stubs.queue = refuse(`${label} does not support steering or follow-up queues`);
    stubs.clearQueue = refuse(`${label} does not support steering or follow-up queues`);
  }
  if (!capabilities.modelSwitch) stubs.setModel = refuse(`${label} cannot switch models`);
  if (!capabilities.thinkingLevels) stubs.setThinkingLevel = refuse(`${label} has no thinking levels`);
  // Usage reporting is optional rather than refusable: the caller polls this and
  // a throw would surface as a failed chat rather than an absent number.
  if (!capabilities.usage) stubs.refreshContext = () => Promise.resolve(null);
  if (!capabilities.compaction) stubs.compact = refuse(`${label} does not support compaction`);
  if (!capabilities.fork) stubs.fork = refuse(`${label} history forks are unavailable`);
  if (capabilities.history === "none") stubs.readHistory = refuse(`${label} history is unavailable`);
  return { ...stubs, ...overrides };
}
