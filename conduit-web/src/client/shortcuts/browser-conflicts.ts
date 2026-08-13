import { shortcutBinding, shortcutStroke } from "./shortcut-normalize.ts";
import type {
  ShortcutBinding, ShortcutBrowser, ShortcutPlatform,
} from "./shortcut-types.ts";

export interface BrowserShortcutConflictRecord {
  id: string;
  owner: string;
  action: string;
  kind: "browser" | "system";
  browsers?: ShortcutBrowser[];
  platforms?: ShortcutPlatform[];
  binding: ShortcutBinding;
}

export const BROWSER_SHORTCUT_CONFLICTS_VERSION = 1;

const primary = (code: string, key: string, shift = false) =>
  shortcutBinding(shortcutStroke(code, key, shift ? ["primary", "shift"] : ["primary"]));

export const BROWSER_SHORTCUT_CONFLICTS: BrowserShortcutConflictRecord[] = [
  {
    id: "browser-print",
    owner: "Browser",
    action: "Print",
    kind: "browser",
    binding: primary("KeyP", "P"),
  },
  {
    id: "browser-bookmark-all-tabs",
    owner: "Browser",
    action: "Bookmark all tabs",
    kind: "browser",
    browsers: ["chrome", "chromium", "edge", "firefox"],
    binding: primary("KeyD", "D", true),
  },
  {
    id: "browser-address-search-k",
    owner: "Browser",
    action: "Search from the address bar",
    kind: "browser",
    browsers: ["chrome", "chromium", "edge", "firefox"],
    platforms: ["windows", "linux", "chromeos"],
    binding: primary("KeyK", "K"),
  },
  {
    id: "browser-address-search-e",
    owner: "Browser",
    action: "Search from the address bar",
    kind: "browser",
    browsers: ["chrome", "chromium", "edge", "firefox"],
    platforms: ["windows", "linux", "chromeos"],
    binding: primary("KeyE", "E"),
  },
  {
    id: "browser-firefox-web-console",
    owner: "Firefox",
    action: "Open Web Console",
    kind: "browser",
    browsers: ["firefox"],
    platforms: ["windows", "linux", "chromeos"],
    binding: primary("KeyK", "K", true),
  },
  {
    id: "browser-bookmarks",
    owner: "Browser",
    action: "Open bookmark manager",
    kind: "browser",
    browsers: ["chrome", "chromium", "edge", "firefox"],
    platforms: ["windows", "linux", "chromeos"],
    binding: primary("KeyO", "O", true),
  },
  {
    id: "browser-new-chat-devtools",
    owner: "Browser developer tools",
    action: "Inspect an element",
    kind: "browser",
    browsers: ["chrome", "chromium", "edge", "firefox"],
    platforms: ["windows", "linux", "chromeos"],
    binding: primary("KeyC", "C", true),
  },
  {
    id: "browser-find",
    owner: "Browser",
    action: "Find in page",
    kind: "browser",
    binding: primary("KeyF", "F"),
  },
  {
    id: "browser-save",
    owner: "Browser",
    action: "Save page",
    kind: "browser",
    binding: primary("KeyS", "S"),
  },
  {
    id: "browser-close-tab",
    owner: "Browser",
    action: "Close tab",
    kind: "browser",
    binding: primary("KeyW", "W"),
  },
  {
    id: "system-close-window",
    owner: "Operating system",
    action: "Close the active window",
    kind: "system",
    platforms: ["windows", "linux"],
    binding: shortcutBinding(shortcutStroke("F4", "F4", ["alt"])),
  },
  {
    id: "system-spotlight",
    owner: "macOS",
    action: "Open Spotlight",
    kind: "system",
    platforms: ["macos"],
    binding: primary("Space", "Space"),
  },
];
