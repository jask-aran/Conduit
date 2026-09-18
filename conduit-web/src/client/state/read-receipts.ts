import { api } from "../api/client";
import type { ChatSummary } from "../api/contracts";
/** Just enough catalogue to clear the row locally; both stores satisfy it. */
type ReadableCatalogue = { patchChat: (chatId: string, patch: Partial<ChatSummary>) => unknown };

/**
 * Say this chat has been read up to the newest completion this client has
 * actually rendered.
 *
 * The body echoes a timestamp the server issued, never a browser clock, so
 * skew cannot reach the comparison and a receipt that is lost, late or
 * duplicated can only re-assert a watermark already passed. That is why a
 * failure is swallowed: the next receipt supersedes it.
 */
export function markChatRead(catalogue: ReadableCatalogue, chat: ChatSummary | null | undefined) {
  if (!chat?.id || !chat.unread) return;
  catalogue.patchChat(chat.id, { unread: false });
  void api(`/v0/sessions/${encodeURIComponent(chat.id)}/read`, {
    method: "POST",
    body: JSON.stringify({ upTo: chat.lastAssistantCompletedAt || null }),
  }).catch(() => {});
}
