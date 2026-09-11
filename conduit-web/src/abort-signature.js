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
