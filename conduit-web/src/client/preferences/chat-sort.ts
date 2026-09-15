import { createSignal } from "solid-js";
import { publishUiPreference, UI_PREFERENCE_CHANGE_EVENT } from "./ui-preferences.ts";

export const CHAT_SORT_STORAGE_KEY = "conduit:chat-sort";
export type ChatSort = "latest" | "created";

export function isChatSort(value: unknown): value is ChatSort {
  return value === "latest" || value === "created";
}

export function parseChatSort(value: unknown): ChatSort {
  return isChatSort(value) ? value : "latest";
}

export function selectedChatSort(): ChatSort {
  if (typeof localStorage === "undefined") return "latest";
  return parseChatSort(localStorage.getItem(CHAT_SORT_STORAGE_KEY));
}

type SortableChat = { id?: string; createdAt?: unknown; lastMessageAt?: unknown };

function normalizeChatTimestamp(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const date = new Date(value < 1_000_000_000_000 ? value * 1_000 : value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function chatSortStamp(chat: SortableChat, sort: ChatSort) {
  const selected = sort === "created" ? chat.createdAt : chat.lastMessageAt || chat.createdAt;
  return normalizeChatTimestamp(selected);
}

export function compareChatsBySort(
  left: SortableChat,
  right: SortableChat,
  sort: ChatSort,
) {
  return chatSortStamp(right, sort).localeCompare(chatSortStamp(left, sort))
    || String(right.id || "").localeCompare(String(left.id || ""));
}

export function sortChats<T extends SortableChat>(chats: T[], sort: ChatSort) {
  return [...chats].sort((left, right) => compareChatsBySort(left, right, sort));
}

const [chatSort, setChatSort] = createSignal<ChatSort>(selectedChatSort());

if (typeof window !== "undefined") {
  window.addEventListener(UI_PREFERENCE_CHANGE_EVENT, (event) => {
    const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
    if (detail?.key === "chatSort" && isChatSort(detail.value)) setChatSort(detail.value);
  });
}

export function useChatSort() {
  return chatSort;
}

export function saveChatSort(value: ChatSort) {
  setChatSort(value);
  if (typeof localStorage !== "undefined") localStorage.setItem(CHAT_SORT_STORAGE_KEY, value);
  return publishUiPreference("chatSort", value);
}
