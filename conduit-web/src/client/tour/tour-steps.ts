import { COMMAND_IDS } from "../commands/command-registry";
import { createSignal } from "solid-js";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { formatShortcutStroke } from "../shortcuts/shortcut-normalize";

// The keys shown are the person's own bindings, formatted by the manager, so a rebind shows.

export interface TourEnv {
  hasDock: () => boolean;
  canStepTabs: () => boolean;
  splitShown: () => boolean;
}

export type LeaderChange = { opened: boolean; browsed: boolean; closed: boolean; levels: number | null };

/* The levels with keys the leader last showed: one (the usual, a region inside the app) leaves nothing to browse. */
const [leaderLevels, setLeaderLevels] = createSignal<number | null>(null);
export { setLeaderLevels };

export interface TourTaskDef {
  id: string;
  label: string;
  keys: (shortcuts: ShortcutManager) => string[];
  /** Can be done here and now; a task that cannot is shown faint, with the step's note, and not waited for. */
  available?: (env: TourEnv) => boolean;
  commands?: string[];
  focus?: { after: string[]; in: (element: Element) => boolean };
  key?: (event: KeyboardEvent, target: Element) => boolean;
  tab?: (target: Element, from: Element | null) => boolean;
  leader?: (change: LeaderChange) => boolean;
}

export interface TourStepDef {
  id: string;
  title: string;
  body: (shortcuts: ShortcutManager) => string;
  tasks: TourTaskDef[];
  also?: (shortcuts: ShortcutManager) => { label: string; keys: string[] }[];
  note?: (env: TourEnv, shortcuts: ShortcutManager) => string | null;
  light: (env: TourEnv, done: string[]) => Element | null;
}

export const bound = (shortcuts: ShortcutManager, ...ids: string[]) => {
  const keys = ids.flatMap((id) => shortcuts.effectiveBindings(id).map((_, index) => shortcuts.formatEffectiveBinding(id, index)))
    .filter((key): key is string => Boolean(key));
  return keys.length ? [...new Set(keys)] : ["Not assigned"];
};
const first = (shortcuts: ShortcutManager, id: string) => shortcuts.formatEffectiveBinding(id) ?? "its key (none is set)";
const fixed = (...keys: string[]) => () => keys;

