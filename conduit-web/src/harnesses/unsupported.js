// Capability flags stop being decorative here. An adapter declares what it can
// do once, in its ChatCapabilities, and the refusals for everything else are
// derived from that - rather than each adapter hand-writing four throwing stubs
// that can drift out of step with the flags it advertises.

const refuse = (message) => () => {
  throw Object.assign(new Error(message), { code: "unsupported_interaction", status: 400 });
};

/**
 * Build the stub methods a backend must expose but cannot honour.
 *
 * @param capabilities the adapter's ChatCapabilities
 * @param label human name used in the refusal message
 * @param protocol AgentProtocol; only `pi_rpc` backends accept raw Pi commands
 * @param overrides methods the adapter implements after all, or extra refusals
 */
export function unsupported(capabilities, { label, protocol = "native_api", overrides = {} } = {}) {
  const stubs = {};
  if (!capabilities.permissions) {
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
  // History forks have no capability flag; no backend but Pi implements one.
  stubs.fork = refuse(`${label} history forks are unavailable`);
  if (protocol !== "pi_rpc") stubs.sendNative = refuse(`Unsupported ${label} command`);
  return { ...stubs, ...overrides };
}
