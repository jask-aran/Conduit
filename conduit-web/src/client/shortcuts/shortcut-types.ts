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
  "workspace-panel",
  "composer",
  "chat",
  "application",
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
}
