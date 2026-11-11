/**
 * Only one branch is ever active, so listing every region before the regions it sits inside (below) is enough for
 * the innermost to win and the rest to follow in order.
 */
export const SHORTCUT_REGION_PARENTS = {
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
  // The regions, each before the ones it sits inside. The main pane is one
  // region whole: its composer and transcript are parts of it, not regions of
  // their own.
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
  context: ShortcutContext;
  firstStroke: ShortcutStroke;
  commandIds: string[];
  /** Innermost first: the second stroke is looked for in that order, so an inner region's key hides an outer one's. */
  levels: Array<{ context: ShortcutContext; commandIds: string[] }>;
  /** Which level the leader menu is showing; browsed with ←/→ and Tab. */
  shown: number;
}
