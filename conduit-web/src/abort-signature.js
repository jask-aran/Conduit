// A provider reports a cancelled request as an "aborted" error; a stop the user asked for reads as a stop, not a
// failure. Kept apart from session-store so the live event path and the replayed transcript agree.
const ABORT_SIGNATURE = /\b(aborted|cancell?ed)\b/i;

function wasAborted(message) {
  if (message?.stopReason === "aborted") return true;
  return message?.stopReason === "error" && ABORT_SIGNATURE.test(message?.errorMessage || "");
}

/**
 * A turn cut off before it wrote anything (the empty assistant entry Pi files when a tool is aborted under it) is not
 * discarded: the mark is for words somebody read that the agent no longer has.
 */
export function wasDiscarded(message, { keepsPartial = false } = {}) {
  if (keepsPartial || message?.role !== "assistant") return false;
  return wasAborted(message) && Boolean(String(message?.content || "").trim());
}
