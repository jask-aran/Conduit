import { normalizeStoredBinding } from "./shortcut-normalize.ts";
import type {
  ShortcutBinding, ShortcutCommandDefinition, ShortcutOverrides,
} from "./shortcut-types.ts";

export const SHORTCUT_PREFERENCES_STORAGE_KEY = "conduit:shortcuts:v1";

interface ShortcutPreferencesDocument {
  version: 1;
  overrides: ShortcutOverrides;
}

export interface ShortcutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const availableStorage = (): ShortcutStorage | null => typeof localStorage === "undefined" ? null : localStorage;

export function parseShortcutOverrides(value: string | null): ShortcutOverrides {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Partial<ShortcutPreferencesDocument>;
    if (parsed.version !== 1 || !parsed.overrides || typeof parsed.overrides !== "object" || Array.isArray(parsed.overrides)) return {};
    const overrides: ShortcutOverrides = {};
    for (const [commandId, bindings] of Object.entries(parsed.overrides)) {
      if (!Array.isArray(bindings)) continue;
      const normalized = bindings.map(normalizeStoredBinding);
      if (normalized.some((binding) => !binding)) continue;
      overrides[commandId] = normalized as ShortcutBinding[];
    }
    return overrides;
  } catch {
    return {};
  }
}

export function readShortcutOverrides(storage: ShortcutStorage | null = availableStorage()): ShortcutOverrides {
  if (!storage) return {};
  return parseShortcutOverrides(storage.getItem(SHORTCUT_PREFERENCES_STORAGE_KEY));
}

export function writeShortcutOverrides(overrides: ShortcutOverrides, storage: ShortcutStorage | null = availableStorage()): void {
  if (!storage) return;
  const document: ShortcutPreferencesDocument = { version: 1, overrides };
  storage.setItem(SHORTCUT_PREFERENCES_STORAGE_KEY, JSON.stringify(document));
}

export function clearShortcutOverrides(storage: ShortcutStorage | null = availableStorage()): void {
  storage?.removeItem(SHORTCUT_PREFERENCES_STORAGE_KEY);
}

export function effectiveShortcutBindings(
  command: ShortcutCommandDefinition,
  overrides: ShortcutOverrides,
): ShortcutBinding[] {
  return Object.hasOwn(overrides, command.id) ? overrides[command.id]! : command.defaultBindings;
}
