/**
 * What Pi can do, apart from the adapter that speaks for it.
 *
 * The manager needs these too -- an interrupted message is stated as discarded
 * or not depending on `interruptKeepsPartial` -- and the manager is what the
 * adapter is built around, so the answer lives here rather than in either.
 */
export const PI_CAPABILITIES = Object.freeze({
  history: "tree", fork: true, regenerate: true,
  steer: true, followUpQueue: true, cancel: true, compaction: true,
  // Pi writes an interrupted assistant message to the session file and then
  // does not use it: the entry carries `stopReason: "aborted"`,
  // `errorMessage: "Request was aborted"` and zeroed usage, and the next
  // request is built without it. Measured, not assumed -- across an interrupt
  // the context grew by 560 tokens where the partial alone was ~670, so it was
  // not sent. An aborted *tool* execution does stay in context; it is assistant
  // text that is dropped.
  thinkingLevels: true, modelSwitch: true, toolUse: true,
  // Pi answers approval requests but has no profiles to pick between.
  approvals: true, permissionModes: false,
  usage: true, replay: true,
  attachments: true,
  interruptKeepsPartial: false,
});
