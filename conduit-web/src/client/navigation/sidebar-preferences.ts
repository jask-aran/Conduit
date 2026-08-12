export const SIDEBAR_CHAT_LIMIT_STORAGE_KEY = "conduit:sidebar-chat-limit";
export const DEFAULT_SIDEBAR_CHAT_LIMIT = 20;
export const MIN_SIDEBAR_CHAT_LIMIT = 5;
export const MAX_SIDEBAR_CHAT_LIMIT = 100;

export function clampSidebarChatLimit(value: unknown): number {
  if (value == null || value === "") return DEFAULT_SIDEBAR_CHAT_LIMIT;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SIDEBAR_CHAT_LIMIT;
  return Math.min(MAX_SIDEBAR_CHAT_LIMIT, Math.max(MIN_SIDEBAR_CHAT_LIMIT, Math.round(number)));
}

export function selectedSidebarChatLimit(): number {
  if (typeof localStorage === "undefined") return DEFAULT_SIDEBAR_CHAT_LIMIT;
  return clampSidebarChatLimit(localStorage.getItem(SIDEBAR_CHAT_LIMIT_STORAGE_KEY));
}
