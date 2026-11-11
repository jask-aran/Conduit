import { normalizeModifiers } from "./shortcut-normalize.ts";
import type {
  ShortcutBinding, ShortcutCommandDefinition, ShortcutOverrides,
} from "./shortcut-types.ts";
import { effectiveShortcutBindings } from "./shortcut-preferences.ts";

export interface GlobalShortcut {
  accelerator: string;
  commandId: string;
}

/**
 * A system-wide key is taken from every other application, so a bare letter would swallow typing everywhere, and a
 * two-stroke sequence would mean watching every keystroke on the machine.
 */
export function globalAccelerator(binding: ShortcutBinding): string | null {
  if (binding.strokes.length !== 1) return null;
  const stroke = binding.strokes[0]!;
  const modifiers = normalizeModifiers(stroke.modifiers);
  if (!modifiers.length) return null;
  const parts = modifiers.map((modifier) => {
    if (modifier === "primary") return "CommandOrControl";
    if (modifier === "control") return "Control";
    if (modifier === "alt") return "Alt";
    return "Shift";
  });
  // The physical key travels as its code, which is what the shell's parser reads.
  return [...parts, stroke.code].join("+");
}

/** The first claim on an accelerator wins, so the shell is never asked to register one chord twice. */
export function globalShortcuts(
  commands: ShortcutCommandDefinition[],
  overrides: ShortcutOverrides,
): GlobalShortcut[] {
  const claimed = new Set<string>();
  const shortcuts: GlobalShortcut[] = [];
  for (const command of commands) {
    if (!command.contexts.includes("global")) continue;
    for (const binding of effectiveShortcutBindings(command, overrides)) {
      const accelerator = globalAccelerator(binding);
      if (!accelerator || claimed.has(accelerator)) continue;
      claimed.add(accelerator);
      shortcuts.push({ accelerator, commandId: command.id });
    }
  }
  return shortcuts;
}
