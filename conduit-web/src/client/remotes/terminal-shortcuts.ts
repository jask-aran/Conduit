export type TerminalShortcut = {
  id: string;
  label: string;
  command: string;
  target: "current" | "new";
};

export const LEGACY_TERMINAL_SHORTCUTS_STORAGE_KEY = "conduit:terminal-shortcuts:v1";

export function normalizeTerminalShortcuts(value: unknown): TerminalShortcut[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    const id = typeof item?.id === "string" ? item.id.slice(0, 80) : "";
    const label = typeof item?.label === "string" ? item.label.trim().slice(0, 32) : "";
    const command = typeof item?.command === "string" ? item.command.trim().slice(0, 2048) : "";
    const target = item?.target === "new" ? "new" : item?.target === "current" ? "current" : null;
    return id && label && command && target ? [{ id, label, command, target }] : [];
  });
}

export function readLegacyTerminalShortcuts(storage: Storage = localStorage): TerminalShortcut[] {
  try { return normalizeTerminalShortcuts(JSON.parse(storage.getItem(LEGACY_TERMINAL_SHORTCUTS_STORAGE_KEY) || "[]")); }
  catch { return []; }
}
