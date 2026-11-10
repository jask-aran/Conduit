import { createSignal } from "solid-js";

/**
 * What Conduit's own title bar shows (Settings › Appearance, under Title bar): each item can be hidden, while what to
 * keep is decided in use. Saved on this device; every item shows until hidden.
 */
export const TITLE_BAR_ITEMS = [
  { id: "server", label: "Server", about: "The hub, its connection and route; opens the server menu." },
  { id: "history", label: "Back and forward", about: "Back and forward through what the panes showed." },
  { id: "search", label: "Search", about: "Search or run a command (the palette)." },
  { id: "live", label: "Live chats", about: "How many chats are live and running; opens a list of them." },
  { id: "agent", label: "Agent", about: "What the agent waits on you for; opens its page." },
  { id: "update", label: "Update", about: "An update ready to take." },
  { id: "panels", label: "Sidebar and dock", about: "Toggles for the sidebar and the dock." },
  { id: "layout", label: "Equalise panes", about: "Even widths, when panes are split." },
] as const;
export type TitleBarItem = (typeof TITLE_BAR_ITEMS)[number]["id"];

const KEY = "conduit:title-bar-hidden";
const read = (): TitleBarItem[] => { try { const value = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
const [hidden, setHidden] = createSignal<TitleBarItem[]>(typeof window === "undefined" ? [] : read());
export const titleBarShows = (item: TitleBarItem) => !hidden().includes(item);
export function setTitleBarShows(item: TitleBarItem, shown: boolean) {
  const next = shown ? hidden().filter((value) => value !== item) : [...new Set([...hidden(), item])];
  setHidden(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
}