const SIDEBAR = '[data-region="sidebar"]';
const DOCK = ".workspace-panel, .main-split[data-docked]";
const PANE = ".chat-main, .main-split:not([data-docked])";
const TRANSCRIPT = ".ui-chat-viewport";
const DASH_GROUP = ".ui-group[data-group=dash]";
const inSidebar = (element: Element) => Boolean(element.closest(SIDEBAR));
const inDock = (element: Element) => Boolean(element.closest(DOCK));
const inPane = (element: Element) => Boolean(element.closest(PANE)) && !inDock(element);
const editable = (element: Element) => Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
const plain = (event: KeyboardEvent) => !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
const shown = (element: Element | null) => {
  if (!element || element.getAttribute("aria-hidden") === "true") return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? element : null;
};
const focusedPane = () => {
  const active = document.activeElement;
  return shown(active?.closest(PANE) ?? null) ?? shown(document.querySelector(".chat-main"));
};
export const onDashboard = () => Boolean(document.querySelector('.chat-main[data-region="dashboard"]'));
export const hasTranscript = () => Boolean(document.querySelector(TRANSCRIPT));
const transcript = () => {
  const pane = document.activeElement?.closest(PANE);
  return shown(pane?.querySelector(TRANSCRIPT) ?? null) ?? shown(document.querySelector(`.chat-main ${TRANSCRIPT}`));
};

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: "regions",
    title: "Three regions, one chord each",
    body: () => "The app is regions: the sidebar, the pane in front of you, and the dock beside it. Each has a go-to chord that opens it if it is closed and puts focus there. Press each one.",
    tasks: [
      { id: "sidebar", label: "Go to the sidebar", keys: (s) => bound(s, COMMAND_IDS.focusSidebar), focus: { after: [COMMAND_IDS.focusSidebar], in: inSidebar } },
      { id: "pane", label: "Go to the pane", keys: (s) => bound(s, COMMAND_IDS.focusMainPane), focus: { after: [COMMAND_IDS.focusMainPane], in: inPane } },
      { id: "dock", label: "Go to the dock", keys: (s) => bound(s, COMMAND_IDS.focusWorkspacePanel), available: (env) => env.hasDock(), focus: { after: [COMMAND_IDS.focusWorkspacePanel], in: inDock } },
    ],
    note: (env) => env.hasDock() ? null : "This page has no dock. Open a chat in a folder or a workspace and its dock is there; or go on without it.",
    light: (env, done) => !done.includes("sidebar") ? shown(document.querySelector(SIDEBAR))
      : !done.includes("pane") || !env.hasDock() ? focusedPane()
        : shown(document.querySelector(".workspace-panel")),
  },
  {
    id: "lists",
    title: "Moving in a list",
    body: (s) => `Every list moves the same way. Go to the sidebar (${first(s, COMMAND_IDS.focusSidebar)}), move with the arrows, and Enter opens the row. Escape steps back one level at a time.`,
    tasks: [
      { id: "move", label: "Move between rows", keys: fixed("↑", "↓"), key: (event, target) => plain(event) && (event.key === "ArrowUp" || event.key === "ArrowDown") && inSidebar(target) && !editable(target) },
      { id: "open", label: "Open a row", keys: fixed("Enter"), key: (event, target) => plain(event) && event.key === "Enter" && inSidebar(target) && !editable(target) },
      { id: "back", label: "Step back", keys: fixed("Esc"), key: (event, target) => event.key === "Escape" && inSidebar(target) },
    ],
    also: () => [{ label: "First, last row", keys: ["Home", "End"] }, { label: "Into or out of a folder", keys: ["→", "←"] }],
    light: () => shown(document.querySelector(SIDEBAR)),
  },
  {
    id: "groups",
    title: "Tab between groups, arrows inside",
    body: () => "A dashboard is groups of rows: its chats, projects, changes. Tab moves to the next group, landing where you last were in it; the arrows move inside one.",
    tasks: [
      { id: "tab", label: "Tab to another group", keys: fixed("Tab"), available: onDashboard,
        tab: (target, from) => Boolean(target.closest('[data-region="dashboard"]')) && target.closest(DASH_GROUP) !== (from?.closest(DASH_GROUP) ?? null) },
      { id: "arrows", label: "Move inside a group", keys: fixed("↑", "↓"), available: onDashboard,
        key: (event, target) => plain(event) && (event.key === "ArrowUp" || event.key === "ArrowDown") && Boolean(target.closest(DASH_GROUP)) && !editable(target) },
    ],
    also: () => [{ label: "Back a group", keys: ["Shift Tab"] }],
    note: () => onDashboard() ? null : "Open a dashboard to try this: the Conduit home, a project or a workspace, from the sidebar.",
    light: () => onDashboard() ? shown(document.querySelector(".chat-main")) : null,
  },
  {
    id: "leader",
    title: "The leader",
    body: () => `The leader starts a two-key shortcut that acts in the region you are in. Press it and wait: its menu lists the keys that work here. ← and → show the regions round you; Escape closes it, or press a key it lists.`,
    tasks: [
      { id: "open", label: "Open the leader", keys: (s) => s.leader ? [formatShortcutStroke(s.leader, s.environment)] : ["Not assigned"],
        leader: (change) => change.opened },
      { id: "browse", label: "Show another region's keys", keys: fixed("←", "→"), available: () => (leaderLevels() ?? 2) > 1,
        leader: (change) => change.browsed },
      { id: "close", label: "Close it, or press one of its keys", keys: fixed("Esc"),
        leader: (change) => change.closed },
    ],
    also: (s) => [{ label: "From the sidebar: a new chat", keys: bound(s, COMMAND_IDS.sidebarNewChat) }],
    note: () => (leaderLevels() ?? 2) > 1 ? null : "Here only one region has leader keys, so there is no other level to show.",
    light: () => shown(document.activeElement?.closest("[data-region]") ?? null),
  },
  {
    id: "palettes",
    title: "Two palettes",
    body: () => "The command palette runs any command by name, with its key beside it. Chat search finds any chat, in any folder. Escape closes either.",
    tasks: [
      { id: "palette", label: "Open the command palette", keys: (s) => bound(s, COMMAND_IDS.openCommandPalette), commands: [COMMAND_IDS.openCommandPalette] },
      { id: "search", label: "Search chats", keys: (s) => bound(s, COMMAND_IDS.searchChats), commands: [COMMAND_IDS.searchChats, COMMAND_IDS.sidebarSearchChats] },
    ],
    light: () => null,
  },
  {
    id: "transcript",
    title: "The transcript is a list too",
    body: () => "Go to the transcript and a cursor lands on the last turn. ↑ and ↓ move between turns, Enter opens a fold, and the menu key opens the turn's own actions: copy, retry. Escape goes back to the composer.",
    tasks: [
      { id: "go", label: "Go to the transcript", keys: (s) => bound(s, COMMAND_IDS.focusTranscript), available: hasTranscript, commands: [COMMAND_IDS.focusTranscript] },
      { id: "turns", label: "Move between turns", keys: fixed("↑", "↓"), available: hasTranscript,
        key: (event, target) => plain(event) && (event.key === "ArrowUp" || event.key === "ArrowDown") && target.matches(TRANSCRIPT) },
      { id: "menu", label: "Open the turn's menu", keys: fixed("Shift F10"), available: hasTranscript,
        key: (event, target) => (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && target.matches(TRANSCRIPT) },
      { id: "find", label: "Find in chat", keys: (s) => bound(s, COMMAND_IDS.findInChat), available: hasTranscript, commands: [COMMAND_IDS.findInChat] },
    ],
    note: (_env, s) => hasTranscript() ? null : `Open a chat first: ${first(s, COMMAND_IDS.focusSidebar)}, ↑ or ↓ to a chat, Enter.`,
    light: () => transcript(),
  },
  {
    id: "panes",
    title: "Tabs and panes",
    body: () => "Step through a pane's tabs, and between panes side by side, from anywhere. The pane with the keyboard has leader keys of its own to close and swap.",
    tasks: [
      { id: "tabs", label: "Step tabs", keys: (s) => bound(s, COMMAND_IDS.previousTab, COMMAND_IDS.nextTab), available: (env) => env.canStepTabs(),
        commands: [COMMAND_IDS.nextTab, COMMAND_IDS.previousTab] },
      { id: "panes", label: "Step panes", keys: (s) => bound(s, COMMAND_IDS.previousPane, COMMAND_IDS.nextPane), available: (env) => env.splitShown(),
        commands: [COMMAND_IDS.nextPane, COMMAND_IDS.previousPane] },
    ],
    also: (s) => [
      { label: "Close tab", keys: bound(s, COMMAND_IDS.closeTab) },
      { label: "Close pane", keys: bound(s, COMMAND_IDS.closePane) },
      { label: "Swap panes", keys: bound(s, COMMAND_IDS.swapPanes) },
    ],
    note: (env) => [
      env.canStepTabs() ? null : "This pane has one tab.",
      env.splitShown() ? null : "There is one pane: drag a chat or a tool beside this one to step between them.",
    ].filter(Boolean).join(" ") || null,
    light: () => focusedPane(),
  },
  {
    id: "leave",
    title: "Escape, stop, and your own keys",
    body: () => "Escape always steps back exactly one level, and never does anything else; from anywhere it gets you home to the composer. Stopping a turn has its own chord. Every key here can be changed in Settings › Shortcuts.",
    tasks: [
      { id: "escape", label: "Step back", keys: fixed("Esc"), key: (event) => event.key === "Escape" },
      { id: "settings", label: "Open Settings", keys: (s) => bound(s, COMMAND_IDS.openSettings), commands: [COMMAND_IDS.openSettings] },
    ],
    also: (s) => [{ label: "Stop a turn", keys: bound(s, COMMAND_IDS.stopResponse) }],
    light: () => null,
  },
];
