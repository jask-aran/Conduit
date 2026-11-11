import { api } from "../api/client";
import type { ChatSummary } from "../api/contracts";
type ReadableCatalogue = { patchChat: (chatId: string, patch: Partial<ChatSummary>) => unknown };

/**
 * The body echoes a server timestamp, never a browser clock, so a lost, late or duplicated receipt can only re-assert
 * a watermark already passed; that is why a failure is swallowed.
 */
export function markChatRead(catalogue: ReadableCatalogue, chat: ChatSummary | null | undefined) {
  if (!chat?.id || !chat.unread) return;
  catalogue.patchChat(chat.id, { unread: false });
  void api(`/v0/sessions/${encodeURIComponent(chat.id)}/read`, {
    method: "POST",
    body: JSON.stringify({ upTo: chat.lastAssistantCompletedAt || null }),
  }).catch(() => {});
}
