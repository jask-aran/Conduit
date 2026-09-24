/**
 * The surfaces focus can be in, as a tree: each region and the regions it can
 * sit inside. A surface marks its element `data-region`, and while focus is
 * inside it, its context and every region around it are active -- a chain
 * such as application › chat › composer, worked out from focus. Only one
 * branch is ever active, so listing every region before the regions it sits
 * inside (below) is enough for the innermost to win and the rest to follow
 * in order. A composer sits in a chat or on a dashboard.
 */
export const SHORTCUT_REGION_PARENTS = {
  composer: ["chat", "dashboard"],
  transcript: ["chat"],
  "workspace-panel": ["application"],
  sidebar: ["application"],
  chat: ["application"],
  dashboard: ["application"],
  terminal: ["application"],
} as const;

export type ShortcutRegion = keyof typeof SHORTCUT_REGION_PARENTS;
export const isShortcutRegion = (value: string | null | undefined): value is ShortcutRegion =>
  value != null && Object.hasOwn(SHORTCUT_REGION_PARENTS, value);

export const SHORTCUT_CONTEXT_PRIORITY = [
  "shortcut-recorder",
  "confirmation",
  "chat-search.rename",
  "chat-search.move",
  "chat-search.edit",
  "chat-search.browse",
  "model-selector",
  "palette.page",
  "palette.root",
  "settings",
  // The regions, each before the ones it sits inside.
  "composer",
  "transcript",
  "workspace-panel",
  "sidebar",
  "chat",
  "dashboard",
  "terminal",
  "application",
  // Not a context the window dispatches in: a command scoped here is handed to
  // the OS by the desktop shell and fires while Conduit is not focused. It sits
  // in this list so the registry checks it for ambiguity like any other scope,
  // and last so that nothing in the window is ever shadowed by it.
  "global",
] as const;

export type KnownShortcutContext = typeof SHORTCUT_CONTEXT_PRIORITY[number];
export type ShortcutContext = KnownShortcutContext | (string & {});
export type ShortcutModifier = "primary" | "control" | "alt" | "shift";
export type ShortcutPlatform = "macos" | "windows" | "linux" | "chromeos" | "ios" | "android" | "unknown";
export type ShortcutBrowser = "chrome" | "edge" | "firefox" | "safari" | "chromium" | "unknown";
export type ShortcutDisplayMode = "browser-tab" | "standalone";

export interface ShortcutEnvironment {
  platform: ShortcutPlatform;
  browser: ShortcutBrowser;
  displayMode: ShortcutDisplayMode;
}

export interface ShortcutEnvironmentProvider {
  detect(): ShortcutEnvironment;
}

export interface ShortcutStroke {
  code: string;
  key: string;
  modifiers: ShortcutModifier[];
}

export type ShortcutStrokeSequence = [ShortcutStroke] | [ShortcutStroke, ShortcutStroke];

export interface ShortcutBinding {
  strokes: ShortcutStrokeSequence;
}

export interface ShortcutCommandDefinition {
  id: string;
  label: string;
  description: string;
  group: string;
  keywords: string[];
  icon: string;
  contexts: ShortcutContext[];
  defaultBindings: ShortcutBinding[];
  configurable: boolean;
  allowRepeat?: boolean;
  allowInExclusiveTarget?: boolean;
  destructive?: boolean;
  palette?: boolean;
}

export type ShortcutOverrides = Record<string, ShortcutBinding[]>;

export interface ShortcutConflict {
  kind: "browser" | "system" | "conduit" | "context-reuse";
  severity: "warning" | "error" | "info";
  commandId?: string;
  commandLabel?: string;
  context?: ShortcutContext;
  owner: string;
  action: string;
}

export interface PendingShortcutSequence {
  /** The innermost region with a sequence for this first stroke. */
  context: ShortcutContext;
  firstStroke: ShortcutStroke;
  /** Every command a second stroke could run, across the levels. */
  commandIds: string[];
  /**
   * The regions around focus, innermost first, each with the commands its
   * sequences name -- empty for a region with none. The second stroke is
   * looked for innermost first, so an inner region's key hides an outer one's.
   */
  levels: Array<{ context: ShortcutContext; commandIds: string[] }>;
  /** Which level the leader menu is showing; browsed with ←/→ and Tab. */
  shown: number;
}
