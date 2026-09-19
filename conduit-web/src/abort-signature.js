// Stopping a turn cancels the in-flight provider request, and the provider
// reports that cancellation as a failure - "This operation was aborted". A stop
// the user asked for is not a failure, so it is read back as one: an abort
// carries no error, and renders as "Stopped" rather than a red failure card.
//
// This lives apart from session-store so the live event path and the replayed
// transcript agree. They used to disagree: the same turn was a red error while
// streaming and a clean stop after a reload.
const ABORT_SIGNATURE = /\b(aborted|cancell?ed)\b/i;

export function wasAborted(message) {
  if (message?.stopReason === "aborted") return true;
  return message?.stopReason === "error" && ABORT_SIGNATURE.test(message?.errorMessage || "");
}

/**
 * Whether an interrupted message is text the harness will not carry forward.
 *
 * Two conditions, and the second matters as much as the first. A turn cut off
 * before it wrote anything -- the empty assistant entry Pi files when a tool is
 * aborted under it -- has nothing to preserve, and striking it through would be
 * marking the absence of text rather than the loss of it. The mark is for words
 * somebody read that the agent no longer has.
 */
export function wasDiscarded(message, { keepsPartial = false } = {}) {
  if (keepsPartial || message?.role !== "assistant") return false;
  return wasAborted(message) && Boolean(String(message?.content || "").trim());
}
